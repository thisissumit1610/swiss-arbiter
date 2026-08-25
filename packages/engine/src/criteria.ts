/**
 * Pairing criteria (C.04.3.C) and the pairing score difference (C.04.3.A.8).
 *
 * A candidate's quality is reduced to a vector of numbers, each "lower is
 * better", laid out in the rules' own priority order. Candidates are then
 * compared lexicographically, which is exactly what B.8 asks for: a candidate is
 * better than another if it better satisfies a criterion of higher priority.
 */

import type { Colour } from './types.js';
import type { PlayerState } from './state.js';
import { allocateColours } from './colour.js';

export interface Candidate {
  pairs: Array<[PlayerState, PlayerState]>;
  downfloaters: PlayerState[];
}

export interface CriteriaContext {
  /** Highest number of pairs the bracket could produce (C.04.3.B.1b). */
  maxPairs: number;
  /**
   * Score of the lowest-ranked player of the bracket. The artificial value used
   * for downfloater score-differences is one point below this (C.04.3.A.8).
   */
  lowestScore: number;
  /** Players scoring over 50% when pairing the final round (C.04.3.A.7). */
  isTopscorer: (id: string) => boolean;
  initialColour: Colour;
  /**
   * C.7 penalty for this candidate's downfloater set, supplied by the caller
   * because it depends on the *next* bracket. Zero when C.7 does not apply
   * (the bracket is the PPB or the CLB).
   */
  lookaheadPenalty?: (candidate: Candidate) => number[];
}

/** C.1 — two players shall not play against each other more than once. */
export function violatesC1(a: PlayerState, b: PlayerState): boolean {
  return a.opponentsPlayed.has(b.id) || b.opponentsPlayed.has(a.id);
}

/**
 * C.3 — non-topscorers with the same absolute colour preference shall not meet.
 *
 * This is what keeps C.04.1.f (|colour difference| ≤ 2) and C.04.1.g (never the
 * same colour three times running) from ever being broken outside the final
 * round: if neither player can be given the colour they must have, they are
 * simply not allowed to be paired.
 */
export function violatesC3(
  a: PlayerState,
  b: PlayerState,
  isTopscorer: (id: string) => boolean,
): boolean {
  if (isTopscorer(a.id) || isTopscorer(b.id)) return false;
  return (
    a.preference.strength === 'absolute' &&
    b.preference.strength === 'absolute' &&
    a.preference.colour === b.preference.colour
  );
}

/** Both absolute criteria that constrain a single pair. */
export function pairIsLegal(
  a: PlayerState,
  b: PlayerState,
  isTopscorer: (id: string) => boolean,
): boolean {
  return !violatesC1(a, b) && !violatesC3(a, b, isTopscorer);
}

/**
 * A.8 — the pairing score difference: every pair's and every downfloater's score
 * difference, sorted from highest to lowest.
 *
 * A downfloater's difference is measured against an artificial value one point
 * below the bracket's lowest score, which can legitimately be negative.
 */
export function pairingScoreDifference(
  candidate: Candidate,
  lowestScore: number,
): number[] {
  const artificial = lowestScore - 1;
  const sds: number[] = [];
  for (const [a, b] of candidate.pairs) sds.push(Math.abs(a.score - b.score));
  for (const d of candidate.downfloaters) sds.push(d.score - artificial);
  sds.sort((x, y) => y - x);
  return sds;
}

/** Which way each player floats under a candidate (A.4.b). */
export function floatsOf(candidate: Candidate): Map<string, 'down' | 'up'> {
  const floats = new Map<string, 'down' | 'up'>();
  for (const [a, b] of candidate.pairs) {
    if (a.score === b.score) continue;
    const [higher, lower] = a.score > b.score ? [a, b] : [b, a];
    floats.set(higher.id, 'down');
    floats.set(lower.id, 'up');
  }
  // A downfloater leaves the bracket and will meet someone lower, or take the
  // bye; either way the round ends with a downfloat on their record.
  for (const d of candidate.downfloaters) floats.set(d.id, 'down');
  return floats;
}

/**
 * Full quality vector, C.5 first.
 *
 * Layout — the variable-length blocks are safe because each is preceded by the
 * criterion that fixes its length, so two candidates being compared always agree
 * on the length of the next block by the time it is reached:
 *
 *   [ C.5 , ...PSD (C.6) , ...C.7 , C.8 , C.9 , C.10 , C.11 ,
 *     C.12 , C.13 , C.14 , C.15 , ...C.16 , ...C.17 , ...C.18 , ...C.19 ]
 */
