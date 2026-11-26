/**
 * Position accounting. One cash balance per player (it IS the nation treasury), plus
 * signed positions. Leverage is modelled per position:
 *
 *   Long  (qty > 0): pay notional/L in cash, borrow the rest (loan).
 *                    equity = qty·P − loan
 *   Short (qty < 0): lock notional/L margin; the sale proceeds are also locked.
 *                    collateral = margin + proceeds;  equity = collateral − |qty|·P
 *
 * With L = 1 a long has no loan and a short locks 2× notional, so neither can blow up
 * until price moves a lot. With L = 5 a ~14% move against you hits maintenance margin.
 */

import type { OrderSide } from '@warmarket/shared';

export interface Position {
  qty: number;
  avgPrice: number;
  loan: number;
  collateral: number;
}

export interface CashAccount {
  cash: number;
}

export function emptyPosition(): Position {
  return { qty: 0, avgPrice: 0, loan: 0, collateral: 0 };
}

export function positionValue(pos: Position, price: number): number {
  if (pos.qty > 0) return pos.qty * price - pos.loan;
  if (pos.qty < 0) return pos.collateral - -pos.qty * price;
  return 0;
}

/** Equity / gross notional. 1 for an unlevered long at any price. */
export function marginRatio(pos: Position, price: number): number {
  const notional = Math.abs(pos.qty) * price;
  if (notional <= 0) return Infinity;
  return positionValue(pos, price) / notional;
}

/** Unrealised P&L vs average entry. */
export function positionPnl(pos: Position, price: number): number {
  if (pos.qty > 0) return pos.qty * (price - pos.avgPrice);
  if (pos.qty < 0) return -pos.qty * (pos.avgPrice - price);
  return 0;
}

/** Which sides are legal given the current signed position. */
export function sideAllowed(side: OrderSide, qtyHeld: number): boolean {
  switch (side) {
    case 'buy':
      return qtyHeld >= 0;
    case 'sell':
      return qtyHeld > 0;
    case 'short':
      return qtyHeld <= 0;
    case 'cover':
      return qtyHeld < 0;
  }
}

/**
 * Apply an executed fill to cash + position. Returns realised P&L (0 for opening fills).
 * Caller must have validated side/qty (e.g. you can't sell more than you hold).
 */
export function applyFill(acct: CashAccount, pos: Position, side: OrderSide, qty: number, price: number, leverage: number): number {
  const L = Math.max(1, leverage);
  const notional = qty * price;
  switch (side) {
    case 'buy': {
      const margin = notional / L;
      acct.cash -= margin;
      pos.loan += notional - margin;
      pos.avgPrice = (pos.avgPrice * pos.qty + notional) / (pos.qty + qty);
      pos.qty += qty;
      return 0;
    }
    case 'sell': {
      const q = Math.min(qty, pos.qty);
      const f = q / pos.qty;
      const repay = pos.loan * f;
      const proceeds = q * price;
      acct.cash += proceeds - repay;
      pos.loan -= repay;
      const realised = proceeds - q * pos.avgPrice;
      pos.qty -= q;
      if (pos.qty <= 1e-9) Object.assign(pos, emptyPosition());
      return realised;
    }
    case 'short': {
      const margin = notional / L;
      acct.cash -= margin;
      pos.collateral += margin + notional;
      const held = -pos.qty;
      pos.avgPrice = (pos.avgPrice * held + notional) / (held + qty);
      pos.qty -= qty;
      return 0;
    }
    case 'cover': {
      const held = -pos.qty;
      const q = Math.min(qty, held);
      const f = q / held;
      const release = pos.collateral * f;
      const cost = q * price;
      acct.cash += release - cost;
      pos.collateral -= release;
      const realised = q * (pos.avgPrice - price);
      pos.qty += q;
      if (pos.qty >= -1e-9) Object.assign(pos, emptyPosition());
      return realised;
    }
  }
}

/** Cash to hold back when a buy/short order is placed so the fill can always be paid. */
export function reserveFor(side: OrderSide, qty: number, refPrice: number, leverage: number, buffer: number): number {
  if (side === 'sell' || side === 'cover') return 0;
  return (qty * refPrice * (1 + buffer)) / Math.max(1, leverage);
}
