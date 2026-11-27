/**
 * World-event generator. Pure: (rng, context) → event spec. The Game applies the spec.
 *
 * Intensity ramps linearly over the session (config.events.intensityStart → End),
 * scaling both how often events fire and how hard they hit.
 *
 * Each event declares:
 *   impacts — one-off price drift spread over N ticks (the headline reaction)
 *   shifts  — a change to the asset's fundamental value (decays back over time), so the
 *             move doesn't simply mean-revert away on the next tick
 */
import { CONFIG, type NewsItem, type Sector } from '@warmarket/shared';
import type { Rng } from '../util/rng.js';

export interface EventImpact {
  assetId?: string;
  sector?: Sector;
  allCompanies?: boolean;
  pct: number;
  ticks: number;
}

export interface FundamentalShift {
  assetId?: string;
  sector?: Sector;
  /** Multiplier applied to the fundamental, e.g. 1.15 = +15%. */
  mult: number;
}

export interface EventSpec {
  kind: string;
  headline: string;
  source: 'Global Wire' | 'Market Desk';
  tone: NewsItem['tone'];
  breaking: boolean;
  impacts: EventImpact[];
  shifts: FundamentalShift[];
  /** Short teaser for rumours and insider tips, e.g. "a drought in the grain belt". */
  teaser: string;
  /** Main asset affected and its direction, for tips ("WHEAT should go UP"). */
  hint: { assetId: string; up: boolean } | null;
}

export interface EventContext {
  intensity: number;
  companies: { id: string; name: string; sector: Sector; ownerId: string | null }[];
}

export function intensityAt(elapsedFraction: number): number {
  const e = CONFIG.events;
  const f = Math.max(0, Math.min(1, elapsedFraction));
  return e.intensityStart + (e.intensityEnd - e.intensityStart) * f;
}

export function eventChanceAt(elapsedFraction: number): number {
  const e = CONFIG.events;
  const f = Math.max(0, Math.min(1, elapsedFraction));
  return e.chanceStart + (e.chanceEnd - e.chanceStart) * f;
}

const REGIONS = ['the grain belt', 'the southern plains', 'the river delta', 'the eastern coast', 'the highlands', 'the northern farms'];
const PORTS = ['Port Lira', 'Saltreach harbour', 'the Gullwing straits', 'Lanternport', 'Blackwater bay'];

type Gen = (rng: Rng, c: EventContext) => EventSpec | null;

const base = (p: Partial<EventSpec> & Pick<EventSpec, 'kind' | 'headline' | 'teaser'>): EventSpec => ({
  source: 'Global Wire',
  tone: 'neutral',
  breaking: false,
  impacts: [],
  shifts: [],
  hint: null,
  ...p,
});

