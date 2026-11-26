/**
 * Spies: train (timer), then send on a mission against another nation.
 *   vision    — see the target's provinces and armies for a while
 *   orderflow — see the target's queued orders and the live (undelayed) order book
 *   stealTech — take a share of the target's tech stockpile
 *   fakeNews  — plant a negative headline about one of the target's companies
 * Missions take a few seconds; failure means the spy is caught (news + reputation hit).
 */
import { CONFIG, type SpyMission, type SpyView } from '@warmarket/shared';
import { uid } from '../util/rng.js';
import type { Game } from '../game/Game.js';

interface Spy {
  id: string;
  nationId: string;
  status: 'training' | 'idle' | 'mission';
  readyAt: number;
  mission?: SpyMission;
  targetId?: string;
  assetId?: string;
}

const FAKE_LINES = [
  '{co} under federal investigation for accounting irregularities',
  '{co} factory fire halts production indefinitely',
  'Whistleblower: {co} product "literally explodes"',
  '{co} CFO resigns abruptly, auditors refuse to sign off',
  '{co} loses its biggest customer overnight',
];

export class Espionage {
  spies: Spy[] = [];
  /** playerId → nationId → until */
  private vision = new Map<string, Map<string, number>>();
  private orderflow = new Map<string, Map<string, number>>();
  private journalistReady = new Map<string, number>();
  caught = new Map<string, number>();
  successes = new Map<string, number>();

  constructor(private g: Game) {}

  train(playerId: string, nationId: string, now: number): string | null {
    const e = CONFIG.espionage;
    const n = this.g.world.nation(nationId)!;
    if (this.spies.filter((s) => s.nationId === nationId).length >= e.maxSpies) return `Max ${e.maxSpies} spies`;
    if (n.resources.tech < e.spyTech) return `Needs ${e.spyTech} tech`;
    if (!this.g.market.spend(playerId, e.spyCost)) return 'Not enough free cash';
    n.resources.tech -= e.spyTech;
    this.spies.push({ id: uid('s'), nationId, status: 'training', readyAt: now + e.spyTrainSec * 1000 });
    return null;
  }

  send(nationId: string, spyId: string, targetId: string, mission: SpyMission, assetId: string | undefined, now: number): string | null {
    const s = this.spies.find((x) => x.id === spyId && x.nationId === nationId);
    if (!s) return 'No such spy';
    if (s.status !== 'idle' || s.readyAt > now) return 'That spy is busy';
    const T = this.g.world.nation(targetId);
    if (!T || targetId === nationId) return 'Invalid target';
    if (T.eliminated) return 'Nothing left to spy on';
    if (mission === 'fakeNews') {
      if (!assetId) return 'Pick one of their companies';
      const a = this.g.market.assets.get(assetId);
      if (!a || a.info.nationId !== targetId) return 'That is not one of their companies';
    }
    s.status = 'mission';
    s.mission = mission;
    s.targetId = targetId;
    s.assetId = assetId;
    s.readyAt = now + (CONFIG.espionage.missionSec[mission] ?? 10) * 1000;
    return null;
  }

