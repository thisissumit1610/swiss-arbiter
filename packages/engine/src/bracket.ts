/**
 * Pairing one bracket (C.04.3.B).
 *
 * The rules describe a strictly ordered sequence of candidate pairings and say:
 * take the first perfect one; failing that, take the best, ties going to
 * whichever was generated first (B.8). Generating that sequence naively is
 * hopeless — a 20-player bracket has 10! orderings of S2 alone — so the search
 * here walks the same sequence but prunes it.
 *
 * The generation order, outermost loop first:
 *
 *   heterogeneous bracket           homogeneous bracket / remainder
 *   ─────────────────────           ───────────────────────────────
 *   D.3  exchange S1 ↔ Limbo        D.2  exchange S1 ↔ S2
 *   D.1  transpose S2               D.1  transpose S2
 *   B.6  pair the remainder
 *
 * Transpositions are enumerated by a depth-first walk that picks the lowest
 * unused BSN first, which is the same thing as ascending lexicographic order.
 * Two things make that walk cheap:
 *
 *   - an absolute criterion (C.1, C.3) kills a whole subtree at the node where
 *     it is first violated, rather than once per completed permutation;
 *   - every criterion from C.5 to C.15 is a count that can only grow as more
 *     pairs are added, so a partial pairing whose counts already lose to the
 *     best candidate found so far cannot be rescued by its remaining pairs and
 *     is abandoned.
 *
 * The second point is what makes this exact rather than approximate: the bound
 * is admissible, so pruning never discards a candidate that would have won.
 */

import type { Colour } from './types.js';
import type { PlayerState } from './state.js';
import { pairingOrder } from './order.js';
import { allocateColours } from './colour.js';
import {
  type Candidate,
  compareQuality,
  lookaheadValues,
  LOOKAHEAD_SLOTS,
  pairIsLegal,
  qualityVector,
  type CriteriaContext,
} from './criteria.js';
import {
  FORBIDDEN,
  maximumMatchingPairs,
  minCostAssignment,
  mdpExchanges,
  residentExchanges,
} from './util/combinatorics.js';

export interface BracketOptions {
  mdps: PlayerState[];
  residents: PlayerState[];
  isTopscorer: (id: string) => boolean;
  initialColour: Colour;
  /** C.7 lookahead; omitted for the PPB and the CLB. */
  lookaheadPenalty?: (candidate: Candidate) => number[];
  /**
   * Hard filter applied before a candidate is scored. Two rules need it:
   *   C.2  the player left over in the last bracket takes the bye, so they must
   *        be eligible for one;
   *   C.4  in the Penultimate Pairing Bracket the downfloaters must be a set
   *        that lets the round-pairing be completed.
   */
  candidateFilter?: (candidate: Candidate) => boolean;
  /** Ceiling on leaf candidates examined before the best-so-far is accepted. */
  budget?: number;
  /**
   * Largest group size considered when swapping players between S1 and S2
   * (D.2/D.3). Exchanges are tried smallest first and the useful ones are
   * always small; the cap stops a pathological bracket from running away.
   */
  maxExchangeSize?: number;
}

export interface BracketResult {
  pairs: Array<[PlayerState, PlayerState]>;
  downfloaters: PlayerState[];
  quality: number[];
  candidatesExamined: number;
  exhaustive: boolean;
  homogeneous: boolean;
  m0: number;
}

const DEFAULT_BUDGET = 120_000;
const DEFAULT_MAX_EXCHANGE = 3;

/** Running totals for the criteria that a partial pairing can already commit to. */
interface Partial {
  /** One count per distinct score-difference, largest difference first (C.6). */
  psd: number[];
  /** How many score-differences have been committed to `psd` so far. */
  entries: number;
  /** C.8 - C.15 as counts, then C.16 - C.19 as score-difference totals. */
  counts: number[];
}

/** C.8, C.9, C.10, C.11, C.12, C.13, C.14, C.15, C.16, C.17, C.18, C.19. */
const COUNT_SLOTS = 12;

