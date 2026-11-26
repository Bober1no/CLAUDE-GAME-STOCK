/**
 * The exchange: assets, per-player accounts, the order queue and the batch auction.
 * Orders queue during each 20s window; tick() clears every asset at once.
 * Pure maths lives in priceEngine.ts / accounts.ts — this file is bookkeeping.
 */

import {
  CONFIG,
  type AccountView,
  type AssetInfo,
  type Candle,
  type FillView,
  type OrderSide,
  type OrderType,
  type OrderView,
  type Quote,
  type Sector,
} from '@warmarket/shared';
import { Rng, uid } from '../util/rng.js';
import {
  computeNextPrice,
  fillPrice,
  limitFill,
  linkDrift,
  makeCandle,
  orderImbalance,
  slippage,
} from './priceEngine.js';
import {
  applyFill,
  emptyPosition,
  marginRatio,
  positionPnl,
  positionValue,
  reserveFor,
  sideAllowed,
  type Position,
} from './accounts.js';

const M = CONFIG.market;

export interface AssetState {
  info: AssetInfo;
  price: number;
  prevPrice: number;
  depth: number;
  volatility: number;
  history: Candle[];
  /** Return on the most recent tick (drives lagged links). */
  lastRet: number;
  /** Halted for the current window (orders rejected). */
  halted: boolean;
  lastVolume: number;
  listingPrice: number;
}

export interface Order {
  id: string;
  playerId: string;
  assetId: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  leverage: number;
  reserved: number;
  placedAt: number;
}

export interface PlayerAccount {
  playerId: string;
  cash: number;
  reserved: number;
  positions: Map<string, Position>;
  orders: Order[];
  fills: FillView[];
  /** Stats for the recap. */
  worstTrade: { pnl: number; assetId: string } | null;
  realisedByAsset: Map<string, number>;
  marginCall: boolean;
}

/** A per-tick impact (news, war, events): `perTick` added to drift for `ticksLeft` ticks. */
export interface Impact {
  assetId: string;
  perTick: number;
  ticksLeft: number;
  /** Optional label, for debugging/recap. */
  why?: string;
}

export interface TradeRecord {
  tick: number;
  playerId: string;
  assetId: string;
  side: OrderSide;
  notional: number;
  price: number;
  realised: number;
  /** Share of this tick's same-side notional on this asset. */
  share: number;
}

export interface TickResult {
  tick: number;
  quotes: Quote[];
  candles: Record<string, Candle>;
  /** Fills per player (so the server can notify). */
  fillsByPlayer: Map<string, FillView[]>;
  trades: TradeRecord[];
  bigMoves: { assetId: string; ret: number; halted: boolean }[];
  liquidations: { playerId: string; assetId: string }[];
}

export type FundamentalFn = (asset: AssetState) => number | null;

export class Market {
  assets = new Map<string, AssetState>();
  accounts = new Map<string, PlayerAccount>();
  tickNo = 0;
  impacts: Impact[] = [];
  /** Snapshots of order imbalance for delayed pressure bars: [time, bars]. */
  private pressureLog: { t: number; bars: Record<string, number> }[] = [];

  constructor(
    private rng: Rng,
    private startTime: number,
  ) {}

  // ------------------------------------------------------------------- setup

  addAsset(info: AssetInfo, depth: number, volatility: number): AssetState {
    const a: AssetState = {
      info,
      price: info.basePrice,
      prevPrice: info.basePrice,
      depth,
      volatility,
      history: [],
      lastRet: 0,
      halted: false,
      lastVolume: 0,
      listingPrice: info.basePrice,
    };
    this.assets.set(info.id, a);
    return a;
  }

  /** Generate some pre-game history so charts aren't empty at t=0. Ends at basePrice. */
  seedHistory(ticks: number): void {
    for (const a of this.assets.values()) {
      const pts: number[] = [a.info.basePrice];
      for (let i = 0; i < ticks; i++) {
        const prev = pts[pts.length - 1];
        pts.push(prev / (1 + this.rng.normal() * a.volatility * 0.8));
      }
      pts.reverse();
      for (let i = 1; i < pts.length; i++) {
        const time = this.tickTime(i - ticks);
        a.history.push(
          makeCandle(time, pts[i - 1], pts[i], 0, this.rng.normal() * a.volatility * M.wickFactor, this.rng.normal() * a.volatility * M.wickFactor),
        );
      }
      a.price = a.prevPrice = a.info.basePrice;
    }
  }

