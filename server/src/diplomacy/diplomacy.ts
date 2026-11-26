/**
 * Chat, trade deals, alliances, sanctions and embargoes.
 *
 * Deals are per-minute flows of cash/resources in both directions for a duration.
 * Breaking one (or defaulting on payments) costs reputation and stability.
 * Sanctions hit the target's stocks and stability; enough sanctioners = embargo
 * (no exports, no deals).
 */
import { CONFIG, type ChatMessage, type DealTerms, type DealView, type Resources } from '@warmarket/shared';
import { uid } from '../util/rng.js';
import type { Game } from '../game/Game.js';

type Flow = Partial<Resources & { cash: number }>;
const KEYS = ['cash', 'oil', 'food', 'metals', 'tech'] as const;

export interface Deal {
  id: string;
  from: string;
  to: string;
  terms: DealTerms;
  status: DealView['status'];
  createdAt: number;
  startedAt?: number;
  endsAt?: number;
}

export class Diplomacy {
  chat: ChatMessage[] = [];
  deals: Deal[] = [];
  private alliances = new Set<string>();
  /** target nation → sanctioning nations */
  private sanctions = new Map<string, Set<string>>();
  private lastChat = new Map<string, number>();
  private lastCheck = 0;

  constructor(private g: Game) {}

  // ------------------------------------------------------------------- chat

