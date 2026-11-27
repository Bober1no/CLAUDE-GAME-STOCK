/**
 * Player-run companies. Every player is the CEO of one listed company and starts with
 * founder shares in it, so its share price is a big part of their net worth.
 *
 * A company's fundamental value = IPO price × health × event shifts.
 * CEO actions move health (long-term value) and/or add one-off price impacts (hype).
 *
 *   R&D        cost now, +health after a delay              (slow, durable)
 *   Marketing  cost now, +hype now, small hangover later     (fast, fades)
 *   Buyback    spend X: buy pressure now, +health a little
 *   Issue      +cash now, dilution: −price, −health
 *   Dividend   pay X pro rata to every holder (shorts pay it), +hype, +health
 *   Fraud      big hidden pump; every tick the regulator may find out → crash + fine
 */
import { CONFIG, type CorporateAction } from '@warmarket/shared';
import type { Game } from '../game/Game.js';

export interface CompanyState {
  assetId: string;
  ownerId: string;
  health: number;
  dividendsPaid: number;
  sharesIssued: number;
  fraud: { startedTick: number } | null;
  frauds: number;
}

interface Delayed {
  atTick: number;
  assetId: string;
  impact?: { pct: number; ticks: number };
  health?: number;
}

export class Corporate {
  companies = new Map<string, CompanyState>();
  private byOwner = new Map<string, CompanyState>();
  private delayed: Delayed[] = [];
  /** playerId → action → next allowed time */
  private cooldowns = new Map<string, Partial<Record<CorporateAction, number>>>();

  constructor(private g: Game) {}

  add(ownerId: string, assetId: string): void {
    const c: CompanyState = { assetId, ownerId, health: 1, dividendsPaid: 0, sharesIssued: 0, fraud: null, frauds: 0 };
    this.companies.set(assetId, c);
    this.byOwner.set(ownerId, c);
  }

  of(playerId: string): CompanyState | undefined {
    return this.byOwner.get(playerId);
  }

  cooldownsOf(playerId: string): Partial<Record<CorporateAction, number>> {
    return this.cooldowns.get(playerId) ?? {};
  }

  pendingRnd(playerId: string): number {
    const c = this.of(playerId);
    return c ? this.delayed.filter((d) => d.assetId === c.assetId && (d.health ?? 0) > 0).length : 0;
  }

  private bumpHealth(c: CompanyState, delta: number): void {
    const k = CONFIG.corporate;
    c.health = Math.max(k.minHealth, Math.min(k.maxHealth, c.health + delta));
  }

  act(playerId: string, action: CorporateAction, amount: number | undefined, now: number): string | null {
    const c = this.of(playerId);
    if (!c) return 'You do not run a company';
    const cds = this.cooldowns.get(playerId) ?? {};
    if ((cds[action] ?? 0) > now) return `Cooldown: ${Math.ceil(((cds[action] ?? 0) - now) / 1000)}s`;
    const k = CONFIG.corporate;
    const m = this.g.market;
    const a = m.assets.get(c.assetId)!;
    const tick = m.tickNo;
    const name = a.info.name;
    const news = (headline: string, tone: 'good' | 'bad' | 'neutral') => this.g.news.post('Press Release', headline, tone, false, [c.assetId]);

    switch (action) {
      case 'rnd': {
        if (!m.spend(playerId, k.rnd.cost)) return 'Not enough free cash';
        this.delayed.push({ atTick: tick + k.rnd.delayTicks, assetId: c.assetId, health: k.rnd.healthGain });
        news(`${name} announces a major R&D programme. Results expected soon.`, 'neutral');
        break;
      }
      case 'marketing': {
        if (!m.spend(playerId, k.marketing.cost)) return 'Not enough free cash';
        m.addImpact(c.assetId, k.marketing.hype, k.marketing.ticks, 'marketing');
        this.delayed.push({ atTick: tick + k.marketing.ticks + 2, assetId: c.assetId, impact: { pct: k.marketing.hangover, ticks: 1 } });
        news(`${name} launches a ${this.g.rng.pick(['Super Bowl ad', 'celebrity collab', 'viral TikTok campaign', 'billboard on the moon'])}.`, 'good');
        break;
      }
      case 'buyback': {
        const amt = Math.floor(amount ?? 0);
        if (amt < k.buyback.minAmount || amt > k.buyback.maxAmount) return `Buyback must be $${k.buyback.minAmount}–$${k.buyback.maxAmount}`;
        if (!m.spend(playerId, amt)) return 'Not enough free cash';
        m.addImpact(c.assetId, (k.buyback.impactPerDepth * amt) / a.depth, 1, 'buyback');
        this.bumpHealth(c, (k.buyback.healthPer1000 * amt) / 1000);
        news(`${name} announces a $${amt.toLocaleString('en-US')} share buyback.`, 'good');
        break;
      }
      case 'issue': {
        m.credit(playerId, k.issue.cash);
        m.addImpact(c.assetId, k.issue.impact, 1, 'dilution');
        this.bumpHealth(c, -k.issue.healthLoss);
        c.sharesIssued++;
        news(`${name} issues new shares to raise $${k.issue.cash.toLocaleString('en-US')}. Existing holders diluted.`, 'bad');
        break;
      }
      case 'dividend': {
        const amt = Math.floor(amount ?? 0);
        if (amt < k.dividend.minAmount || amt > k.dividend.maxAmount) return `Dividend must be $${k.dividend.minAmount}–$${k.dividend.maxAmount}`;
        if (!m.spend(playerId, amt)) return 'Not enough free cash';
        this.payDividend(c.assetId, amt);
        m.addImpact(c.assetId, k.dividend.hype, 1, 'dividend');
        this.bumpHealth(c, k.dividend.healthGain);
        c.dividendsPaid++;
        news(`${name} pays a $${amt.toLocaleString('en-US')} special dividend to shareholders.`, 'good');
        break;
      }
      case 'fraud': {
        if (c.fraud) return 'You are already cooking the books';
        m.addImpact(c.assetId, k.fraud.hype, k.fraud.ticks, 'fraud');
        this.g.shiftFundamental(c.assetId, 1 + k.fraud.hype * 0.75);
        c.fraud = { startedTick: tick };
        c.frauds++;
        news(`${name} reports a RECORD quarter: revenue up ${this.g.rng.int(140, 420)}%!`, 'good');
        break;
      }
    }
    const cd = (k as unknown as Record<string, { cooldownSec: number }>)[action].cooldownSec;
    this.cooldowns.set(playerId, { ...cds, [action]: now + cd * 1000 });
    return null;
  }

