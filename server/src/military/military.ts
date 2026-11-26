/**
 * Armies, recruitment, timed movement, battles and wars. Runs inside the 100ms world loop.
 * Battle maths is in battle.ts (pure); this file decides who fights whom and what follows.
 */
import { CONFIG, type ArmyView, type RecruitView, type WarView } from '@warmarket/shared';
import { uid } from '../util/rng.js';
import { haveMet, resolveBattle, travelMs } from './battle.js';
import type { Game } from '../game/Game.js';

export interface Army {
  id: string;
  ownerId: string;
  provinceId: number;
  strength: number;
  move: { from: number; to: number; departAt: number; arriveAt: number } | null;
}

export interface Recruit {
  nationId: string;
  provinceId: number;
  doneAt: number;
}

export interface War {
  a: string;
  b: string;
  since: number;
  mobilisedAt: number;
  casualties: number;
  battles: number;
}

export class Military {
  armies: Army[] = [];
  recruits: Recruit[] = [];
  wars: War[] = [];
  /** nationId → time the nation may next declare war. */
  private declareCooldown = new Map<string, number>();
  /** "a|b" → time before these two may go to war again after peace. */
  private peaceUntil = new Map<string, number>();
  /** For the recap: biggest war by casualties. */
  endedWars: War[] = [];

  constructor(private g: Game) {}

  // ------------------------------------------------------------------- queries

  war(a: string, b: string): War | undefined {
    return this.wars.find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  }
  atWar(a: string, b: string): boolean {
    return !!this.war(a, b);
  }
  enemiesOf(n: string): string[] {
    return this.wars.filter((w) => w.a === n || w.b === n).map((w) => (w.a === n ? w.b : w.a));
  }
  strengthOf(nationId: string): number {
    let s = 0;
    for (const a of this.armies) if (a.ownerId === nationId) s += a.strength;
    return s;
  }
  cooldownUntil(nationId: string): number {
    return this.declareCooldown.get(nationId) ?? 0;
  }

  // ------------------------------------------------------------------- actions

  recruit(nationId: string, playerId: string, provinceId: number, now: number): string | null {
    const p = this.g.world.provinces[provinceId];
    if (!p || p.ownerId !== nationId) return 'You can only recruit in your own provinces';
    const m = CONFIG.military;
    const count = this.armies.filter((a) => a.ownerId === nationId).length + this.recruits.filter((r) => r.nationId === nationId).length;
    if (count >= m.maxArmiesPerPlayer) return 'Army limit reached';
    const n = this.g.world.nation(nationId)!;
    if (!this.g.world.canAfford(n, m.armyResources)) return 'Not enough resources (metals, oil, food)';
    if (!this.g.market.spend(playerId, m.armyCost)) return 'Not enough free cash';
    this.g.world.pay(n, m.armyResources);
    const queued = this.recruits.filter((r) => r.provinceId === provinceId).length;
    this.recruits.push({ nationId, provinceId, doneAt: now + (m.armyBuildSec + queued * m.armyBuildSec * 0.5) * 1000 });
    return null;
  }

  canEnter(nationId: string, provinceId: number, now: number): string | null {
    const p = this.g.world.provinces[provinceId];
    if (!p.ownerId || p.ownerId === nationId) return null;
    if (this.g.areAllied(nationId, p.ownerId)) return null;
    const w = this.war(nationId, p.ownerId);
    if (!w) return `Declare war on ${this.g.world.nation(p.ownerId)!.name} first`;
    if (now < w.mobilisedAt) return `Still mobilising (${Math.ceil((w.mobilisedAt - now) / 1000)}s)`;
    return null;
  }

  move(nationId: string, armyId: string, to: number, now: number): string | null {
    const a = this.armies.find((x) => x.id === armyId);
    if (!a || a.ownerId !== nationId) return 'Not your army';
    if (a.move) return 'That army is already marching';
    if (!this.g.world.isNeighbor(a.provinceId, to)) return 'You can only march to an adjacent province';
    const block = this.canEnter(nationId, to, now);
    if (block) return block;
    const sea = this.g.world.map.seaLanes.some(([x, y]) => (x === a.provinceId && y === to) || (y === a.provinceId && x === to));
    const terrain = this.g.world.map.provinces[to].terrain;
    const m = CONFIG.military;
    const ms = travelMs(m.travelBaseSec, CONFIG.terrainTravel[terrain], sea, m.travelMinSec, m.travelMaxSec);
    a.move = { from: a.provinceId, to, departAt: now, arriveAt: now + ms };
    return null;
  }