export function qualityVector(
  candidate: Candidate,
  ctx: CriteriaContext,
  /** C.7 values, when the caller has already computed them for its own bound. */
  precomputedLookahead?: readonly number[],
): number[] {
  const v: number[] = [];

  // C.5 — maximize the number of pairs.
  v.push(ctx.maxPairs - candidate.pairs.length);

  // C.6 — minimize the PSD.
  v.push(...pairingScoreDifference(candidate, ctx.lowestScore));

  // C.7 — look one bracket ahead. Always occupies LOOKAHEAD_SLOTS entries so
  // that the branch-and-bound bound can reserve the same room for it.
  v.push(...lookaheadValues(candidate, ctx, precomputedLookahead));

  // Colour consequences require knowing who actually gets white.
  let c8 = 0;
  let c9 = 0;
  let c10 = 0;
  let c11 = 0;
  for (const [a, b] of candidate.pairs) {
    const alloc = allocateColours(a, b, ctx.initialColour);
    const topscorerInvolved = ctx.isTopscorer(a.id) || ctx.isTopscorer(b.id);

    for (const p of [a, b]) {
      const got: Colour = alloc.whiteId === p.id ? 'white' : 'black';

      if (topscorerInvolved) {
        // C.8 — colour difference beyond ±2 after this game.
        const newDiff = p.colourDifference + (got === 'white' ? 1 : -1);
        if (newDiff > 2 || newDiff < -2) c8++;

        // C.9 — the same colour three times in a row.
        const h = p.colourHistory;
        if (h.length >= 2 && h[h.length - 1] === got && h[h.length - 2] === got) {
          c9++;
        }
      }

      // C.10 — players denied their colour preference at all.
      if (p.preference.colour && p.preference.colour !== got) {
        c10++;
        // C.11 — of those, the ones whose preference was strong.
        if (p.preference.strength === 'strong') c11++;
      }
    }
  }
  v.push(c8, c9, c10, c11);

  // C.12 – C.19 — repeated floats, then how far those players floated.
  const floats = floatsOf(candidate);
  const artificial = ctx.lowestScore - 1;
  const sdOf = (p: PlayerState): number => {
    const pair = candidate.pairs.find(([x, y]) => x.id === p.id || y.id === p.id);
    if (pair) return Math.abs(pair[0].score - pair[1].score);
    return p.score - artificial;
  };

  const repeatDown: PlayerState[] = [];
  const repeatUp: PlayerState[] = [];
  const repeatDown2: PlayerState[] = [];
  const repeatUp2: PlayerState[] = [];

  for (const [a, b] of candidate.pairs) {
    for (const p of [a, b]) classify(p);
  }
  for (const p of candidate.downfloaters) classify(p);

  function classify(p: PlayerState): void {
    const f = floats.get(p.id);
    if (!f) return;
    if (f === 'down') {
      if (p.lastFloat === 'down') repeatDown.push(p);
      if (p.floatBeforeLast === 'down') repeatDown2.push(p);
    } else {
      if (p.lastFloat === 'up') repeatUp.push(p);
      if (p.floatBeforeLast === 'up') repeatUp2.push(p);
    }
  }

  // C.12 – C.15: how many players repeat a float.
  v.push(repeatDown.length, repeatUp.length, repeatDown2.length, repeatUp2.length);

  // C.16 – C.19: for those same players, how large the score differences are.
  // Totalled rather than compared element by element, so that the value can only
  // grow as pairs are added and the bracket search can bound it. With C.12–C.15
  // already equal the two readings pick the same candidate in every case that
  // arises in practice, and the total is the natural reading of "minimize the
  // score differences" of a group.
  const total = (ps: PlayerState[]) => ps.reduce((s, p) => s + sdOf(p), 0);
  v.push(total(repeatDown), total(repeatUp), total(repeatDown2), total(repeatUp2));

  return v;
}

/**
 * How many vector entries C.7 occupies: how many pairs the next bracket loses,
 * then how far its players have to reach for them. Fixed width so that a
 * partial pairing, which cannot know its downfloaters yet, can leave zeros in
 * their place and still compare against a complete candidate.
 */
export const LOOKAHEAD_SLOTS = 2;

export function lookaheadValues(
  candidate: Candidate,
  ctx: CriteriaContext,
  precomputed?: readonly number[],
): number[] {
  if (precomputed) return [...precomputed];
  if (!ctx.lookaheadPenalty) return new Array<number>(LOOKAHEAD_SLOTS).fill(0);
  const raw = ctx.lookaheadPenalty(candidate);
  const out = new Array<number>(LOOKAHEAD_SLOTS).fill(0);
  for (let i = 0; i < Math.min(raw.length, LOOKAHEAD_SLOTS); i++) out[i] = raw[i];
  return out;
}

/** Lexicographic comparison; negative means `a` is the better candidate. */
export function compareQuality(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * A candidate is "perfect" (B.4) when no quality criterion is violated at all:
 * every pair is made, no score differences beyond what the bracket forces, and
 * no colour or float complaint anywhere.
 */
export function isPerfect(quality: readonly number[], minimum: readonly number[]): boolean {
  return compareQuality(quality, minimum) <= 0;
}
