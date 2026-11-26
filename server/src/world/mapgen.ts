/**
 * Procedural world map. Pure: same seed + player count → same map.
 *
 * 1. Scatter points, relax them twice (Lloyd) so Voronoi cells are evenly sized.
 * 2. Score each cell by distance to a few random "continent" blobs; the top N are land.
 * 3. Land cells sharing a Voronoi edge are adjacent. Disconnected landmasses are joined
 *    with sea lanes between their closest coastal provinces, plus a couple of extras.
 * 4. Terrain, names and commodity specialties are assigned per province.
 */
import { Delaunay } from 'd3-delaunay';
import { CONFIG, type CommodityId, type MapStatic, type ProvinceStatic, type Terrain } from '@warmarket/shared';
import { Rng } from '../util/rng.js';

const PLACE_NAMES = [
  'Northmarch', 'Saltreach', 'Dunmoor', 'Kessel Flats', 'Varnholt', 'Greyhaven', 'Oxbridge Wastes', 'Port Lira',
  'Highcrag', 'Tamsin Vale', 'Brightwater', 'Ostrava Gap', 'Coldspire', 'Marrowfield', 'Emberlands', 'Silt Coast',
  'Redmouth', 'Hollowmere', 'Fenwick', 'Ashgrove', 'Talon Ridge', 'Quarry Bay', 'Lowmarsh', 'Sunscar',
  'Brackenhall', 'Irongate', 'Willowdeep', 'Cinder Plain', 'Gullwing Isles', 'Stonewake', 'Mirefall', 'Copperhead',
  'Dusthollow', 'Riverend', 'Frostmark', 'Glimmerdale', 'Thornwood', 'Saltmarsh', 'Ravenmoor', 'Goldfen',
  'Westerholm', 'Pikeford', 'Amberly', 'Crowcliff', 'Blackwater', 'Deepmine', 'Harrowgate', 'Lanternport',
];

const TERRAIN_WEIGHTS: [Terrain, number][] = [
  ['plains', 30],
  ['forest', 20],
  ['mountain', 15],
  ['desert', 16],
  ['urban', 8],
];

const SPECIALTY: Record<Terrain, CommodityId[]> = {
  plains: ['WHEAT', 'RICE', 'WHEAT'],
  forest: ['LUMBER', 'COFFEE'],
  mountain: ['GOLD', 'LITHIUM', 'LITHIUM'],
  desert: ['OIL', 'OIL', 'LITHIUM'],
  coast: ['RICE', 'OIL', 'COFFEE'],
  urban: ['ELEC', 'ELEC', 'GOLD'],
};

export function landCountFor(players: number): number {
  return Math.max(30, Math.min(40, 24 + players * 2));
}

