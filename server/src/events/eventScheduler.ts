/**
 * World-event generator. Pure: (rng, context) → event spec. The Game applies the spec.
 *
 * Intensity ramps linearly over the session (config.events.intensityStart → End),
 * scaling both how often events fire and how hard they hit.
 */
import { CONFIG, type NewsItem, type ResourceKind, type Sector } from '@warmarket/shared';
import type { Rng } from '../util/rng.js';

export interface EventImpact {
  assetId?: string;
  sector?: Sector;
  nationId?: string;
  allCompanies?: boolean;
  pct: number;
  ticks: number;
}

export interface EventSpec {
  kind: string;
  headline: string;
  source: 'Global Wire' | 'Market Desk';
  tone: NewsItem['tone'];
  breaking: boolean;
  impacts: EventImpact[];
  provinceEffects: { provinceId: number; label: string; prodMult: number; ms: number }[];
  stability: { nationId: string | 'all'; delta: number }[];
  resources: { nationId: string; res: ResourceKind; amount: number }[];
  /** Short teaser for rumours and insider tips, e.g. "a drought near Saltreach". */
  teaser: string;
  /** Main asset affected and its direction, for tips ("buy WHEAT"). */
  hint: { assetId: string; up: boolean } | null;
}

export interface EventContext {
  intensity: number;
  provinces: { id: number; name: string; coastal: boolean; ownerId: string | null; neighbors: number[] }[];
  nations: { id: string; name: string; companies: { id: string; name: string; sector: Sector }[] }[];
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

type Gen = (rng: Rng, c: EventContext) => EventSpec | null;

const base = (p: Partial<EventSpec> & Pick<EventSpec, 'kind' | 'headline' | 'teaser'>): EventSpec => ({
  source: 'Global Wire',
  tone: 'neutral',
  breaking: false,
  impacts: [],
  provinceEffects: [],
  stability: [],
  resources: [],
  hint: null,
  ...p,
});

function cluster(rng: Rng, c: EventContext, filter?: (p: EventContext['provinces'][number]) => boolean) {
  const pool = filter ? c.provinces.filter(filter) : c.provinces;
  if (!pool.length) return null;
  const center = rng.pick(pool);
  const ids = [center.id, ...center.neighbors.filter(() => rng.chance(0.6))].slice(0, 4);
  return { center, ids };
}

const GENERATORS: Record<string, Gen> = {
  drought(rng, c) {
    const cl = cluster(rng, c);
    if (!cl) return null;
    const k = c.intensity;
    return base({
      kind: 'drought',
      headline: `Severe drought scorches the region around ${cl.center.name}. Grain futures soar.`,
      teaser: `a drought around ${cl.center.name}`,
      tone: 'bad',
      breaking: true,
      impacts: [
        { assetId: 'WHEAT', pct: 0.1 * k, ticks: 2 },
        { assetId: 'RICE', pct: 0.07 * k, ticks: 2 },
        { sector: 'food', pct: -0.04 * k, ticks: 2 },
      ],
      provinceEffects: cl.ids.map((id) => ({ provinceId: id, label: 'Drought', prodMult: 0.4, ms: 90_000 })),
      hint: { assetId: 'WHEAT', up: true },
    });
  },
  hurricane(rng, c) {
    const cl = cluster(rng, c, (p) => p.coastal);
    if (!cl) return null;
    const k = c.intensity;
    return base({
      kind: 'hurricane',
      headline: `Category ${rng.int(3, 5)} hurricane slams into ${cl.center.name}. Ports shut, refineries offline.`,
      teaser: `a hurricane heading for ${cl.center.name}`,
      tone: 'bad',
      breaking: true,
      impacts: [
        { sector: 'shipping', pct: -0.1 * k, ticks: 2 },
        { assetId: 'OIL', pct: 0.06 * k, ticks: 2 },
        { assetId: 'LUMBER', pct: 0.05 * k, ticks: 1 },
      ],
      provinceEffects: cl.ids.map((id) => ({ provinceId: id, label: 'Hurricane damage', prodMult: 0.3, ms: 60_000 })),
      hint: { assetId: 'OIL', up: true },
    });
  },
  pandemic(rng, c) {
    const k = c.intensity;
    const name = rng.pick(['Hiccup Flu', 'Variant Ω', 'Office Cough', 'Bat-Adjacent Fever', 'The Sniffles 2']);
    return base({
      kind: 'pandemic',
      headline: `WHO declares ${name} a pandemic. Lockdowns spread; pharma rallies, everything else wobbles.`,
      teaser: 'a fast-spreading virus',
      tone: 'bad',
      breaking: true,
      impacts: [
        { sector: 'pharma', pct: 0.16 * k, ticks: 2 },
        { allCompanies: true, pct: -0.05 * k, ticks: 2 },
        { assetId: 'OIL', pct: -0.07 * k, ticks: 2 },
        { assetId: 'GOLD', pct: 0.04 * k, ticks: 1 },
      ],
      stability: [{ nationId: 'all', delta: -6 * k }],
      hint: { assetId: c.nations.flatMap((n) => n.companies).find((x) => x.sector === 'pharma')?.id ?? 'GOLD', up: true },
    });
  },
  breakthrough(rng, c) {
    if (!c.nations.length) return null;
    const n = rng.pick(c.nations);
    const k = c.intensity;
    return base({
      kind: 'breakthrough',
      headline: `${n.name} scientists announce a ${rng.pick(['room-temperature superconductor', 'battery that lasts a week', 'chip made of sand (more sand)', 'quantum toaster'])}. Tech stocks surge.`,
      teaser: `a tech breakthrough in ${n.name}`,
      tone: 'good',
      breaking: true,
      impacts: [
        { nationId: n.id, sector: 'tech', pct: 0.15 * k, ticks: 2 },
        { sector: 'tech', pct: 0.04 * k, ticks: 1 },
        { assetId: 'LITHIUM', pct: 0.08 * k, ticks: 2 },
      ],
      resources: [{ nationId: n.id, res: 'tech', amount: Math.round(40 * k) }],
      hint: { assetId: 'LITHIUM', up: true },
    });
  },
  discovery(rng, c) {
    const pool = c.provinces.filter((p) => p.ownerId);
    if (!pool.length) return null;
    const p = rng.pick(pool);
    const owner = c.nations.find((n) => n.id === p.ownerId);
    const k = c.intensity;
    const oil = rng.chance(0.6);
    const asset = oil ? 'OIL' : 'LITHIUM';
    return base({
      kind: 'discovery',
      headline: `Massive ${oil ? 'oil field' : 'lithium deposit'} discovered beneath ${p.name}${owner ? ` (${owner.name})` : ''}. ${asset} slides on supply hopes.`,
      teaser: `a big ${oil ? 'oil' : 'lithium'} find near ${p.name}`,
      tone: 'good',
      impacts: [{ assetId: asset, pct: -0.08 * k, ticks: 2 }, ...(owner ? [{ nationId: owner.id, pct: 0.07 * k, ticks: 2 }] : [])],
      provinceEffects: [{ provinceId: p.id, label: oil ? 'Oil boom' : 'Lithium boom', prodMult: 1.8, ms: 180_000 }],
      resources: owner ? [{ nationId: owner.id, res: oil ? 'oil' : 'metals', amount: Math.round(50 * k) }] : [],
      hint: { assetId: asset, up: false },
    });
  },
  scandal(rng, c) {
    const cos = c.nations.flatMap((n) => n.companies);
    if (!cos.length) return null;
    const co = rng.pick(cos);
    const k = c.intensity;
    return base({
      kind: 'scandal',
      source: 'Market Desk',
      headline: `${co.name} CEO ${rng.pick(['caught expensing a yacht', 'flees the country with the pension fund', 'admits the product never existed', 'tweets something unhinged at 3am'])}. ${co.id} tanks.`,
      teaser: `trouble at ${co.name}`,
      tone: 'bad',
      breaking: true,
      impacts: [{ assetId: co.id, pct: -0.2 * k, ticks: 2 }],
      hint: { assetId: co.id, up: false },
    });
  },
  earnings(rng, c) {
    const cos = c.nations.flatMap((n) => n.companies);
    if (!cos.length) return null;
    const co = rng.pick(cos);
    const up = rng.chance(0.55);
    const k = c.intensity;
    return base({
      kind: 'earnings',
      source: 'Market Desk',
      headline: up ? `${co.name} smashes earnings expectations. ${co.id} jumps.` : `${co.name} misses earnings badly, cuts guidance. ${co.id} sinks.`,
      teaser: `${co.name} earnings`,
      tone: up ? 'good' : 'bad',
      impacts: [{ assetId: co.id, pct: (up ? 0.13 : -0.13) * k, ticks: 1 }],
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
      tone: 'neutral',
      impacts: [
        { assetId: 'OIL', pct: 0.1 * k, ticks: 2 },
        { sector: 'energy', pct: 0.06 * k, ticks: 2 },
        { assetId: 'COFFEE', pct: 0.05 * k, ticks: 1 },
      ],
      hint: { assetId: 'OIL', up: true },
    });
  },
  blight(_rng, c) {
    const k = c.intensity;
    return base({
      kind: 'blight',
      headline: 'Coffee leaf rust wipes out half the bean harvest. Baristas weep.',
      teaser: 'a crop disease in coffee plantations',
      tone: 'bad',
      impacts: [{ assetId: 'COFFEE', pct: 0.2 * k, ticks: 2 }],
      hint: { assetId: 'COFFEE', up: true },
    });
  },
  tariffs(rng, c) {
    const k = c.intensity;
    return base({
      kind: 'tariffs',
      source: 'Market Desk',
      headline: `Global tariff spat escalates over ${rng.pick(['rubber ducks', 'semiconductors', 'cheese', 'bananas'])}. Shipping slumps, electronics pricier.`,
      teaser: 'new tariffs',
      tone: 'bad',
      impacts: [
        { sector: 'shipping', pct: -0.08 * k, ticks: 2 },
        { assetId: 'ELEC', pct: 0.07 * k, ticks: 2 },
      ],
      hint: { assetId: 'ELEC', up: true },
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
  ['drought', 10],
  ['hurricane', 8],
  ['pandemic', 4],
  ['breakthrough', 8],
  ['discovery', 8],
  ['scandal', 10],
  ['earnings', 14],
  ['rates', 6],
  ['coldSnap', 6],
  ['blight', 5],
  ['tariffs', 6],
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