  declareWar(attacker: string, target: string, now: number): string | null {
    const w = this.g.world;
    const A = w.nation(attacker)!;
    const T = w.nation(target);
    if (!T || T.id === A.id) return 'Invalid target';
    if (T.eliminated) return 'They are already finished';
    if (this.atWar(attacker, target)) return 'Already at war';
    if (this.g.areAllied(attacker, target)) return 'You are allied — break the alliance first';
    if (now < this.cooldownUntil(attacker)) return `War cooldown: ${Math.ceil((this.cooldownUntil(attacker) - now) / 1000)}s`;
    const key = pairKey(attacker, target);
    if (now < (this.peaceUntil.get(key) ?? 0)) return `Peace treaty holds for ${Math.ceil(((this.peaceUntil.get(key) ?? 0) - now) / 1000)}s more`;
    const m = CONFIG.military;
    this.wars.push({ a: attacker, b: target, since: now, mobilisedAt: now + m.warMobilisationSec * 1000, casualties: 0, battles: 0 });
    this.declareCooldown.set(attacker, now + m.warDeclareCooldownSec * 1000);
    A.stability = Math.max(0, A.stability - CONFIG.stability.declareWarHit);

    // Market shocks: defence up, oil up, target's companies hammered, aggressor's dip.
    const s = CONFIG.shocks.warDeclared;
    this.g.market.addSectorImpact('defence', s.defence, s.durationTicks, 'war');
    this.g.market.addImpact('OIL', s.oil, s.durationTicks, 'war');
    this.g.market.addNationImpact(target, s.targetCompanies, s.durationTicks, 'war target');
    this.g.market.addNationImpact(attacker, s.aggressorCompanies, s.durationTicks, 'war aggressor');
    this.g.news.post('War Correspondent', `${A.name} DECLARES WAR on ${T.name}. Defence stocks jump, oil spikes.`, 'bad', true, [...T.companies.map((c) => c.id), 'OIL']);
    this.g.notify(T.playerId, 'bad', `${A.name} has declared war on you! They can invade in ${m.warMobilisationSec}s.`);
    return null;
  }

  makePeace(a: string, b: string, now: number): void {
    const w = this.war(a, b);
    if (!w) return;
    this.wars = this.wars.filter((x) => x !== w);
    this.endedWars.push(w);
    this.peaceUntil.set(pairKey(a, b), now + CONFIG.military.peaceCooldownSec * 1000);
    const A = this.g.world.nation(a)!;
    const B = this.g.world.nation(b)!;
    this.g.news.post('Global Wire', `Peace signed between ${A.name} and ${B.name}. Markets exhale.`, 'good', true);
    this.g.market.addSectorImpact('defence', -0.04, 1, 'peace');
    this.g.market.addNationImpact(a, 0.03, 1, 'peace');
    this.g.market.addNationImpact(b, 0.03, 1, 'peace');
  }

  /** Called when provinces change hands outside of battle (coups). Armies inside stay. */
  onProvincesLost(): void {}

  // ------------------------------------------------------------------- tick