function weighted<T>(rng: Rng, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

function polyCentroid(poly: [number, number][]): [number, number] {
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) return poly[0];
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

function pathOf(poly: [number, number][]): string {
  return 'M' + poly.slice(0, -1).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + 'Z';
}

export interface GeneratedMap extends MapStatic {
  /** Hop distances between every pair of provinces (BFS over land + sea lanes). */
  dist: number[][];
}

export function generateMap(seed: number, players: number): GeneratedMap {
  const rng = new Rng(seed);
  const W = CONFIG.world.mapWidth;
  const H = CONFIG.world.mapHeight;
  const landN = landCountFor(players);
  const totalN = Math.round(landN * 1.85);
  const margin = 18;

  // 1) points + Lloyd relaxation
  let pts: [number, number][] = [];
  for (let i = 0; i < totalN; i++) pts.push([rng.range(margin, W - margin), rng.range(margin, H - margin)]);
  for (let iter = 0; iter < 2; iter++) {
    const v = Delaunay.from(pts).voronoi([0, 0, W, H]);
    pts = pts.map((p, i) => {
      const poly = v.cellPolygon(i) as [number, number][] | null;
      return poly ? polyCentroid(poly) : p;
    });
  }
  const delaunay = Delaunay.from(pts);
  const vor = delaunay.voronoi([0, 0, W, H]);

  // 2) land mask: continent blobs
  const blobs = Array.from({ length: 4 }, () => ({
    x: rng.range(W * 0.18, W * 0.82),
    y: rng.range(H * 0.2, H * 0.8),
    r: rng.range(W * 0.16, W * 0.26),
  }));
  const score = pts.map(([x, y], i) => {
    let s = -Infinity;
    for (const b of blobs) s = Math.max(s, 1 - Math.hypot(x - b.x, (y - b.y) * 1.3) / b.r);
    const edge = Math.min(x, W - x, y, H - y) / 60;
    return s + rng.range(-0.15, 0.15) - (edge < 1 ? 1 - edge : 0) + i * 1e-9;
  });
  const order = pts.map((_, i) => i).sort((a, b) => score[b] - score[a]);
  const landSet = new Set(order.slice(0, landN));

  // Map cell index → province id (0..landN-1), ordered left→right for stable-ish naming.
  const landCells = [...landSet].sort((a, b) => pts[a][0] - pts[b][0]);
  const pid = new Map<number, number>();
  landCells.forEach((c, i) => pid.set(c, i));

  const names = rng.shuffle([...PLACE_NAMES]);
  const provinces: ProvinceStatic[] = landCells.map((cell, i) => {
    const poly = vor.cellPolygon(cell) as [number, number][];
    const nbCells = [...vor.neighbors(cell)];
    const neighbors = nbCells.filter((n) => landSet.has(n)).map((n) => pid.get(n)!);
    const touchesEdge = poly.some(([x, y]) => x <= 0.5 || y <= 0.5 || x >= W - 0.5 || y >= H - 0.5);
    const coastal = touchesEdge || nbCells.some((n) => !landSet.has(n));
    let terrain = weighted(rng, TERRAIN_WEIGHTS);
    if (coastal && rng.chance(0.4)) terrain = 'coast';
    return {
      id: i,
      name: names[i % names.length],
      path: pathOf(poly),
      cx: Math.round(pts[cell][0]),
      cy: Math.round(pts[cell][1]),
      terrain,
      neighbors: [...new Set(neighbors)].sort((a, b) => a - b),
      specialty: rng.pick(SPECIALTY[terrain]),
      coastal,
    };
  });

  // Make sure every commodity is produced somewhere.
  const allSpecs: CommodityId[] = ['OIL', 'GOLD', 'WHEAT', 'COFFEE', 'LITHIUM', 'LUMBER', 'RICE', 'ELEC'];
  for (const c of allSpecs) {
    if (!provinces.some((p) => p.specialty === c)) {
      const counts = new Map<CommodityId, number>();
      for (const p of provinces) counts.set(p.specialty, (counts.get(p.specialty) ?? 0) + 1);
      const donor = provinces.filter((p) => (counts.get(p.specialty) ?? 0) > 2);
      if (donor.length) rng.pick(donor).specialty = c;
    }
  }

  // 3) connect landmasses with sea lanes
  const seaLanes: [number, number][] = [];
  const link = (a: number, b: number) => {
    if (a === b || provinces[a].neighbors.includes(b)) return;
    provinces[a].neighbors.push(b);
    provinces[b].neighbors.push(a);
    seaLanes.push([Math.min(a, b), Math.max(a, b)]);
  };
  const d2 = (a: number, b: number) => (provinces[a].cx - provinces[b].cx) ** 2 + (provinces[a].cy - provinces[b].cy) ** 2;
  for (;;) {
    const comps = components(provinces);
    if (comps.length <= 1) break;
    // join the smallest component to its closest other component
    comps.sort((a, b) => a.length - b.length);
    const small = comps[0];
    const others = comps.slice(1).flat();
    let best: [number, number] = [small[0], others[0]];
    let bd = Infinity;
    for (const a of small) for (const b of others) {
      const d = d2(a, b);
      if (d < bd) {
        bd = d;
        best = [a, b];
      }
    }
    link(best[0], best[1]);
  }
  // a couple of extra lanes between coastal provinces that are close but not adjacent
  const coastal = provinces.filter((p) => p.coastal).map((p) => p.id);
  for (let k = 0; k < 3; k++) {
    const a = rng.pick(coastal);
    const cands = coastal.filter((b) => b !== a && !provinces[a].neighbors.includes(b) && d2(a, b) < (W * 0.22) ** 2);
    if (cands.length) link(a, rng.pick(cands));
  }
  for (const p of provinces) p.neighbors.sort((a, b) => a - b);

  const oceanPaths: string[] = [];
  for (let c = 0; c < pts.length; c++) {
    if (landSet.has(c)) continue;
    const poly = vor.cellPolygon(c) as [number, number][] | null;
    if (poly) oceanPaths.push(pathOf(poly));
  }

  return { width: W, height: H, provinces, seaLanes, oceanPaths, dist: allPairsHops(provinces) };
}

export function components(provinces: ProvinceStatic[]): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const p of provinces) {
    if (seen.has(p.id)) continue;
    const comp: number[] = [];
    const q = [p.id];
    seen.add(p.id);
    while (q.length) {
      const x = q.shift()!;
      comp.push(x);
      for (const n of provinces[x].neighbors) if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
    out.push(comp);
  }
  return out;
}

export function allPairsHops(provinces: ProvinceStatic[]): number[][] {
  return provinces.map((p) => {
    const d = new Array(provinces.length).fill(Infinity);
    d[p.id] = 0;
    const q = [p.id];
    while (q.length) {
      const x = q.shift()!;
      for (const n of provinces[x].neighbors) if (d[n] === Infinity) {
        d[n] = d[x] + 1;
        q.push(n);
      }
    }
    return d;
  });
}

/**
 * Choose capitals far apart (farthest-point sampling over hop distance), then grow each
 * nation round-robin by BFS into unclaimed neighbouring land.
 */
export function placeNations(map: GeneratedMap, count: number, perNation: number, seed: number): { capital: number; provinces: number[] }[] {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const n = map.provinces.length;
  const caps: number[] = [rng.int(0, n - 1)];
  while (caps.length < count) {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < n; i++) {
      if (caps.includes(i)) continue;
      const d = Math.min(...caps.map((c) => map.dist[c][i])) + rng.next() * 0.5;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    caps.push(best);
  }
  const owner = new Array<number>(n).fill(-1);
  const owned = caps.map((c, i) => {
    owner[c] = i;
    return [c];
  });
  for (let round = 1; round < perNation; round++) {
    for (let i = 0; i < count; i++) {
      // closest unclaimed province to this nation's capital that borders its territory
      let pick = -1;
      let pd = Infinity;
      for (const p of owned[i]) for (const nb of map.provinces[p].neighbors) {
        if (owner[nb] !== -1) continue;
        const d = map.dist[caps[i]][nb] + rng.next() * 0.3;
        if (d < pd) {
          pd = d;
          pick = nb;
        }
      }
      if (pick >= 0) {
        owner[pick] = i;
        owned[i].push(pick);
      }
    }
  }
  return caps.map((c, i) => ({ capital: c, provinces: owned[i] }));
}