  openAccount(playerId: string, cash: number): PlayerAccount {
    const acct: PlayerAccount = {
      playerId,
      cash,
      reserved: 0,
      positions: new Map(),
      orders: [],
      fills: [],
      worstTrade: null,
      realisedByAsset: new Map(),
      marginCall: false,
    };
    this.accounts.set(playerId, acct);
    return acct;
  }

  tickTime(tick: number): number {
    return Math.floor(this.startTime / 1000) + tick * Math.round(CONFIG.clocks.marketTickMs / 1000);
  }

  // ------------------------------------------------------------------- cash helpers

  freeCash(playerId: string): number {
    const a = this.accounts.get(playerId);
    return a ? a.cash - a.reserved : 0;
  }

  /** Spend cash on non-market things (armies, buildings). Fails if not enough free cash. */
  spend(playerId: string, amount: number): boolean {
    const a = this.accounts.get(playerId);
    if (!a || amount < 0 || a.cash - a.reserved < amount) return false;
    a.cash -= amount;
    return true;
  }

  /** Force a debit even if it makes cash negative (fines, upkeep, deal flows). */
  debit(playerId: string, amount: number): void {
    const a = this.accounts.get(playerId);
    if (a) a.cash -= amount;
  }

  credit(playerId: string, amount: number): void {
    const a = this.accounts.get(playerId);
    if (a && Number.isFinite(amount)) a.cash += amount;
  }

  // ------------------------------------------------------------------- orders

  placeOrder(
    playerId: string,
    o: { assetId: string; side: OrderSide; orderType: OrderType; qty: number; limitPrice?: number; leverage?: number },
    now: number,
    opts: { leverageEnabled: boolean; limitEnabled: boolean; blocked?: (assetId: string) => string | null },
  ): { ok: boolean; error?: string; order?: Order } {
    const acct = this.accounts.get(playerId);
    const asset = this.assets.get(o.assetId);
    if (!acct) return { ok: false, error: 'No account' };
    if (!asset) return { ok: false, error: 'Unknown asset' };
    if (asset.halted) return { ok: false, error: `${asset.info.id} is halted this round (circuit breaker)` };
    const blocked = opts.blocked?.(o.assetId);
    if (blocked) return { ok: false, error: blocked };
    if (!Number.isInteger(o.qty) || o.qty <= 0) return { ok: false, error: 'Quantity must be a positive whole number' };
    if (acct.orders.length >= M.maxOpenOrdersPerPlayer) return { ok: false, error: 'Too many open orders' };

    const leverage = o.leverage ?? 1;
    if (!M.leverageOptions.includes(leverage)) return { ok: false, error: 'Invalid leverage' };
    if (leverage > 1 && !opts.leverageEnabled) return { ok: false, error: 'Leverage is not enabled' };
    if (leverage > 1 && (o.side === 'sell' || o.side === 'cover')) return { ok: false, error: 'Leverage applies to opening orders only' };

    if (o.orderType === 'limit') {
      if (!opts.limitEnabled) return { ok: false, error: 'Limit orders are not enabled' };
      if (typeof o.limitPrice !== 'number' || !Number.isFinite(o.limitPrice) || o.limitPrice <= 0)
        return { ok: false, error: 'Bad limit price' };
      // Must be reachable this tick, otherwise it's pointless and just ties up cash.
      if (o.limitPrice < asset.price * (1 - M.priceCap) * 0.5 || o.limitPrice > asset.price * (1 + M.priceCap) * 2)
        return { ok: false, error: 'Limit price too far from market' };
    }

    const notional = o.qty * asset.price;
    if (notional > M.maxOrderNotional) return { ok: false, error: 'Order too large' };

    const pos = acct.positions.get(o.assetId) ?? emptyPosition();
    // Position direction must match the side (no flipping long→short in one order).
    const pendingSameAsset = acct.orders.filter((x) => x.assetId === o.assetId);
    if (!sideAllowed(o.side, pos.qty)) {
      return { ok: false, error: sideError(o.side, pos.qty) };
    }
    if (pendingSameAsset.some((x) => conflicting(x.side, o.side))) {
      return { ok: false, error: 'You already have an opposing order queued on this asset' };
    }
    if (o.side === 'sell' || o.side === 'cover') {
      const held = Math.abs(pos.qty);
      const pending = pendingSameAsset.filter((x) => x.side === o.side).reduce((s, x) => s + x.qty, 0);
      if (o.qty + pending > held + 1e-9) return { ok: false, error: `You only hold ${held - pending} closable units` };
    }

    // Reserve enough to cover worst-case cap move + slippage.
    const ref =
      o.orderType === 'limit' && (o.side === 'buy') ? Math.min(o.limitPrice!, asset.price * (1 + M.priceCap)) : asset.price;
    const reserve = reserveFor(o.side, o.qty, ref, leverage, M.reserveBuffer);
    if (acct.cash - acct.reserved < reserve) return { ok: false, error: 'Not enough free cash for this order' };

    const order: Order = {
      id: uid('o'),
      playerId,
      assetId: o.assetId,
      side: o.side,
      type: o.orderType,
      qty: o.qty,
      limitPrice: o.orderType === 'limit' ? o.limitPrice : undefined,
      leverage,
      reserved: reserve,
      placedAt: now,
    };
    acct.reserved += reserve;
    acct.orders.push(order);
    return { ok: true, order };
  }

