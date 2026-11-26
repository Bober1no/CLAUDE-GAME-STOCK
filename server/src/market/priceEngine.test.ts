import { describe, expect, it } from 'vitest';
import { CONFIG } from '@warmarket/shared';
import {
  clamp,
  computeNextPrice,
  fillPrice,
  limitFill,
  linkDrift,
  makeCandle,
  orderImbalance,
  reversionDrift,
  slippage,
  type PriceInput,
} from './priceEngine.js';

const P = CONFIG.market;
const base: PriceInput = {
  price: 100,
  fundamental: null,
  buyNotional: 0,
  sellNotional: 0,
  depth: 20_000,
  eventDrift: 0,
  linkDrift: 0,
  noise: 0,
};

describe('orderImbalance', () => {
  it('is zero for an empty or balanced book', () => {
    expect(orderImbalance(0, 0, 1000)).toBe(0);
    expect(orderImbalance(500, 500, 1000)).toBe(0);
  });
  it('is bounded in (-1, 1) and signed', () => {
    expect(orderImbalance(1e12, 0, 1000)).toBeLessThan(1);
    expect(orderImbalance(1e12, 0, 1000)).toBeGreaterThan(0.99);
    expect(orderImbalance(0, 1e12, 1000)).toBeGreaterThan(-1);
    expect(orderImbalance(0, 5000, 1000)).toBeLessThan(0);
  });
  it('treats depth as resistance: same order moves a deep market less', () => {
    expect(orderImbalance(1000, 0, 100_000)).toBeLessThan(orderImbalance(1000, 0, 1000));
  });
  it('ignores negative notionals (never trust input)', () => {
    expect(orderImbalance(-1000, 0, 1000)).toBe(0);
  });
});

describe('computeNextPrice', () => {
  it('does nothing with no forces', () => {
    const r = computeNextPrice(base, P);
    expect(r.price).toBe(100);
    expect(r.ret).toBe(0);
    expect(r.halt).toBe(false);
  });

  it('net buying raises the price, net selling lowers it', () => {
    expect(computeNextPrice({ ...base, buyNotional: 10_000 }, P).price).toBeGreaterThan(100);
    expect(computeNextPrice({ ...base, sellNotional: 10_000 }, P).price).toBeLessThan(100);
  });

  it('bigger pressure moves the price more (monotonic)', () => {
    const a = computeNextPrice({ ...base, buyNotional: 5_000 }, P).ret;
    const b = computeNextPrice({ ...base, buyNotional: 50_000 }, P).ret;
    expect(b).toBeGreaterThan(a);
  });

  it('caps moves at ±priceCap', () => {
    const up = computeNextPrice({ ...base, eventDrift: 0.9 }, P);
    expect(up.ret).toBeCloseTo(P.priceCap, 10);
    expect(up.capped).toBe(true);
    const down = computeNextPrice({ ...base, eventDrift: -0.9 }, P);
    expect(down.ret).toBeCloseTo(-P.priceCap, 10);
  });

  it('pure order pressure alone can never exceed pressureImpact', () => {
    const r = computeNextPrice({ ...base, buyNotional: 1e15 }, P);
    expect(r.ret).toBeLessThanOrEqual(P.pressureImpact);
  });

  it('triggers the circuit breaker on raw drops beyond the threshold, but still caps the move', () => {
    const r = computeNextPrice({ ...base, eventDrift: -0.35 }, P);
    expect(r.halt).toBe(true);
    expect(r.ret).toBeCloseTo(-P.priceCap, 10);
    const mild = computeNextPrice({ ...base, eventDrift: -0.18 }, P);
    expect(mild.halt).toBe(false);
  });

  it('a +20% rally does not halt (breaker is for drops only)', () => {
    expect(computeNextPrice({ ...base, eventDrift: 0.5 }, P).halt).toBe(false);
  });

  it('reverts toward fundamental value', () => {
    expect(computeNextPrice({ ...base, fundamental: 150 }, P).price).toBeGreaterThan(100);
    expect(computeNextPrice({ ...base, fundamental: 60 }, P).price).toBeLessThan(100);
    expect(computeNextPrice({ ...base, fundamental: 100 }, P).price).toBe(100);
  });

  it('never goes below minPrice', () => {
    let price = 0.02;
    for (let i = 0; i < 50; i++) price = computeNextPrice({ ...base, price, eventDrift: -1 }, P).price;
    expect(price).toBeGreaterThanOrEqual(P.minPrice);
  });

  it('is deterministic for the same input', () => {
    const inp = { ...base, buyNotional: 1234, sellNotional: 567, noise: 0.004, linkDrift: 0.01, fundamental: 110 };
    expect(computeNextPrice(inp, P)).toEqual(computeNextPrice(inp, P));
  });

  it('combines forces additively before the cap', () => {
    const r = computeNextPrice({ ...base, eventDrift: 0.01, linkDrift: 0.02, noise: -0.005 }, P);
    expect(r.rawRet).toBeCloseTo(0.025, 10);
    expect(r.price).toBeCloseTo(102.5, 8);
  });
});

describe('slippage + fills', () => {
  it('is zero for nothing, grows with size, and is capped', () => {
    expect(slippage(0, 1000, 0.1, 0.1)).toBe(0);
    expect(slippage(1000, 10_000, 0.1, 0.1)).toBeCloseTo(0.01);
    expect(slippage(5000, 10_000, 0.1, 0.1)).toBeGreaterThan(slippage(1000, 10_000, 0.1, 0.1));
    expect(slippage(1e9, 10_000, 0.1, 0.1)).toBe(0.1);
  });

  it('always moves against the trader', () => {
    expect(fillPrice(100, 'buy', 0.02)).toBeCloseTo(102);
    expect(fillPrice(100, 'cover', 0.02)).toBeCloseTo(102);
    expect(fillPrice(100, 'sell', 0.02)).toBeCloseTo(98);
    expect(fillPrice(100, 'short', 0.02)).toBeCloseTo(98);
  });

  it('limit orders fill only when the price lands in range and never cross the limit', () => {
    expect(limitFill(95, 'buy', 96, 0.05)).toBe(96);
    expect(limitFill(95, 'buy', 100, 0.01)).toBeCloseTo(95.95);
    expect(limitFill(101, 'buy', 100, 0.01)).toBeNull();
    expect(limitFill(105, 'sell', 104, 0.05)).toBe(104);
    expect(limitFill(103, 'sell', 104, 0.01)).toBeNull();
  });
});

describe('helpers', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
  it('reversionDrift sign and null handling', () => {
    expect(reversionDrift(100, null, 0.1)).toBe(0);
    expect(reversionDrift(100, 200, 0.1)).toBeCloseTo(0.1 * Math.log(2));
    expect(reversionDrift(100, 50, 0.1)).toBeLessThan(0);
  });
  it('linkDrift sums coef × driver return', () => {
    expect(linkDrift([{ coef: 0.5, driverRet: 0.1 }, { coef: -0.4, driverRet: 0.1 }])).toBeCloseTo(0.01);
    expect(linkDrift([])).toBe(0);
  });
  it('makeCandle wraps open/close in high/low', () => {
    const c = makeCandle(1, 100, 90, 5, 0.01, 0.02);
    expect(c.high).toBeGreaterThanOrEqual(100);
    expect(c.low).toBeLessThanOrEqual(90);
    expect(c.open).toBe(100);
    expect(c.close).toBe(90);
  });
});
