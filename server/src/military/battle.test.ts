import { describe, expect, it } from 'vitest';
import { haveMet, resolveBattle, travelMs } from './battle.js';

const even = { randomness: 0, rollA: 0.5, rollD: 0.5 };

describe('resolveBattle', () => {
  it('stronger attacker wins and loses troops per the square law', () => {
    const r = resolveBattle({ attacker: 20, defender: 10, defenceMult: 1, ...even });
    expect(r.attackerWins).toBe(true);
    expect(r.defenderLeft).toBe(0);
    expect(r.attackerLeft).toBeCloseTo(20 * Math.sqrt(1 - 0.25));
  });

  it('terrain/fort multiplier can flip the result', () => {
    expect(resolveBattle({ attacker: 15, defender: 10, defenceMult: 1, ...even }).attackerWins).toBe(true);
    expect(resolveBattle({ attacker: 15, defender: 10, defenceMult: 1.6, ...even }).attackerWins).toBe(false);
  });

  it('ties go to the defender', () => {
    const r = resolveBattle({ attacker: 10, defender: 10, defenceMult: 1, ...even });
    expect(r.attackerWins).toBe(false);
    expect(r.attackerLeft).toBe(0);
  });

  it('undefended land falls without losses', () => {
    const r = resolveBattle({ attacker: 10, defender: 0, defenceMult: 2, ...even });
    expect(r.attackerWins).toBe(true);
    expect(r.attackerLeft).toBe(10);
  });

  it('randomness is bounded by the roll range', () => {
    // 11 vs 10 with ±20%: attacker can lose with a bad roll and win with a good one.
    const lucky = resolveBattle({ attacker: 11, defender: 10, defenceMult: 1, randomness: 0.2, rollA: 0.99, rollD: 0 });
    const unlucky = resolveBattle({ attacker: 11, defender: 10, defenceMult: 1, randomness: 0.2, rollA: 0, rollD: 0.99 });
    expect(lucky.attackerWins).toBe(true);
    expect(unlucky.attackerWins).toBe(false);
    // but 3:1 always wins
    expect(resolveBattle({ attacker: 30, defender: 10, defenceMult: 1, randomness: 0.2, rollA: 0, rollD: 0.999 }).attackerWins).toBe(true);
  });

  it('never creates troops and is pure', () => {
    for (let i = 0; i < 200; i++) {
      const inp = { attacker: (i * 7) % 50, defender: (i * 13) % 40, defenceMult: 1 + (i % 5) / 4, randomness: 0.2, rollA: (i * 0.37) % 1, rollD: (i * 0.61) % 1 };
      const r = resolveBattle(inp);
      expect(r.attackerLeft).toBeLessThanOrEqual(inp.attacker + 1e-9);
      expect(r.defenderLeft).toBeLessThanOrEqual(inp.defender + 1e-9);
      expect(r.attackerLeft === 0 || r.defenderLeft === 0).toBe(true);
      expect(resolveBattle(inp)).toEqual(r);
    }
  });
});

describe('movement helpers', () => {
  it('travel time is clamped and terrain/sea lanes slow you down', () => {
    expect(travelMs(32, 1, false, 30, 90)).toBe(32_000);
    expect(travelMs(32, 1.8, false, 30, 90)).toBeGreaterThan(travelMs(32, 1, false, 30, 90));
    expect(travelMs(32, 1, true, 30, 90)).toBeGreaterThan(32_000);
    expect(travelMs(10, 1, false, 30, 90)).toBe(30_000);
    expect(travelMs(100, 2, true, 30, 90)).toBe(90_000);
  });
  it('armies meet when combined progress covers the edge', () => {
    expect(haveMet(0.5, 0.5)).toBe(true);
    expect(haveMet(0.3, 0.4)).toBe(false);
  });
});