export function pairBracket(options: BracketOptions): BracketResult {
  const {
    mdps,
    residents,
    isTopscorer,
    initialColour,
    lookaheadPenalty,
    candidateFilter,
    budget = DEFAULT_BUDGET,
    maxExchangeSize = DEFAULT_MAX_EXCHANGE,
  } = options;

  const all = pairingOrder([...mdps, ...residents]);
  const m0 = mdps.length;
  const homogeneous = all.length > 0 && all.every((p) => p.score === all[0].score);

  if (all.length < 2) {
    return {
      pairs: [],
      downfloaters: all,
      quality: [],
      candidatesExamined: 0,
      exhaustive: true,
      homogeneous,
      m0,
    };
  }

  const lowestScore = Math.min(...all.map((p) => p.score));
  const legal = (a: PlayerState, b: PlayerState) => pairIsLegal(a, b, isTopscorer);

  // The distinct score differences this bracket can produce, largest first, so
  // that "minimise the PSD" becomes "lexicographically minimise these counts".
  const buckets = scoreDifferenceBuckets(all, lowestScore);
  const bucketOf = new Map<number, number>();
  buckets.forEach((v, i) => bucketOf.set(v, i));
  const bucketIndex = (sd: number): number => bucketOf.get(sd) ?? buckets.length - 1;

  const upperBoundPairs = homogeneous
    ? Math.floor(all.length / 2)
    : Math.min(Math.floor(all.length / 2), residents.length);

  const orderedMdps = pairingOrder(mdps);
  const orderedResidents = pairingOrder(residents);

  let examined = 0;
  let budgetExhausted = false;
  // Each pair-count gets its own allowance. Sharing one across all of them lets
  // a hopeless high count starve the lower ones, which is how a bracket ends up
  // pairing nobody at all.
  let levelExamined = 0;

  for (let targetPairs = upperBoundPairs; targetPairs >= 0; targetPairs--) {
    levelExamined = 0;
    const ctx: CriteriaContext = {
      maxPairs: targetPairs,
      lowestScore,
      isTopscorer,
      initialColour,
      lookaheadPenalty,
    };

    let best: Candidate | null = null;
    let bestQuality: number[] | null = null;
    /** The incumbent expressed in the prunable representation. */
    let bestBound: number[] | null = null;

    // Solve the colour side of this bracket by assignment before searching. Two
    // things come out of it: the fewest preferences any pairing here can refuse,
    // which becomes a hard target for the walk; and an actual pairing achieving
    // it, which is kept as a fallback so that a bracket too large to search
    // exhaustively still comes back with a legal, good pairing rather than
    // nothing at all.
    const seed = colourAssignment(all, targetPairs, legal, initialColour);
    let refusalTarget = seed.refusals;
    let fallback: Candidate | null = seed.candidate;
    let fallbackQuality: number[] | null = null;

    // B.4 — the floor this bracket could conceivably reach. A candidate that
    // meets it is "perfect" and is accepted at once, which is what stops the
    // search from grinding through exchanges just to prove nothing better
    // exists.
    let floor = floorQuality(
      targetPairs,
      homogeneous,
      orderedMdps,
      orderedResidents,
      all,
      lowestScore,
      refusalTarget,
    );

    /** The seed expressed the same way partial pairings are, for comparison. */
    let fallbackBound: number[] | null = null;

    const search: Search = {
      legal,
      bucketIndex,
      bucketCount: buckets.length,
      lowestScore,
      initialColour,
      isTopscorer,
      // Each pair contributes one score-difference and each downfloater one more.
      totalEntries: all.length - targetPairs,
      refusalTarget,
      tick() {
        examined++;
        if (++levelExamined < budget) return false;
        budgetExhausted = true;
        return true;
      },
      onLeaf(candidate, partial) {
        examined++;
        if (++levelExamined >= budget) {
          budgetExhausted = true;
          return 'stop';
        }
        if (candidateFilter && !candidateFilter(candidate)) return 'continue';

        const lookahead = lookaheadValues(candidate, ctx);
        const q = qualityVector(candidate, ctx, lookahead);
        if (bestQuality === null || compareQuality(q, bestQuality) < 0) {
          best = candidate;
          bestQuality = q;
          bestBound = boundVector(partial, lookahead, search.totalEntries);
          // B.4 — nothing can beat the floor, so stop looking.
          if (floor && compareQuality(q, floor) <= 0) return 'stop';
        }
        return 'continue';
      },
      shouldPrune(partial, futureColourRefusals = 0) {
        if (partial.counts[2] + futureColourRefusals > search.refusalTarget) {
          return true;
        }
        // Before the walk has produced anything, the seed's quality is still a
        // valid yardstick — but only for discarding partials that are strictly
        // worse. A partial that merely matches it has to be followed, because
        // the candidate it leads to is the one B.8 actually wants: the earliest
        // generated of those achieving that quality.
        const reference = bestBound ?? fallbackBound;
        if (reference === null) return false;
        // Against a real incumbent a tie is enough to prune, since B.8 awards a
        // tie to whichever candidate came first and that is the incumbent.
        // Against the seed it is not: the seed is not part of the rules'
        // ordering, so a partial that matches it must still be followed.
        const slack = bestBound === null ? 1 : 0;
        // Every entry of the bound is a total that placing more pairs can only
        // raise, and the C.7 slots sit at zero, their floor. So no completion of
        // this partial can score below the bound it already carries.
        //
        // Ties are pruned as well as losses: a candidate that only equals the
        // incumbent cannot displace it, because B.8 gives a tie to whichever
        // candidate was generated first and the incumbent always was.
        return (
          compareQuality(
            boundVector(
              partial,
              ZERO_LOOKAHEAD,
              search.totalEntries,
              futureColourRefusals,
            ),
            reference,
          ) >= slack
        );
      },
    };

    if (fallback && candidateFilter && !candidateFilter(fallback)) fallback = null;
    if (fallback === null) {
      // Either the assignment could not pair this split at all, or what it
      // produced was unusable — most often in the final bracket, where whoever
      // is left over has to be able to accept the bye. Look for a legal pairing
      // by matching instead, which is free of the S1/S2 split's constraints.
      fallback = matchingFallback(
        all,
        targetPairs,
        legal,
        candidateFilter ?? (() => true),
      );
    }
    if (fallback) {
      const seedLookahead = lookaheadValues(fallback, ctx);
      fallbackQuality = qualityVector(fallback, ctx, seedLookahead);
      fallbackBound = boundVector(
        partialOf(fallback, search),
        seedLookahead,
        search.totalEntries,
      );
    } else {
      fallback = null;
    }

    // The colour floor is exact for the pairs themselves, but the other criteria
    // can make it unreachable — a pairing that refuses nobody might be barred by
    // C.1, or force a worse PSD. If the search comes back empty, loosen the
    // target a step at a time; `pairsPossible` bounds how far that can go.
    const maxRefusals = 2 * targetPairs;
    while (best === null && !budgetExhausted) {
      if (homogeneous) {
        enumerateHomogeneous(all, targetPairs, search, [], [], maxExchangeSize);
      } else {
        enumerateHeterogeneous(
          orderedMdps,
          orderedResidents,
          targetPairs,
          search,
          maxExchangeSize,
        );
      }
      if (best !== null || refusalTarget >= maxRefusals) break;
      refusalTarget = Math.min(maxRefusals, refusalTarget + 1);
      search.refusalTarget = refusalTarget;
      floor = floorQuality(
        targetPairs,
        homogeneous,
        orderedMdps,
        orderedResidents,
        all,
        lowestScore,
        refusalTarget,
      );
    }

    const winner: Candidate | null = best ?? fallback;
    const winnerQuality = best !== null ? bestQuality : fallbackQuality;
    if (winner !== null) {
      return {
        pairs: winner.pairs,
        downfloaters: winner.downfloaters,
        quality: winnerQuality ?? [],
        candidatesExamined: examined,
        // Provably the best pairing available, either because the walk finished
        // or because what it found already meets the bracket's quality floor and
        // so cannot be beaten.
        exhaustive:
          (!budgetExhausted && best !== null) ||
          (floor !== null &&
            winnerQuality !== null &&
            compareQuality(winnerQuality, floor) <= 0),
        homogeneous,
        m0,
      };
    }
  }

  return {
    pairs: [],
    downfloaters: all,
    quality: [],
    candidatesExamined: examined,
    exhaustive: !budgetExhausted,
    homogeneous,
    m0,
  };
}