const GENERATORS: Record<string, Gen> = {
  drought(rng, c) {
    const where = rng.pick(REGIONS);
    const k = c.intensity;
    return base({
      kind: 'drought',
      headline: `Severe drought scorches ${where}. Wheat futures soar.`,
      teaser: `a drought in ${where}`,
      tone: 'bad',
      breaking: true,
      impacts: [
        { assetId: 'WHEAT', pct: 0.12 * k, ticks: 2 },
        { sector: 'food', pct: -0.05 * k, ticks: 2 },
      ],
      shifts: [{ assetId: 'WHEAT', mult: 1 + 0.1 * k }],
      hint: { assetId: 'WHEAT', up: true },
    });
  },
  hurricane(rng, c) {
    const where = rng.pick(PORTS);
    const k = c.intensity;
    return base({
      kind: 'hurricane',
      headline: `Category ${rng.int(3, 5)} hurricane slams into ${where}. Refineries offline, oil spikes.`,
      teaser: `a hurricane heading for ${where}`,
      tone: 'bad',
      breaking: true,
      impacts: [
        { assetId: 'OIL', pct: 0.08 * k, ticks: 2 },
        { sector: 'energy', pct: 0.03 * k, ticks: 1 },
        { sector: 'food', pct: -0.04 * k, ticks: 1 },
      ],
      shifts: [{ assetId: 'OIL', mult: 1 + 0.06 * k }],
      hint: { assetId: 'OIL', up: true },
    });
  },
  pandemic(rng, c) {
    const k = c.intensity;
    const name = rng.pick(['Hiccup Flu', 'Variant Omega', 'Office Cough', 'Bat-Adjacent Fever', 'The Sniffles 2']);
    return base({
      kind: 'pandemic',
      headline: `WHO declares ${name} a pandemic. Everyone works from home: tech rallies, oil and stocks wobble.`,
      teaser: 'a fast-spreading virus',
      tone: 'bad',
      breaking: true,
      impacts: [
        { allCompanies: true, pct: -0.06 * k, ticks: 2 },
        { sector: 'tech', pct: 0.1 * k, ticks: 2 },
        { assetId: 'OIL', pct: -0.08 * k, ticks: 2 },
        { assetId: 'GOLD', pct: 0.05 * k, ticks: 1 },
      ],
      shifts: [{ sector: 'tech', mult: 1 + 0.06 * k }],
      hint: { assetId: 'GOLD', up: true },
    });
  },
  breakthrough(rng, c) {
    const k = c.intensity;
    const tech = c.companies.filter((x) => x.sector === 'tech');
    const winner = tech.length ? rng.pick(tech) : null;
    return base({
      kind: 'breakthrough',
      headline: `${winner ? winner.name : 'Researchers'} unveil a ${rng.pick(['room-temperature superconductor', 'battery that lasts a week', 'chip made of sand (more sand)', 'quantum toaster'])}. Tech stocks surge.`,
      teaser: 'a tech breakthrough',
      tone: 'good',
      breaking: true,
      impacts: [...(winner ? [{ assetId: winner.id, pct: 0.12 * k, ticks: 2 }] : []), { sector: 'tech', pct: 0.04 * k, ticks: 1 }, { assetId: 'LITHIUM', pct: 0.08 * k, ticks: 2 }],
      shifts: [...(winner ? [{ assetId: winner.id, mult: 1 + 0.1 * k }] : []), { assetId: 'LITHIUM', mult: 1 + 0.06 * k }],
      hint: { assetId: 'LITHIUM', up: true },
    });
  },
  discovery(rng, c) {
    const k = c.intensity;
    const oil = rng.chance(0.6);
    const asset = oil ? 'OIL' : 'LITHIUM';
    const where = rng.pick(REGIONS);
    return base({
      kind: 'discovery',
      headline: `Massive ${oil ? 'oil field' : 'lithium deposit'} discovered beneath ${where}. ${asset} slides on supply hopes.`,
      teaser: `a big ${oil ? 'oil' : 'lithium'} find`,
      tone: 'good',
      impacts: [{ assetId: asset, pct: -0.08 * k, ticks: 2 }, ...(oil ? [{ sector: 'energy' as Sector, pct: 0.04 * k, ticks: 2 }] : [])],
      shifts: [{ assetId: asset, mult: 1 - 0.08 * k }],
      hint: { assetId: asset, up: false },
    });
  },
  scandal(rng, c) {
    if (!c.companies.length) return null;
    const co = rng.pick(c.companies);
    const k = c.intensity;
    return base({
      kind: 'scandal',
      source: 'Market Desk',
      headline: `${co.name} ${rng.pick(['caught expensing a yacht', 'hit by a massive data leak', 'recalls its flagship product', 'loses a key lawsuit'])}. ${co.id} tanks.`,
      teaser: `trouble at ${co.name}`,
      tone: 'bad',
      breaking: true,
      impacts: [{ assetId: co.id, pct: -0.16 * k, ticks: 2 }],
      shifts: [{ assetId: co.id, mult: 1 - 0.08 * k }],
      hint: { assetId: co.id, up: false },
    });
  },
  earnings(rng, c) {
    if (!c.companies.length) return null;
    const co = rng.pick(c.companies);
    const up = rng.chance(0.55);
    const k = c.intensity;
    return base({
      kind: 'earnings',
      source: 'Market Desk',
      headline: up ? `${co.name} smashes earnings expectations. ${co.id} jumps.` : `${co.name} misses earnings badly, cuts guidance. ${co.id} sinks.`,
      teaser: `${co.name} earnings`,
      tone: up ? 'good' : 'bad',
      impacts: [{ assetId: co.id, pct: (up ? 0.12 : -0.12) * k, ticks: 1 }],
      shifts: [{ assetId: co.id, mult: 1 + (up ? 0.07 : -0.07) * k }],
      hint: { assetId: co.id, up },
    });
  },
  rates(rng, c) {
    const hike = rng.chance(0.5);
    const k = c.intensity;
    return base({
      kind: 'rates',
      source: 'Market Desk',
      headline: hike ? 'World Central Bank hikes rates by 75bp. Stocks slide, gold dips.' : 'World Central Bank slashes rates. Risk-on: stocks and WarDoge rally.',
      teaser: 'a central bank surprise',
      tone: hike ? 'bad' : 'good',
      breaking: true,
      impacts: [
        { allCompanies: true, pct: (hike ? -0.05 : 0.05) * k, ticks: 2 },
        { assetId: 'GOLD', pct: (hike ? -0.04 : 0.03) * k, ticks: 1 },
        { assetId: CONFIG.memecoin.id, pct: (hike ? -0.15 : 0.2) * k, ticks: 1 },
      ],
      hint: { assetId: 'GOLD', up: !hike },
    });
  },
  coldSnap(_rng, c) {
    const k = c.intensity;
    return base({
      kind: 'coldSnap',
      headline: 'Polar vortex grips the northern hemisphere. Heating oil demand explodes.',
      teaser: 'an unusually cold winter',
      impacts: [
        { assetId: 'OIL', pct: 0.1 * k, ticks: 2 },
        { sector: 'energy', pct: 0.06 * k, ticks: 2 },
      ],
      shifts: [{ assetId: 'OIL', mult: 1 + 0.06 * k }],
      hint: { assetId: 'OIL', up: true },
    });
  },
  tariffs(rng, c) {
    const k = c.intensity;
    return base({
      kind: 'tariffs',
      source: 'Market Desk',
      headline: `Global tariff spat escalates over ${rng.pick(['rubber ducks', 'semiconductors', 'cheese', 'bananas'])}. Lithium scarce, tech stocks slide.`,
      teaser: 'new tariffs',
      tone: 'bad',
      impacts: [
        { assetId: 'LITHIUM', pct: 0.08 * k, ticks: 2 },
        { sector: 'tech', pct: -0.07 * k, ticks: 2 },
      ],
      shifts: [{ assetId: 'LITHIUM', mult: 1 + 0.06 * k }],
      hint: { assetId: 'LITHIUM', up: true },
    });
  },
  defenceContract(rng, c) {
    const k = c.intensity;
    const d = c.companies.filter((x) => x.sector === 'defence');
    const co = d.length ? rng.pick(d) : null;
    return base({
      kind: 'defenceContract',
      source: 'Market Desk',
      headline: `${co ? co.name : 'A defence firm'} lands a record government contract. Gold and defence stocks firm up.`,
      teaser: 'a giant government contract',
      tone: 'good',
      impacts: [{ sector: 'defence', pct: 0.1 * k, ticks: 2 }, { assetId: 'GOLD', pct: 0.03 * k, ticks: 1 }],
      shifts: [{ sector: 'defence', mult: 1 + 0.06 * k }],
      hint: co ? { assetId: co.id, up: true } : { assetId: 'GOLD', up: true },
    });
  },
  dogeTweet(rng, c) {
    const up = rng.chance(0.6);
    const k = c.intensity;
    return base({
      kind: 'dogeTweet',
      source: 'Market Desk',
      headline: up ? 'Famous billionaire tweets a picture of a dog in a helmet. WarDoge goes vertical.' : 'Billionaire says WarDoge is "kinda mid". Holders in shambles.',
      teaser: 'a celebrity posting about WarDoge',
      tone: up ? 'good' : 'bad',
      impacts: [{ assetId: CONFIG.memecoin.id, pct: (up ? 0.45 : -0.4) * k, ticks: 1 }],
      hint: { assetId: CONFIG.memecoin.id, up },
    });
  },
};

