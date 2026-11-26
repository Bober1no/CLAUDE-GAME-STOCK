/**
 * One running game. Owns the subsystems and the two clocks:
 *   - world loop: every CONFIG.clocks.worldTickMs (100ms) — production, timers, movement
 *   - market clock: every CONFIG.clocks.marketTickMs (20s) — batch auction
 * Everything a player sees is built per-player in buildView(). Never broadcast raw state.
 */

import {
  CONFIG,
  type Action,
  type Ack,
  type AssetInfo,
  type CommodityId,
  type GameRecap,
  type GameStatic,
  type LobbySettings,
  type Notice,
  type ProvinceView,
  type Role,
  type WorldView,
} from '@warmarket/shared';
import { Market, type AssetState } from '../market/market.js';
import { Rng, randomSeed, uid } from '../util/rng.js';
import type { Emitter } from '../net/emitter.js';
import { NewsService } from '../events/news.js';
import { World, type Nation, type WorldEvent } from '../world/world.js';
import { RESOURCES, commodityFundamental, companyFundamental, nationAssetValue } from '../world/economy.js';
import { Military } from '../military/military.js';
import { Proposals } from '../diplomacy/proposals.js';
import { Diplomacy } from '../diplomacy/diplomacy.js';
import { WorldEvents } from '../events/worldEvents.js';

export interface GamePlayer {
  id: string;
  name: string;
  color: string;
}

export class Game {
  readonly rng: Rng;
  readonly seed: number;
  readonly market: Market;
  readonly news: NewsService;
  readonly world: World;
  readonly military: Military;
  readonly proposals: Proposals;
  readonly diplomacy: Diplomacy;
  readonly events: WorldEvents;
  /** Counters for the recap. */
  stats = { tipsSent: 0, battles: 0 };
  readonly startedAt: number;
  readonly endsAt: number;
  nextMarketTickAt: number;
  private loop: NodeJS.Timeout | null = null;
  private lastViewAt = 0;
  private lastPressureAt = 0;
  private lastPressureLogAt = 0;
  private lastWorldTickAt = 0;
  private supplyNow: Record<CommodityId, number>;
  ended = false;
  recap: GameRecap | null = null;
  readonly roles = new Map<string, Role>();
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
    this.endsAt = now + settings.sessionMinutes * 60_000;
    this.nextMarketTickAt = now + CONFIG.clocks.marketTickMs;
    this.market = new Market(this.rng, now);
    this.news = new NewsService(emit);
    this.assignRoles();
    this.world = new World(this.rng, players, seed, this.roles);
    this.supplyNow = this.world.commoditySupply(now);
    this.military = new Military(this);
    this.proposals = new Proposals(this);
    this.diplomacy = new Diplomacy(this);
    this.events = new WorldEvents(this);

    for (const c of CONFIG.commodities) {
      this.market.addAsset({ id: c.id, name: c.name, kind: 'commodity', basePrice: c.basePrice }, c.depth, c.volatility);
    }
    for (const n of this.world.nations) {
      for (const co of n.companies) {
        this.market.addAsset({ id: co.id, name: co.name, kind: 'company', sector: co.sector, nationId: n.id, basePrice: co.basePrice }, CONFIG.companies.depth, CONFIG.companies.volatility);
      }
    }
    const mc = CONFIG.memecoin;
    this.market.addAsset({ id: mc.id, name: mc.name, kind: 'memecoin', basePrice: mc.basePrice }, mc.depth, mc.volatility);
    this.market.seedHistory(30);