const ZERO_LOOKAHEAD: readonly number[] = new Array<number>(LOOKAHEAD_SLOTS).fill(0);

/**
 * Flatten a partial into a vector laid out exactly like the quality vector: the
 * C.5 slot, the PSD as bucket counts, the C.7 slots, then C.8 - C.19.
 *
 * Bucket counts stand in for the sorted PSD list; the two orderings agree as
 * long as the lists being compared hold the same number of values. A partial
 * pairing has not produced all of its score-differences yet, so the ones still
 * missing are credited to the smallest-difference bucket — the best they could
 * possibly turn out to be. That keeps every vector the same total size and
 * keeps the bound optimistic, which is what makes pruning safe.
 */
function boundVector(
  partial: Partial,
  lookahead: readonly number[],
  totalEntries: number,
  /** Colour refusals the pairs still to be placed cannot avoid (C.10). */
  futureColourRefusals = 0,
): number[] {
  const psd = [...partial.psd];
  const missing = totalEntries - partial.entries;
  if (missing > 0 && psd.length > 0) psd[psd.length - 1] += missing;

  const counts = [...partial.counts];
  counts[2] += futureColourRefusals; // C.10
  return [0, ...psd, ...lookahead, ...counts];
}

/**
 * How many colour preferences the pairs still to be placed are *guaranteed* to
 * refuse, however cleverly they are arranged.
 *
 * Every pair hands out exactly one white and one black. So if the players left
 * to pair include more white-wanters than there are pairs left, the surplus has
 * to be refused; likewise for black. Counting only players certain to be paired
 * keeps this a true lower bound, so using it to prune never loses a candidate
 * that would have won.
 *
 * Without this the search can spend its whole budget proving that a pairing it
 * already found cannot be improved on, because the accumulated counts alone say
 * nothing about what the unplaced pairs are forced into.
 */