  tick(now: number): void {
    const e = CONFIG.espionage;
    for (const s of [...this.spies]) {
      if (s.readyAt > now) continue;
      const me = this.g.world.nation(s.nationId)!;
      if (s.status === 'training') {
        s.status = 'idle';
        this.g.notify(me.playerId, 'good', 'A new spy is ready for duty (Intel tab)');
        continue;
      }
      if (s.status !== 'mission' || !s.mission || !s.targetId) continue;
      const T = this.g.world.nation(s.targetId)!;
      const ok = this.g.rng.chance(e.successChance[s.mission] ?? 0.6);
      if (!ok) {
        this.spies = this.spies.filter((x) => x !== s);
        me.reputation = Math.max(0, me.reputation - e.caughtReputationHit);
        this.caught.set(me.id, (this.caught.get(me.id) ?? 0) + 1);
        this.g.news.post('Global Wire', `${T.name} arrests a spy working for ${me.name}. Diplomatic row erupts.`, 'bad', true);
        this.g.notify(me.playerId, 'bad', `Your spy was caught in ${T.name}. Reputation -${e.caughtReputationHit}.`);
        this.g.notify(T.playerId, 'good', `Counter-intelligence caught a ${me.name} spy (${missionName(s.mission)})`);
        continue;
      }
      this.successes.set(me.id, (this.successes.get(me.id) ?? 0) + 1);
      switch (s.mission) {
        case 'vision':
          setUntil(this.vision, me.playerId, T.id, now + e.visionDurationSec * 1000);
          this.g.notify(me.playerId, 'good', `Spy network in ${T.name} is live: you see their land for ${e.visionDurationSec}s`);
          break;
        case 'orderflow':
          setUntil(this.orderflow, me.playerId, T.id, now + e.orderflowDurationSec * 1000);
          this.g.notify(me.playerId, 'good', `You are reading ${T.name}'s trading desk for ${e.orderflowDurationSec}s (and the live order book)`);
          break;
        case 'stealTech': {
          const amount = Math.floor(T.resources.tech * e.stealTechFraction);
          T.resources.tech -= amount;
          me.resources.tech = Math.min(CONFIG.world.resourceCap, me.resources.tech + amount);
          this.g.notify(me.playerId, 'good', `Stole ${amount} tech from ${T.name}`);
          if (amount > 0) this.g.notify(T.playerId, 'bad', `${amount} tech vanished from your labs overnight…`);
          break;
        }
        case 'fakeNews': {
          const a = this.g.market.assets.get(s.assetId!);
          if (a) {
            const line = this.g.rng.pick(FAKE_LINES).replace('{co}', a.info.name);
            // Planted stories run under a "credible" masthead. That's the point.
            this.g.news.post('Market Desk', line, 'bad', true, [a.info.id]);
            this.g.market.addImpact(a.info.id, e.fakeNewsImpact, 1, 'fake news');
            this.g.notify(me.playerId, 'good', `Your story about ${a.info.id} is out. Enjoy.`);
          }
          break;
        }
      }
      s.status = 'idle';
      s.mission = undefined;
      s.targetId = undefined;
      s.assetId = undefined;
      s.readyAt = now + e.cooldownSec * 1000;
    }
  }

  visionOn(playerId: string, now: number): string[] {
    return active(this.vision, playerId, now);
  }
  orderflowOn(playerId: string, now: number): string[] {
    return active(this.orderflow, playerId, now);
  }

  views(nationId: string): SpyView[] {
    return this.spies.filter((s) => s.nationId === nationId).map((s) => ({ id: s.id, status: s.status, readyAt: s.readyAt, mission: s.mission, targetId: s.targetId }));
  }

  // --------------------------------------------------------------- journalist role

  journalistReadyAt(playerId: string): number {
    return this.journalistReady.get(playerId) ?? 0;
  }

  publish(playerId: string, headline: string, now: number): string | null {
    if (this.g.roles.get(playerId) !== 'journalist') return 'Only the journalist can publish';
    if (now < this.journalistReadyAt(playerId)) return 'Your editor says wait';
    const clean = headline.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
    if (clean.length < 5) return 'Too short';
    this.journalistReady.set(playerId, now + CONFIG.roles.journalistHeadlineCooldownSec * 1000);
    this.g.news.post('Citizen Journal', clean, 'neutral', false);
    return null;
  }
}

function setUntil(m: Map<string, Map<string, number>>, pid: string, nid: string, until: number): void {
  const inner = m.get(pid) ?? new Map<string, number>();
  inner.set(nid, Math.max(inner.get(nid) ?? 0, until));
  m.set(pid, inner);
}

function active(m: Map<string, Map<string, number>>, pid: string, now: number): string[] {
  const inner = m.get(pid);
  if (!inner) return [];
  return [...inner].filter(([, until]) => until > now).map(([nid]) => nid);
}

function missionName(m: SpyMission): string {
  return { vision: 'surveillance', orderflow: 'trading-desk infiltration', stealTech: 'tech theft', fakeNews: 'disinformation' }[m];
}
