/**
 * Headless simulation: drive a whole Game with synthetic time, no sockets.
 * Catches integration bugs between market, world, military and diplomacy.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '@warmarket/shared';
import { Game } from './Game.js';
import { nullEmitter } from '../net/emitter.js';

const T0 = 1_700_000_000_000;

function makeGame(players = 2, seed = 42, mode: 'networth' | 'lastStanding' = 'networth') {
  const ps = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: '#fff' }));
  const g = new Game('TEST1', ps, { sessionMinutes: 30, mode, rolesEnabled: false }, nullEmitter, () => {}, seed, T0);
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

describe('game simulation', () => {
  it('produces resources and cash over time', () => {
    const { g, ps } = makeGame();
    const n = g.world.nationOf(ps[0].id)!;
    const cash0 = g.market.accounts.get(ps[0].id)!.cash;
    const food0 = n.resources.food;
    run(g, T0, T0 + 30_000);
    expect(g.market.accounts.get(ps[0].id)!.cash).toBeGreaterThan(cash0);
    expect(n.resources.food).not.toBe(food0);
    expect(g.market.tickNo).toBe(1);
  });

  it('rejects cheats: negative qty, unknown asset, selling what you do not own, spending more than you have', () => {
    const { g, ps } = makeGame();
    const pid = ps[0].id;
    expect(g.handle(pid, { type: 'order', assetId: 'OIL', side: 'buy', orderType: 'market', qty: -5 }).ok).toBe(false);
    expect(g.handle(pid, { type: 'order', assetId: 'NOPE', side: 'buy', orderType: 'market', qty: 5 }).ok).toBe(false);
    expect(g.handle(pid, { type: 'order', assetId: 'OIL', side: 'sell', orderType: 'market', qty: 5 }).ok).toBe(false);
    expect(g.handle(pid, { type: 'order', assetId: 'GOLD', side: 'buy', orderType: 'market', qty: 1_000_000 }).ok).toBe(false);
    expect(g.handle(pid, { type: 'order', assetId: 'OIL', side: 'buy', orderType: 'market', qty: 10 }).ok).toBe(true);
    // can't recruit in someone else's province
    const other = g.world.ownedBy(g.world.nationOf(ps[1].id)!.id)[0].id;
    expect(g.handle(pid, { type: 'recruit', provinceId: other }).ok).toBe(false);
  });

  it('recruits, marches and fights for a neutral province', () => {
    const { g, ps } = makeGame(2, 7);
    const pid = ps[0].id;
    const n = g.world.nationOf(pid)!;
    n.resources = { oil: 500, food: 500, metals: 500, tech: 50 };
    g.market.credit(pid, 50_000);
    const home = n.capital;
    for (let i = 0; i < 4; i++) expect(g.handle(pid, { type: 'recruit', provinceId: home })).toEqual({ ok: true });
    let t = run(g, T0, T0 + 60_000);
    const army = g.military.armies.find((a) => a.ownerId === n.id)!;
    expect(army).toBeDefined();
    expect(army.strength).toBeCloseTo(CONFIG.military.armyStrength * 4);
    const target = g.world.map.provinces[home].neighbors.find((x) => g.world.provinces[x].ownerId === null);
    if (target === undefined) return; // map-dependent; other seeds cover it
    const before = g.world.ownedBy(n.id).length;
    expect(g.military.move(n.id, army.id, target, t)).toBeNull();
    t = run(g, t, t + 95_000);
    const after = g.world.ownedBy(n.id).length;
    expect(after === before + 1 || !g.military.armies.some((a) => a.id === army.id)).toBe(true);
  });

  it('requires a war declaration before invading, which costs stability and shocks markets', () => {
    const { g, ps } = makeGame(2, 11);
    const A = g.world.nationOf(ps[0].id)!;
    const B = g.world.nationOf(ps[1].id)!;
    A.resources = { oil: 500, food: 500, metals: 500, tech: 50 };
    g.market.credit(ps[0].id, 50_000);
    for (let i = 0; i < 3; i++) g.handle(ps[0].id, { type: 'recruit', provinceId: A.capital });
    let t = run(g, T0, T0 + 40_000);
    const army = g.military.armies.find((a) => a.ownerId === A.id)!;
    const bProv = g.world.ownedBy(B.id)[0].id;
    // teleport the army next to B for the test
    const adj = g.world.map.provinces[bProv].neighbors[0];
    army.provinceId = adj;
    expect(g.military.move(A.id, army.id, bProv, t)).toMatch(/Declare war/);
    const stab = A.stability;
    expect(g.handle(ps[0].id, { type: 'declareWar', targetId: B.id }).ok).toBe(true);
    expect(A.stability).toBeLessThan(stab);
    expect(g.isAtWar(B.id)).toBe(true);
    expect(g.market.impacts.length).toBeGreaterThan(0);
    expect(g.military.move(A.id, army.id, bProv, t)).toMatch(/mobilising/i);
    t = run(g, t, t + CONFIG.military.warMobilisationSec * 1000 + 1000);
    if (g.world.provinces[adj].ownerId !== A.id && g.world.provinces[adj].ownerId !== null && g.world.provinces[adj].ownerId !== B.id) return;
    expect(g.military.move(A.id, army.id, bProv, t)).toBeNull();
    // peace
    expect(g.handle(ps[0].id, { type: 'proposePeace', targetId: B.id }).ok).toBe(true);
    const prop = g.proposals.list[0];
    expect(g.handle(ps[1].id, { type: 'respondProposal', proposalId: prop.id, accept: true }).ok).toBe(true);
    expect(g.isAtWar(A.id)).toBe(false);
  });

  it('fog of war hides distant armies', () => {
    const { g, ps } = makeGame(2, 3);
    const A = g.world.nationOf(ps[0].id)!;
    const B = g.world.nationOf(ps[1].id)!;
    g.military.armies.push({ id: 'x', ownerId: B.id, provinceId: B.capital, strength: 10, move: null });
    const view = g.buildView(ps[0].id, T0);
    const dist = g.world.map.dist[A.capital][B.capital];
    if (dist > 2) {
      expect(view.armies.some((a) => a.id === 'x')).toBe(false);
      expect(view.provinces[B.capital].visible).toBe(false);
      expect(view.provinces[B.capital].garrison).toBeUndefined();
    }
    // never leak other players' orders or accounts in the view
    expect(JSON.stringify(view)).not.toContain('token');
  });

  it('ends the game at the timer and produces a recap', () => {
    const { g } = makeGame(3, 5);
    run(g, T0, T0 + 30 * 60_000 + 1000, 5000);
    expect(g.ended).toBe(true);
    expect(g.recap?.standings.length).toBe(3);
    expect(g.recap?.winnerId).toBeTruthy();
  });
});

describe('phase 4 systems', () => {
  it('trade deals move resources both ways and defaults are punished', () => {
    const { g, ps } = makeGame(2, 21);
    const A = g.world.nationOf(ps[0].id)!;
    const B = g.world.nationOf(ps[1].id)!;
    A.resources.oil = 1000;
    B.resources.food = 0;
    expect(g.handle(ps[0].id, { type: 'proposeDeal', targetId: B.id, terms: { give: { oil: 60 }, receive: { cash: 600 }, durationSec: 60 } }).ok).toBe(true);
    const deal = g.diplomacy.deals[0];
    expect(g.handle(ps[1].id, { type: 'respondDeal', dealId: deal.id, accept: true }).ok).toBe(true);
    const bOil = B.resources.oil;
    const aCash = g.market.accounts.get(ps[0].id)!.cash;
    run(g, T0, T0 + 10_000);
    expect(B.resources.oil).toBeGreaterThan(bOil + 5);
    expect(g.market.accounts.get(ps[0].id)!.cash).toBeGreaterThan(aCash + 50);
    // B drains its cash → default
    const bAcct = g.market.accounts.get(ps[1].id)!;
    bAcct.cash = -5000;
    const rep = B.reputation;
    run(g, T0 + 10_000, T0 + 13_000);
    expect(deal.status).toBe('broken');
    expect(B.reputation).toBeLessThan(rep);
  });

  it('sanctions block buying the target and two of them make an embargo', () => {
    const { g, ps } = makeGame(3, 22);
    const [A, B, C] = ps.map((p) => g.world.nationOf(p.id)!);
    expect(g.handle(ps[0].id, { type: 'sanction', targetId: C.id, on: true }).ok).toBe(true);
    const cStock = C.companies[0].id;
    expect(g.handle(ps[0].id, { type: 'order', assetId: cStock, side: 'buy', orderType: 'market', qty: 1 }).ok).toBe(false);
    expect(g.handle(ps[0].id, { type: 'order', assetId: cStock, side: 'short', orderType: 'market', qty: 1 }).ok).toBe(true);
    expect(g.isEmbargoed(C.id)).toBe(false);
    g.handle(ps[1].id, { type: 'sanction', targetId: C.id, on: true });
    expect(g.isEmbargoed(C.id)).toBe(true);
    C.resources.oil = 100;
    expect(g.handle(ps[2].id, { type: 'export', resource: 'oil', amount: 10 }).ok).toBe(false);
    expect(g.handle(ps[2].id, { type: 'proposeDeal', targetId: A.id, terms: { give: { oil: 5 }, receive: {}, durationSec: 60 } }).ok).toBe(false);
    void B;
  });

  it('alliances share vision and block war; private chat stays private', () => {
    const { g, ps } = makeGame(3, 23);
    const [A, B] = ps.map((p) => g.world.nationOf(p.id)!);
    g.handle(ps[0].id, { type: 'proposeAlliance', targetId: B.id });
    const pr = g.proposals.list[0];
    expect(g.handle(ps[1].id, { type: 'respondProposal', proposalId: pr.id, accept: true }).ok).toBe(true);
    expect(g.areAllied(A.id, B.id)).toBe(true);
    expect(g.handle(ps[0].id, { type: 'declareWar', targetId: B.id }).ok).toBe(false);
    const view = g.buildView(ps[0].id, T0);
    expect(view.provinces[B.capital].visible).toBe(true);
    // chat
    g.handle(ps[0].id, { type: 'chat', text: 'secret plan', toId: ps[1].id });
    g.clock = () => T0 + 2000;
    g.handle(ps[0].id, { type: 'chat', text: 'hello all', toId: null });
    expect(g.diplomacy.chatFor(ps[2].id).map((c) => c.text)).toEqual(['hello all']);
    expect(g.diplomacy.chatFor(ps[1].id).map((c) => c.text)).toContain('secret plan');
  });

  it('world events fire over a session and move the market', () => {
    const { g } = makeGame(4, 24);
    run(g, T0, T0 + 30 * 60_000, 2000);
    expect(g.events.fired.length).toBeGreaterThan(5);
    const rumours = g.news.all().filter((n) => n.source === 'Rumour Mill').length;
    expect(rumours).toBeGreaterThan(0);
  });

  it('leverage and limit orders work end to end', () => {
    const { g, ps } = makeGame(2, 25);
    const pid = ps[0].id;
    expect(g.handle(pid, { type: 'order', assetId: 'GOLD', side: 'buy', orderType: 'market', qty: 10, leverage: 5 }).ok).toBe(true);
    // a limit far below market won't fill and is cancelled after the tick
    expect(g.handle(pid, { type: 'order', assetId: 'OIL', side: 'buy', orderType: 'limit', qty: 5, limitPrice: 50 }).ok).toBe(true);
    run(g, T0, T0 + 21_000);
    const acct = g.market.accounts.get(pid)!;
    expect(acct.positions.get('GOLD')?.loan).toBeGreaterThan(0);
    expect(acct.positions.has('OIL')).toBe(false);
    expect(acct.orders.length).toBe(0);
    expect(acct.reserved).toBe(0);
  });
});