function futureColourFloor(
  s1: readonly PlayerState[],
  s2: readonly PlayerState[],
  depth: number,
  used: ReadonlySet<number>,
): number {
  const pairsLeft = s1.length - depth;
  if (pairsLeft <= 0) return 0;

  let white = 0;
  let black = 0;
  for (let i = depth; i < s1.length; i++) {
    if (s1[i].preference.colour === 'white') white++;
    else if (s1[i].preference.colour === 'black') black++;
  }

  // Players left in S2 beyond the pairs still to place will downfloat and take
  // no colour, so which of them ends up paired is not yet decided. Only fold S2
  // in when every remaining one of them is certain to be paired.
  const s2Left = s2.length - used.size;
  if (s2Left === pairsLeft) {
    for (let i = 0; i < s2.length; i++) {
      if (used.has(i)) continue;
      if (s2[i].preference.colour === 'white') white++;
      else if (s2[i].preference.colour === 'black') black++;
    }
  }

  return (
    Math.max(0, white - pairsLeft) + Math.max(0, black - pairsLeft)
  );
}

function emptyPartial(bucketCount: number): Partial {
  return {
    psd: new Array<number>(bucketCount).fill(0),
    entries: 0,
    counts: new Array<number>(COUNT_SLOTS).fill(0),
  };
}

function clonePartial(p: Partial): Partial {
  return { psd: [...p.psd], entries: p.entries, counts: [...p.counts] };
}

/**
 * The best quality vector this bracket could possibly achieve.
 *
 * Two parts are worth computing rather than assuming zero:
 *
 *   C.6  the score differences are forced by which players are in the bracket.
 *        In a homogeneous bracket every pair is a zero and every downfloater
 *        reaches one point below the bracket; in a heterogeneous one the
 *        moved-down players have to reach down to the residents, and C.6 wants
 *        the highest-scoring of them paired first.
 *
 *   C.10 supplied by the caller as `colourFloor`, worked out by assignment in
 *        `minimumColourRefusals` rather than guessed at here.
 *
 * Returns null when the floor cannot be pinned down — a bracket whose residents
 * hold several different scores, which only happens in the collapsed last
 * bracket. The search then runs to its budget instead of stopping early.
 */