const WEIGHTS: [string, number][] = [
  ['drought', 9],
  ['hurricane', 8],
  ['pandemic', 4],
  ['breakthrough', 8],
  ['discovery', 8],
  ['scandal', 10],
  ['earnings', 16],
  ['rates', 6],
  ['coldSnap', 6],
  ['tariffs', 6],
  ['defenceContract', 5],
  ['dogeTweet', 7],
];

export function rollEvent(rng: Rng, c: EventContext, kind?: string): EventSpec | null {
  if (kind && GENERATORS[kind]) return GENERATORS[kind](rng, c);
  for (let attempt = 0; attempt < 5; attempt++) {
    const total = WEIGHTS.reduce((s, [, w]) => s + w, 0);
    let r = rng.next() * total;
    let pick = WEIGHTS[0][0];
    for (const [k, w] of WEIGHTS) {
      r -= w;
      if (r <= 0) {
        pick = k;
        break;
      }
    }
    const spec = GENERATORS[pick](rng, c);
    if (spec) return spec;
  }
  return null;
}

export const EVENT_KINDS = Object.keys(GENERATORS);

/** Wording for Rumour Mill headlines. */
export function rumourHeadline(rng: Rng, teaser: string): string {
  return rng.pick([
    `Sources say ${teaser} is imminent`,
    `Whispers on the trading floor about ${teaser}`,
    `Unverified: insiders bracing for ${teaser}`,
    `Anonymous post claims ${teaser} within the hour`,
    `"Trust me bro": ${teaser} incoming`,
  ]);
}
