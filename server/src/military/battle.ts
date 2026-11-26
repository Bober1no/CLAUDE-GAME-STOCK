/**
 * Pure battle resolution.
 *
 * Each side's effective strength = raw strength × modifiers × a random roll in [1-r, 1+r]:
 *   A = attacker · rollA
 *   D = defender · defenceMult · rollD        (defenceMult = terrain + fort bonus)
 * The larger effective side wins (ties go to the defender).
 *
 * Casualties follow Lanchester's square law, which models aimed fire: the winner keeps
 *   W_left = W · sqrt(1 − (L/W)²)
 * of its effective strength, so a 2:1 win costs ~13% while a narrow win nearly wipes you out.
 * We convert back to raw strength by the same fraction, so modifiers never create troops.
 */

export interface BattleInput {
  attacker: number;
  defender: number;
  /** Multiplier on the defender (terrain × fort). 1 for open-field clashes. */
  defenceMult: number;
  /** Max ± swing of the random rolls (e.g. 0.2 → each side ×0.8..1.2). */
  randomness: number;
  /** Uniform [0,1) rolls, passed in so the function stays pure. */
  rollA: number;
  rollD: number;
}

export interface BattleResult {
  attackerWins: boolean;
  attackerLeft: number;
  defenderLeft: number;
  attackerEff: number;
  defenderEff: number;
}

export function resolveBattle(i: BattleInput): BattleResult {
  const atk = Math.max(0, i.attacker);
  const def = Math.max(0, i.defender);
  const r = Math.max(0, Math.min(0.9, i.randomness));
  const rollA = 1 - r + 2 * r * clamp01(i.rollA);
  const rollD = 1 - r + 2 * r * clamp01(i.rollD);
  const A = atk * rollA;
  const D = def * Math.max(0, i.defenceMult) * rollD;

  if (atk <= 0) return { attackerWins: false, attackerLeft: 0, defenderLeft: def, attackerEff: A, defenderEff: D };
  if (def <= 0 || D <= 0) return { attackerWins: true, attackerLeft: atk, defenderLeft: 0, attackerEff: A, defenderEff: D };

  if (A > D) {
    const frac = Math.sqrt(1 - (D / A) ** 2);
    return { attackerWins: true, attackerLeft: atk * frac, defenderLeft: 0, attackerEff: A, defenderEff: D };
  }
  const frac = Math.sqrt(Math.max(0, 1 - (A / D) ** 2));
  return { attackerWins: false, attackerLeft: 0, defenderLeft: def * frac, attackerEff: A, defenderEff: D };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x >= 1 ? 0.999999 : x;
}

/** Travel time between adjacent provinces, clamped to the configured window. */
export function travelMs(baseSec: number, terrainMult: number, seaLane: boolean, minSec: number, maxSec: number): number {
  const s = baseSec * terrainMult * (seaLane ? 1.35 : 1);
  return Math.round(Math.max(minSec, Math.min(maxSec, s)) * 1000);
}

/**
 * Two armies marching opposite ways along the same edge meet when their progress fractions
 * sum to 1 (they've jointly covered the whole edge).
 */
export function haveMet(progressA: number, progressB: number): boolean {
  return progressA + progressB >= 1;
}