function floorQuality(
  targetPairs: number,
  homogeneous: boolean,
  mdps: readonly PlayerState[],
  residents: readonly PlayerState[],
  all: readonly PlayerState[],
  lowestScore: number,
  colourFloor: number,
): number[] | null {
  if (residents.length === 0) return null;
  const residentScore = residents[0].score;
  if (!residents.every((r) => r.score === residentScore)) return null;

  const artificial = lowestScore - 1;
  const sds: number[] = [];

  if (homogeneous) {
    for (let i = 0; i < targetPairs; i++) sds.push(0);
    for (let i = 0; i < all.length - 2 * targetPairs; i++) {
      sds.push(residentScore - artificial);
    }
  } else {
    const m1 = Math.min(mdps.length, targetPairs, residents.length);
    for (let i = 0; i < m1; i++) sds.push(Math.abs(mdps[i].score - residentScore));
    for (let i = m1; i < targetPairs; i++) sds.push(0);
    for (let i = m1; i < mdps.length; i++) sds.push(mdps[i].score - artificial);
    const residentsLeft = residents.length - m1 - 2 * (targetPairs - m1);
    for (let i = 0; i < residentsLeft; i++) sds.push(residentScore - artificial);
  }
  sds.sort((a, b) => b - a);

  //     C.5   PSD      C.7   C.8 C.9  C.10          C.11 .. C.19
  return [0, ...sds, 0, 0, 0, 0, colourFloor, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/**
 * The fewest colour preferences a bracket can refuse (C.10).
 *
 * Split the bracket the way B.2 does and ask the assignment problem directly:
 * every S1 player must take an S2 partner, each partner costs however many of
 * the two players it leaves with the wrong colour, and forbidden pairs cost
 * enough to be ruled out. The answer is a genuine lower bound on C.10 for the
 * bracket, and in the overwhelming majority of brackets it is exactly what the
 * best candidate achieves.
 */
function colourAssignment(
  all: readonly PlayerState[],
  targetPairs: number,
  legal: (a: PlayerState, b: PlayerState) => boolean,
  initialColour: Colour,
): { refusals: number; candidate: Candidate | null } {
  if (targetPairs === 0) {
    return { refusals: 0, candidate: { pairs: [], downfloaters: [...all] } };
  }
  const s1 = all.slice(0, targetPairs);
  const s2 = all.slice(targetPairs);
  if (s2.length < s1.length) return { refusals: 0, candidate: null };

  const { total, assignment } = minCostAssignment(s1.length, s2.length, (i, j) => {
    const a = s1[i];
    const b = s2[j];
    if (!legal(a, b)) return FORBIDDEN;
    const alloc = allocateColours(a, b, initialColour);
    let refused = 0;
    for (const p of [a, b]) {
      const got: Colour = alloc.whiteId === p.id ? 'white' : 'black';
      if (p.preference.colour && p.preference.colour !== got) refused++;
    }
    return refused;
  });

  // No legal assignment on this split. Exchanges may still find one, so leave
  // the search unconstrained rather than forcing it to fail.
  if (total >= FORBIDDEN) {
    return { refusals: 2 * targetPairs, candidate: null };
  }

  const taken = new Set<number>();
  const pairs: Array<[PlayerState, PlayerState]> = [];
  for (let i = 0; i < s1.length; i++) {
    const j = assignment[i];
    taken.add(j);
    pairs.push([s1[i], s2[j]]);
  }
  const downfloaters = s2.filter((_, j) => !taken.has(j));
  return { refusals: total, candidate: { pairs, downfloaters } };
}

function scoreDifferenceBuckets(
  players: readonly PlayerState[],
  lowestScore: number,
): number[] {
  const values = new Set<number>();
  for (let i = 0; i < players.length; i++) {
    values.add(players[i].score - (lowestScore - 1));
    for (let j = i + 1; j < players.length; j++) {
      values.add(Math.abs(players[i].score - players[j].score));
    }
  }
  return [...values].sort((a, b) => b - a);
}

type LeafAction = 'continue' | 'stop';

interface Search {
  legal: (a: PlayerState, b: PlayerState) => boolean;
  bucketIndex: (sd: number) => number;
  bucketCount: number;
  lowestScore: number;
  initialColour: Colour;
  isTopscorer: (id: string) => boolean;
  /** Pairs plus downfloaters a complete candidate must produce (A.8). */
  totalEntries: number;
  /**
   * The fewest colour preferences this bracket can refuse (C.10), worked out up
   * front by assignment rather than by search. A partial pairing that has
   * already refused more than this cannot be part of the best candidate, so the
   * whole subtree below it is dropped.
   */
  refusalTarget: number;
  /**
   * Charge one unit of work; true means the budget is spent and the search must
   * unwind. Every node of the walk is charged, not just completed candidates,
   * so the total cost of pairing a bracket is bounded whatever shape it is.
   */
  tick(): boolean;
  onLeaf(candidate: Candidate, partial: Partial): LeafAction;
  shouldPrune(partial: Partial, futureColourRefusals?: number): boolean;
}

/**
 * A legal pairing of the bracket found by maximum matching rather than by
 * walking candidates, used when the assignment seed cannot be accepted.
 *
 * The point is the final bracket. Exactly one player is left unpaired there and
 * takes the pairing-allocated bye, and C.2 forbids giving it to anyone who has
 * had one already. So each eligible player is tried as the bye in turn, lowest
 * ranked first — which is both the traditional choice and the one that disturbs
 * the standings least — keeping the first whose removal leaves a set that can
 * still be paired in full.
 */
function matchingFallback(
  all: readonly PlayerState[],
  targetPairs: number,
  legal: (a: PlayerState, b: PlayerState) => boolean,
  candidateFilter: (c: Candidate) => boolean,
): Candidate | null {
  const build = (players: readonly PlayerState[], floats: PlayerState[]) => {
    const matched = maximumMatchingPairs(players.length, (i, j) =>
      legal(players[i], players[j]),
    );
    if (matched.length !== targetPairs) return null;
    const paired = new Set<number>();
    for (const [i, j] of matched) {
      paired.add(i);
      paired.add(j);
    }
    return {
      pairs: matched.map(
        ([i, j]) => [players[i], players[j]] as [PlayerState, PlayerState],
      ),
      downfloaters: [...floats, ...players.filter((_, i) => !paired.has(i))],
    };
  };

  const whole = build(all, []);
  if (whole && candidateFilter(whole)) return whole;

  // Try each player as the one left over, lowest ranked first.
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].hasReceivedByeOrForfeitWin) continue;
    const rest = all.filter((_, k) => k !== i);
    const candidate = build(rest, [all[i]]);
    if (candidate && candidateFilter(candidate)) return candidate;
  }
  return null;
}

