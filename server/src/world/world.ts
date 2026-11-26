/**
 * World state: provinces, nations, production, buildings, stability, coups.
 * The Game calls tick() from the 100ms world loop; this module returns events
 * (protests, coups, starvation) for the Game to turn into news and market shocks.
 */
import {
  CONFIG,
  NATION_NAMES,
  type BuildingKind,
  type CommodityId,
  type NationStatic,
  type ResourceKind,
  type Resources,
  type Role,
  type Sector,
} from '@warmarket/shared';
import { Rng } from '../util/rng.js';
import { generateMap, placeNations, type GeneratedMap } from './mapgen.js';
import { RESOURCES, provinceTax, provinceYield, stabilityMultiplier, stabilityStep, zeroResources } from './economy.js';
import { SECTOR_RESOURCE, makeCompanies, type CompanyDef } from './companies.js';

export interface ProvinceState {
  id: number;
  /** Nation id or null for neutral land. */
  ownerId: string | null;
  garrison: number;
  buildings: BuildingKind[];
  construction: { kind: BuildingKind; doneAt: number } | null;
  /** World-event effect (drought, hurricane...). */
  effect: { label: string; prodMult: number; until: number } | null;
  /** Recently fought over: production heavily reduced until this time. */
  disruptedUntil: number;
}

export interface Nation {
  id: string;
  playerId: string;
  name: string;
  color: string;
  capital: number;
  resources: Resources;
  stability: number;
  reputation: number;
  eliminated: boolean;
  companies: CompanyDef[];
  startProvinces: number;
  startSectorOutput: Record<Sector, number>;
  protesting: boolean;
  starving: boolean;
  /** Last computed net per-second rates (for the UI). */
  rates: Resources & { cash: number };
  role: Role;
  coups: number;
  /** For the recap. */
  peakNetWorth: number;
}

export interface WorldHooks {
  atWar(nationId: string): boolean;
  sanctions(nationId: string): number;
  /** Total army strength (for food upkeep). */
  armyStrength(nationId: string): number;
  companiesCrashed(nationId: string): boolean;
  credit(playerId: string, amount: number): void;
  /** Net per-second flows from deals (cash + resources), signed. */
  dealFlows(nationId: string): Partial<Resources & { cash: number }>;
}

export type WorldEvent =
  | { type: 'protestStart'; nationId: string }
  | { type: 'protestEnd'; nationId: string }
  | { type: 'starving'; nationId: string }
  | { type: 'coup'; nationId: string; lost: number[] }
  | { type: 'built'; nationId: string; provinceId: number; kind: BuildingKind };

export class World {
  readonly map: GeneratedMap;
  readonly provinces: ProvinceState[];
  readonly nations: Nation[] = [];
  private byPlayer = new Map<string, Nation>();
  private byId = new Map<string, Nation>();
  /** Baseline output per commodity specialty, for commodity fundamentals. */
  readonly supplyStart: Record<CommodityId, number>;

  constructor(
    private rng: Rng,
    players: { id: string; name: string; color: string }[],
    seed: number,
    roles: Map<string, Role>,
  ) {
    this.map = generateMap(seed, players.length);
    const per = players.length <= 4 ? CONFIG.start.provincesPerNation : CONFIG.start.provincesPerNation - 1;
    const placement = placeNations(this.map, players.length, per, seed);
    this.provinces = this.map.provinces.map((p) => ({
      id: p.id,
      ownerId: null,
      garrison: Math.round(CONFIG.military.neutralGarrison * rng.range(0.6, 1.4)),
      buildings: [],
      construction: null,
      effect: null,
      disruptedUntil: 0,
    }));
    const names = rng.shuffle([...NATION_NAMES]);
    const tickers = new Set<string>(CONFIG.commodities.map((c) => c.id as string).concat(CONFIG.memecoin.id));
    players.forEach((pl, i) => {
      const place = placement[i];
      const id = `n${i}`;
      for (const pid of place.provinces) {
        this.provinces[pid].ownerId = id;
        this.provinces[pid].garrison = CONFIG.military.ownedGarrison;
      }
      const terrains = place.provinces.map((pid) => this.map.provinces[pid].terrain);
      const nation: Nation = {
        id,
        playerId: pl.id,
        name: names[i % names.length],
        color: pl.color,
        capital: place.capital,
        resources: { ...CONFIG.start.resources },
        stability: CONFIG.start.stability,
        reputation: CONFIG.diplomacy.startingReputation,
        eliminated: false,
        companies: [],
        startProvinces: place.provinces.length,
        startSectorOutput: {} as Record<Sector, number>,
        protesting: false,
        starving: false,
        rates: { ...zeroResources(), cash: 0 },
        role: roles.get(pl.id) ?? 'none',
        coups: 0,
        peakNetWorth: 0,
      };
      nation.companies = makeCompanies(rng, nation.name, terrains, tickers);
      this.nations.push(nation);
      this.byPlayer.set(pl.id, nation);
      this.byId.set(id, nation);
    });
    // Capitals start with a building matching their terrain, to give each nation an identity.
    for (const n of this.nations) {
      const t = this.map.provinces[n.capital].terrain;
      const b: BuildingKind = t === 'desert' ? 'well' : t === 'mountain' ? 'mine' : t === 'urban' ? 'lab' : t === 'coast' ? 'port' : 'farm';
      this.provinces[n.capital].buildings.push(b);
    }
    for (const n of this.nations) {
      const out = this.nationOutput(n.id, 0);
      for (const s of Object.keys(SECTOR_RESOURCE) as Sector[]) n.startSectorOutput[s] = out[SECTOR_RESOURCE[s]];
    }
    this.supplyStart = this.commoditySupply(0);
  }

