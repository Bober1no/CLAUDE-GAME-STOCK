/**
 * Pure price-engine maths for the batch auction. No state, no I/O, no randomness
 * (noise is passed in already sampled) so everything here is unit-testable.
 *
 * Model, per asset per market tick:
 *
 *   imbalance  I = (B - S) / (B + S + D)
 *       B, S = buy-side / sell-side notional queued this window, D = market depth.
 *       I is in (-1, 1). Adding D in the denominator means a small order in a quiet
 *       market barely moves anything, while a big one-sided book saturates towards ±1.
 *
 *   raw return r = k·I                     (order pressure, k = pressureImpact)
 *                + Σ event drifts          (news/events, already per-tick fractions)
 *                + link drift              (lagged sector/commodity correlations)
 *                + m·ln(F / P)             (mean reversion toward fundamental F)
 *                + noise                   (σ·z, sampled by the caller)
 *
 *   applied    r' = clamp(r, -cap, +cap);  P' = max(minPrice, P·(1 + r'))
 *   halt next tick if r < -circuitBreakerDrop (the RAW move, before the cap).
 */

export interface PriceParams {
  priceCap: number;
  circuitBreakerDrop: number;
  pressureImpact: number;
  meanReversion: number;
  minPrice: number;
}

export interface PriceInput {
  price: number;
  /** Fundamental value to revert toward. null = random walk (no reversion). */
  fundamental: number | null;
  buyNotional: number;
  sellNotional: number;
  depth: number;
  eventDrift: number;
  linkDrift: number;
  noise: number;
}

export interface PriceOutput {
  price: number;
  /** Applied return after the cap. */
  ret: number;
  /** Return before capping. */
  rawRet: number;
  imbalance: number;
  capped: boolean;
  halt: boolean;
}

export function orderImbalance(buyNotional: number, sellNotional: number, depth: number): number {
  const b = Math.max(0, buyNotional);
  const s = Math.max(0, sellNotional);
  const denom = b + s + Math.max(1e-9, depth);
  return (b - s) / denom;
}

export function reversionDrift(price: number, fundamental: number | null, strength: number): number {
  if (fundamental === null || fundamental <= 0 || price <= 0) return 0;
  return strength * Math.log(fundamental / price);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function computeNextPrice(input: PriceInput, p: PriceParams): PriceOutput {
  const imbalance = orderImbalance(input.buyNotional, input.sellNotional, input.depth);
  const pressure = p.pressureImpact * imbalance;
  const reversion = reversionDrift(input.price, input.fundamental, p.meanReversion);
  const rawRet = pressure + input.eventDrift + input.linkDrift + reversion + input.noise;
  const ret = clamp(rawRet, -p.priceCap, p.priceCap);
  const price = Math.max(p.minPrice, input.price * (1 + ret));
  return {
    price,
    ret: price / input.price - 1,
    rawRet,
    imbalance,
    capped: ret !== rawRet,
    halt: rawRet < -p.circuitBreakerDrop,
  };
}

/**
 * Slippage grows linearly with order size relative to depth:
 *   slip = min(maxSlip, k · notional / depth)
 * so an order equal to the whole depth costs k (e.g. 12%) extra, capped at maxSlip.
 */
export function slippage(notional: number, depth: number, k: number, maxSlip: number): number {
  if (notional <= 0) return 0;
  return Math.min(maxSlip, (k * notional) / Math.max(1e-9, depth));
}

/** Buyers (buy/cover) pay above the clearing price, sellers (sell/short) receive below it. */
export function fillPrice(clearing: number, side: 'buy' | 'sell' | 'short' | 'cover', slip: number): number {
  return side === 'buy' || side === 'cover' ? clearing * (1 + slip) : clearing * (1 - slip);
}

/**
 * Limit check: buy-side limits fill if the clearing price is at or below the limit,
 * sell-side limits fill if it is at or above. Fill price never crosses the limit.
 */
export function limitFill(
  clearing: number,
  side: 'buy' | 'sell' | 'short' | 'cover',
  limit: number,
  slip: number,
): number | null {
  const buySide = side === 'buy' || side === 'cover';
  if (buySide) {
    if (clearing > limit) return null;
    return Math.min(limit, clearing * (1 + slip));
  }
  if (clearing < limit) return null;
  return Math.max(limit, clearing * (1 - slip));
}

/** Synthetic candle for one batch tick: open = old price, close = new price, small wicks. */
export function makeCandle(
  time: number,
  open: number,
  close: number,
  volume: number,
  wickA: number,
  wickB: number,
): { time: number; open: number; high: number; low: number; close: number; volume: number } {
  const high = Math.max(open, close) * (1 + Math.abs(wickA));
  const low = Math.min(open, close) * (1 - Math.min(0.5, Math.abs(wickB)));
  return { time, open, high, low, close, volume };
}

/**
 * Lagged link drift: Σ coef × (driver's return on the previous tick).
 * Using the previous tick keeps one tick's clearing independent of asset order.
 */
export function linkDrift(links: { coef: number; driverRet: number }[]): number {
  let d = 0;
  for (const l of links) d += l.coef * l.driverRet;
  return d;
}
