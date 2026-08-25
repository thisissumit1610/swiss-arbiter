/**
 * Ordering rules.
 *
 *   C.04.2.B   initial ranking list and pairing numbers
 *   C.04.3.A.2 pairing order: score, then pairing number
 *   C.04.2.D.9 the sort applied to pairs before they are published
 */

import type { Player, Pair } from './types.js';
import { TITLE_ORDER } from './types.js';
import type { PlayerState } from './state.js';

function titleRank(p: Player): number {
  if (!p.title) return TITLE_ORDER.length;
  const i = TITLE_ORDER.indexOf(p.title);
  return i === -1 ? TITLE_ORDER.length : i;
}

/**
 * Order players for the initial ranking list (C.04.2.B.2), highest first:
 *   a) rating, descending
 *   b) FIDE title, GM first
 *   c) alphabetically by name
 *
 * The ranking then fixes the pairing numbers: the top player gets #1 (C.04.2.B.3).
 */
export function initialRankingOrder(players: readonly Player[]): Player[] {
  return [...players].sort((a, b) => {
    const ra = a.rating ?? 0;
    const rb = b.rating ?? 0;
    if (ra !== rb) return rb - ra;
    const ta = titleRank(a);
    const tb = titleRank(b);
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name, 'en');
  });
}

/** Assign pairing numbers 1..n from the initial ranking list (C.04.2.B.3). */
export function assignPairingNumbers(players: readonly Player[]): Player[] {
  return initialRankingOrder(players).map((p, i) => ({
    ...p,
    pairingNumber: i + 1,
  }));
}

/**
 * The pairing order (C.04.3.A.2): score first, then pairing number.
 * "Higher ranked" throughout the Dutch rules means earlier in this order.
 */
export function pairingOrder(states: readonly PlayerState[]): PlayerState[] {
  return [...states].sort(comparePairingOrder);
}

export function comparePairingOrder(a: PlayerState, b: PlayerState): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.pairingNumber - b.pairingNumber;
}

/**
 * Sort pairs for publication and number the boards (C.04.2.D.9), by descending:
 *   a) the score of the higher-ranked player of the pair
 *   b) the sum of both players' scores
 *   c) the initial-order rank of the higher-ranked player  (ascending)
 */
export function sortAndNumberBoards(
  pairs: ReadonlyArray<{ whiteId: string; blackId: string }>,
  states: Map<string, PlayerState>,
): Pair[] {
  const keyed = pairs.map((p) => {
    const w = states.get(p.whiteId)!;
    const b = states.get(p.blackId)!;
    // "Higher ranked" of the two, per C.04.3.A.2.
    const higher = comparePairingOrder(w, b) <= 0 ? w : b;
    return {
      pair: p,
      higherScore: higher.score,
      sumScore: w.score + b.score,
      higherRank: higher.pairingNumber,
    };
  });

  keyed.sort((x, y) => {
    if (x.higherScore !== y.higherScore) return y.higherScore - x.higherScore;
    if (x.sumScore !== y.sumScore) return y.sumScore - x.sumScore;
    return x.higherRank - y.higherRank;
  });

  return keyed.map((k, i) => ({
    board: i + 1,
    whiteId: k.pair.whiteId,
    blackId: k.pair.blackId,
  }));
}