/** Express a finished candidate in the same running totals a partial carries. */
function partialOf(candidate: Candidate, search: Search): Partial {
  let partial = emptyPartial(search.bucketCount);
  for (const [a, b] of candidate.pairs) partial = addPair(partial, a, b, search);
  return addDownfloaters(partial, candidate.downfloaters, search);
}

/**
 * What one pair adds to the running totals: its score difference, the colour
 * complaints it causes (C.8 – C.11) and the float repeats it causes (C.12 – C.15).
 */
function addPair(
  partial: Partial,
  a: PlayerState,
  b: PlayerState,
  search: Search,
): Partial {
  const next = clonePartial(partial);
  next.psd[search.bucketIndex(Math.abs(a.score - b.score))]++;
  next.entries++;

  const alloc = allocateColours(a, b, search.initialColour);
  const topscorerInvolved = search.isTopscorer(a.id) || search.isTopscorer(b.id);

  for (const p of [a, b]) {
    const got: Colour = alloc.whiteId === p.id ? 'white' : 'black';
    if (topscorerInvolved) {
      const newDiff = p.colourDifference + (got === 'white' ? 1 : -1);
      if (newDiff > 2 || newDiff < -2) next.counts[0]++; // C.8
      const h = p.colourHistory;
      if (h.length >= 2 && h[h.length - 1] === got && h[h.length - 2] === got) {
        next.counts[1]++; // C.9
      }
    }
    if (p.preference.colour && p.preference.colour !== got) {
      next.counts[2]++; // C.10
      if (p.preference.strength === 'strong') next.counts[3]++; // C.11
    }
  }

  // A.4.b — when the scores differ, the higher player has downfloated and the
  // lower has upfloated. The score difference each of them carries is the
  // pair's own difference, which is what C.16 - C.19 total up.
  if (a.score !== b.score) {
    const [higher, lower] = a.score > b.score ? [a, b] : [b, a];
    const sd = Math.abs(a.score - b.score);
    if (higher.lastFloat === 'down') {
      next.counts[4]++; // C.12
      next.counts[8] += sd; // C.16
    }
    if (lower.lastFloat === 'up') {
      next.counts[5]++; // C.13
      next.counts[9] += sd; // C.17
    }
    if (higher.floatBeforeLast === 'down') {
      next.counts[6]++; // C.14
      next.counts[10] += sd; // C.18
    }
    if (lower.floatBeforeLast === 'up') {
      next.counts[7]++; // C.15
      next.counts[11] += sd; // C.19
    }
  }
  return next;
}

