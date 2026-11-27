import { describe, expect, it } from 'vitest';
import { CONFIG } from '@warmarket/shared';
import { Rng } from '../util/rng.js';
import { EVENT_KINDS, eventChanceAt, intensityAt, rollEvent, rumourHeadline, type EventContext } from './eventScheduler.js';

const ctx: EventContext = {
  intensity: 1,
  companies: [
    { id: 'HOTA', name: 'Hot Air Petroleum', sector: 'energy', ownerId: null },
    { id: 'SNAK', name: 'Big Snack Foods', sector: 'food', ownerId: null },
    { id: 'ALIC', name: 'Alice Corp', sector: 'tech', ownerId: 'p0' },
    { id: 'BOOM', name: 'Boom Industries', sector: 'defence', ownerId: null },
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
        expect(i.assetId || i.sector || i.allCompanies).toBeTruthy();
      }
      for (const s of e.shifts) expect(s.mult).toBeGreaterThan(0);
    }
  });

  it('impacts scale with intensity', () => {
    const lo = rollEvent(new Rng(9), { ...ctx, intensity: 1 }, 'drought')!;
    const hi = rollEvent(new Rng(9), { ...ctx, intensity: 2 }, 'drought')!;
    expect(Math.abs(hi.impacts[0].pct)).toBeCloseTo(Math.abs(lo.impacts[0].pct) * 2);
  });

  it('is deterministic for a seed', () => {
    expect(rollEvent(new Rng(123), ctx)).toEqual(rollEvent(new Rng(123), ctx));
    expect(rumourHeadline(new Rng(5), 'x')).toBe(rumourHeadline(new Rng(5), 'x'));
  });

  it('copes with no companies', () => {
    const e = rollEvent(new Rng(3), { intensity: 1, companies: [] });
    expect(e === null || e.impacts.length > 0).toBe(true);
  });
});
