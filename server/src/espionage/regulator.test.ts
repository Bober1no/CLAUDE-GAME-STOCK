import { describe, expect, it } from 'vitest';
import { detectManipulation, fineFor } from './regulator.js';
import type { TradeRecord } from '../market/market.js';

const tr = (p: Partial<TradeRecord>): TradeRecord => ({ tick: 1, playerId: 'p', assetId: 'DOGE2', side: 'buy', notional: 5000, price: 1, realised: 0, share: 0.9, ...p });

describe('regulator', () => {
  it('flags a dominant buy followed by a profitable sell after a big rise', () => {
    const f = detectManipulation([tr({})], [tr({ tick: 3, side: 'sell', price: 1.3, realised: 1500 })]);
    expect(f).toHaveLength(1);
    expect(f[0].rise).toBeCloseTo(0.3);
  });
  it('ignores small or crowd-following buys, slow round trips, losses and small moves', () => {
    const sell = tr({ tick: 3, side: 'sell', price: 1.3, realised: 1500 });
    expect(detectManipulation([tr({ share: 0.2 })], [sell])).toHaveLength(0);
    expect(detectManipulation([tr({ notional: 100 })], [sell])).toHaveLength(0);
    expect(detectManipulation([tr({ tick: -10 })], [sell])).toHaveLength(0);
    expect(detectManipulation([tr({})], [{ ...sell, realised: -5 }])).toHaveLength(0);
    expect(detectManipulation([tr({})], [{ ...sell, price: 1.05 }])).toHaveLength(0);
    expect(detectManipulation([tr({ playerId: 'q' })], [sell])).toHaveLength(0);
  });
  it('catches short-and-distort too', () => {
    const f = detectManipulation([tr({ side: 'short', price: 1 })], [tr({ tick: 2, side: 'cover', price: 0.7, realised: 900 })]);
    expect(f).toHaveLength(1);
  });
  it('fines scale with profit', () => {
    expect(fineFor(1000)).toBeGreaterThan(fineFor(0));
    expect(fineFor(-500)).toBe(fineFor(0));
  });
});