  tick(dt: number, now: number): void {
    const world = this.g.world;
    const m = CONFIG.military;

    // Recruits finishing.
    const done = this.recruits.filter((r) => r.doneAt <= now);
    this.recruits = this.recruits.filter((r) => r.doneAt > now);
    for (const r of done) {
      if (world.provinces[r.provinceId].ownerId !== r.nationId) continue; // province lost while training
      this.station({ id: uid('a'), ownerId: r.nationId, provinceId: r.provinceId, strength: m.armyStrength, move: null });
      const n = world.nation(r.nationId)!;
      this.g.notify(n.playerId, 'good', `New army ready in ${this.g.provName(r.provinceId)}`);
    }

    // Garrisons regenerate slowly toward their base level.
    for (const p of world.provinces) {
      const target = p.ownerId ? m.ownedGarrison * (p.buildings.includes('fort') ? 1.5 : 1) : m.neutralGarrison;
      if (p.garrison < target) p.garrison = Math.min(target, p.garrison + (p.ownerId ? 0.08 : 0.03) * dt);
    }

    // Head-on collisions between hostile armies on the same edge.
    const movers = this.armies.filter((a) => a.move);
    for (let i = 0; i < movers.length; i++) {
      for (let j = i + 1; j < movers.length; j++) {
        const A = movers[i];
        const B = movers[j];
        if (!A.move || !B.move || A.strength <= 0 || B.strength <= 0) continue;
        if (A.move.from !== B.move.to || A.move.to !== B.move.from) continue;
        if (!this.atWar(A.ownerId, B.ownerId)) continue;
        const pa = (now - A.move.departAt) / (A.move.arriveAt - A.move.departAt);
        const pb = (now - B.move.departAt) / (B.move.arriveAt - B.move.departAt);
        if (haveMet(pa, pb)) this.fieldBattle(A, B, now);
      }
    }
    this.armies = this.armies.filter((a) => a.strength > 0.5);

    // Arrivals.
    for (const a of [...this.armies]) {
      if (!a.move || a.move.arriveAt > now || a.strength <= 0) continue;
      this.arrive(a, now);
    }
    this.armies = this.armies.filter((a) => a.strength > 0.5);

    // Elimination: no land and no armies.
    for (const n of world.nations) {
      const land = world.ownedBy(n.id).length;
      const was = n.eliminated;
      n.eliminated = land === 0 && this.strengthOf(n.id) <= 0 && !this.recruits.some((r) => r.nationId === n.id);
      if (this.g.settings.mode === 'lastStanding' && land === 0) n.eliminated = true;
      if (n.eliminated && !was) {
        this.g.news.post('War Correspondent', `${n.name} has fallen. Its stocks are now collectibles.`, 'bad', true, n.companies.map((c) => c.id));
        this.g.market.addNationImpact(n.id, -0.5, 2, 'eliminated');
        for (const e of this.enemiesOf(n.id)) this.makePeace(n.id, e, now);
      }
    }
  }

  /** Put an army down in a province, merging with a friendly stack already there. */
  private station(a: Army): void {
    a.move = null;
    const stack = this.armies.find((x) => x !== a && !x.move && x.ownerId === a.ownerId && x.provinceId === a.provinceId);
    if (stack) {
      stack.strength += a.strength;
      a.strength = 0;
      this.armies = this.armies.filter((x) => x !== a);
    } else if (!this.armies.includes(a)) this.armies.push(a);
  }

  private fieldBattle(A: Army, B: Army, now: number): void {
    const rng = this.g.rng;
    const r = resolveBattle({ attacker: A.strength, defender: B.strength, defenceMult: 1, randomness: CONFIG.military.battleRandomness, rollA: rng.next(), rollD: rng.next() });
    const losses = A.strength - r.attackerLeft + (B.strength - r.defenderLeft);
    A.strength = r.attackerLeft;
    B.strength = r.defenderLeft;
    const war = this.war(A.ownerId, B.ownerId);
    if (war) {
      war.casualties += losses;
      war.battles++;
    }
    const an = this.g.world.nation(A.ownerId)!;
    const bn = this.g.world.nation(B.ownerId)!;
    const winner = r.attackerWins ? an : bn;
    const loser = r.attackerWins ? bn : an;
    const where = `${this.g.provName(A.move!.from)}–${this.g.provName(A.move!.to)}`;
    this.g.news.post('War Correspondent', `Armies of ${an.name} and ${bn.name} clash on the road ${where}. ${winner.name} wins the field.`, 'bad', false);
    this.g.notify(winner.playerId, 'good', `Your army won a field battle near ${where}`);
    this.g.notify(loser.playerId, 'bad', `Your army was destroyed in a field battle near ${where}`);
    void now;
  }