  // ------------------------------------------------------------------- lookups

  nation(id: string | null | undefined): Nation | undefined {
    return id ? this.byId.get(id) : undefined;
  }
  nationOf(playerId: string): Nation | undefined {
    return this.byPlayer.get(playerId);
  }
  ownedBy(nationId: string): ProvinceState[] {
    return this.provinces.filter((p) => p.ownerId === nationId);
  }
  isNeighbor(a: number, b: number): boolean {
    return this.map.provinces[a]?.neighbors.includes(b) ?? false;
  }

  staticNations(): NationStatic[] {
    return this.nations.map((n) => ({ id: n.id, playerId: n.playerId, name: n.name, color: n.color, capital: n.capital }));
  }

  // ------------------------------------------------------------------- production

  provinceMult(p: ProvinceState, now: number): number {
    const owner = this.nation(p.ownerId);
    let m = owner ? stabilityMultiplier(owner.stability) : 1;
    if (p.effect && p.effect.until > now) m *= p.effect.prodMult;
    if (p.disruptedUntil > now) m *= 0.3;
    return m;
  }

  /** Gross per-second resource output of a nation (before upkeep). */
  nationOutput(nationId: string, now: number): Resources {
    const out = zeroResources();
    for (const p of this.provinces) {
      if (p.ownerId !== nationId) continue;
      const y = provinceYield(this.map.provinces[p.id].terrain, p.buildings, this.provinceMult(p, now));
      for (const r of RESOURCES) out[r] += y[r];
    }
    return out;
  }

  /** Live output of provinces specialising in each commodity (owned or neutral). */
  commoditySupply(now: number): Record<CommodityId, number> {
    const s = {} as Record<CommodityId, number>;
    for (const c of CONFIG.commodities) s[c.id] = 0;
    for (const p of this.provinces) {
      const sp = this.map.provinces[p.id];
      s[sp.specialty] += this.provinceMult(p, now) * (1 + p.buildings.length * 0.25);
    }
    return s;
  }

  sectorOutput(nationId: string, sector: Sector, now: number): number {
    return this.nationOutput(nationId, now)[SECTOR_RESOURCE[sector]];
  }

  // ------------------------------------------------------------------- tick