  sendChat(playerId: string, text: string, toId: string | null, now: number): string | null {
    const last = this.lastChat.get(playerId) ?? 0;
    if (now - last < CONFIG.diplomacy.chatRateMs) return 'Slow down';
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, CONFIG.diplomacy.chatMaxLength);
    if (!clean) return 'Empty message';
    const from = this.g.players.find((p) => p.id === playerId)!;
    if (toId !== null && (!this.g.players.some((p) => p.id === toId) || toId === playerId)) return 'Unknown recipient';
    this.lastChat.set(playerId, now);
    const msg: ChatMessage = { id: uid('c'), t: now, fromId: playerId, fromName: from.name, toId, text: clean };
    this.chat.push(msg);
    if (this.chat.length > CONFIG.diplomacy.chatHistory * 3) this.chat.shift();
    if (toId === null) this.g.emit.toAll('chat', msg);
    else {
      this.g.emit.toPlayer(playerId, 'chat', msg);
      this.g.emit.toPlayer(toId, 'chat', msg);
    }
    return null;
  }

  /** Only global messages plus private ones you sent or received. */
  chatFor(playerId: string): ChatMessage[] {
    return this.chat.filter((c) => c.toId === null || c.toId === playerId || c.fromId === playerId).slice(-CONFIG.diplomacy.chatHistory);
  }

  // ------------------------------------------------------------------- alliances

  allied(a: string, b: string): boolean {
    return this.alliances.has(key(a, b));
  }

  alliesOf(n: string): string[] {
    const out: string[] = [];
    for (const k of this.alliances) {
      const [x, y] = k.split('|');
      if (x === n) out.push(y);
      else if (y === n) out.push(x);
    }
    return out;
  }

  formAlliance(a: string, b: string): string | null {
    if (this.g.military.atWar(a, b)) return 'You are at war with them';
    this.alliances.add(key(a, b));
    const A = this.g.world.nation(a)!;
    const B = this.g.world.nation(b)!;
    this.g.news.post('Global Wire', `${A.name} and ${B.name} sign a mutual defence pact`, 'good', true);
    this.setSanction(a, b, false, 0, true);
    this.setSanction(b, a, false, 0, true);
    return null;
  }

  breakAlliance(by: string, other: string): string | null {
    if (!this.allied(by, other)) return 'You are not allied';
    this.alliances.delete(key(by, other));
    const A = this.g.world.nation(by)!;
    const B = this.g.world.nation(other)!;
    A.reputation = Math.max(0, A.reputation - CONFIG.diplomacy.allianceBreakReputationHit);
    this.g.news.post('Global Wire', `${A.name} tears up its alliance with ${B.name}`, 'bad', true);
    this.g.notify(B.playerId, 'bad', `${A.name} broke your alliance!`);
    return null;
  }

  // ------------------------------------------------------------------- sanctions

  sanctionersOf(target: string): string[] {
    return [...(this.sanctions.get(target) ?? [])];
  }
  sanctioning(by: string, target: string): boolean {
    return this.sanctions.get(target)?.has(by) ?? false;
  }
  embargoed(target: string): boolean {
    return (this.sanctions.get(target)?.size ?? 0) >= CONFIG.diplomacy.embargoThreshold;
  }

  setSanction(by: string, target: string, on: boolean, now: number, quiet = false): string | null {
    if (by === target) return 'You cannot sanction yourself';
    const T = this.g.world.nation(target);
    const B = this.g.world.nation(by)!;
    if (!T) return 'Unknown nation';
    if (on && this.allied(by, target)) return 'You are allied with them';
    const set = this.sanctions.get(target) ?? new Set<string>();
    const wasEmbargo = this.embargoed(target);
    if (on === set.has(by)) return on ? 'Already sanctioning them' : 'Not sanctioning them';
    if (on) set.add(by);
    else set.delete(by);
    this.sanctions.set(target, set);
    if (quiet) return null;
    if (on) {
      const s = CONFIG.shocks.sanction;
      this.g.market.addNationImpact(target, s.targetCompanies, s.durationTicks, 'sanctions');
      // Deals between them are void.
      for (const d of this.deals) if (d.status === 'active' && ((d.from === by && d.to === target) || (d.from === target && d.to === by))) d.status = 'broken';
      this.g.news.post('Global Wire', `${B.name} slaps sanctions on ${T.name}`, 'bad', true, T.companies.map((c) => c.id));
      this.g.notify(T.playerId, 'bad', `${B.name} sanctioned you: stocks hit, stability draining.`);
    } else {
      this.g.news.post('Global Wire', `${B.name} lifts sanctions on ${T.name}`, 'good', false);
    }
    const isEmbargo = this.embargoed(target);
    if (isEmbargo && !wasEmbargo) {
      const s = CONFIG.shocks.embargo;
      this.g.market.addNationImpact(target, s.targetCompanies, s.durationTicks, 'embargo');
      for (const d of this.deals) if (d.status === 'active' && (d.from === target || d.to === target)) d.status = 'broken';
      this.g.news.post('Global Wire', `EMBARGO: a coalition cuts ${T.name} off from world trade. No exports, no deals.`, 'bad', true, T.companies.map((c) => c.id));
    } else if (!isEmbargo && wasEmbargo) {
      this.g.news.post('Global Wire', `The embargo on ${T.name} collapses`, 'good', true);
    }
    void now;
    return null;
  }

  // ------------------------------------------------------------------- deals

  proposeDeal(from: string, to: string, terms: DealTerms, now: number): string | null {
    const T = this.g.world.nation(to);
    if (!T || to === from) return 'Invalid partner';
    if (this.g.military.atWar(from, to)) return 'You are at war with them';
    if (this.embargoed(from) || this.embargoed(to)) return 'Embargo: no deals allowed';
    if (this.sanctioning(from, to) || this.sanctioning(to, from)) return 'Sanctions are in place between you';
    if (isEmpty(terms.give) && isEmpty(terms.receive)) return 'The deal is empty';
    if (this.deals.filter((d) => d.status === 'proposed' && d.from === from).length >= 3) return 'Too many pending deal offers';
    this.deals.push({ id: uid('d'), from, to, terms, status: 'proposed', createdAt: now });
    const F = this.g.world.nation(from)!;
    this.g.notify(T.playerId, 'info', `${F.name} offers you a trade deal — see Diplomacy`);
    return null;
  }

  respondDeal(nationId: string, dealId: string, accept: boolean, now: number): string | null {
    const d = this.deals.find((x) => x.id === dealId);
    if (!d || d.status !== 'proposed') return 'Deal no longer available';
    if (d.to !== nationId && !(d.from === nationId && !accept)) return 'Not your deal to answer';
    if (!accept) {
      d.status = 'rejected';
      return null;
    }
    if (this.embargoed(d.from) || this.embargoed(d.to)) return 'Embargo: no deals allowed';
    if (this.g.military.atWar(d.from, d.to)) return 'You are at war';
    d.status = 'active';
    d.startedAt = now;
    d.endsAt = now + d.terms.durationSec * 1000;
    const A = this.g.world.nation(d.from)!;
    const B = this.g.world.nation(d.to)!;
    this.g.news.post('Market Desk', `${A.name} and ${B.name} sign a ${Math.round(d.terms.durationSec / 60) || 1}-minute trade deal`, 'good', false);
    this.g.notify(A.playerId, 'good', `${B.name} accepted your trade deal`);
    return null;
  }

  breakDeal(nationId: string, dealId: string, reason: 'broken' | 'default' = 'broken'): string | null {
    const d = this.deals.find((x) => x.id === dealId);
    if (!d || d.status !== 'active') return 'No such active deal';
    if (d.from !== nationId && d.to !== nationId) return 'Not your deal';
    d.status = 'broken';
    const breaker = this.g.world.nation(nationId)!;
    const other = this.g.world.nation(d.from === nationId ? d.to : d.from)!;
    breaker.reputation = Math.max(0, breaker.reputation - CONFIG.diplomacy.breakDealReputationHit);
    breaker.stability = Math.max(0, breaker.stability - CONFIG.diplomacy.breakDealStabilityHit);
    this.g.news.post(
      'Global Wire',
      reason === 'default' ? `${breaker.name} defaults on its trade deal with ${other.name}` : `${breaker.name} breaks its trade deal with ${other.name}. Trust plummets.`,
      'bad',
      false,
    );
    this.g.notify(other.playerId, 'bad', `${breaker.name} ${reason === 'default' ? 'defaulted on' : 'broke'} your trade deal`);
    return null;
  }

  /** Net per-second flow for a nation across all active deals. */
  flows(nationId: string): Flow {
    const out: Record<string, number> = {};
    for (const d of this.deals) {
      if (d.status !== 'active') continue;
      const sign = d.from === nationId ? 1 : d.to === nationId ? -1 : 0;
      if (!sign) continue;
      for (const k of KEYS) {
        // `give` flows from proposer to target; `receive` from target to proposer.
        const give = (d.terms.give[k] ?? 0) / 60;
        const recv = (d.terms.receive[k] ?? 0) / 60;
        out[k] = (out[k] ?? 0) + (sign === 1 ? recv - give : give - recv);
      }
    }
    return out;
  }

  tick(now: number): void {
    for (const d of this.deals) {
      if (d.status === 'proposed' && now - d.createdAt > CONFIG.diplomacy.proposalTtlMs) d.status = 'expired';
      if (d.status === 'active' && d.endsAt && now >= d.endsAt) {
        d.status = 'done';
        const A = this.g.world.nation(d.from)!;
        const B = this.g.world.nation(d.to)!;
        this.g.notify(A.playerId, 'info', `Trade deal with ${B.name} completed`);
        this.g.notify(B.playerId, 'info', `Trade deal with ${A.name} completed`);
      }
    }
    // Once a second: default anyone who can no longer pay.
    if (now - this.lastCheck >= 1000) {
      this.lastCheck = now;
      for (const d of this.deals) {
        if (d.status !== 'active') continue;
        for (const [payer, owed] of [
          [d.from, d.terms.give],
          [d.to, d.terms.receive],
        ] as const) {
          const n = this.g.world.nation(payer)!;
          const broke = KEYS.some((k) => {
            const amt = owed[k] ?? 0;
            if (amt <= 0) return false;
            if (k === 'cash') return this.g.market.freeCash(n.playerId) < amt / 60;
            return n.resources[k] < amt / 60;
          });
          if (broke) {
            this.breakDeal(payer, d.id, 'default');
            break;
          }
        }
      }
    }
    // Keep the list bounded.
    if (this.deals.length > 200) this.deals = this.deals.filter((d) => d.status === 'active' || d.status === 'proposed' || now - d.createdAt < 300_000);
  }

  dealViews(nationId: string): DealView[] {
    return this.deals
      .filter((d) => d.from === nationId || d.to === nationId)
      .slice(-20)
      .map((d) => ({ id: d.id, from: d.from, to: d.to, terms: d.terms, status: d.status, startedAt: d.startedAt, endsAt: d.endsAt, createdAt: d.createdAt }));
  }
}

function key(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function isEmpty(f: Flow): boolean {
  return KEYS.every((k) => !(f[k] && f[k]! > 0));
}