    for (const p of players) {
      const role = this.roles.get(p.id);
      this.market.openAccount(p.id, CONFIG.start.treasury * (role === 'whale' ? CONFIG.roles.whaleCashMultiplier : 1));
    }
  }

  private assignRoles(): void {
    for (const p of this.players) this.roles.set(p.id, 'none');
    if (!this.settings.rolesEnabled) return;
    const pool: Role[] = ['analyst', 'whale', 'journalist'];
    const shuffled = this.rng.shuffle([...this.players]);
    shuffled.forEach((p, i) => this.roles.set(p.id, pool[i % pool.length]));
  }

  // ------------------------------------------------------------------- lifecycle

  start(): void {
    this.lastWorldTickAt = Date.now();
    this.loop = setInterval(() => {
      try {
        this.worldTick(Date.now());
      } catch (err) {
        console.error(`[game ${this.code}] tick error`, err);
      }
    }, CONFIG.clocks.worldTickMs);
    for (const p of this.players) this.sendInitial(p.id);
    this.news.post('Market Desk', 'Markets open. The exchange clears every 20 seconds. Good luck, and may your neighbours fail.', 'neutral', false);
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
    this.emit.toPlayer(playerId, 'chat:backlog', this.diplomacy.chatFor(playerId));
    this.pushAccount(playerId);
    this.emit.toPlayer(playerId, 'game:view', this.buildView(playerId, this.clock()));
    if (this.recap) this.emit.toPlayer(playerId, 'game:ended', this.recap);
  }

  staticFor(playerId: string): GameStatic {
    const m = this.world.map;
    return {
      code: this.code,
      map: { width: m.width, height: m.height, provinces: m.provinces, seaLanes: m.seaLanes, oceanPaths: m.oceanPaths },
      nations: this.world.staticNations(),
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
    const dt = Math.min(1, Math.max(0, (now - this.lastWorldTickAt) / 1000));
    this.lastWorldTickAt = now;

    const events = this.world.tick(dt, now, {
      atWar: (nid) => this.isAtWar(nid),
      sanctions: (nid) => this.sanctionCount(nid),
      armyStrength: (nid) => this.armyStrength(nid),
      companiesCrashed: (nid) => this.companiesCrashed(nid),
      credit: (pid, amt) => this.market.credit(pid, amt),
      dealFlows: (nid) => this.dealFlows(nid),
    });
    for (const e of events) this.onWorldEvent(e, now);
    this.subTick(dt, now);

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
      for (const p of this.players) {
        this.emit.toPlayer(p.id, 'game:view', this.buildView(p.id, now));
      }
    }

    this.checkVictory(now);
    if (now >= this.endsAt) this.finish(now, 'Highest net worth when the clock ran out');
  }

  /** Systems that run every world tick after production. */
  protected subTick(dt: number, now: number): void {
    this.military.tick(dt, now);
    this.proposals.tick(now);
    this.diplomacy.tick(now);
    this.events.tick(now);
  }

  onWorldEvent(e: WorldEvent, now: number): void {
    const n = this.world.nation(e.nationId)!;
    switch (e.type) {
      case 'built':
        this.notify(n.playerId, 'good', `${BUILDING_NAME[e.kind]} completed in ${this.provName(e.provinceId)}`);
        break;
      case 'starving':
        this.notify(n.playerId, 'bad', 'Your people are starving! Food stocks are empty — stability is collapsing.');
        this.news.post('Global Wire', `Food riots reported in ${n.name}`, 'bad', false);
        break;
      case 'protestStart':
        this.news.post('Global Wire', `Mass protests erupt across ${n.name} — production grinds down`, 'bad', true, n.companies.map((c) => c.id));
        this.market.addNationImpact(n.id, -0.05, 1, 'protests');
        break;
      case 'protestEnd':
        this.news.post('Global Wire', `Protests in ${n.name} die down`, 'good', false);
        break;
      case 'coup': {
        const acct = this.market.accounts.get(n.playerId);
        if (acct && acct.cash > 0) acct.cash *= 1 - CONFIG.stability.coupTreasuryLoss;
        const s = CONFIG.shocks.coup;
        this.market.addNationImpact(n.id, s.companies, s.durationTicks, 'coup');
        this.news.post('Global Wire', `COUP in ${n.name}! ${e.lost.length} province${e.lost.length === 1 ? '' : 's'} break away, the treasury is looted`, 'bad', true, n.companies.map((c) => c.id));
        this.notify(n.playerId, 'bad', `A coup! You lost ${e.lost.length} provinces and ${CONFIG.stability.coupTreasuryLoss * 100}% of your treasury.`);
        this.onProvincesLost(n, e.lost, now);
        break;
      }
    }
  }

  /** Hook for military (armies stranded in lost provinces etc.). */
  protected onProvincesLost(_n: Nation, _lost: number[], _now: number): void {}

  // ------------------------------------------------------------------- market

  /** Fundamental value per asset — what mean reversion pulls toward. */
  fundamental = (a: AssetState): number | null => {
    if (a.info.kind === 'memecoin') return null;
    if (a.info.kind === 'commodity') {
      const c = CONFIG.commodities.find((x) => x.id === a.info.id)!;
      return commodityFundamental(c.basePrice, this.world.supplyStart[c.id], this.supplyNow[c.id], c.supplyElasticity);
    }
    const n = this.world.nation(a.info.nationId);
    if (!n) return a.info.basePrice;
    const now = this.clock();
    return companyFundamental(a.listingPrice, {
      stability: n.stability,
      provinces: this.world.ownedBy(n.id).length,
      startProvinces: n.startProvinces,
      sectorOutput: this.world.sectorOutput(n.id, a.info.sector!, now),
      startSectorOutput: n.startSectorOutput[a.info.sector!],
      wars: this.warCount(n.id),
      eliminated: n.eliminated,
      isDefence: a.info.sector === 'defence',
    });
  };

  marketTick(now: number): void {
    this.supplyNow = this.world.commoditySupply(now);
    this.beforeMarketTick(now);
    const res = this.market.tick(this.fundamental);
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
    this.afterMarketTick(res, now);
    for (const p of this.players) this.pushAccount(p.id);
  }

  protected beforeMarketTick(now: number): void {
    this.events.onMarketTick(now);
  }
  protected afterMarketTick(_res: ReturnType<Market['tick']>, _now: number): void {}

  broadcastPressure(now: number): void {
    const delayed = this.market.delayedPressure(now, CONFIG.clocks.pressureDelayMs);
    // Fuzz: noise + quantise to 0.1 so the bar is a hint, not a readout.
    const fuzzy: Record<string, number> = {};
    for (const [id, v] of Object.entries(delayed)) {
      const n = v + this.rng.normal() * 0.15;
      fuzzy[id] = Math.round(Math.max(-1, Math.min(1, n)) * 10) / 10;
    }
    for (const p of this.players) {
      const exact = this.seesExactPressure(p.id);
      if (exact) {
        const live = this.market.delayedPressure(now + 10_000, 0);
        const bars: Record<string, number> = {};
        const noise = this.roles.get(p.id) === 'analyst' ? CONFIG.roles.analystNoise : 0;
        for (const [id, v] of Object.entries(live)) bars[id] = Math.round(Math.max(-1, Math.min(1, v + this.rng.normal() * noise)) * 100) / 100;
        this.emit.toPlayer(p.id, 'game:pressure', { bars, exact: true });
      } else this.emit.toPlayer(p.id, 'game:pressure', { bars: fuzzy, exact: false });
    }
  }

  protected seesExactPressure(playerId: string): boolean {
    return this.roles.get(playerId) === 'analyst';
  }

  pushAccount(playerId: string): void {
    const v = this.market.accountView(playerId, this.nationWorth(playerId));
    if (v) this.emit.toPlayer(playerId, 'game:account', v);
  }

  companiesCrashed(nationId: string): boolean {
    const n = this.world.nation(nationId);
    if (!n || !n.companies.length) return false;
    let r = 0;
    for (const c of n.companies) {
      const a = this.market.assets.get(c.id);
      if (a) r += a.price / a.listingPrice;
    }
    return r / n.companies.length < CONFIG.stability.crashThreshold;
  }

  // ------------------------------------------------------------------- worth

  /** Non-market net worth: provinces, buildings, resources. */
  nationWorth(playerId: string): number {
    const n = this.world.nationOf(playerId);
    if (!n) return 0;
    const owned = this.world.ownedBy(n.id).map((p) => ({ capital: p.id === n.capital, buildings: p.buildings }));
    return nationAssetValue(owned, n.resources);
  }

  netWorth(playerId: string): number {
    return this.market.marketWorth(playerId) + this.nationWorth(playerId);
  }

  notify(playerId: string, kind: Notice['kind'], text: string): void {
    this.emit.toPlayer(playerId, 'notice', { id: uid('n'), t: Date.now(), kind, text });
  }

  provName(id: number): string {
    return this.world.map.provinces[id]?.name ?? `#${id}`;
  }

  // ------------------------------------------------------------------- stubs overridden by later systems

  isAtWar(nationId: string): boolean {
    return this.military.enemiesOf(nationId).length > 0;
  }
  warCount(nationId: string): number {
    return this.military.enemiesOf(nationId).length;
  }
  areAllied(a: string, b: string): boolean {
    return this.diplomacy.allied(a, b);
  }
  formAlliance(a: string, b: string, _now: number): string | null {
    return this.diplomacy.formAlliance(a, b);
  }
  sanctionCount(nationId: string): number {
    return this.diplomacy.sanctionersOf(nationId).length;
  }
  armyStrength(nationId: string): number {
    return this.military.strengthOf(nationId);
  }
  dealFlows(nationId: string): Partial<Record<string, number>> {
    return this.diplomacy.flows(nationId);
  }
  protected checkVictory(_now: number): void {}

  // ------------------------------------------------------------------- views

  /** Fog of war: which provinces this player can see in detail. */
  visibleProvinces(playerId: string, now: number): Set<number> {
    const n = this.world.nationOf(playerId)!;
    if (this.ended) return new Set(this.world.provinces.map((p) => p.id));
    return this.military.visibleFor(n.id, this.sharedVisionNations(playerId, now), this.extraVisibleProvinces(playerId, now));
  }
  /** Nations whose vision this player shares (allies, spied nations). */
  sharedVisionNations(playerId: string, now: number): string[] {
    const n = this.world.nationOf(playerId)!;
    return [...this.diplomacy.alliesOf(n.id), ...this.spyVisionOn(playerId, now)];
  }
  extraVisibleProvinces(_playerId: string, _now: number): number[] {
    return [];
  }

  buildView(playerId: string, now: number): WorldView {
    const n = this.world.nationOf(playerId)!;
    const visible = this.visibleProvinces(playerId, now);
    const provinces: ProvinceView[] = this.world.provinces.map((p) => {
      const vis = visible.has(p.id);
      const mine = p.ownerId === n.id;
      if (!vis) return { id: p.id, ownerId: p.ownerId, visible: false };
      return {
        id: p.id,
        ownerId: p.ownerId,
        visible: true,
        garrison: Math.round(p.garrison),
        buildings: p.buildings,
        construction: mine ? p.construction : p.construction ? { kind: p.construction.kind, doneAt: 0 } : null,
        effect: p.effect && p.effect.until > now ? p.effect.label : p.disruptedUntil > now ? 'Disrupted by fighting' : null,
      };
    });
    return {
      serverNow: now,
      endsAt: this.endsAt,
      leaderboard: this.leaderboard(),
      provinces,
      armies: this.armiesFor(playerId, visible, now),
      me: {
        id: n.id,
        treasury: this.market.accounts.get(playerId)?.cash ?? 0,
        resources: roundRes(n.resources),
        rates: { ...roundRes(n.rates, 100), cash: Math.round(n.rates.cash * 100) / 100 },
        stability: Math.round(n.stability * 10) / 10,
        protesting: n.protesting,
        recruiting: this.recruitingFor(n.id),
        spies: this.spiesFor(playerId, now),
        spyVisionOn: this.spyVisionOn(playerId, now),
        orderflowOn: this.orderflowOn(playerId, now),
        warCooldownUntil: this.warCooldownUntil(n.id),
        role: n.role,
        journalistReadyAt: this.journalistReadyAt(playerId),
      },
      nations: this.world.nations.map((x) => ({
        id: x.id,
        playerId: x.playerId,
        name: x.name,
        color: x.color,
        provinces: this.world.ownedBy(x.id).length,
        stability: Math.round(x.stability),
        reputation: Math.round(x.reputation),
        connected: this.isConnected(x.playerId),
        eliminated: x.eliminated,
        atWarWith: this.warsOf(x.id),
        allies: this.alliesOf(x.id),
        sanctionedBy: this.sanctionersOf(x.id),
        embargoed: this.isEmbargoed(x.id),
      })),
      wars: this.warViews(),
      deals: this.dealViews(n.id),
      proposals: this.proposalViews(n.id),
      objective: this.objectiveText(n, now),
      spiedOrders: this.spiedOrders(playerId, now),
    };
  }

  // overridable view pieces
  armiesFor(playerId: string, visible: Set<number>, _now: number): WorldView['armies'] {
    return this.military.armyViews(this.world.nationOf(playerId)!.id, visible);
  }
  recruitingFor(nationId: string): WorldView['me']['recruiting'] {
    return this.military.recruitViews(nationId);
  }
  spiesFor(_playerId: string, _now: number): WorldView['me']['spies'] {
    return [];
  }
  spyVisionOn(_playerId: string, _now: number): string[] {
    return [];
  }
  orderflowOn(_playerId: string, _now: number): string[] {
    return [];
  }
  warCooldownUntil(nationId: string): number {
    return this.military.cooldownUntil(nationId);
  }
  journalistReadyAt(_playerId: string): number {
    return 0;
  }
  warsOf(nationId: string): string[] {
    return this.military.enemiesOf(nationId);
  }
  alliesOf(nationId: string): string[] {
    return this.diplomacy.alliesOf(nationId);
  }
  sanctionersOf(nationId: string): string[] {
    return this.diplomacy.sanctionersOf(nationId);
  }
  isEmbargoed(nationId: string): boolean {
    return this.diplomacy.embargoed(nationId);
  }
  warViews(): WorldView['wars'] {
    return this.military.warViews();
  }
  dealViews(nationId: string): WorldView['deals'] {
    return this.diplomacy.dealViews(nationId);
  }
  proposalViews(nationId: string): WorldView['proposals'] {
    return this.proposals.viewsFor(nationId);
  }
  spiedOrders(_playerId: string, _now: number): WorldView['spiedOrders'] {
    return [];
  }
  objectiveText(_n: Nation, _now: number): string {
    return 'Highest net worth when the timer ends wins.';
  }

  leaderboard(): WorldView['leaderboard'] {
    return this.players
      .map((p) => ({ playerId: p.id, name: p.name, color: p.color, netWorth: Math.round(this.netWorth(p.id)), connected: this.isConnected(p.id) }))
      .sort((a, b) => b.netWorth - a.netWorth);
  }

  /** Overridden by the room glue so the game knows who's online. */
  isConnected: (playerId: string) => boolean = () => true;

  /** Hook for when a player's socket comes back. */
  onReconnect?: (playerId: string) => void;

  // ------------------------------------------------------------------- actions

  handle(playerId: string, a: Action): Ack {
    if (this.ended) return { ok: false, error: 'Game over' };
    const n = this.world.nationOf(playerId);
    if (!n) return { ok: false, error: 'Not in this game' };
    const now = this.clock();
    switch (a.type) {
      case 'order': {
        const r = this.market.placeOrder(playerId, a, now, {
          leverageEnabled: this.features.leverage,
          limitEnabled: this.features.limit,
          blocked: (assetId) => this.orderBlocked(playerId, assetId, a.side),
        });
        if (r.ok) this.pushAccount(playerId);
        return { ok: r.ok, error: r.error };
      }
      case 'cancelOrder': {
        const ok = this.market.cancelOrder(playerId, a.orderId);
        if (ok) this.pushAccount(playerId);
        return ok ? { ok } : { ok, error: 'Order not found (already filled?)' };
      }
      case 'build': {
        const err = this.world.buildCheck(n, a.provinceId, a.kind);
        if (err) return { ok: false, error: err };
        if (!this.market.spend(playerId, CONFIG.buildings[a.kind].cost)) return { ok: false, error: 'Not enough free cash' };
        this.world.startBuild(n, a.provinceId, a.kind, now);
        this.pushAccount(playerId);
        return { ok: true };
      }
      case 'export': {
        if (this.isEmbargoed(n.id)) return { ok: false, error: 'You are under embargo — nobody will buy your exports' };
        const amount = Math.floor(a.amount);
        if (amount <= 0 || n.resources[a.resource] < amount) return { ok: false, error: 'Not enough of that resource' };
        const commodity = CONFIG.world.exportCommodity[a.resource];
        const asset = this.market.assets.get(commodity)!;
        // Export value tracks the linked commodity's price relative to its base.
        const unit = CONFIG.world.resourceValue[a.resource] * (asset.price / asset.info.basePrice);
        const cash = amount * unit;
        n.resources[a.resource] -= amount;
        this.market.credit(playerId, cash);
        // Dumping resources on the world market is sell pressure on that commodity.
        this.market.addImpact(commodity, (-0.3 * cash) / asset.depth, 1, 'export');
        this.pushAccount(playerId);
        return { ok: true };
      }
      default:
        return this.handleMore(playerId, n, a, now);
    }
  }

  features = { leverage: true, limit: true };

  /** Sanctions: you can't buy (go long on) stock of a nation you sanction. Shorting is fine. */
  protected orderBlocked(playerId: string, assetId: string, side: string): string | null {
    const a = this.market.assets.get(assetId);
    const me = this.world.nationOf(playerId);
    if (!a?.info.nationId || !me || side !== 'buy') return null;
    if (this.diplomacy.sanctioning(me.id, a.info.nationId)) return 'You are sanctioning that nation — you cannot buy its stocks';
    return null;
  }

  protected handleMore(playerId: string, n: Nation, a: Action, now: number): Ack {
    const res = (err: string | null): Ack => (err ? { ok: false, error: err } : { ok: true });
    switch (a.type) {
      case 'recruit': {
        const r = res(this.military.recruit(n.id, playerId, a.provinceId, now));
        if (r.ok) this.pushAccount(playerId);
        return r;
      }
      case 'move':
        return res(this.military.move(n.id, a.armyId, a.to, now));
      case 'declareWar':
        return res(this.military.declareWar(n.id, a.targetId, now));
      case 'proposePeace': {
        if (!this.military.atWar(n.id, a.targetId)) return { ok: false, error: 'You are not at war with them' };
        return res(this.proposals.propose('peace', n.id, a.targetId, now));
      }
      case 'respondProposal':
        return res(this.proposals.respond(n.id, a.proposalId, a.accept, now));
      default:
        return this.handleExtra(playerId, n, a, now);
    }
  }

  protected handleExtra(playerId: string, n: Nation, a: Action, now: number): Ack {
    const res = (err: string | null): Ack => (err ? { ok: false, error: err } : { ok: true });
    const d = this.diplomacy;
    switch (a.type) {
      case 'chat':
        return res(d.sendChat(playerId, a.text, a.toId, now));
      case 'proposeDeal':
        return res(d.proposeDeal(n.id, a.targetId, a.terms, now));
      case 'respondDeal':
        return res(d.respondDeal(n.id, a.dealId, a.accept, now));
      case 'breakDeal':
        return res(d.breakDeal(n.id, a.dealId));
      case 'proposeAlliance': {
        if (d.allied(n.id, a.targetId)) return { ok: false, error: 'Already allied' };
        if (this.military.atWar(n.id, a.targetId)) return { ok: false, error: 'You are at war with them' };
        return res(this.proposals.propose('alliance', n.id, a.targetId, now));
      }
      case 'breakAlliance':
        return res(d.breakAlliance(n.id, a.targetId));
      case 'sanction':
        return res(d.setSanction(n.id, a.targetId, a.on, now));
      default:
        return this.handleSpy(playerId, n, a, now);
    }
  }

  protected handleSpy(_playerId: string, _n: Nation, _a: Action, _now: number): Ack {
    return { ok: false, error: 'Not available yet' };
  }

  // ------------------------------------------------------------------- end

  finish(now: number, reason: string, winnerId?: string): void {
    if (this.ended) return;
    this.ended = true;
    this.stop();
    const board = this.leaderboard();
    const standings = board.map((r, i) => ({
      playerId: r.playerId,
      name: r.name,
      color: r.color,
      netWorth: r.netWorth,
      provinces: this.world.ownedBy(this.world.nationOf(r.playerId)!.id).length,
      rank: i + 1,
    }));
    if (winnerId) {
      const i = standings.findIndex((s) => s.playerId === winnerId);
      if (i > 0) {
        const [w] = standings.splice(i, 1);
        standings.unshift(w);
        standings.forEach((s, k) => (s.rank = k + 1));
      }
    }
    this.recap = {
      mode: this.settings.mode,
      winnerId: winnerId ?? standings[0]?.playerId ?? null,
      reason,
      standings,
      awards: this.awards(now),
    };
    this.emit.toAll('game:ended', this.recap);
    this.news.post('Market Desk', `FINAL BELL. ${standings[0]?.name ?? 'Nobody'} wins. ${reason}.`, 'neutral', true);
    this.onEnd();
  }

  protected awards(_now: number): GameRecap['awards'] {
    return [];
  }
}

function roundRes<T extends Record<string, number>>(r: T, f = 10): T {
  const o = {} as Record<string, number>;
  for (const k of RESOURCES) o[k] = Math.round((r[k] ?? 0) * f) / f;
  return o as T;
}

const BUILDING_NAME: Record<string, string> = { farm: 'Farm', mine: 'Mine', well: 'Oil well', lab: 'Research lab', fort: 'Fort', port: 'Port' };

const ROLE_BLURB: Record<Role, string> = {
  none: '',
  analyst: 'Your secret role: ANALYST. Your pressure bars show the live order book, not the delayed fuzzy one.',
  whale: `Your secret role: WHALE. You started with ${CONFIG.roles.whaleCashMultiplier}× cash. Move markets — but the regulator is watching.`,
  journalist: 'Your secret role: JOURNALIST. You can publish headlines under "Citizen Journal" from the Intel tab. True or not.',
};