  cancelOrder(playerId: string, orderId: string): boolean {
    const acct = this.accounts.get(playerId);
    if (!acct) return false;
    const i = acct.orders.findIndex((o) => o.id === orderId);
    if (i < 0) return false;
    acct.reserved -= acct.orders[i].reserved;
    acct.orders.splice(i, 1);
    return true;
  }

  cancelAll(playerId: string): void {
    const acct = this.accounts.get(playerId);
    if (!acct) return;
    acct.orders = [];
    acct.reserved = 0;
  }

  allOrders(): Order[] {
    const out: Order[] = [];
    for (const a of this.accounts.values()) out.push(...a.orders);
    return out;
  }

  /** Current window's buy/sell notional per asset (market orders + limit orders). */
  bookPressure(filter?: (o: Order) => boolean): Record<string, { buy: number; sell: number }> {
    const book: Record<string, { buy: number; sell: number }> = {};
    for (const id of this.assets.keys()) book[id] = { buy: 0, sell: 0 };
    for (const o of this.allOrders()) {
      if (filter && !filter(o)) continue;
      const a = this.assets.get(o.assetId);
      if (!a || !book[o.assetId]) continue;
      // qty is the full position size, so leveraged orders already carry their full notional.
      const n = o.qty * a.price;
      if (o.side === 'buy' || o.side === 'cover') book[o.assetId].buy += n;
      else book[o.assetId].sell += n;
    }
    return book;
  }

  /** Record a pressure snapshot (called every second by the game). */
  logPressure(now: number): void {
    const book = this.bookPressure((o) => o.type === 'market');
    const bars: Record<string, number> = {};
    for (const [id, a] of this.assets) bars[id] = orderImbalance(book[id].buy, book[id].sell, a.depth * 0.25);
    this.pressureLog.push({ t: now, bars });
    const cutoff = now - 60_000;
    while (this.pressureLog.length && this.pressureLog[0].t < cutoff) this.pressureLog.shift();
  }

  /** Pressure as it looked `delayMs` ago. */
  delayedPressure(now: number, delayMs: number): Record<string, number> {
    const target = now - delayMs;
    let snap: Record<string, number> | null = null;
    for (const s of this.pressureLog) {
      if (s.t <= target) snap = s.bars;
      else break;
    }
    if (!snap) {
      const out: Record<string, number> = {};
      for (const id of this.assets.keys()) out[id] = 0;
      return out;
    }
    return snap;
  }

  clearPressureLog(): void {
    this.pressureLog = [];
  }

