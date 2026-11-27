/**
 * One running game. Every player is a tycoon: a trader who also runs one listed company.
 * Owns the subsystems and the two clocks:
 *   - world loop: every CONFIG.clocks.worldTickMs (100ms) — timers, events, broadcasts
 *   - market clock: every CONFIG.clocks.marketTickMs (20s) — the batch auction
 * Everything a player sees is built per-player. Never broadcast raw state.
 */

import {
  CONFIG,
  type Action,
  type Ack,
  type AssetInfo,
  type GameRecap,
  type GameStatic,
  type LobbySettings,
  type Notice,
  type PlayerView,
  type Role,
  type Sector,
} from '@warmarket/shared';
import { Market, type AssetState, type TradeRecord } from '../market/market.js';
import { Rng, randomSeed, uid } from '../util/rng.js';
import type { Emitter } from '../net/emitter.js';
import { NewsService } from '../events/news.js';
import { WorldEvents } from '../events/worldEvents.js';
import { detectManipulation, fineFor } from '../espionage/regulator.js';
import { Corporate } from '../corporate/corporate.js';
import { Influence } from '../influence/influence.js';
import { Chat } from '../chat/chat.js';

export interface GamePlayer {
  id: string;
  name: string;
  color: string;
  companyName: string;
  sector: Sector;
}

/** Ticker from a company name: first letters of its words, padded from the first word. */
export function makeTicker(name: string, used: Set<string>): string {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean);
  let t = words.map((w) => w[0]).join('').slice(0, 4);
  const first = words[0] ?? 'CO';
  for (let i = 1; t.length < 4 && i < first.length; i++) t += first[i];
  t = (t + 'XXXX').slice(0, 4);
  let k = 0;
  let out = t;
  while (used.has(out)) out = t.slice(0, 3) + String.fromCharCode(65 + (k++ % 26));
  used.add(out);
  return out;
}

export class Game {
  readonly rng: Rng;
  readonly seed: number;
  readonly market: Market;
  readonly news: NewsService;
  readonly events: WorldEvents;
  readonly corporate: Corporate;
  readonly influence: Influence;
  readonly chat: Chat;
  readonly startedAt: number;
  readonly endsAt: number;
  nextMarketTickAt: number;
  private loop: NodeJS.Timeout | null = null;
  private lastViewAt = 0;
  private lastPressureAt = 0;
  private lastPressureLogAt = 0;
  private tradeHistory: TradeRecord[] = [];
  /** Persistent multipliers on fundamental value from events/stories/fraud; decay to 1. */
  private shifts = new Map<string, number>();
  readonly roles = new Map<string, Role>();
  readonly reputation = new Map<string, number>();
  readonly fines = new Map<string, number>();
  /** Net worth at the opening bell, for "biggest loser". */
  readonly startWorth = new Map<string, number>();
  /** playerId → their company's ticker */
  readonly companyOf = new Map<string, string>();
  ended = false;
  recap: GameRecap | null = null;
  /** Game clock. Real time in production; tests swap in simulated time. */
  clock: () => number = () => Date.now();

  constructor(
    readonly code: string,
    readonly players: GamePlayer[],
    readonly settings: LobbySettings,
    readonly emit: Emitter,
    private onEnd: () => void,
    seed = randomSeed(),
    now = Date.now(),
  ) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.startedAt = now;
    // WARMARKET_SESSION_SCALE (dev only) shrinks sessions, e.g. 0.02 → a 10-minute game lasts 12s.
    const scale = Number(process.env.WARMARKET_SESSION_SCALE) > 0 ? Number(process.env.WARMARKET_SESSION_SCALE) : 1;
    this.endsAt = now + settings.sessionMinutes * 60_000 * scale;
    this.nextMarketTickAt = now + CONFIG.clocks.marketTickMs;
    this.market = new Market(this.rng, now);
    this.news = new NewsService(emit);
    this.events = new WorldEvents(this);
    this.corporate = new Corporate(this);
    this.influence = new Influence(this);
    this.chat = new Chat(this);
    this.assignRoles();

