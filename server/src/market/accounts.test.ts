import { describe, expect, it } from 'vitest';
import { applyFill, emptyPosition, marginRatio, positionPnl, positionValue, reserveFor, sideAllowed } from './accounts.js';

describe('applyFill', () => {
  it('unlevered long round trip at a profit', () => {
    const acct = { cash: 1000 };
    const pos = emptyPosition();
    applyFill(acct, pos, 'buy', 10, 50, 1);
    expect(acct.cash).toBe(500);
    expect(pos.qty).toBe(10);
    expect(positionValue(pos, 60)).toBe(600);
    const realised = applyFill(acct, pos, 'sell', 10, 60, 1);
    expect(realised).toBe(100);
    expect(acct.cash).toBe(1100);
    expect(pos.qty).toBe(0);
  });

  it('levered long borrows and repays the loan on sale', () => {
    const acct = { cash: 1000 };
    const pos = emptyPosition();
    applyFill(acct, pos, 'buy', 10, 100, 5); // notional 1000, margin 200
    expect(acct.cash).toBe(800);
    expect(pos.loan).toBe(800);
    expect(positionValue(pos, 100)).toBe(200);
    expect(marginRatio(pos, 100)).toBeCloseTo(0.2);
    applyFill(acct, pos, 'sell', 10, 110, 1); // proceeds 1100, repay 800
    expect(acct.cash).toBeCloseTo(1100);
  });

  it('partial sells repay a proportional share of the loan', () => {
    const acct = { cash: 1000 };
    const pos = emptyPosition();
    applyFill(acct, pos, 'buy', 10, 100, 2);
    applyFill(acct, pos, 'sell', 5, 100, 1);
    expect(pos.qty).toBe(5);
    expect(pos.loan).toBeCloseTo(250);
    expect(acct.cash).toBeCloseTo(750);
  });

  it('unlevered short profits when price falls and is break-even at entry', () => {
    const acct = { cash: 1000 };
    const pos = emptyPosition();
    applyFill(acct, pos, 'short', 10, 50, 1);
    expect(acct.cash).toBe(500);
    expect(pos.qty).toBe(-10);
    expect(positionValue(pos, 50)).toBe(500);
    expect(positionPnl(pos, 40)).toBe(100);
    const realised = applyFill(acct, pos, 'cover', 10, 40, 1);
    expect(realised).toBe(100);
    expect(acct.cash).toBe(1100);
  });

  it('short loses when price rises and margin ratio shrinks', () => {
    const pos = emptyPosition();
    const acct = { cash: 1000 };
    applyFill(acct, pos, 'short', 10, 100, 5); // margin 200, collateral 1200
    expect(pos.collateral).toBe(1200);
    expect(marginRatio(pos, 100)).toBeCloseTo(0.2);
    expect(marginRatio(pos, 110)).toBeLessThan(0.1);
  });

  it('average price is volume-weighted across adds', () => {
    const pos = emptyPosition();
    const acct = { cash: 10_000 };
    applyFill(acct, pos, 'buy', 10, 100, 1);
    applyFill(acct, pos, 'buy', 10, 200, 1);
    expect(pos.avgPrice).toBe(150);
  });

  it('conserves value: buy then sell at the same price returns the cash', () => {
    for (const L of [1, 2, 3, 5]) {
      const acct = { cash: 5000 };
      const pos = emptyPosition();
      applyFill(acct, pos, 'buy', 7, 33, L);
      applyFill(acct, pos, 'sell', 7, 33, 1);
      expect(acct.cash).toBeCloseTo(5000, 8);
      const acct2 = { cash: 5000 };
      const pos2 = emptyPosition();
      applyFill(acct2, pos2, 'short', 7, 33, L);
      applyFill(acct2, pos2, 'cover', 7, 33, 1);
      expect(acct2.cash).toBeCloseTo(5000, 8);
    }
  });
});

describe('rules', () => {
  it('sideAllowed blocks flipping and selling what you do not own', () => {
    expect(sideAllowed('sell', 0)).toBe(false);
    expect(sideAllowed('cover', 0)).toBe(false);
    expect(sideAllowed('buy', -5)).toBe(false);
    expect(sideAllowed('short', 5)).toBe(false);
    expect(sideAllowed('buy', 5)).toBe(true);
    expect(sideAllowed('short', -5)).toBe(true);
  });
  it('reserves include the buffer and scale with leverage', () => {
    expect(reserveFor('buy', 10, 100, 1, 0.27)).toBeCloseTo(1270);
    expect(reserveFor('buy', 10, 100, 5, 0.27)).toBeCloseTo(254);
    expect(reserveFor('sell', 10, 100, 1, 0.27)).toBe(0);
  });
});
