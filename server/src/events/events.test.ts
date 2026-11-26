import { describe, expect, it } from 'vitest';
import { CONFIG } from '@warmarket/shared';
import { Rng } from '../util/rng.js';
import { EVENT_KINDS, eventChanceAt, intensityAt, rollEvent, rumourHeadline, type EventContext } from './eventScheduler.js';

const ctx: EventContext = {
  intensity: 1,
  provinces: [
    { id: 0, name: 'A', coastal: true, ownerId: 'n0', neighbors: [1] },
    { id: 1, name: 'B', coastal: false, ownerId: null, neighbors: [0, 2] },
    { id: 2, name: 'C', coastal: true, ownerId: 'n1', neighbors: [1] },
  ],
  nations: [
    { id: 'n0', name: 'Oilvania', companies: [{ id: 'OILE', name: 'Oilvania Petroleum', sector: 'energy' }, { id: 'OILP', name: 'Oilvania Pharma', sector: 'pharma' }] },
    { id: 'n1', name: 'Ricebowl', companies: [{ id: 'RICT', name: 'iRicebowl', sector: 'tech' }] },
  ],
};

describe('event scheduler', () => {
  it('ramps intensity and chance over the session', () => {
    expect(intensityAt(0)).toBe(CONFIG.events.intensityStart);
    expect(intensityAt(1)).toBe(CONFIG.events.intensityEnd);
    expect(intensityAt(0.5)).toBeGreaterThan(intensityAt(0.1));
    expect(eventChanceAt(1)).toBeGreaterThan(eventChanceAt(0));
    expect(intensityAt(5)).toBe(CONFIG.events.intensityEnd);
  });

  it('every event kind produces a well-formed spec with declared impacts', () => {
    for (const kind of EVENT_KINDS) {
      const e = rollEvent(new Rng(1), ctx, kind)!;
      expect(e).toBeTruthy();
      expect(e.kind).toBe(kind);
      expect(e.headline.length).toBeGreaterThan(10);
      expect(e.teaser.length).toBeGreaterThan(3);
      expect(e.impacts.length).toBeGreaterThan(0);
      for (const i of e.impacts) {
        expect(Number.isFinite(i.pct)).toBe(true);
        expect(i.ticks).toBeGreaterThan(0);
        expect(i.assetId || i.sector || i.nationId || i.allCompanies).toBeTruthy();
      }
      for (const p of e.provinceEffects) expect(ctx.provinces.some((x) => x.id === p.provinceId)).toBe(true);
    }
  });

  it('impacts scale with intensity', () => {
    const lo = rollEvent(new Rng(9), { ...ctx, intensity: 1 }, 'blight')!;
    const hi = rollEvent(new Rng(9), { ...ctx, intensity: 2 }, 'blight')!;
    expect(Math.abs(hi.impacts[0].pct)).toBeCloseTo(Math.abs(lo.impacts[0].pct) * 2);
  });

  it('is deterministic for a seed', () => {
    expect(rollEvent(new Rng(123), ctx)).toEqual(rollEvent(new Rng(123), ctx));
    expect(rumourHeadline(new Rng(5), 'x')).toBe(rumourHeadline(new Rng(5), 'x'));
  });

  it('copes with an empty world', () => {
    const e = rollEvent(new Rng(3), { intensity: 1, provinces: [], nations: [] });
    expect(e === null || e.impacts.length > 0).toBe(true);
  });
});
