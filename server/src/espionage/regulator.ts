/**
 * Market regulator: flags pump-and-dump round trips.
 *
 * A sell (or cover) is suspicious when the same player bought the asset within the last
 * `windowTicks` ticks, that buy made up most of the buy-side flow on its tick (they moved
 * the price), the price rose by `minPriceRise` since, and the buy was big enough to matter.
 * Shorts are the mirror image (short-and-distort). Pure function, tested.
 */
import { CONFIG } from '@warmarket/shared';
import type { TradeRecord } from '../market/market.js';

export interface Flag {
  playerId: string;
  assetId: string;
  profit: number;
  rise: number;
}

export function detectManipulation(history: TradeRecord[], current: TradeRecord[], cfg = CONFIG.regulator): Flag[] {
  const flags: Flag[] = [];
  for (const t of current) {
    const closing = t.side === 'sell' || t.side === 'cover';
    if (!closing || t.realised <= 0) continue;
    const opener = t.side === 'sell' ? 'buy' : 'short';
    const pumps = history.filter(
      (h) =>
        h.playerId === t.playerId &&
        h.assetId === t.assetId &&
        h.side === opener &&
        t.tick - h.tick >= 1 &&
        t.tick - h.tick <= cfg.windowTicks &&
        h.share >= cfg.minBuyShare &&
        h.notional >= cfg.minNotional,
    );
    for (const h of pumps) {
      const rise = opener === 'buy' ? t.price / h.price - 1 : h.price / t.price - 1;
      if (rise >= cfg.minPriceRise) {
        flags.push({ playerId: t.playerId, assetId: t.assetId, profit: t.realised, rise });
        break;
      }
    }
  }
  return flags;
}

export function fineFor(profit: number, cfg = CONFIG.regulator): number {
  return Math.round(cfg.fineFlat + Math.max(0, profit) * cfg.fineProfitFraction);
}