  /**
   * Pay `amount` to every long holder pro rata. Short sellers owe the same per-share
   * amount (as in real markets), which makes dividends a weapon against people shorting you.
   */
  payDividend(assetId: string, amount: number): void {
    const m = this.g.market;
    let longQty = 0;
    for (const acct of m.accounts.values()) {
      const p = acct.positions.get(assetId);
      if (p && p.qty > 0) longQty += p.qty;
    }
    if (longQty <= 0) return;
    const perShare = amount / longQty;
    for (const acct of m.accounts.values()) {
      const p = acct.positions.get(assetId);
      if (!p || p.qty === 0) continue;
      const amt = perShare * Math.abs(p.qty);
      if (p.qty > 0) {
        m.credit(acct.playerId, amt);
        if (acct.playerId !== this.companies.get(assetId)?.ownerId) this.g.notify(acct.playerId, 'good', `Dividend: +$${Math.round(amt).toLocaleString('en-US')} from ${assetId}`);
      } else {
        m.debit(acct.playerId, amt);
        this.g.notify(acct.playerId, 'bad', `You are short ${assetId}: you owe its dividend, −$${Math.round(amt).toLocaleString('en-US')}`);
      }
    }
  }

  /** Called before each market clear: mature delayed effects, roll fraud discovery. */
  beforeMarketTick(): void {
    const m = this.g.market;
    const tick = m.tickNo + 1;
    const due = this.delayed.filter((d) => d.atTick <= tick);
    this.delayed = this.delayed.filter((d) => d.atTick > tick);
    for (const d of due) {
      const c = this.companies.get(d.assetId);
      if (d.impact) m.addImpact(d.assetId, d.impact.pct, d.impact.ticks, 'delayed');
      if (d.health && c) {
        this.bumpHealth(c, d.health);
        const success = this.g.rng.chance(0.8);
        const a = m.assets.get(d.assetId)!;
        if (success) {
          m.addImpact(d.assetId, 0.05, 1, 'rnd');
          this.g.news.post('Press Release', `${a.info.name}'s R&D pays off: new product line unveiled`, 'good', false, [d.assetId]);
        } else {
          this.bumpHealth(c, -d.health * 0.75);
          this.g.news.post('Press Release', `${a.info.name}'s R&D programme quietly shelved`, 'bad', false, [d.assetId]);
        }
      }
    }

    const k = CONFIG.corporate.fraud;
    for (const c of this.companies.values()) {
      if (!c.fraud) continue;
      const owner = this.g.players.find((p) => p.id === c.ownerId)!;
      const mult = this.g.suspicionMult(c.ownerId);
      if (this.g.rng.chance(Math.min(0.9, k.discoverChancePerTick * mult))) {
        c.fraud = null;
        m.addImpact(c.assetId, k.crash, 1, 'fraud exposed');
        this.g.shiftFundamental(c.assetId, 0.7);
        this.bumpHealth(c, -0.15);
        m.debit(c.ownerId, k.fineFlat);
        this.g.adjustReputation(c.ownerId, -k.reputationHit);
        this.g.fines.set(c.ownerId, (this.g.fines.get(c.ownerId) ?? 0) + k.fineFlat);
        const a = m.assets.get(c.assetId)!;
        this.g.news.post('Regulator', `FRAUD: regulator finds ${a.info.name}'s "record quarter" was invented. CEO ${owner.name} fined $${k.fineFlat.toLocaleString('en-US')}.`, 'bad', true, [c.assetId]);
        this.g.notify(c.ownerId, 'bad', 'The regulator found your cooked books. Your stock is crashing.');
      } else if (tick - c.fraud.startedTick > 10) {
        // Got away with it. For now.
        c.fraud = null;
        this.g.notify(c.ownerId, 'good', 'The auditors moved on. You got away with it.');
      }
    }
  }
}
