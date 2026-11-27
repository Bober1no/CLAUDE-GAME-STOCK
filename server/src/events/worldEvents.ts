/**
 * Runtime side of world events: schedules them a little ahead of time so rumours and
 * insider tips can leak first, fires them, and applies their declared effects.
 *
 * Rumour Mill accuracy: true rumours come from real upcoming events. False ones are made
 * up at a rate chosen so that, on average, rumourFalseRate of all rumours are false.
 */
import { CONFIG } from '@warmarket/shared';
import { uid } from '../util/rng.js';
import type { Game } from '../game/Game.js';
import { eventChanceAt, intensityAt, rollEvent, rumourHeadline, type EventContext, type EventImpact, type EventSpec } from './eventScheduler.js';

interface Pending {
  id: string;
  spec: EventSpec;
  fireAt: number;
}

export class WorldEvents {
  pending: Pending[] = [];
  fired: { t: number; kind: string }[] = [];
  rumours = { true: 0, false: 0 };

  constructor(private g: Game) {}

  context(now: number): EventContext {
    const companies = [...this.g.market.assets.values()]
      .filter((a) => a.info.kind === 'company')
      .map((a) => ({ id: a.info.id, name: a.info.name, sector: a.info.sector!, ownerId: a.info.ownerId ?? null }));
    return { intensity: intensityAt(this.elapsed(now)), companies };
  }

  elapsed(now: number): number {
    return (now - this.g.startedAt) / (this.g.endsAt - this.g.startedAt);
  }

  /** Called once per market tick: maybe schedule an event, maybe spread a rumour. */
  onMarketTick(now: number): void {
    const rng = this.g.rng;
    const e = CONFIG.events;
    const f = this.elapsed(now);
    const chance = eventChanceAt(f);

    if (rng.chance(chance)) {
      const spec = rollEvent(rng, this.context(now));
      if (spec) {
        const fireAt = now + rng.range(8_000, 30_000);
        const p: Pending = { id: uid('ev'), spec, fireAt };
        this.pending.push(p);
        if (rng.chance(e.rumourLeadChance)) {
          this.rumours.true++;
          this.g.news.post('Rumour Mill', rumourHeadline(rng, spec.teaser), 'neutral', false);
        }
        if (rng.chance(e.insiderTipChance)) this.sendTip(spec, false);
      }
    }

    // False rumours: base rate chosen so the false share ≈ rumourFalseRate, plus a
    // correction toward the target when the running share has drifted below it.
    const trueRate = chance * e.rumourLeadChance;
    let pFalse = Math.min(0.9, (trueRate * e.rumourFalseRate) / Math.max(0.01, 1 - e.rumourFalseRate));
    const total = this.rumours.true + this.rumours.false;
    const deficit = e.rumourFalseRate * total - this.rumours.false;
    if (deficit >= 1) pFalse = Math.max(pFalse, 0.6);
    else if (deficit <= -1) pFalse = 0;
    if (rng.chance(pFalse)) {
      const fake = rollEvent(rng, this.context(now));
      if (fake) {
        this.rumours.false++;
        this.g.news.post('Rumour Mill', rumourHeadline(rng, fake.teaser), 'neutral', false);
        // Some wrong insider tips are about things that never happen.
        if (rng.chance(e.insiderTipChance * e.insiderTipWrongRate)) this.sendTip(fake, true);
      }
    }
  }

  /** Private tip to one random player. Sometimes the direction is wrong. */
  private sendTip(spec: EventSpec, fabricated: boolean): void {
    const rng = this.g.rng;
    const alive = this.g.players;
    if (!alive.length || !spec.hint) return;
    const who = rng.pick(alive);
    const wrong = fabricated || rng.chance(CONFIG.events.insiderTipWrongRate);
    const up = wrong && !fabricated ? !spec.hint.up : spec.hint.up;
    const secs = Math.round(CONFIG.events.insiderTipLeadMs / 1000);
    this.g.notify(who.id, 'tip', `A friend at the ministry says: expect ${spec.teaser} soon. ${spec.hint.assetId} should go ${up ? 'UP' : 'DOWN'}. (~${secs}s, maybe.)`);
  }

  tick(now: number): void {
    const due = this.pending.filter((p) => p.fireAt <= now);
    if (!due.length) return;
    this.pending = this.pending.filter((p) => p.fireAt > now);
    for (const p of due) this.apply(p.spec, now);
  }

  /** Apply an event spec's declared effects. Public so tests/debug can force events. */
  apply(spec: EventSpec, now: number): void {
    const g = this.g;
    for (const i of spec.impacts) this.applyImpact(i, spec.kind);
    for (const sh of spec.shifts) {
      for (const a of g.market.assets.values()) {
        if (sh.assetId ? a.info.id === sh.assetId : a.info.kind === 'company' && a.info.sector === sh.sector) g.shiftFundamental(a.info.id, sh.mult);
      }
    }
    g.news.post(spec.source, spec.headline, spec.tone, spec.breaking, spec.impacts.map((i) => i.assetId).filter((x): x is string => !!x));
    this.fired.push({ t: now, kind: spec.kind });
  }

  applyImpact(i: EventImpact, why: string): void {
    const m = this.g.market;
    if (i.assetId) return m.addImpact(i.assetId, i.pct, i.ticks, why);
    for (const a of m.assets.values()) {
      if (a.info.kind !== 'company') continue;
      if (i.allCompanies || a.info.sector === i.sector) m.addImpact(a.info.id, i.pct, i.ticks, why);
    }
  }
}