    const used = new Set<string>();
    for (const c of CONFIG.commodities) {
      used.add(c.id);
      this.market.addAsset({ id: c.id, name: c.name, kind: 'commodity', basePrice: c.basePrice }, c.depth, c.volatility);
    }
    for (const c of CONFIG.npcCompanies) {
      used.add(c.id);
      this.market.addAsset({ id: c.id, name: c.name, kind: 'company', sector: c.sector, ownerId: null, basePrice: c.basePrice }, CONFIG.companies.depth, CONFIG.companies.volatility);
    }
    used.add(CONFIG.memecoin.id);
    for (const p of players) {
      const ticker = makeTicker(p.companyName, used);
      this.companyOf.set(p.id, ticker);
      this.market.addAsset({ id: ticker, name: p.companyName, kind: 'company', sector: p.sector, ownerId: p.id, basePrice: CONFIG.start.ipoPrice }, CONFIG.companies.depth, CONFIG.companies.volatility);
      this.corporate.add(p.id, ticker);
    }
    const mc = CONFIG.memecoin;
    this.market.addAsset({ id: mc.id, name: mc.name, kind: 'memecoin', basePrice: mc.basePrice }, mc.depth, mc.volatility);
    this.market.seedHistory(30);

    for (const p of players) {
      const role = this.roles.get(p.id);
      this.market.openAccount(p.id, CONFIG.start.cash * (role === 'whale' ? CONFIG.roles.whaleCashMultiplier : 1));
      this.market.grantShares(p.id, this.companyOf.get(p.id)!, CONFIG.start.founderShares, CONFIG.start.ipoPrice);
      this.reputation.set(p.id, CONFIG.reputation.start);
    }
    for (const p of players) this.startWorth.set(p.id, this.netWorth(p.id));
  }

  private assignRoles(): void {
    for (const p of this.players) this.roles.set(p.id, 'none');
    if (!this.settings.rolesEnabled) return;
    const pool: Role[] = ['analyst', 'whale', 'journalist'];
    this.rng.shuffle([...this.players]).forEach((p, i) => this.roles.set(p.id, pool[i % pool.length]));
  }

  // ------------------------------------------------------------------- lifecycle

  start(): void {
    this.loop = setInterval(() => {
      try {
        this.worldTick(Date.now());
      } catch (err) {
        console.error(`[game ${this.code}] tick error`, err);
      }
    }, CONFIG.clocks.worldTickMs);
    for (const p of this.players) this.sendInitial(p.id);
    const ipos = this.players.map((p) => `${p.companyName} (${this.companyOf.get(p.id)})`).join(', ');
    this.news.post('Market Desk', `Markets open. Today's IPOs: ${ipos}. The exchange clears every 20 seconds.`, 'neutral', true);
    for (const p of this.players) {
      const role = this.roles.get(p.id);
      if (role && role !== 'none') this.notify(p.id, 'tip', ROLE_BLURB[role]);
    }
  }

  stop(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  /** Everything a (re)joining client needs to render from scratch. */
  sendInitial(playerId: string): void {
    this.emit.toPlayer(playerId, 'game:static', this.staticFor(playerId));
    this.emit.toPlayer(playerId, 'game:history', {
      tick: this.market.tickNo,
      nextTickAt: this.nextMarketTickAt,
      quotes: this.market.quotes(),
      history: this.market.history(),
    });
    this.emit.toPlayer(playerId, 'news:backlog', this.news.backlog());
    this.emit.toPlayer(playerId, 'chat:backlog', this.chat.for(playerId));
    this.pushAccount(playerId);
    this.emit.toPlayer(playerId, 'game:view', this.buildView(playerId, this.clock()));
    if (this.recap) this.emit.toPlayer(playerId, 'game:ended', this.recap);
  }

  staticFor(playerId: string): GameStatic {
    return {
      code: this.code,
      assets: [...this.market.assets.values()].map((a) => a.info as AssetInfo),
      players: this.players.map((p) => ({ id: p.id, name: p.name, color: p.color, companyId: this.companyOf.get(p.id)! })),
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      marketTickMs: CONFIG.clocks.marketTickMs,
      settings: this.settings,
      playerId,
    };
  }

  // ------------------------------------------------------------------- loop

  worldTick(now: number): void {
    if (this.ended) return;
    this.events.tick(now);

    if (now - this.lastPressureLogAt >= 1000) {
      this.lastPressureLogAt = now;
      this.market.logPressure(now);
    }
    if (now >= this.nextMarketTickAt) {
      this.marketTick(now);
      this.nextMarketTickAt += CONFIG.clocks.marketTickMs;
      if (this.nextMarketTickAt < now) this.nextMarketTickAt = now + CONFIG.clocks.marketTickMs;
    }
    if (now - this.lastPressureAt >= CONFIG.clocks.pressureBroadcastMs) {
      this.lastPressureAt = now;
      this.broadcastPressure(now);
    }
    if (now - this.lastViewAt >= CONFIG.clocks.viewBroadcastMs) {
      this.lastViewAt = now;
      for (const p of this.players) this.emit.toPlayer(p.id, 'game:view', this.buildView(p.id, now));
    }
    if (now >= this.endsAt) this.finish(now, 'Highest net worth when the closing bell rang');
  }

  // ------------------------------------------------------------------- fundamentals

  /** Multiply an asset's fundamental value (events, planted stories, fraud). Decays back to 1. */
  shiftFundamental(assetId: string, mult: number): void {
    if (!Number.isFinite(mult) || mult <= 0) return;
    const cur = this.shifts.get(assetId) ?? 1;
    this.shifts.set(assetId, Math.max(0.2, Math.min(5, cur * mult)));
  }

  /** Fundamental value per asset — what mean reversion pulls toward. */
  fundamental = (a: AssetState): number | null => {
    if (a.info.kind === 'memecoin') return null;
    const shift = this.shifts.get(a.info.id) ?? 1;
    const c = this.corporate.companies.get(a.info.id);
    return a.listingPrice * shift * (c ? c.health : 1);
  };

  marketTick(now: number): void {
    this.events.onMarketTick(now);
    this.corporate.beforeMarketTick();
    const res = this.market.tick(this.fundamental);
    // Shifts fade: (shift − 1) shrinks by shiftDecay each tick.
    for (const [id, s] of this.shifts) {
      const next = 1 + (s - 1) * (1 - CONFIG.companies.shiftDecay);
      if (Math.abs(next - 1) < 0.002) this.shifts.delete(id);
      else this.shifts.set(id, next);
    }
    this.emit.toAll('game:market', {
      tick: res.tick,
      serverNow: now,
      nextTickAt: this.nextMarketTickAt + CONFIG.clocks.marketTickMs,
      quotes: res.quotes,
      candles: res.candles,
    });

    for (const m of res.bigMoves) {
      const a = this.market.assets.get(m.assetId)!;
      if (m.halted) this.news.post('Market Desk', `${a.info.name} (${a.info.id}) HALTED after a crash — trading suspended for one round`, 'bad', true, [a.info.id]);
      else if (Math.abs(m.ret) >= 0.12)
        this.news.post('Market Desk', `${a.info.name} ${m.ret > 0 ? 'rockets' : 'plunges'} ${(m.ret * 100).toFixed(1)}% in one round`, m.ret > 0 ? 'good' : 'bad', false, [a.info.id]);
    }
    for (const [pid, fills] of res.fillsByPlayer) {
      const real = fills.filter((f) => f.qty > 0 && !f.note?.startsWith('MARGIN'));
      if (real.length) this.notify(pid, 'info', `${real.length} order${real.length > 1 ? 's' : ''} filled`);
      for (const f of fills) if (f.note?.startsWith('MARGIN')) this.notify(pid, 'bad', `Margin call: your ${f.assetId} position was liquidated at ${f.price.toFixed(2)}`);
    }
    this.regulate(res.trades, res.tick);
    for (const p of this.players) this.pushAccount(p.id);
  }

  /** Regulator: look for pump-and-dump round trips in this tick's trades. */
  private regulate(trades: TradeRecord[], tick: number): void {
    for (const f of detectManipulation(this.tradeHistory, trades)) {
      if (!this.rng.chance(Math.min(0.95, CONFIG.regulator.investigateChance * this.suspicionMult(f.playerId)))) continue;
      const fine = fineFor(f.profit);
      this.market.debit(f.playerId, fine);
      this.fines.set(f.playerId, (this.fines.get(f.playerId) ?? 0) + fine);
      this.adjustReputation(f.playerId, -5);
      const who = this.players.find((p) => p.id === f.playerId)!;
      this.news.post('Regulator', `Regulator fines ${who.name} $${fine.toLocaleString('en-US')} for manipulating ${f.assetId} (+${(f.rise * 100).toFixed(0)}% pump then dump)`, 'bad', true, [f.assetId]);
      this.notify(f.playerId, 'bad', `The regulator caught your ${f.assetId} round trip. Fined $${fine.toLocaleString('en-US')}.`);
    }
    this.tradeHistory.push(...trades);
    const cutoff = tick - CONFIG.regulator.windowTicks - 1;
    this.tradeHistory = this.tradeHistory.filter((t) => t.tick >= cutoff);
  }

  /** 1 at full reputation, up to maxSuspicionMult at zero. */
  suspicionMult(playerId: string): number {
    const rep = this.reputation.get(playerId) ?? CONFIG.reputation.start;
    return 1 + (CONFIG.reputation.maxSuspicionMult - 1) * (1 - Math.max(0, Math.min(100, rep)) / 100);
  }

  adjustReputation(playerId: string, delta: number): void {
    this.reputation.set(playerId, Math.max(0, Math.min(100, (this.reputation.get(playerId) ?? 100) + delta)));
  }

  broadcastPressure(now: number): void {
    const delayed = this.market.delayedPressure(now, CONFIG.clocks.pressureDelayMs);
    // Fuzz: noise + quantise to 0.1 so the bar is a hint, not a readout.
    const fuzzy: Record<string, number> = {};
    for (const [id, v] of Object.entries(delayed)) fuzzy[id] = Math.round(Math.max(-1, Math.min(1, v + this.rng.normal() * 0.15)) * 10) / 10;
    for (const p of this.players) {
      const analyst = this.roles.get(p.id) === 'analyst';
      if (analyst || this.influence.researchUntil(p.id) > now) {
        const live = this.market.delayedPressure(now + 10_000, 0);
        const noise = analyst ? CONFIG.roles.analystNoise : 0;
        const bars: Record<string, number> = {};
        for (const [id, v] of Object.entries(live)) bars[id] = Math.round(Math.max(-1, Math.min(1, v + this.rng.normal() * noise)) * 100) / 100;
        this.emit.toPlayer(p.id, 'game:pressure', { bars, exact: true });
      } else this.emit.toPlayer(p.id, 'game:pressure', { bars: fuzzy, exact: false });
    }
  }

  pushAccount(playerId: string): void {
    const v = this.market.accountView(playerId, 0);
    if (v) this.emit.toPlayer(playerId, 'game:account', v);
  }

  netWorth(playerId: string): number {
    return this.market.marketWorth(playerId);
  }

  notify(playerId: string, kind: Notice['kind'], text: string): void {
    this.emit.toPlayer(playerId, 'notice', { id: uid('n'), t: Date.now(), kind, text });
  }

  // ------------------------------------------------------------------- views

  buildView(playerId: string, now: number): PlayerView {
    const c = this.corporate.of(playerId)!;
    return {
      serverNow: now,
      endsAt: this.endsAt,
      leaderboard: this.leaderboard(),
      me: {
        companyId: c.assetId,
        health: Math.round(c.health * 100) / 100,
        fraudActive: !!c.fraud,
        cooldowns: { ...this.corporate.cooldownsOf(playerId), ...this.influence.cooldownsOf(playerId) },
        researchUntil: this.influence.researchUntil(playerId),
        spying: this.influence.spyingOn(playerId, now),
        reputation: Math.round(this.reputation.get(playerId) ?? 100),
        role: this.roles.get(playerId) ?? 'none',
        journalistReadyAt: this.influence.journalistReadyAt(playerId),
        pendingRnd: this.corporate.pendingRnd(playerId),
      },
      companies: [...this.market.assets.values()]
        .filter((a) => a.info.kind === 'company')
        .map((a) => {
          const cs = this.corporate.companies.get(a.info.id);
          return { assetId: a.info.id, ownerId: a.info.ownerId ?? null, name: a.info.name, sector: a.info.sector!, dividendsPaid: cs?.dividendsPaid ?? 0, sharesIssued: cs?.sharesIssued ?? 0 };
        }),
      spiedOrders: this.influence.spyingOn(playerId, now).map((s) => ({
        playerId: s.playerId,
        orders: (this.market.accounts.get(s.playerId)?.orders ?? []).map((o) => this.market.orderView(o)),
      })),
    };
  }

  leaderboard(): PlayerView['leaderboard'] {
    return this.players
      .map((p) => ({
        playerId: p.id,
        name: p.name,
        color: p.color,
        netWorth: Math.round(this.netWorth(p.id)),
        connected: this.isConnected(p.id),
        reputation: Math.round(this.reputation.get(p.id) ?? 100),
        companyId: this.companyOf.get(p.id)!,
      }))
      .sort((a, b) => b.netWorth - a.netWorth);
  }

  /** Overridden by the room glue so the game knows who's online. */
  isConnected: (playerId: string) => boolean = () => true;

  /** Display-name change mid-game. Old chat lines keep the name they were sent under. */
  renamePlayer(playerId: string, oldName: string, newName: string): void {
    const p = this.players.find((x) => x.id === playerId);
    if (!p) return;
    p.name = newName;
    if (!this.ended) this.news.post('Global Wire', `${oldName} will now be known as ${newName}`, 'neutral', false);
  }

  /** Hook for when a player's socket comes back. */
  onReconnect?: (playerId: string) => void;

  // ------------------------------------------------------------------- actions

  handle(playerId: string, a: Action): Ack {
    if (this.ended) return { ok: false, error: 'Game over' };
    if (!this.players.some((p) => p.id === playerId)) return { ok: false, error: 'Not in this game' };
    const now = this.clock();
    const res = (err: string | null, push = false): Ack => {
      if (!err && push) this.pushAccount(playerId);
      return err ? { ok: false, error: err } : { ok: true };
    };
    switch (a.type) {
      case 'order': {
        const r = this.market.placeOrder(playerId, a, now, { leverageEnabled: true, limitEnabled: true });
        return res(r.ok ? null : r.error ?? 'Rejected', true);
      }
      case 'cancelOrder':
        return res(this.market.cancelOrder(playerId, a.orderId) ? null : 'Order not found (already filled?)', true);
      case 'corporate':
        return res(this.corporate.act(playerId, a.action, a.amount, now), true);
      case 'story':
        return res(this.influence.story(playerId, a.assetId, a.positive, now), true);
      case 'lobby':
        return res(this.influence.lobby(playerId, a.assetId, a.up, now), true);
      case 'spy':
        return res(this.influence.spy(playerId, a.targetId, now), true);
      case 'research':
        return res(this.influence.buyResearch(playerId, now), true);
      case 'chat':
        return res(this.chat.send(playerId, a.text, a.toId, now));
      case 'publish':
        return res(this.influence.publish(playerId, a.headline, now));
    }
  }

  // ------------------------------------------------------------------- end

  finish(now: number, reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.stop();
    const standings = this.leaderboard().map((r, i) => {
      const a = this.market.assets.get(r.companyId)!;
      return { playerId: r.playerId, name: r.name, color: r.color, netWorth: r.netWorth, companyId: r.companyId, companyChange: a.price / a.listingPrice - 1, rank: i + 1 };
    });
    this.recap = { winnerId: standings[0]?.playerId ?? null, reason, standings, awards: this.awards() };
    this.emit.toAll('game:ended', this.recap);
    this.news.post('Market Desk', `CLOSING BELL. ${standings[0]?.name ?? 'Nobody'} wins. ${reason}.`, 'neutral', true);
    void now;
    this.onEnd();
  }

  private awards(): GameRecap['awards'] {
    const out: GameRecap['awards'] = [];
    const name = (pid: string) => this.players.find((p) => p.id === pid)?.name ?? '?';
    const board = this.leaderboard();
    const change = (r: { playerId: string; netWorth: number }) => r.netWorth / Math.max(1, this.startWorth.get(r.playerId) ?? 1) - 1;
    if (board.length > 1) {
      const loser = [...board].sort((a, b) => change(a) - change(b))[0];
      const c = change(loser);
      out.push(c < 0 ? { title: 'Biggest loser', who: loser.name, detail: `Net worth ${(c * 100).toFixed(0)}% since the opening bell` } : { title: 'Biggest loser', who: 'Nobody', detail: 'Everyone grew. Boring.' });
    }
    const cos = this.players.map((p) => {
      const a = this.market.assets.get(this.companyOf.get(p.id)!)!;
      return { pid: p.id, id: a.info.id, ch: a.price / a.listingPrice - 1 };
    });
    const best = [...cos].sort((a, b) => b.ch - a.ch)[0];
    if (best) out.push({ title: 'Best-run company', who: name(best.pid), detail: `${best.id} ${best.ch >= 0 ? '+' : ''}${(best.ch * 100).toFixed(0)}% since IPO` });
    const worstCo = [...cos].sort((a, b) => a.ch - b.ch)[0];
    if (worstCo && cos.length > 1 && worstCo.ch < 0) out.push({ title: 'Penny stock award', who: name(worstCo.pid), detail: `${worstCo.id} ${(worstCo.ch * 100).toFixed(0)}% since IPO` });
    let worst: { pid: string; pnl: number; asset: string } | null = null;
    for (const [pid, acct] of this.market.accounts) if (acct.worstTrade && (!worst || acct.worstTrade.pnl < worst.pnl)) worst = { pid, pnl: acct.worstTrade.pnl, asset: acct.worstTrade.assetId };
    if (worst && worst.pnl < 0) out.push({ title: 'Worst trade', who: name(worst.pid), detail: `Lost $${Math.round(-worst.pnl).toLocaleString('en-US')} on ${worst.asset} in one go` });
    const doge = CONFIG.memecoin.id;
    let rug: { pid: string; loss: number } | null = null;
    for (const [pid, acct] of this.market.accounts) {
      let pnl = acct.realisedByAsset.get(doge) ?? 0;
      const pos = acct.positions.get(doge);
      const price = this.market.assets.get(doge)!.price;
      if (pos) pnl += pos.qty > 0 ? pos.qty * (price - pos.avgPrice) : -pos.qty * (pos.avgPrice - price);
      if (pnl < 0 && (!rug || pnl < rug.loss)) rug = { pid, loss: pnl };
    }
    out.push(rug ? { title: 'Rugged by WarDoge', who: name(rug.pid), detail: `Down $${Math.round(-rug.loss).toLocaleString('en-US')} on the memecoin` } : { title: 'Rugged by WarDoge', who: 'Nobody', detail: 'Suspiciously sensible' });
    const fined = [...this.fines].sort((a, b) => b[1] - a[1])[0];
    if (fined) out.push({ title: 'Regulator’s favourite', who: name(fined[0]), detail: `$${fined[1].toLocaleString('en-US')} in fines` });
    const mogul = [...this.influence.storiesPlanted].sort((a, b) => b[1] - a[1])[0];
    if (mogul) out.push({ title: 'Media mogul', who: name(mogul[0]), detail: `${mogul[1]} planted stor${mogul[1] === 1 ? 'y' : 'ies'}` });
    const crook = [...this.corporate.companies.values()].sort((a, b) => b.frauds - a.frauds)[0];
    if (crook && crook.frauds > 0) out.push({ title: 'Creative accounting', who: name(crook.ownerId), detail: `Cooked the books ${crook.frauds} time${crook.frauds > 1 ? 's' : ''}` });
    return out;
  }
}

const ROLE_BLURB: Record<Role, string> = {
  none: '',
  analyst: 'Your secret role: ANALYST. Your pressure bars show the live order book, not the delayed fuzzy one.',
  whale: `Your secret role: WHALE. You started with ${CONFIG.roles.whaleCashMultiplier}× cash. Move markets — but the regulator is watching.`,
  journalist: 'Your secret role: JOURNALIST. You can publish headlines under "Citizen Journal" from the Influence tab. True or not.',
};