  tick(dt: number, now: number, hooks: WorldHooks): WorldEvent[] {
    const events: WorldEvent[] = [];
    // finish constructions
    for (const p of this.provinces) {
      if (p.construction && p.construction.doneAt <= now) {
        const kind = p.construction.kind;
        p.construction = null;
        if (p.ownerId) {
          p.buildings.push(kind);
          events.push({ type: 'built', nationId: p.ownerId, provinceId: p.id, kind });
        }
      }
      if (p.effect && p.effect.until <= now) p.effect = null;
    }

    for (const n of this.nations) {
      if (n.eliminated) continue;
      const owned = this.ownedBy(n.id);
      if (owned.length === 0) continue;
      const out = this.nationOutput(n.id, now);
      let cash = 0;
      for (const p of owned) cash += provinceTax(p.buildings, p.id === n.capital, this.provinceMult(p, now));
      // Upkeep: population eats food, armies eat food.
      const foodUse = owned.length * CONFIG.world.foodUpkeepPerProvince + hooks.armyStrength(n.id) * CONFIG.military.foodUpkeepPerStrength;
      out.food -= foodUse;
      const flows = hooks.dealFlows(n.id);
      for (const r of RESOURCES) out[r] += flows[r] ?? 0;
      cash += flows.cash ?? 0;
      n.rates = { ...out, cash };

      for (const r of RESOURCES) n.resources[r] = Math.min(CONFIG.world.resourceCap, n.resources[r] + out[r] * dt);
      hooks.credit(n.playerId, cash * dt);

      const wasStarving = n.starving;
      n.starving = n.resources.food < 0;
      if (n.resources.food < 0) n.resources.food = 0;
      for (const r of RESOURCES) if (r !== 'food' && n.resources[r] < 0) n.resources[r] = 0;
      if (n.starving && !wasStarving) events.push({ type: 'starving', nationId: n.id });

      n.stability = stabilityStep(
        n.stability,
        { atWar: hooks.atWar(n.id), sanctions: hooks.sanctions(n.id), starving: n.starving, companiesCrashed: hooks.companiesCrashed(n.id) },
        dt,
      );
      const protesting = n.stability < CONFIG.stability.protestThreshold;
      if (protesting && !n.protesting) events.push({ type: 'protestStart', nationId: n.id });
      if (!protesting && n.protesting) events.push({ type: 'protestEnd', nationId: n.id });
      n.protesting = protesting;

      if (n.stability <= 0) events.push(this.coup(n));
    }
    return events;
  }

  /**
   * Coup: the nation splits. The provinces farthest from the capital (a fraction of them)
   * revolt and become neutral; the treasury takes a hit (applied by the Game); stability resets.
   */
  coup(n: Nation): WorldEvent {
    const owned = this.ownedBy(n.id).filter((p) => p.id !== n.capital);
    owned.sort((a, b) => this.map.dist[n.capital][b.id] - this.map.dist[n.capital][a.id]);
    const count = Math.ceil(owned.length * CONFIG.stability.coupSplitFraction);
    const lost = owned.slice(0, count).map((p) => p.id);
    for (const id of lost) {
      const p = this.provinces[id];
      p.ownerId = null;
      p.garrison = Math.round(CONFIG.military.neutralGarrison * 0.8);
      p.construction = null;
    }
    n.stability = CONFIG.stability.coupResetStability;
    n.protesting = false;
    n.coups++;
    return { type: 'coup', nationId: n.id, lost };
  }

  // ------------------------------------------------------------------- actions

  canAfford(n: Nation, res: Partial<Record<ResourceKind, number>>): boolean {
    return RESOURCES.every((r) => n.resources[r] >= (res[r] ?? 0));
  }
  pay(n: Nation, res: Partial<Record<ResourceKind, number>>): void {
    for (const r of RESOURCES) n.resources[r] -= res[r] ?? 0;
  }

  /** Validate a build (cash is checked and spent by the Game via the market account). */
  buildCheck(n: Nation, provinceId: number, kind: BuildingKind): string | null {
    const p = this.provinces[provinceId];
    if (!p) return 'No such province';
    if (p.ownerId !== n.id) return 'You do not own that province';
    if (p.construction) return 'Already building something there';
    if (p.buildings.length >= CONFIG.maxBuildingsPerProvince) return `Max ${CONFIG.maxBuildingsPerProvince} buildings per province`;
    if (p.buildings.includes(kind)) return 'Already has one';
    if (kind === 'port' && !this.map.provinces[provinceId].coastal) return 'Ports need a coastline';
    if (!this.canAfford(n, CONFIG.buildings[kind].resources)) return 'Not enough resources';
    return null;
  }

  startBuild(n: Nation, provinceId: number, kind: BuildingKind, now: number): void {
    this.pay(n, CONFIG.buildings[kind].resources);
    this.provinces[provinceId].construction = { kind, doneAt: now + CONFIG.buildings[kind].buildSec * 1000 };
  }

  /** Transfer a province (conquest). Buildings survive, constructions are lost. */
  transfer(provinceId: number, toNationId: string | null): void {
    const p = this.provinces[provinceId];
    p.ownerId = toNationId;
    p.construction = null;
  }

  totalProduction(now: number): number {
    let t = 0;
    for (const p of this.provinces) {
      const y = provinceYield(this.map.provinces[p.id].terrain, p.buildings, this.provinceMult(p, now));
      t += y.oil + y.food + y.metals + y.tech;
    }
    return t;
  }

  nationProductionShare(nationId: string, now: number): number {
    const total = this.totalProduction(now);
    if (total <= 0) return 0;
    const o = this.nationOutput(nationId, now);
    return (o.oil + o.food + o.metals + o.tech) / total;
  }
}