  // ------------------------------------------------------------------- impacts

  addImpact(assetId: string, totalPct: number, durationTicks: number, why?: string): void {
    if (!this.assets.has(assetId) || durationTicks <= 0 || !Number.isFinite(totalPct)) return;
    this.impacts.push({ assetId, perTick: totalPct / durationTicks, ticksLeft: durationTicks, why });
  }

  addSectorImpact(sector: Sector, totalPct: number, durationTicks: number, why?: string): void {
    for (const a of this.assets.values()) if (a.info.sector === sector) this.addImpact(a.info.id, totalPct, durationTicks, why);
  }

  addNationImpact(nationId: string, totalPct: number, durationTicks: number, why?: string): void {
    for (const a of this.assets.values()) if (a.info.nationId === nationId) this.addImpact(a.info.id, totalPct, durationTicks, why);
  }

  // ------------------------------------------------------------------- the batch auction

  tick(fundamental: FundamentalFn): TickResult {
    this.tickNo++;
    const tick = this.tickNo;
    const time = this.tickTime(tick);

    // 1) Aggregate this window's order flow per asset. Limit orders do NOT add pressure
    //    (they're conditional on the price we're about to compute).
    const book = this.bookPressure((o) => o.type === 'market');

    // 2) Event drift per asset from active impacts.
    const drift: Record<string, number> = {};
    for (const imp of this.impacts) {
      drift[imp.assetId] = (drift[imp.assetId] ?? 0) + imp.perTick;
      imp.ticksLeft--;
    }
    this.impacts = this.impacts.filter((i) => i.ticksLeft > 0);

    // 3) Lagged link drift from last tick's commodity moves.
    const lastRets: Record<string, number> = {};
    for (const [id, a] of this.assets) lastRets[id] = a.lastRet;

    const quotes: Quote[] = [];
    const candles: Record<string, Candle> = {};
    const bigMoves: TickResult['bigMoves'] = [];
    const newPrices = new Map<string, number>();
    const wasHalted = new Set<string>();

    for (const [id, a] of this.assets) {
      const links: { coef: number; driverRet: number }[] = [];
      if (a.info.sector) {
        for (const l of CONFIG.sectorLinks) if (l.sector === a.info.sector) links.push({ coef: l.coef, driverRet: lastRets[l.driver] ?? 0 });
      }
      for (const l of CONFIG.commodityLinks) if (l.target === id) links.push({ coef: l.coef, driverRet: lastRets[l.driver] ?? 0 });

      let eventDrift = drift[id] ?? 0;
      if (a.info.kind === 'memecoin') eventDrift += this.memecoinChaos(a);

      const out = computeNextPrice(
        {
          price: a.price,
          fundamental: fundamental(a),
          buyNotional: a.halted ? 0 : book[id].buy,
          sellNotional: a.halted ? 0 : book[id].sell,
          depth: a.depth,
          eventDrift,
          linkDrift: linkDrift(links),
          noise: this.rng.normal() * a.volatility,
        },
        M,
      );

      if (a.halted) wasHalted.add(id);
      a.prevPrice = a.price;
      a.price = out.price;
      a.lastRet = out.ret;
      // Circuit breaker: halt for the NEXT window.
      a.halted = out.halt;
      newPrices.set(id, out.price);
      if (Math.abs(out.ret) >= 0.08 || out.halt) bigMoves.push({ assetId: id, ret: out.ret, halted: out.halt });
    }

    // 4) Execute orders at the new clearing price, with size-based slippage.
    const fillsByPlayer = new Map<string, FillView[]>();
    const trades: TradeRecord[] = [];
    const volume: Record<string, number> = {};
    const sideTotals: Record<string, { buy: number; sell: number }> = {};
    for (const o of this.allOrders()) {
      const a = this.assets.get(o.assetId)!;
      const st = (sideTotals[o.assetId] ??= { buy: 0, sell: 0 });
      if (o.side === 'buy' || o.side === 'cover') st.buy += o.qty * a.prevPrice;
      else st.sell += o.qty * a.prevPrice;
    }

    for (const acct of this.accounts.values()) {
      const orders = acct.orders;
      acct.orders = [];
      for (const o of orders) {
        acct.reserved -= o.reserved;
        const a = this.assets.get(o.assetId);
        if (!a) continue;
        if (wasHalted.has(o.assetId)) continue;
        const clearing = a.price;
        const slip = slippage(o.qty * clearing, a.depth, M.slippageK, M.maxSlippage);
        let px: number | null;
        if (o.type === 'limit') px = limitFill(clearing, o.side, o.limitPrice!, slip);
        else px = fillPrice(clearing, o.side, slip);
        if (px === null) {
          this.pushFill(acct, fillsByPlayer, { id: uid('f'), tick, assetId: o.assetId, side: o.side, qty: 0, price: clearing, slippage: 0, realisedPnl: 0, note: 'Limit not reached — cancelled' });
          continue;
        }
        const pos = acct.positions.get(o.assetId) ?? emptyPosition();
        // Re-validate (position may have been liquidated since placement).
        if (!sideAllowed(o.side, pos.qty)) continue;
        const qty = o.side === 'sell' || o.side === 'cover' ? Math.min(o.qty, Math.abs(pos.qty)) : o.qty;
        if (qty <= 0) continue;
        const realised = applyFill(acct, pos, o.side, qty, px, o.leverage);
        acct.positions.set(o.assetId, pos);
        if (pos.qty === 0) acct.positions.delete(o.assetId);
        volume[o.assetId] = (volume[o.assetId] ?? 0) + qty * px;
        this.trackRealised(acct, o.assetId, realised);
        const st = sideTotals[o.assetId];
        const buySide = o.side === 'buy' || o.side === 'cover';
        const sideNotional = buySide ? st.buy : st.sell;
        trades.push({
          tick,
          playerId: acct.playerId,
          assetId: o.assetId,
          side: o.side,
          notional: qty * px,
          price: px,
          realised,
          share: sideNotional > 0 ? (o.qty * a.prevPrice) / sideNotional : 1,
        });
        this.pushFill(acct, fillsByPlayer, {
          id: uid('f'),
          tick,
          assetId: o.assetId,
          side: o.side,
          qty,
          price: px,
          slippage: slip,
          realisedPnl: realised,
          note: o.leverage > 1 ? `${o.leverage}x` : undefined,
        });
      }
      if (acct.reserved < 1e-6) acct.reserved = 0;
    }

    // 5) Margin calls: force-close positions whose equity fell below maintenance.
    const liquidations: TickResult['liquidations'] = [];
    for (const acct of this.accounts.values()) {
      acct.marginCall = false;
      for (const [assetId, pos] of [...acct.positions]) {
        const a = this.assets.get(assetId)!;
        const mr = marginRatio(pos, a.price);
        if (mr < M.maintenanceMargin) {
          const side: OrderSide = pos.qty > 0 ? 'sell' : 'cover';
          const qty = Math.abs(pos.qty);
          const slip = slippage(qty * a.price, a.depth, M.slippageK, M.maxSlippage);
          const px = fillPrice(a.price, side, slip);
          const realised = applyFill(acct, pos, side, qty, px, 1);
          acct.positions.delete(assetId);
          this.trackRealised(acct, assetId, realised);
          liquidations.push({ playerId: acct.playerId, assetId });
          this.pushFill(acct, fillsByPlayer, { id: uid('f'), tick, assetId, side, qty, price: px, slippage: slip, realisedPnl: realised, note: 'MARGIN CALL — liquidated' });
        } else if (mr < M.marginWarning) {
          acct.marginCall = true;
        }
      }
    }

    // 6) Candles + quotes.
    for (const [id, a] of this.assets) {
      a.lastVolume = volume[id] ?? 0;
      const c = makeCandle(time, a.prevPrice, a.price, a.lastVolume, this.rng.normal() * a.volatility * M.wickFactor, this.rng.normal() * a.volatility * M.wickFactor);
      a.history.push(c);
      if (a.history.length > M.historyLength) a.history.shift();
      candles[id] = c;
      quotes.push(this.quote(a));
    }

    this.clearPressureLog();
    return { tick, quotes, candles, fillsByPlayer, trades, bigMoves, liquidations };
  }