  private arrive(a: Army, now: number): void {
    const world = this.g.world;
    const to = a.move!.to;
    const from = a.move!.from;
    const p = world.provinces[to];

    // Rules may have changed while marching (peace signed, alliance formed).
    const block = p.ownerId && p.ownerId !== a.ownerId && !this.atWar(a.ownerId, p.ownerId) ? 'blocked' : null;
    if (block && !this.g.areAllied(a.ownerId, p.ownerId!)) {
      // Turn around and go home.
      const back = a.move!.arriveAt - a.move!.departAt;
      a.move = { from: to, to: from, departAt: now, arriveAt: now + back };
      a.provinceId = to;
      const n = world.nation(a.ownerId)!;
      this.g.notify(n.playerId, 'warn', `Your army could not enter ${this.g.provName(to)} and is returning`);
      return;
    }

    a.provinceId = to;
    if (!p.ownerId || (p.ownerId !== a.ownerId && !this.g.areAllied(a.ownerId, p.ownerId))) {
      this.siege(a, now);
      if (a.strength <= 0.5) return;
    }
    // Fight any hostile armies still sitting here (e.g. parked in neutral or our land).
    this.clearHostiles(a, now);
    if (a.strength > 0.5) this.station(a);
  }

  /** Hostile armies parked in a province we just walked into (our own or ally's land). */
  private clearHostiles(a: Army, now: number): void {
    const hostiles = this.armies.filter((x) => x !== a && !x.move && x.provinceId === a.provinceId && this.atWar(a.ownerId, x.ownerId));
    for (const h of hostiles) {
      if (a.strength <= 0) break;
      const terrain = this.g.world.map.provinces[a.provinceId].terrain;
      const r = resolveBattle({ attacker: a.strength, defender: h.strength, defenceMult: CONFIG.terrainDefence[terrain], randomness: CONFIG.military.battleRandomness, rollA: this.g.rng.next(), rollD: this.g.rng.next() });
      const war = this.war(a.ownerId, h.ownerId);
      if (war) {
        war.casualties += a.strength - r.attackerLeft + (h.strength - r.defenderLeft);
        war.battles++;
      }
      a.strength = r.attackerLeft;
      h.strength = r.defenderLeft;
    }
    this.armies = this.armies.filter((x) => x.strength > 0.5 || x === a);
    void now;
  }

  /** Attack a neutral or enemy province: defenders are the garrison plus stationed armies. */
  private siege(a: Army, now: number): void {
    const world = this.g.world;
    const p = world.provinces[a.provinceId];
    const sp = world.map.provinces[a.provinceId];
    const defenderNation = world.nation(p.ownerId);
    const attackerNation = world.nation(a.ownerId)!;
    const defArmies = this.armies.filter((x) => x !== a && !x.move && x.provinceId === p.id && x.ownerId === p.ownerId);
    const defStrength = p.garrison + defArmies.reduce((s, x) => s + x.strength, 0);
    const mult = CONFIG.terrainDefence[sp.terrain] + (p.buildings.includes('fort') ? CONFIG.buildings.fort.defence : 0);
    const r = resolveBattle({ attacker: a.strength, defender: defStrength, defenceMult: mult, randomness: CONFIG.military.battleRandomness, rollA: this.g.rng.next(), rollD: this.g.rng.next() });

    const losses = a.strength - r.attackerLeft + (defStrength - r.defenderLeft);
    const war = defenderNation ? this.war(a.ownerId, defenderNation.id) : undefined;
    if (war) {
      war.casualties += losses;
      war.battles++;
    }
    // Defender losses spread proportionally over garrison and armies.
    const keep = defStrength > 0 ? r.defenderLeft / defStrength : 0;
    p.garrison *= keep;
    for (const d of defArmies) d.strength *= keep;
    this.armies = this.armies.filter((x) => x.strength > 0.5 || x === a);
    a.strength = r.attackerLeft;
    p.disruptedUntil = now + 30_000;

    if (!r.attackerWins) {
      this.g.notify(attackerNation.playerId, 'bad', `Your attack on ${sp.name} failed. The army was destroyed.`);
      if (defenderNation) {
        this.g.notify(defenderNation.playerId, 'good', `${sp.name} held against ${attackerNation.name}!`);
        this.g.news.post('War Correspondent', `${defenderNation.name} repels ${attackerNation.name} at ${sp.name}`, 'neutral', false);
      }
      return;
    }

    // Captured.
    const wasCapital = defenderNation && defenderNation.capital === p.id;
    world.transfer(p.id, attackerNation.id);
    p.garrison = CONFIG.military.ownedGarrison * 0.5;
    p.disruptedUntil = now + 45_000;
    attackerNation.stability = Math.min(100, attackerNation.stability + CONFIG.stability.provinceWonBoost);
    const cs = CONFIG.shocks.provinceCaptured;
    this.g.market.addNationImpact(attackerNation.id, cs.winnerCompanies, cs.durationTicks, 'conquest');
    const oil = sp.specialty === 'OIL';
    if (oil) this.g.market.addImpact('OIL', CONFIG.shocks.oilProvinceCaptured.oil, 1, 'oil province');

    if (defenderNation) {
      defenderNation.stability = Math.max(0, defenderNation.stability - CONFIG.stability.provinceLostHit * (wasCapital ? 2 : 1));
      this.g.market.addNationImpact(defenderNation.id, cs.loserCompanies * (wasCapital ? 2 : 1), cs.durationTicks, 'lost province');
      if (wasCapital) {
        const rest = world.ownedBy(defenderNation.id);
        if (rest.length) defenderNation.capital = rest.sort((x, y) => world.map.dist[p.id][y.id] - world.map.dist[p.id][x.id])[0].id;
      }
      this.g.news.post(
        'War Correspondent',
        `BREAKING: ${attackerNation.name} ${wasCapital ? 'storms the CAPITAL of' : 'invades'} ${defenderNation.name} at ${sp.name}${oil ? ' — oil surges' : ''}`,
        'bad',
        true,
        [...defenderNation.companies.map((c) => c.id), ...(oil ? ['OIL'] : [])],
      );
      this.g.notify(defenderNation.playerId, 'bad', `You lost ${sp.name} to ${attackerNation.name}!`);
      // A merged hostile stack inside is gone (already killed above); stranded allies stay.
    } else {
      this.g.news.post('War Correspondent', `${attackerNation.name} annexes the neutral province of ${sp.name}${oil ? '. Oil traders take note' : ''}`, 'neutral', false, oil ? ['OIL'] : undefined);
    }
    this.g.notify(attackerNation.playerId, 'good', `You captured ${sp.name}!`);
  }

