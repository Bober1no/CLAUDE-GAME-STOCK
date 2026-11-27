/**
 * Ways to push the market around besides trading:
 *   story    — plant a pump or smear story about any company or commodity (may get traced)
 *   lobby    — lobby the government to push a commodity up or down for a few ticks
 *   spy      — read a rival's trading desk (their queued orders) for a while
 *   publish  — journalist role only: free headlines with no direct price effect
 */
import { CONFIG, type InfluenceAction } from '@warmarket/shared';
import type { Game } from '../game/Game.js';

const PUMP_LINES = [
  '{n} reportedly in takeover talks at a huge premium',
  'Analysts slap a "strong buy" on {n}, see 80% upside',
  '{n} said to be landing a mega-contract',
  'Insiders loading up on {n}, filings show',
];
const SMEAR_LINES = [
  '{n} under investigation for accounting irregularities',
  'Factory fire halts {n} production indefinitely',
  'Whistleblower: {n} product "literally explodes"',
  '{n} CFO resigns abruptly, auditors refuse to sign off',
];
const COMMODITY_PUMP = ['Shortage fears grip the {n} market', 'Hedge funds pile into {n} on supply worries'];
const COMMODITY_SMEAR = ['{n} glut: warehouses overflowing', 'Demand for {n} collapses, traders say'];

export class Influence {
  private cooldowns = new Map<string, Partial<Record<InfluenceAction, number>>>();
  /** spier → target → until */
  private spying = new Map<string, Map<string, number>>();
  private journalistReady = new Map<string, number>();
  storiesPlanted = new Map<string, number>();

  constructor(private g: Game) {}

  cooldownsOf(playerId: string): Partial<Record<InfluenceAction, number>> {
    return this.cooldowns.get(playerId) ?? {};
  }
  spyingOn(playerId: string, now: number): { playerId: string; until: number }[] {
    return [...(this.spying.get(playerId) ?? [])].filter(([, u]) => u > now).map(([pid, until]) => ({ playerId: pid, until }));
  }
  journalistReadyAt(playerId: string): number {
    return this.journalistReady.get(playerId) ?? 0;
  }

  private gate(playerId: string, action: InfluenceAction, cost: number, now: number): string | null {
    const cd = this.cooldownsOf(playerId)[action] ?? 0;
    if (cd > now) return `Cooldown: ${Math.ceil((cd - now) / 1000)}s`;
    if (!this.g.market.spend(playerId, cost)) return 'Not enough free cash';
    const cfg = CONFIG.influence[action];
    this.cooldowns.set(playerId, { ...this.cooldownsOf(playerId), [action]: now + cfg.cooldownSec * 1000 });
    return null;
  }

  story(playerId: string, assetId: string, positive: boolean, now: number): string | null {
    const a = this.g.market.assets.get(assetId);
    if (!a || a.info.kind === 'memecoin') return 'Pick a company or commodity';
    const err = this.gate(playerId, 'story', CONFIG.influence.story.cost, now);
    if (err) return err;
    const s = CONFIG.influence.story;
    const g = this.g;
    this.storiesPlanted.set(playerId, (this.storiesPlanted.get(playerId) ?? 0) + 1);
    const ok = g.rng.chance(s.successChance / g.suspicionMult(playerId));
    if (!ok) {
      const me = g.players.find((p) => p.id === playerId)!;
      g.market.debit(playerId, s.fine);
      g.fines.set(playerId, (g.fines.get(playerId) ?? 0) + s.fine);
      g.adjustReputation(playerId, -s.reputationHit);
      g.news.post('Regulator', `Regulator traces a planted ${positive ? 'pump' : 'smear'} story about ${a.info.name} back to ${me.name}. Fined $${s.fine.toLocaleString('en-US')}.`, 'bad', true, [assetId]);
      g.notify(playerId, 'bad', `Your story about ${assetId} was traced back to you. Fined and exposed.`);
      return null;
    }
    const lines = a.info.kind === 'commodity' ? (positive ? COMMODITY_PUMP : COMMODITY_SMEAR) : positive ? PUMP_LINES : SMEAR_LINES;
    // Planted stories run under a credible masthead. That's the point.
    g.news.post('Market Desk', g.rng.pick(lines).replace('{n}', a.info.name), positive ? 'good' : 'bad', true, [assetId]);
    g.market.addImpact(assetId, positive ? s.impact : -s.impact, 1, 'story');
    g.shiftFundamental(assetId, 1 + (positive ? s.impact : -s.impact) * 0.4);
    g.notify(playerId, 'good', `Your story about ${assetId} is out.`);
    return null;
  }

  lobby(playerId: string, assetId: string, up: boolean, now: number): string | null {
    const a = this.g.market.assets.get(assetId);
    if (!a || a.info.kind !== 'commodity') return 'You can only lobby on commodities';
    const err = this.gate(playerId, 'lobby', CONFIG.influence.lobby.cost, now);
    if (err) return err;
    const l = CONFIG.influence.lobby;
    this.g.market.addImpact(assetId, up ? l.impact : -l.impact, l.ticks, 'lobbying');
    this.g.shiftFundamental(assetId, 1 + (up ? l.impact : -l.impact) * 0.6);
    this.g.news.post(
      'Global Wire',
      up ? `Government announces ${this.g.rng.pick(['export restrictions', 'a strategic stockpile', 'new subsidies'])} for ${a.info.name}` : `Government ${this.g.rng.pick(['releases reserves of', 'cuts import tariffs on', 'scraps subsidies for'])} ${a.info.name}`,
      'neutral',
      false,
      [assetId],
    );
    return null;
  }

  spy(playerId: string, targetId: string, now: number): string | null {
    if (targetId === playerId || !this.g.players.some((p) => p.id === targetId)) return 'Pick a rival';
    const err = this.gate(playerId, 'spy', CONFIG.influence.spy.cost, now);
    if (err) return err;
    const s = CONFIG.influence.spy;
    const g = this.g;
    const me = g.players.find((p) => p.id === playerId)!;
    const them = g.players.find((p) => p.id === targetId)!;
    if (g.rng.chance(Math.min(0.9, s.caughtChance * g.suspicionMult(playerId)))) {
      g.adjustReputation(playerId, -s.reputationHit);
      g.news.post('Global Wire', `${me.name} caught paying a mole on ${them.name}'s trading desk`, 'bad', true);
      g.notify(playerId, 'bad', `Your mole was caught. Reputation −${s.reputationHit}.`);
      g.notify(targetId, 'good', `Security caught ${me.name}'s mole on your desk`);
      return null;
    }
    const inner = this.spying.get(playerId) ?? new Map<string, number>();
    inner.set(targetId, now + s.durationSec * 1000);
    this.spying.set(playerId, inner);
    g.notify(playerId, 'good', `You can see ${them.name}'s queued orders for ${s.durationSec}s (Influence tab)`);
    return null;
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