  /** WarDoge: random pumps, and a rug pull once it's been pumped high enough. */
  private memecoinChaos(a: AssetState): number {
    const mc = CONFIG.memecoin;
    if (a.price > mc.basePrice * mc.rugThreshold && this.rng.chance(mc.rugChance)) return -mc.rugSize;
    if (this.rng.chance(mc.pumpChance)) return mc.pumpSize * this.rng.range(0.5, 1);
    return 0;
  }

  private trackRealised(acct: PlayerAccount, assetId: string, realised: number): void {
    if (realised === 0) return;
    acct.realisedByAsset.set(assetId, (acct.realisedByAsset.get(assetId) ?? 0) + realised);
    if (!acct.worstTrade || realised < acct.worstTrade.pnl) acct.worstTrade = { pnl: realised, assetId };
  }

  private pushFill(acct: PlayerAccount, map: Map<string, FillView[]>, f: FillView): void {
    acct.fills.unshift(f);
    if (acct.fills.length > 30) acct.fills.pop();
    const arr = map.get(acct.playerId) ?? [];
    arr.push(f);
    map.set(acct.playerId, arr);
  }

  // ------------------------------------------------------------------- views

  quote(a: AssetState): Quote {
    return {
      id: a.info.id,
      price: a.price,
      prevPrice: a.prevPrice,
      change: a.prevPrice > 0 ? a.price / a.prevPrice - 1 : 0,
      changeTotal: a.price / a.listingPrice - 1,
      halted: a.halted,
      volume: a.lastVolume,
    };
  }