  // ------------------------------------------------------------------- views

  /**
   * Fog of war: you see your provinces, provinces your armies are in or heading to,
   * everything adjacent to those, plus whatever allies and spies give you.
   */
  visibleFor(nationId: string, extraNations: string[], extraProvinces: Iterable<number>): Set<number> {
    const world = this.g.world;
    const seeds = new Set<number>();
    const owners = new Set([nationId, ...extraNations]);
    for (const p of world.provinces) if (p.ownerId && owners.has(p.ownerId)) seeds.add(p.id);
    for (const a of this.armies) {
      if (!owners.has(a.ownerId)) continue;
      seeds.add(a.provinceId);
      if (a.move) {
        seeds.add(a.move.from);
        seeds.add(a.move.to);
      }
    }
    for (const x of extraProvinces) seeds.add(x);
    const vis = new Set(seeds);
    let frontier = [...seeds];
    for (let r = 0; r < CONFIG.military.visionRange; r++) {
      const next: number[] = [];
      for (const id of frontier) for (const nb of world.map.provinces[id].neighbors) if (!vis.has(nb)) {
        vis.add(nb);
        next.push(nb);
      }
      frontier = next;
    }
    return vis;
  }

  armyViews(nationId: string, visible: Set<number>): ArmyView[] {
    return this.armies
      .filter((a) => a.ownerId === nationId || (a.move ? visible.has(a.move.from) || visible.has(a.move.to) : visible.has(a.provinceId)))
      .map((a) => ({ id: a.id, ownerId: a.ownerId, provinceId: a.provinceId, strength: Math.round(a.strength * 10) / 10, move: a.move }));
  }

  recruitViews(nationId: string): RecruitView[] {
    return this.recruits.filter((r) => r.nationId === nationId).map((r) => ({ provinceId: r.provinceId, doneAt: r.doneAt }));
  }

  warViews(): WarView[] {
    return this.wars.map((w) => ({ a: w.a, b: w.b, since: w.since, mobilisedAt: w.mobilisedAt, casualties: Math.round(w.casualties) }));
  }

  biggestWar(): War | undefined {
    return [...this.wars, ...this.endedWars].sort((x, y) => y.casualties - x.casualties)[0];
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
