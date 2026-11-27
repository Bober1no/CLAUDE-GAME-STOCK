/**
 * Headless simulation: drive a whole Game with synthetic time, no sockets.
 * Catches integration bugs between market, corporate actions, influence and events.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG, type Sector } from '@warmarket/shared';
import { Game, makeTicker } from './Game.js';
import { nullEmitter } from '../net/emitter.js';

const T0 = 1_700_000_000_000;
const SECTORS: Sector[] = ['tech', 'energy', 'food', 'defence'];

function makeGame(players = 2, seed = 42, rolesEnabled = false) {
  const ps = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: '#fff', companyName: `Player ${i} Holdings`, sector: SECTORS[i % 4] }));
  const g = new Game('TEST1', ps, { sessionMinutes: 30, rolesEnabled }, nullEmitter, () => {}, seed, T0);
  g.clock = () => T0;
  return { g, ps };
}

function run(g: Game, from: number, to: number, step = 500): number {
  for (let t = from; t <= to; t += step) {
    g.clock = () => t;
    g.worldTick(t);
  }
  g.clock = () => to;
  return to;
}

const co = (g: Game, pid: string) => g.companyOf.get(pid)!;

describe('setup', () => {
  it('lists every player company and grants founder shares', () => {
    const { g, ps } = makeGame(3);
    for (const p of ps) {
      const id = co(g, p.id);
      expect(g.market.assets.get(id)?.info.ownerId).toBe(p.id);
      expect(g.market.accounts.get(p.id)!.positions.get(id)!.qty).toBe(CONFIG.start.founderShares);
    }
    expect(g.netWorth(ps[0].id)).toBeCloseTo(CONFIG.start.cash + CONFIG.start.founderShares * CONFIG.start.ipoPrice);
  });

  it('makes unique tickers', () => {
    const used = new Set(['OIL']);
    expect(makeTicker('Alice Corp', used)).toBe('ACLI');
    expect(makeTicker('Alice Corp', used)).not.toBe('ACLI');
    expect(makeTicker('!!', used)).toHaveLength(4);
  });
});

describe('market integrity', () => {
  it('rejects cheats: negative qty, unknown asset, selling what you do not own, overspending', () => {
    const { g, ps } = makeGame();
    const pid = ps[0].id;
    expect(g.handle(pid, { type: 'order', assetId: 'OIL', side: 'buy', orderType: 'market', qty: -5 }).ok).toBe(false);
    expect(g.handle(pid, { type: 'order', assetId: 'NOPE', side: 'buy', orderType: 'market', qty: 5 }).ok).toBe(false);
    expect(g.handle(pid, { type: 'order', assetId: 'OIL', side: 'sell', orderType: 'market', qty: 5 }).ok).toBe(false);
    expect(g.handle(pid, { type: 'order', assetId: 'GOLD', side: 'buy', orderType: 'market', qty: 1_000_000 }).ok).toBe(false);
    expect(g.handle(pid, { type: 'order', assetId: 'OIL', side: 'buy', orderType: 'market', qty: 10 }).ok).toBe(true);
    // you can sell your founder shares
    expect(g.handle(pid, { type: 'order', assetId: co(g, pid), side: 'sell', orderType: 'market', qty: 10 }).ok).toBe(true);
  });

  it('leverage and limit orders work end to end', () => {
    const { g, ps } = makeGame(2, 25);
    const pid = ps[0].id;
    expect(g.handle(pid, { type: 'order', assetId: 'GOLD', side: 'buy', orderType: 'market', qty: 10, leverage: 5 }).ok).toBe(true);
    expect(g.handle(pid, { type: 'order', assetId: 'OIL', side: 'buy', orderType: 'limit', qty: 5, limitPrice: 50 }).ok).toBe(true);
    run(g, T0, T0 + 21_000);
    const acct = g.market.accounts.get(pid)!;
    expect(acct.positions.get('GOLD')?.loan).toBeGreaterThan(0);
    expect(acct.positions.has('OIL')).toBe(false);
    expect(acct.orders.length).toBe(0);
    expect(acct.reserved).toBe(0);
  });
});

describe('running your company', () => {
  it('R&D raises health after a delay; cooldowns apply', () => {
    const { g, ps } = makeGame();
    const pid = ps[0].id;
    expect(g.handle(pid, { type: 'corporate', action: 'rnd' }).ok).toBe(true);
    expect(g.handle(pid, { type: 'corporate', action: 'rnd' }).ok).toBe(false);
    const before = g.corporate.of(pid)!.health;
    run(g, T0, T0 + 3 * 20_000 + 1000);
    expect(g.corporate.of(pid)!.health).not.toBe(before);
  });

  it('dividends pay longs pro rata and charge shorts', () => {
    const { g, ps } = makeGame(3);
    const [a, b, c] = ps.map((p) => p.id);
    const ticker = co(g, a);
    g.handle(b, { type: 'order', assetId: ticker, side: 'buy', orderType: 'market', qty: 50 });
    g.handle(c, { type: 'order', assetId: ticker, side: 'short', orderType: 'market', qty: 30 });
    run(g, T0, T0 + 21_000);
    const bCash = g.market.accounts.get(b)!.cash;
    const cCash = g.market.accounts.get(c)!.cash;
    expect(g.handle(a, { type: 'corporate', action: 'dividend', amount: 2000 }).ok).toBe(true);
    // B holds 50 of 200 long shares → 25% of $2000
    expect(g.market.accounts.get(b)!.cash - bCash).toBeCloseTo(500, 0);
    expect(g.market.accounts.get(c)!.cash).toBeLessThan(cCash);
    expect(g.handle(a, { type: 'corporate', action: 'dividend', amount: 10 }).ok).toBe(false);
  });

  it('cooked books pump the stock and eventually resolve', () => {
    const { g, ps } = makeGame(2, 9);
    const pid = ps[0].id;
    expect(g.handle(pid, { type: 'corporate', action: 'fraud' }).ok).toBe(true);
    expect(g.corporate.of(pid)!.fraud).not.toBeNull();
    run(g, T0, T0 + 15 * 20_000);
    expect(g.corporate.of(pid)!.fraud).toBeNull();
    expect(g.corporate.of(pid)!.frauds).toBe(1);
  });

  it('cannot act on a company you do not run', () => {
    const { g } = makeGame();
    expect(g.handle('ghost', { type: 'corporate', action: 'rnd' }).ok).toBe(false);
  });
});

describe('influence', () => {
  it('stories cost money and move the market (or get traced)', () => {
    const { g, ps } = makeGame(2, 3);
    const pid = ps[0].id;
    const cash = g.market.accounts.get(pid)!.cash;
    expect(g.handle(pid, { type: 'story', assetId: 'HOTA', positive: false }).ok).toBe(true);
    expect(g.market.accounts.get(pid)!.cash).toBeLessThan(cash);
    expect(g.news.all().some((n) => n.tickers?.includes('HOTA'))).toBe(true);
    expect(g.handle(pid, { type: 'story', assetId: CONFIG.memecoin.id, positive: true }).ok).toBe(false);
  });

  it('lobbying only works on commodities', () => {
    const { g, ps } = makeGame();
    expect(g.handle(ps[0].id, { type: 'lobby', assetId: 'HOTA', up: true }).ok).toBe(false);
    expect(g.handle(ps[0].id, { type: 'lobby', assetId: 'WHEAT', up: true }).ok).toBe(true);
    expect(g.market.impacts.some((i) => i.assetId === 'WHEAT')).toBe(true);
  });

  it('spying reveals a rival’s queued orders', () => {
    const { g, ps } = makeGame(2, 5);
    const [a, b] = ps.map((p) => p.id);
    g.handle(b, { type: 'order', assetId: 'OIL', side: 'buy', orderType: 'market', qty: 3 });
    expect(g.buildView(a, T0).spiedOrders).toEqual([]);
    for (let i = 0; i < 10 && g.influence.spyingOn(a, T0).length === 0; i++) {
      g.clock = () => T0 + i * 31_000;
      g.market.credit(a, 2000);
      g.handle(a, { type: 'spy', targetId: b });
    }
    const t = g.clock();
    if (g.influence.spyingOn(a, t).length) {
      expect(g.buildView(a, t).spiedOrders[0].orders.length).toBe(1);
    }
    expect(g.handle(a, { type: 'spy', targetId: a }).ok).toBe(false);
  });

  it('private chat stays private', () => {
    const { g, ps } = makeGame(3);
    g.handle(ps[0].id, { type: 'chat', text: 'secret plan', toId: ps[1].id });
    g.clock = () => T0 + 2000;
    g.handle(ps[0].id, { type: 'chat', text: 'hello all', toId: null });
    expect(g.chat.for(ps[2].id).map((c) => c.text)).toEqual(['hello all']);
    expect(g.chat.for(ps[1].id).map((c) => c.text)).toContain('secret plan');
  });

  it('only the journalist can publish, with a cooldown; whales start rich', () => {
    const { g, ps } = makeGame(3, 77, true);
    const j = ps.find((p) => g.roles.get(p.id) === 'journalist')!;
    const other = ps.find((p) => g.roles.get(p.id) !== 'journalist')!;
    expect(g.handle(other.id, { type: 'publish', headline: 'Fake news about stuff' }).ok).toBe(false);
    expect(g.handle(j.id, { type: 'publish', headline: 'Totally real scoop here' }).ok).toBe(true);
    expect(g.handle(j.id, { type: 'publish', headline: 'Another scoop right now' }).ok).toBe(false);
    const whale = ps.find((p) => g.roles.get(p.id) === 'whale')!;
    expect(g.market.accounts.get(whale.id)!.cash).toBeGreaterThan(CONFIG.start.cash);
  });

  it('never leaks other players’ secrets in a view', () => {
    const { g, ps } = makeGame(2);
    g.handle(ps[1].id, { type: 'corporate', action: 'fraud' });
    const v = JSON.stringify(g.buildView(ps[0].id, T0));
    expect(v).not.toContain('token');
    expect(g.buildView(ps[0].id, T0).me.fraudActive).toBe(false);
    expect(g.buildView(ps[1].id, T0).me.fraudActive).toBe(true);
  });
});

describe('full session', () => {
  it('events fire, rumours spread, and the game ends with a recap', () => {
    const { g } = makeGame(4, 24);
    run(g, T0, T0 + 30 * 60_000 + 1000, 2000);
    expect(g.events.fired.length).toBeGreaterThan(5);
    expect(g.news.all().some((n) => n.source === 'Rumour Mill')).toBe(true);
    expect(g.ended).toBe(true);
    expect(g.recap!.standings).toHaveLength(4);
    expect(g.recap!.awards.length).toBeGreaterThan(2);
  });

  it('recap names a WarDoge victim when someone loses on it', () => {
    const { g, ps } = makeGame(2, 34);
    g.handle(ps[0].id, { type: 'order', assetId: CONFIG.memecoin.id, side: 'buy', orderType: 'market', qty: 1000 });
    run(g, T0, T0 + 21_000);
    g.market.assets.get(CONFIG.memecoin.id)!.price = 0.05;
    g.finish(T0 + 22_000, 'test');
    expect(g.recap!.awards.find((a) => a.title === 'Rugged by WarDoge')!.who).toBe('P0');
  });
});
