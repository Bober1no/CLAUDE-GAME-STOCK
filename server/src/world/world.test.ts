import { describe, expect, it } from 'vitest';
import { CONFIG } from '@warmarket/shared';
import { components, generateMap, landCountFor, placeNations } from './mapgen.js';
import { commodityFundamental, companyFundamental, provinceYield, stabilityMultiplier, stabilityStep } from './economy.js';

describe('generateMap', () => {
  for (const players of [2, 5, 8]) {
    it(`builds a connected map of 30–40 provinces for ${players} players`, () => {
      const m = generateMap(12345 + players, players);
      expect(m.provinces.length).toBe(landCountFor(players));
      expect(m.provinces.length).toBeGreaterThanOrEqual(30);
      expect(m.provinces.length).toBeLessThanOrEqual(40);
      expect(components(m.provinces).length).toBe(1);
      for (const p of m.provinces) {
        expect(p.neighbors.length).toBeGreaterThan(0);
        for (const n of p.neighbors) expect(m.provinces[n].neighbors).toContain(p.id);
        expect(p.path.startsWith('M')).toBe(true);
      }
    });
  }

  it('is deterministic for a seed', () => {
    expect(generateMap(99, 4)).toEqual(generateMap(99, 4));
  });

  it('places nations on distinct provinces with the requested size', () => {
    const m = generateMap(7, 8);
    const nations = placeNations(m, 8, 3, 7);
    const all = nations.flatMap((n) => n.provinces);
    expect(new Set(all).size).toBe(all.length);
    for (const n of nations) {
      expect(n.provinces[0]).toBe(n.capital);
      expect(n.provinces.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('economy', () => {
  it('buildings add yield and multipliers scale it', () => {
    const plain = provinceYield('plains', [], 1);
    const farm = provinceYield('plains', ['farm'], 1);
    expect(farm.food).toBeGreaterThan(plain.food);
    expect(provinceYield('plains', ['farm'], 0.5).food).toBeCloseTo(farm.food / 2);
  });

  it('protests cut production', () => {
    expect(stabilityMultiplier(CONFIG.stability.protestThreshold - 1)).toBeLessThan(stabilityMultiplier(CONFIG.stability.protestThreshold + 1) * 0.7);
    expect(stabilityMultiplier(100)).toBe(1);
  });

  it('stability regenerates toward baseline in peace and drains in war', () => {
    const calm = { atWar: false, sanctions: 0, starving: false, companiesCrashed: false };
    expect(stabilityStep(40, calm, 10)).toBeGreaterThan(40);
    expect(stabilityStep(CONFIG.stability.baseline, calm, 10)).toBe(CONFIG.stability.baseline);
    expect(stabilityStep(50, { ...calm, atWar: true }, 10)).toBeLessThan(50);
    expect(stabilityStep(1, { ...calm, starving: true }, 100)).toBe(0);
  });

  it('commodity fundamental rises when supply falls', () => {
    expect(commodityFundamental(100, 10, 10, 0.8)).toBeCloseTo(100);
    expect(commodityFundamental(100, 10, 5, 0.8)).toBeGreaterThan(100);
    expect(commodityFundamental(100, 10, 20, 0.8)).toBeLessThan(100);
    expect(commodityFundamental(100, 10, 0, 5)).toBeLessThanOrEqual(300);
  });

  it('company fundamental tracks nation health', () => {
    const h = { stability: 70, provinces: 4, startProvinces: 4, sectorOutput: 1, startSectorOutput: 1, wars: 0, eliminated: false, isDefence: false };
    const base = companyFundamental(50, h);
    expect(base).toBeCloseTo(50, 0);
    expect(companyFundamental(50, { ...h, provinces: 8 })).toBeGreaterThan(base);
    expect(companyFundamental(50, { ...h, stability: 10 })).toBeLessThan(base);
    expect(companyFundamental(50, { ...h, eliminated: true })).toBeLessThan(5);
    expect(companyFundamental(50, { ...h, wars: 1, isDefence: true })).toBeGreaterThan(base);
  });
});