  quotes(): Quote[] {
    return [...this.assets.values()].map((a) => this.quote(a));
  }

  history(): Record<string, Candle[]> {
    const h: Record<string, Candle[]> = {};
    for (const [id, a] of this.assets) h[id] = a.history;
    return h;
  }

  portfolioValue(playerId: string): number {
    const acct = this.accounts.get(playerId);
    if (!acct) return 0;
    let v = 0;
    for (const [id, pos] of acct.positions) v += positionValue(pos, this.assets.get(id)!.price);
    return v;
  }

  /** Cash + positions (excluding nation assets, which the game adds). */
  marketWorth(playerId: string): number {
    const acct = this.accounts.get(playerId);
    if (!acct) return 0;
    return acct.cash + this.portfolioValue(playerId);
  }

  orderView(o: Order): OrderView {
    return { id: o.id, assetId: o.assetId, side: o.side, type: o.type, qty: o.qty, limitPrice: o.limitPrice, leverage: o.leverage, placedAt: o.placedAt };
  }

  accountView(playerId: string, extraWorth: number): AccountView | null {
    const acct = this.accounts.get(playerId);
    if (!acct) return null;
    const positions = [...acct.positions].map(([assetId, pos]) => {
      const price = this.assets.get(assetId)!.price;
      return {
        assetId,
        qty: pos.qty,
        avgPrice: pos.avgPrice,
        loan: pos.loan,
        collateral: pos.collateral,
        value: positionValue(pos, price),
        pnl: positionPnl(pos, price),
        marginRatio: Math.min(9.99, marginRatio(pos, price)),
      };
    });
    const portfolioValue = positions.reduce((s, p) => s + p.value, 0);
    return {
      cash: acct.cash,
      reserved: acct.reserved,
      positions,
      orders: acct.orders.map((o) => this.orderView(o)),
      fills: acct.fills.slice(0, 20),
      portfolioValue,
      netWorth: acct.cash + portfolioValue + extraWorth,
      marginCall: acct.marginCall,
    };
  }
}

/** Different sides on the same asset in one window (buy+sell, short+cover, ...) are refused. */
function conflicting(a: OrderSide, b: OrderSide): boolean {
  return a !== b;
}

function sideError(side: OrderSide, held: number): string {
  if (side === 'sell') return 'Nothing to sell (use SHORT to bet against it)';
  if (side === 'cover') return 'No short position to cover';
  if (side === 'buy') return `You are short ${-held}: COVER first`;
  return `You are long ${held}: SELL first`;
}
