/**
 * One running game. Owns the subsystems and the two clocks:
 *   - world loop: every CONFIG.clocks.worldTickMs (100ms)
 *   - market clock: every CONFIG.clocks.marketTickMs (20s), a batch auction
 * Everything a player sees is built per-player in buildView() — never broadcast raw state.
 */

import {
  CONFIG,
  type Action,
  type Ack,
  type AssetInfo,
  type GameRecap,
  type GameStatic,
  type LobbySettings,
  type NationPrivateView,
  type Notice,
  type WorldView,
} from '@warmarket/shared';
import { Market, type AssetState } from '../market/market.js';
import { Rng, randomSeed, uid } from '../util/rng.js';
import type { Emitter } from '../net/emitter.js';
import { NewsService } from '../events/news.js';

export interface GamePlayer {
  id: string;
  name: string;
  color: string;
}

export class Game {
  readonly rng: Rng;
  readonly market: Market;
  readonly news: NewsService;
  readonly startedAt: number;
  readonly endsAt: number;
  nextMarketTickAt: number;
  private loop: NodeJS.Timeout | null = null;
  private lastViewAt = 0;
  private lastPressureAt = 0;
  private lastPressureLogAt = 0;
  private lastWorldTickAt = 0;
  ended = false;
  recap: GameRecap | null = null;

  constructor(
    readonly code: string,
    readonly players: GamePlayer[],
    readonly settings: LobbySettings,
    readonly emit: Emitter,
    private onEnd: () => void,
    seed = randomSeed(),
    now = Date.now(),
  ) {
    this.rng = new Rng(seed);
    this.startedAt = now;
    this.endsAt = now + settings.sessionMinutes * 60_000;
    this.nextMarketTickAt = now + CONFIG.clocks.marketTickMs;
    this.market = new Market(this.rng, now);
    this.news = new NewsService(emit);

    for (const c of CONFIG.commodities) {
      this.market.addAsset({ id: c.id, name: c.name, kind: 'commodity', basePrice: c.basePrice }, c.depth, c.volatility);
    }
    const mc = CONFIG.memecoin;
    this.market.addAsset({ id: mc.id, name: mc.name, kind: 'memecoin', basePrice: mc.basePrice }, mc.depth, mc.volatility);
    this.market.seedHistory(30);

    for (const p of players) this.market.openAccount(p.id, CONFIG.start.treasury);
  }

  // ------------------------------------------------------------------- lifecycle

  start(): void {
    this.lastWorldTickAt = Date.now();
    this.loop = setInterval(() => this.worldTick(Date.now()), CONFIG.clocks.worldTickMs);
    for (const p of this.players) this.sendInitial(p.id);
    this.news.post('Market Desk', 'Markets open. Trading window closes every 20 seconds.', 'neutral', false);
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
    this.pushAccount(playerId);
    this.emit.toPlayer(playerId, 'game:view', this.buildView(playerId, Date.now()));
    if (this.recap) this.emit.toPlayer(playerId, 'game:ended', this.recap);
  }

