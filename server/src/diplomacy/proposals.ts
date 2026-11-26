/** Two-party proposals (peace, alliance) that expire if ignored. */
import { CONFIG, type ProposalView } from '@warmarket/shared';
import { uid } from '../util/rng.js';
import type { Game } from '../game/Game.js';

export interface Proposal {
  id: string;
  kind: 'peace' | 'alliance';
  from: string;
  to: string;
  createdAt: number;
}

export class Proposals {
  list: Proposal[] = [];
  constructor(private g: Game) {}

  propose(kind: Proposal['kind'], from: string, to: string, now: number): string | null {
    const target = this.g.world.nation(to);
    if (!target || to === from) return 'Invalid target';
    if (this.list.some((p) => p.kind === kind && ((p.from === from && p.to === to) || (p.from === to && p.to === from))))
      return 'There is already a pending proposal between you';
    this.list.push({ id: uid('pr'), kind, from, to, createdAt: now });
    const me = this.g.world.nation(from)!;
    this.g.notify(target.playerId, 'info', `${me.name} proposes ${kind === 'peace' ? 'PEACE' : 'an ALLIANCE'} — answer in the Diplomacy tab`);
    return null;
  }

  respond(nationId: string, id: string, accept: boolean, now: number): string | null {
    const p = this.list.find((x) => x.id === id);
    if (!p) return 'Proposal expired';
    if (p.to !== nationId && !(p.from === nationId && !accept)) return 'Not your proposal to answer';
    this.list = this.list.filter((x) => x !== p);
    const from = this.g.world.nation(p.from)!;
    const to = this.g.world.nation(p.to)!;
    if (!accept) {
      if (p.to === nationId) this.g.notify(from.playerId, 'bad', `${to.name} rejected your ${p.kind} proposal`);
      return null;
    }
    if (p.kind === 'peace') {
      if (!this.g.military.atWar(p.from, p.to)) return 'You are no longer at war';
      this.g.military.makePeace(p.from, p.to, now);
    } else {
      const err = this.g.formAlliance(p.from, p.to, now);
      if (err) return err;
    }
    return null;
  }

  tick(now: number): void {
    const ttl = CONFIG.diplomacy.proposalTtlMs;
    this.list = this.list.filter((p) => now - p.createdAt < ttl);
  }

  viewsFor(nationId: string): ProposalView[] {
    return this.list.filter((p) => p.from === nationId || p.to === nationId).map((p) => ({ ...p }));
  }
}