/** What a set of downfloaters adds once the pairing is settled. */
function addDownfloaters(
  partial: Partial,
  downfloaters: readonly PlayerState[],
  search: Search,
): Partial {
  const next = clonePartial(partial);
  for (const d of downfloaters) {
    const sd = d.score - (search.lowestScore - 1);
    next.psd[search.bucketIndex(sd)]++;
    next.entries++;
    if (d.lastFloat === 'down') {
      next.counts[4]++; // C.12
      next.counts[8] += sd; // C.16
    }
    if (d.floatBeforeLast === 'down') {
      next.counts[6]++; // C.14
      next.counts[10] += sd; // C.18
    }
  }
  return next;
}

/**
 * B.6 — a homogeneous bracket, or the remainder of a heterogeneous one.
 *
 * S1 takes the top `k` players and S2 the rest; S1[i] meets S2[i] after the
 * transposition. Returns true when the search asked to stop.
 */
function enumerateHomogeneous(
  players: readonly PlayerState[],
  k: number,
  search: Search,
  carriedDownfloaters: readonly PlayerState[],
  carriedPairs: ReadonlyArray<[PlayerState, PlayerState]>,
  maxExchangeSize: number,
  carriedPartial?: Partial,
): boolean {
  const base = carriedPartial ?? emptyPartial(search.bucketCount);

  if (k === 0) {
    const downfloaters = [...carriedDownfloaters, ...players];
    const partial = addDownfloaters(base, downfloaters, search);
    return (
      search.onLeaf({ pairs: [...carriedPairs], downfloaters }, partial) === 'stop'
    );
  }
  if (players.length < 2 * k) return false;

  const s1 = players.slice(0, k);
  const s2 = players.slice(k);
  const s1Bsn = s1.map((_, i) => i + 1);
  const s2Bsn = s2.map((_, i) => k + i + 1);

  // D.2 — the identity exchange first, then swaps of growing size.
  for (const ex of residentExchanges(s1Bsn, s2Bsn, maxExchangeSize)) {
    // No exchange can improve on what we already hold: every one of them starts
    // from this same base and can only add to it. Checking here also stops the
    // generator before it builds its next batch of exchanges.
    if (search.shouldPrune(base)) return false;
    if (search.tick()) return true;

    const movedOut = new Set(ex.fromS1);
    const movedIn = new Set(ex.fromS2);
    const newS1 = pairingOrder([
      ...s1.filter((_, i) => !movedOut.has(i)),
      ...ex.fromS2.map((i) => s2[i]),
    ]);
    const newS2 = pairingOrder([
      ...s2.filter((_, i) => !movedIn.has(i)),
      ...ex.fromS1.map((i) => s1[i]),
    ]);

    if (
      assign(
        newS1,
        newS2,
        0,
        new Set(),
        search,
        carriedDownfloaters,
        carriedPairs,
        [],
        base,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * D.1 as a pruned depth-first walk: fill S1 position `depth` with the
 * lowest-BSN legal S2 player not yet used, then recurse.
 */
function assign(
  s1: readonly PlayerState[],
  s2: readonly PlayerState[],
  depth: number,
  used: Set<number>,
  search: Search,
  carriedDownfloaters: readonly PlayerState[],
  carriedPairs: ReadonlyArray<[PlayerState, PlayerState]>,
  built: ReadonlyArray<[PlayerState, PlayerState]>,
  partial: Partial,
): boolean {
  if (depth === s1.length) {
    const leftovers = s2.filter((_, i) => !used.has(i));
    const downfloaters = [...carriedDownfloaters, ...leftovers];
    const finalPartial = addDownfloaters(partial, downfloaters, search);
    return (
      search.onLeaf(
        { pairs: [...carriedPairs, ...built], downfloaters },
        finalPartial,
      ) === 'stop'
    );
  }

  if (search.shouldPrune(partial, futureColourFloor(s1, s2, depth, used))) {
    return false;
  }
  if (search.tick()) return true;

  for (let i = 0; i < s2.length; i++) {
    if (used.has(i)) continue;
    if (!search.legal(s1[depth], s2[i])) continue;

    const nextPartial = addPair(partial, s1[depth], s2[i], search);
    used.add(i);
    if (search.shouldPrune(nextPartial, futureColourFloor(s1, s2, depth + 1, used))) {
      used.delete(i);
      continue;
    }

    const stop = assign(
      s1,
      s2,
      depth + 1,
      used,
      search,
      carriedDownfloaters,
      carriedPairs,
      [...built, [s1[depth], s2[i]]],
      nextPartial,
    );
    used.delete(i);
    if (stop) return true;
  }
  return false;
}

/**
 * B.7 — a heterogeneous bracket. S1 holds the top `m1` moved-down players, any
 * further MDPs sit in the Limbo and are bound to float again, and S2 holds the
 * residents. Whatever residents survive the MDP-pairing form the remainder.
 *
 * `m1` counts down from as many paired MDPs as possible, because C.6 prefers
 * pairing more moved-down players and the highest-scoring ones first.
 */
function enumerateHeterogeneous(
  mdps: readonly PlayerState[],
  residents: readonly PlayerState[],
  targetPairs: number,
  search: Search,
  maxExchangeSize: number,
): boolean {
  const maxM1 = Math.min(mdps.length, targetPairs, residents.length);

  for (let m1 = maxM1; m1 >= 0; m1--) {
    if (search.shouldPrune(emptyPartial(search.bucketCount))) return false;

    const remainderPairs = targetPairs - m1;
    if (remainderPairs < 0) continue;
    if (residents.length - m1 < 2 * remainderPairs) continue;

    if (m1 === 0) {
      // Every MDP is in the Limbo, so the bracket reduces to its remainder.
      if (
        enumerateHomogeneous(
          residents,
          remainderPairs,
          search,
          mdps,
          [],
          maxExchangeSize,
        )
      ) {
        return true;
      }
      continue;
    }

    const mdpBsn = mdps.map((_, i) => i + 1);
    const s1Slots = mdpBsn.slice(0, m1);
    const limboSlots = mdpBsn.slice(m1);
    const scoreOfBsn = (bsn: number) => mdps[bsn - 1].score;

    // D.3 — which MDPs sit in S1 rather than the Limbo.
    for (const ex of mdpExchanges(s1Slots, limboSlots, scoreOfBsn, maxExchangeSize)) {
      if (search.shouldPrune(emptyPartial(search.bucketCount))) return false;
      if (search.tick()) return true;

      const outIdx = new Set(ex.fromS1.map((i) => s1Slots[i] - 1));
      const inIdx = new Set(ex.fromS2.map((i) => limboSlots[i] - 1));
      const s1 = pairingOrder(
        mdps.filter((_, i) => (i < m1 && !outIdx.has(i)) || inIdx.has(i)),
      );
      const inS1 = new Set(s1.map((p) => p.id));
      const limbo = mdps.filter((p) => !inS1.has(p.id));

      if (
        assignMdps(
          s1,
          residents,
          0,
          new Set(),
          remainderPairs,
          search,
          limbo,
          [],
          emptyPartial(search.bucketCount),
          maxExchangeSize,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

/** The MDP-pairing, which hands its leftover residents on as the remainder. */
function assignMdps(
  s1: readonly PlayerState[],
  s2: readonly PlayerState[],
  depth: number,
  used: Set<number>,
  remainderPairs: number,
  search: Search,
  limbo: readonly PlayerState[],
  built: ReadonlyArray<[PlayerState, PlayerState]>,
  partial: Partial,
  maxExchangeSize: number,
): boolean {
  if (depth === s1.length) {
    const remainder = s2.filter((_, i) => !used.has(i));
    return enumerateHomogeneous(
      remainder,
      remainderPairs,
      search,
      limbo,
      built,
      maxExchangeSize,
      partial,
    );
  }

  if (search.shouldPrune(partial)) return false;
  if (search.tick()) return true;

  for (let i = 0; i < s2.length; i++) {
    if (used.has(i)) continue;
    if (!search.legal(s1[depth], s2[i])) continue;

    const nextPartial = addPair(partial, s1[depth], s2[i], search);
    used.add(i);
    if (search.shouldPrune(nextPartial)) {
      used.delete(i);
      continue;
    }

    const stop = assignMdps(
      s1,
      s2,
      depth + 1,
      used,
      remainderPairs,
      search,
      limbo,
      [...built, [s1[depth], s2[i]]],
      nextPartial,
      maxExchangeSize,
    );
    used.delete(i);
    if (stop) return true;
  }
  return false;
}
