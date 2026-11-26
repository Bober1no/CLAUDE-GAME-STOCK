/** Parody company generator: 2–4 sector-tagged companies per nation. */
import { CONFIG, type ResourceKind, type Sector, type Terrain } from '@warmarket/shared';
import { Rng } from '../util/rng.js';

const TEMPLATES: Record<Sector, string[]> = {
  energy: ['{N} Petroleum', '{N} Gas & Hot Air', 'Royal {N} Oil', '{N} Drill Baby Drill'],
  defence: ['{N} Dynamics', 'Boom Industries {N}', '{N} Arms & Legs', '{N} Ordnance Co.'],
  tech: ['{N}Soft', 'i{N}', '{N} Quantum Vapourware', '{N} Cloud Solutions'],
  shipping: ['{N} Freight Lines', '{N} Maritime', 'Slowboat {N}', '{N} Container Corp'],
  food: ['{N} Grain Cartel', 'Big {N} Foods', '{N} Mega Farms', '{N} Snack Empire'],
  pharma: ['{N} Pharma', '{N} Pills Inc.', 'Placebo {N}', '{N} BioSomething'],
};

/** Which sectors a nation's terrain favours. */
const TERRAIN_SECTOR: Record<Terrain, Sector[]> = {
  plains: ['food'],
  forest: ['shipping', 'food'],
  mountain: ['defence'],
  desert: ['energy'],
  coast: ['shipping'],
  urban: ['tech', 'pharma'],
};

/** Which nation resource drives a sector's output. */
export const SECTOR_RESOURCE: Record<Sector, ResourceKind> = {
  energy: 'oil',
  defence: 'metals',
  tech: 'tech',
  shipping: 'oil',
  food: 'food',
  pharma: 'tech',
};

export interface CompanyDef {
  id: string;
  name: string;
  sector: Sector;
  basePrice: number;
}

export function makeCompanies(rng: Rng, nationName: string, terrains: Terrain[], usedTickers: Set<string>): CompanyDef[] {
  const word = nationName.split(' ').pop()!.replace(/[^A-Za-z]/g, '');
  const weights = new Map<Sector, number>();
  for (const s of Object.keys(TEMPLATES) as Sector[]) weights.set(s, 1);
  for (const t of terrains) for (const s of TERRAIN_SECTOR[t]) weights.set(s, (weights.get(s) ?? 1) + 1.5);
  const count = Math.max(2, Math.min(4, CONFIG.companies.perNation));
  const chosen: Sector[] = [];
  while (chosen.length < count) {
    const pool = [...weights].filter(([s]) => !chosen.includes(s));
    const total = pool.reduce((a, [, w]) => a + w, 0);
    let r = rng.next() * total;
    for (const [s, w] of pool) {
      r -= w;
      if (r <= 0) {
        chosen.push(s);
        break;
      }
    }
  }
  return chosen.map((sector) => {
    const name = rng.pick(TEMPLATES[sector]).replace('{N}', word);
    let ticker = (word.slice(0, 3) + sector[0]).toUpperCase();
    let k = 1;
    while (usedTickers.has(ticker)) ticker = (word.slice(0, 2) + sector[0] + String.fromCharCode(64 + k++)).toUpperCase();
    usedTickers.add(ticker);
    const basePrice = Math.round(rng.range(CONFIG.companies.basePriceMin, CONFIG.companies.basePriceMax) * 100) / 100;
    return { id: ticker, name, sector, basePrice };
  });
}
