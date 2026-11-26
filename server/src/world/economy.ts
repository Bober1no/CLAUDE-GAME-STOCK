/**
 * Pure economic rules: production, upkeep, stability drift, fundamentals.
 * No state lives here — the World passes everything in.
 */
import { CONFIG, type BuildingKind, type ResourceKind, type Resources, type Terrain } from '@warmarket/shared';

export const RESOURCES: ResourceKind[] = ['oil', 'food', 'metals', 'tech'];

export function zeroResources(): Resources {
  return { oil: 0, food: 0, metals: 0, tech: 0 };
}

/** Per-second yield of one province. `mult` folds in stability/protests/events/disruption. */
export function provinceYield(terrain: Terrain, buildings: BuildingKind[], mult: number): Resources {
  const base = CONFIG.world.terrainYield[terrain];
  const out = zeroResources();
  for (const r of RESOURCES) out[r] = base[r];
  for (const b of buildings) {
    const y = CONFIG.buildings[b].yield;
    for (const r of RESOURCES) out[r] += y[r] ?? 0;
  }
  for (const r of RESOURCES) out[r] *= Math.max(0, mult);
  return out;
}

export function provinceTax(buildings: BuildingKind[], isCapital: boolean, mult: number): number {
  let t = CONFIG.world.taxPerProvince + (isCapital ? CONFIG.world.capitalTaxBonus : 0);
  for (const b of buildings) t += CONFIG.buildings[b].tax ?? 0;
  return t * Math.max(0, mult);
}

/** Production multiplier from stability: 100% at ≥ baseline, sliding down, ×0.6 extra while protesting. */
export function stabilityMultiplier(stability: number): number {
  const s = CONFIG.stability;
  const linear = 0.55 + 0.45 * Math.min(1, stability / s.baseline);
  return stability < s.protestThreshold ? linear * s.protestProductionMult : linear;
}

export interface StabilityFactors {
  atWar: boolean;
  sanctions: number;
  starving: boolean;
  companiesCrashed: boolean;
}

/**
 * Stability drifts toward the baseline when nothing bad is happening; each bad factor
 * applies a constant per-second drain. Regen only applies when below baseline and nothing
 * is draining, so a nation at war can't sit comfortably.
 */
export function stabilityStep(current: number, f: StabilityFactors, dt: number): number {
  const s = CONFIG.stability;
  let drain = 0;
  if (f.atWar) drain += s.warPerSec;
  drain += f.sanctions * s.sanctionPerSec;
  if (f.starving) drain += s.starvationPerSec;
  if (f.companiesCrashed) drain += s.crashPerSec;
  let next = current - drain * dt;
  if (drain === 0) {
    if (next < s.baseline) next = Math.min(s.baseline, next + s.regenPerSec * dt);
    else if (next > s.baseline) next = Math.max(s.baseline, next - s.regenPerSec * 0.5 * dt);
  }
  return Math.max(0, Math.min(s.max, next));
}

/**
 * Commodity fundamental from world supply: if live production of provinces specialising in
 * this commodity drops to half the starting level, price target rises by 2^elasticity.
 *   F = base × (supplyStart / supplyNow)^elasticity, clamped to [0.4, 3] × base.
 */
export function commodityFundamental(base: number, supplyStart: number, supplyNow: number, elasticity: number): number {
  if (supplyStart <= 0) return base;
  const ratio = Math.max(0.05, supplyNow) / supplyStart;
  const f = Math.pow(1 / ratio, elasticity);
  return base * Math.max(0.4, Math.min(3, f));
}

export interface CompanyHealth {
  stability: number;
  provinces: number;
  startProvinces: number;
  sectorOutput: number;
  startSectorOutput: number;
  wars: number;
  eliminated: boolean;
  isDefence: boolean;
}

/**
 * Company fundamental = listing price × (stability term) × (territory term) × (sector output term)
 * Each term is a ratio vs. the nation's starting state raised to a weight, so a nation that
 * doubles its land sees its companies rise ~2^0.5 = 1.41×. Defence companies like wars.
 */
export function companyFundamental(listing: number, h: CompanyHealth): number {
  if (h.eliminated) return listing * 0.05;
  const c = CONFIG.companies;
  const stab = Math.pow(Math.max(0.05, (0.3 + 0.7 * (h.stability / CONFIG.stability.baseline))), c.stabilityWeight);
  const terr = Math.pow(Math.max(0.05, h.provinces / Math.max(1, h.startProvinces)), c.territoryWeight);
  const prod = Math.pow(Math.max(0.05, (h.sectorOutput + 0.01) / (h.startSectorOutput + 0.01)), c.productionWeight);
  const war = h.isDefence ? 1 + 0.18 * Math.min(3, h.wars) : 1 - 0.05 * Math.min(3, h.wars);
  return listing * Math.max(0.05, Math.min(5, stab * terr * prod * war));
}

/** Value of a nation's non-market assets, for net worth. */
export function nationAssetValue(provinces: { capital: boolean; buildings: BuildingKind[] }[], resources: Resources): number {
  const w = CONFIG.world;
  let v = 0;
  for (const p of provinces) {
    v += p.capital ? w.capitalValue : w.provinceValue;
    for (const b of p.buildings) v += CONFIG.buildings[b].cost * w.buildingValueFactor;
  }
  for (const r of RESOURCES) v += Math.max(0, resources[r]) * w.resourceValue[r];
  return v;
}