  staticFor(playerId: string): GameStatic {
    return {
      code: this.code,
      map: { width: CONFIG.world.mapWidth, height: CONFIG.world.mapHeight, provinces: [], seaLanes: [], oceanPaths: [] },
      nations: [],
      assets: [...this.market.assets.values()].map((a) => a.info as AssetInfo),
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
    const dt = Math.min(1, (now - this.lastWorldTickAt) / 1000);
    this.lastWorldTickAt = now;
    void dt;

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

    if (now >= this.endsAt) this.finish(now);
  }

  /** Fundamental value per asset: commodities revert weakly to base, the memecoin is a random walk. */
  fundamental = (a: AssetState): number | null => {
    if (a.info.kind === 'memecoin') return null;
    return a.info.basePrice;
  };

  marketTick(now: number): void {
    const res = this.market.tick(this.fundamental);
    this.emit.toAll('game:market', { tick: res.tick, serverNow: now, nextTickAt: this.nextMarketTickAt + CONFIG.clocks.marketTickMs, quotes: res.quotes, candles: res.candles });

    for (const m of res.bigMoves) {
      const a = this.market.assets.get(m.assetId)!;
      if (m.halted) this.news.post('Market Desk', `${a.info.name} (${a.info.id}) HALTED after a crash — trading suspended for one round`, 'bad', true, [a.info.id]);
      else if (Math.abs(m.ret) >= 0.12) this.news.post('Market Desk', `${a.info.name} ${m.ret > 0 ? 'rockets' : 'plunges'} ${(m.ret * 100).toFixed(1)}% in one round`, m.ret > 0 ? 'good' : 'bad', false, [a.info.id]);
    }
    for (const [pid, fills] of res.fillsByPlayer) {
      const real = fills.filter((f) => f.qty > 0);
      if (real.length) this.notify(pid, 'info', `${real.length} order${real.length > 1 ? 's' : ''} filled`);
      for (const f of fills) if (f.note?.startsWith('MARGIN')) this.notify(pid, 'bad', `Margin call: your ${f.assetId} position was liquidated`);
    }
    for (const p of this.players) this.pushAccount(p.id);
  }

  broadcastPressure(now: number): void {
    const delayed = this.market.delayedPressure(now, CONFIG.clocks.pressureDelayMs);
    // Fuzz: noise + quantise to 0.1 so the bar is a hint, not a readout.
    const fuzzy: Record<string, number> = {};
    for (const [id, v] of Object.entries(delayed)) {
      const n = v + this.rng.normal() * 0.15;
      fuzzy[id] = Math.round(Math.max(-1, Math.min(1, n)) * 10) / 10;
    }
    for (const p of this.players) this.emit.toPlayer(p.id, 'game:pressure', { bars: fuzzy, exact: false });
  }

  pushAccount(playerId: string): void {
    const v = this.market.accountView(playerId, this.nationWorth(playerId));
    if (v) this.emit.toPlayer(playerId, 'game:account', v);
  }

  /** Non-market net worth (provinces, buildings, resources). Phase 2 fills this in. */
  nationWorth(_playerId: string): number {
    return 0;
  }

  netWorth(playerId: string): number {
    return this.market.marketWorth(playerId) + this.nationWorth(playerId);
  }

  notify(playerId: string, kind: Notice['kind'], text: string): void {
    this.emit.toPlayer(playerId, 'notice', { id: uid('n'), t: Date.now(), kind, text });
  }

  // ------------------------------------------------------------------- views

  buildView(playerId: string, now: number): WorldView {
    const me: NationPrivateView = {
      id: playerId,
      treasury: this.market.accounts.get(playerId)?.cash ?? 0,
      resources: { oil: 0, food: 0, metals: 0, tech: 0 },
      rates: { oil: 0, food: 0, metals: 0, tech: 0, cash: 0 },
      stability: CONFIG.start.stability,
      protesting: false,
      recruiting: [],
      spies: [],
      spyVisionOn: [],
      orderflowOn: [],
      warCooldownUntil: 0,
      role: 'none',
      journalistReadyAt: 0,
    };
    return {
      serverNow: now,
      endsAt: this.endsAt,
      leaderboard: this.leaderboard(),
      provinces: [],
      armies: [],
      me,
      nations: [],
      wars: [],
      deals: [],
      proposals: [],
      objective: 'Highest net worth when the timer ends wins.',
      spiedOrders: [],
    };
  }

  leaderboard(): WorldView['leaderboard'] {
    return this.players
      .map((p) => ({ playerId: p.id, name: p.name, color: p.color, netWorth: this.netWorth(p.id), connected: this.isConnected(p.id) }))
      .sort((a, b) => b.netWorth - a.netWorth);
  }

  /** Overridden by the room glue so the game knows who's online. */
  isConnected: (playerId: string) => boolean = () => true;

  /** Hook for when a player's socket comes back (e.g. re-send private notices). */
  onReconnect?: (playerId: string) => void;

  // ------------------------------------------------------------------- actions

  handle(playerId: string, a: Action): Ack {
    if (this.ended) return { ok: false, error: 'Game over' };
    if (!this.players.some((p) => p.id === playerId)) return { ok: false, error: 'Not in this game' };
    const now = Date.now();
    switch (a.type) {
      case 'order': {
        const r = this.market.placeOrder(playerId, a, now, { leverageEnabled: false, limitEnabled: false });
        if (r.ok) this.pushAccount(playerId);
        return { ok: r.ok, error: r.error };
      }
      case 'cancelOrder': {
        const ok = this.market.cancelOrder(playerId, a.orderId);
        if (ok) this.pushAccount(playerId);
        return ok ? { ok } : { ok, error: 'Order not found (already filled?)' };
      }
      default:
        return { ok: false, error: 'Not available yet' };
    }
  }

  // ------------------------------------------------------------------- end

  finish(now: number): void {
    if (this.ended) return;
    this.ended = true;
    this.stop();
    const standings = this.leaderboard().map((r, i) => ({ playerId: r.playerId, name: r.name, color: r.color, netWorth: r.netWorth, provinces: 0, rank: i + 1 }));
    this.recap = {
      mode: this.settings.mode,
      winnerId: standings[0]?.playerId ?? null,
      reason: 'Highest net worth when the clock ran out',
      standings,
      awards: [],
    };
    void now;
    this.emit.toAll('game:ended', this.recap);
    this.onEnd();
  }
}
