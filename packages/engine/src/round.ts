/**
 * Pairing a whole round (C.04.3.A.9, "Round-Pairing Outlook").
 *
 * Brackets are paired from the top scoregroup downwards, each one inheriting the
 * previous one's downfloaters. If at some point the players still to be paired
 * cannot be completed into a legal round, the rules do not backtrack blindly:
 * the last bracket paired becomes the Penultimate Pairing Bracket, everything
 * below it collapses into a single scoregroup, and the PPB is re-paired under
 * C.4 so that its downfloaters plus the collapsed players form a Collapsed Last
 * Bracket that can be finished.
 */

import type {
  BracketReport,
  Colour,
  Pair,
  RoundPairing,
  Tournament,
  UnpairedReason,
} from './types.js';
import { buildStates, type PlayerState } from './state.js';
import { pairingOrder, sortAndNumberBoards } from './order.js';
import { allocateColours } from './colour.js';
import { pairBracket, type BracketResult } from './bracket.js';
import {
  type Candidate,
  pairIsLegal,
  pairingScoreDifference,
} from './criteria.js';
import { maximumMatching } from './util/combinatorics.js';

export interface PairRoundOptions {
  /** Node budget handed to each bracket search. */
  budget?: number;
  /**
   * Apply C.7, the one-bracket lookahead. On by default. Turning it off makes
   * pairing markedly faster on large fields at the cost of occasionally choosing
   * a downfloater set that makes the next bracket harder than it needed to be.
   */
  lookahead?: boolean;
}

export function pairRound(
  tournament: Tournament,
  round: number,
  options: PairRoundOptions = {},
): RoundPairing {
  const { budget, lookahead = true } = options;
  const states = buildStates(tournament, round);

  // Who is actually being paired this round.
  const unpaired: RoundPairing['unpaired'] = [];
  const pool: PlayerState[] = [];

  for (const player of tournament.players) {
    const state = states.get(player.id)!;

    if (state.withdrawn) {
      unpaired.push({ playerId: player.id, reason: 'withdrawn', points: 0 });
      continue;
    }
    if (player.entersAtRound !== undefined && round < player.entersAtRound) {
      // C.04.2.C.2 — a late entrant is simply not paired until they arrive.
      unpaired.push({ playerId: player.id, reason: 'not-yet-entered', points: 0 });
      continue;
    }
    const requested = player.requestedByes?.find((b) => b.round === round);
    if (requested) {
      unpaired.push({
        playerId: player.id,
        reason: requested.points > 0 ? 'half-point-bye' : 'zero-point-bye',
        points: requested.points,
      });
      continue;
    }
    pool.push(state);
  }

  // A.7 — topscorers exist only when pairing the final round.
  const isFinalRound = round === tournament.totalRounds;
  const maxPossible = (round - 1) * tournament.scoring.win;
  const topscorers = new Set<string>();
  if (isFinalRound) {
    for (const p of pool) {
      if (p.score > maxPossible / 2) topscorers.add(p.id);
    }
  }
  const isTopscorer = (id: string) => topscorers.has(id);

  const ordered = pairingOrder(pool);
  const scoregroups = groupByScore(ordered);

  const result = runBrackets(
    scoregroups,
    isTopscorer,
    tournament.initialColour,
    { budget, lookahead },
  );

  // Colour allocation (E) then the publishing sort (C.04.2.D.9).
  const coloured = result.pairs.map(([a, b]) =>
    allocateColours(a, b, tournament.initialColour),
  );
  const pairs: Pair[] = sortAndNumberBoards(
    coloured.map((c) => ({ whiteId: c.whiteId, blackId: c.blackId })),
    states,
  );

  return {
    round,
    pairs,
    pairingAllocatedByeId: result.byeId,
    unpaired,
    brackets: result.reports,
    exhaustive: result.exhaustive,
    complete: result.complete,
  };
}

function groupByScore(ordered: readonly PlayerState[]): PlayerState[][] {
  const groups: PlayerState[][] = [];
  let current: PlayerState[] = [];
  let score: number | null = null;
  for (const p of ordered) {
    if (score === null || p.score === score) {
      current.push(p);
      score = p.score;
    } else {
      groups.push(current);
      current = [p];
      score = p.score;
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

interface RunResult {
  pairs: Array<[PlayerState, PlayerState]>;
  byeId: string | null;
  reports: BracketReport[];
  exhaustive: boolean;
  /** False when even the collapsed route could not finish the round (A.9). */
  complete: boolean;
}

function runBrackets(
  scoregroups: PlayerState[][],
  isTopscorer: (id: string) => boolean,
  initialColour: Colour,
  opts: { budget?: number; lookahead: boolean },
): RunResult {
  const pairs: Array<[PlayerState, PlayerState]> = [];
  const reports: BracketReport[] = [];
  let exhaustive = true;
  let mdps: PlayerState[] = [];

  for (let i = 0; i < scoregroups.length; i++) {
    const residents = scoregroups[i];
    const isLast = i === scoregroups.length - 1;
    const remainingBelow = scoregroups.slice(i + 1).flat();

    const bracket = pairOneBracket({
      mdps,
      residents,
      isLast,
      nextBracket: scoregroups[i + 1] ?? [],
      isTopscorer,
      initialColour,
      opts,
    });

    // A.9 — if what this bracket floats down, together with everyone still
    // waiting, cannot be finished, then *this* bracket is the PPB and every
    // scoregroup below it collapses into one.
    if (
      !isLast &&
      !completionPossible(bracket.downfloaters, remainingBelow, isTopscorer)
    ) {
      const redo = repairAsPpb({
        mdps,
        residents,
        collapsed: remainingBelow,
        isTopscorer,
        initialColour,
        opts,
      });

      pairs.push(...redo.ppb.pairs, ...redo.clb.pairs);
      reports.push(redo.ppbReport, redo.clbReport);
      exhaustive = exhaustive && redo.ppb.exhaustive && redo.clb.exhaustive;
      return {
        pairs,
        byeId: redo.byeId,
        reports,
        exhaustive,
        complete: redo.complete,
      };
    }

    pairs.push(...bracket.pairs);
    reports.push(bracket.report);
    exhaustive = exhaustive && bracket.exhaustive;
    mdps = bracket.downfloaters;
  }

  return {
    pairs,
    byeId: mdps.length === 1 ? mdps[0].id : null,
    reports,
    exhaustive,
    complete: mdps.length <= 1,
  };
}

interface OneBracket {
  pairs: Array<[PlayerState, PlayerState]>;
  downfloaters: PlayerState[];
  report: BracketReport;
  exhaustive: boolean;
}

function pairOneBracket(args: {
  mdps: PlayerState[];
  residents: PlayerState[];
  isLast: boolean;
  nextBracket: PlayerState[];
  isTopscorer: (id: string) => boolean;
  initialColour: Colour;
  opts: { budget?: number; lookahead: boolean };
}): OneBracket {
  const { mdps, residents, isLast, nextBracket, isTopscorer, initialColour, opts } =
    args;

  // C.2 — whoever is left unpaired in the final bracket takes the bye, so in
  // that bracket a candidate is only admissible if its leftover can accept one.
  const candidateFilter = isLast
    ? (c: Candidate) =>
        c.downfloaters.length === 0 ||
        (c.downfloaters.length === 1 && !c.downfloaters[0].hasReceivedByeOrForfeitWin)
    : undefined;

  const lookaheadPenalty =
    opts.lookahead && !isLast && nextBracket.length > 0
      ? makeLookahead(nextBracket, isTopscorer)
      : undefined;

  const result = pairBracket({
    mdps,
    residents,
    isTopscorer,
    initialColour,
    candidateFilter,
    lookaheadPenalty,
    budget: opts.budget,
  });

  return {
    pairs: result.pairs,
    downfloaters: result.downfloaters,
    exhaustive: result.exhaustive,
    report: toReport(result, residents, mdps, false, false),
  };
}

/**
 * C.7 — of the possible downfloater sets, prefer the one that lets the *next*
 * bracket make the most pairs and then the smallest PSD. Only the immediately
 * following bracket is considered, exactly as the rule says.
 *
 * Reported as exactly two numbers, because the bracket search reserves a fixed
 * pair of slots for C.7 in its bound:
 *
 *   [0] how many pairs the next bracket is short of its ceiling
 *   [1] how far the downfloaters have to reach to be paired there
 *
 * Max pairs is exact, by maximum matching over the next bracket's legal-pair
 * graph. The reach term collapses the projected PSD to a single total, which is
 * enough to separate candidates on the only thing C.7 uses it for: preferring
 * downfloaters that land close to the players waiting below.
 *
 * Results are memoised on the downfloater set, since the search reaches the
 * same set through many different orderings of the pairs above it.
 */
function makeLookahead(
  nextBracket: readonly PlayerState[],
  isTopscorer: (id: string) => boolean,
): (candidate: Candidate) => number[] {
  const cache = new Map<string, number[]>();

  return (candidate: Candidate) => {
    const key = candidate.downfloaters
      .map((p) => p.id)
      .sort()
      .join('|');
    const hit = cache.get(key);
    if (hit) return hit;

    const combined = pairingOrder([...candidate.downfloaters, ...nextBracket]);
    let value: number[];
    if (combined.length < 2) {
      value = [0, 0];
    } else {
      const pairsPossible = maximumMatching(combined.length, (i, j) =>
        pairIsLegal(combined[i], combined[j], isTopscorer),
      );
      const ceiling = Math.floor(combined.length / 2);
      const lowest = Math.min(...combined.map((p) => p.score));
      const reach = pairingScoreDifference(
        { pairs: [], downfloaters: candidate.downfloaters },
        lowest,
      ).reduce((a, b) => a + b, 0);
      value = [ceiling - pairsPossible, reach];
    }
    cache.set(key, value);
    return value;
  };
}

/**
 * Could the round still be completed from this point? The remaining players are
 * everyone not yet paired; at most one of them may end up unpaired, and only if
 * they may take the bye.
 */
function completionPossible(
  downfloaters: readonly PlayerState[],
  remaining: readonly PlayerState[],
  isTopscorer: (id: string) => boolean,
): boolean {
  const all = [...downfloaters, ...remaining];
  if (all.length === 0) return true;
  if (all.length === 1) return !all[0].hasReceivedByeOrForfeitWin;

  const legalIn = (players: readonly PlayerState[]) => (i: number, j: number) =>
    pairIsLegal(players[i], players[j], isTopscorer);

  if (all.length % 2 === 0) {
    return maximumMatching(all.length, legalIn(all)) === all.length / 2;
  }

  // An odd field means somebody sits out with the pairing-allocated bye, and
  // C.2 says it cannot be anyone who has had a bye or a forfeit win already.
  //
  // It is not enough to check that a maximum matching exists and that *some*
  // eligible player is present: the one player a maximum matching leaves out
  // may be precisely the one who cannot accept the bye. So the question has to
  // be asked the other way round — is there an eligible player whose removal
  // still leaves everyone else pairable?
  const matched = maximumMatching(all.length, legalIn(all));
  if (matched < Math.floor(all.length / 2)) return false;

  for (let k = all.length - 1; k >= 0; k--) {
    if (all[k].hasReceivedByeOrForfeitWin) continue;
    const rest = all.filter((_, i) => i !== k);
    if (maximumMatching(rest.length, legalIn(rest)) === rest.length / 2) {
      return true;
    }
  }
  return false;
}

/**
 * A.9 — re-pair the Penultimate Pairing Bracket so its downfloaters, together
 * with the collapsed scoregroup, form a Collapsed Last Bracket that completes.
 */
function repairAsPpb(args: {
  mdps: PlayerState[];
  residents: PlayerState[];
  collapsed: PlayerState[];
  isTopscorer: (id: string) => boolean;
  initialColour: Colour;
  opts: { budget?: number; lookahead: boolean };
}): {
  ppb: BracketResult;
  clb: BracketResult;
  ppbReport: BracketReport;
  clbReport: BracketReport;
  byeId: string | null;
  complete: boolean;
} {
  const { mdps, residents, collapsed, isTopscorer, initialColour, opts } = args;

  // C.4 — admit only those PPB candidates whose downfloaters let the round be
  // completed. C.7 does not apply to the PPB, so no lookahead is passed.
  // Checking completion means a matching over everyone still unpaired, which is
  // far too costly to repeat for every candidate. The answer depends only on
  // which players float down, and the search reaches the same set of
  // downfloaters through many different orderings, so memoise on that set.
  const completionCache = new Map<string, boolean>();
  const canComplete = (downfloaters: readonly PlayerState[]): boolean => {
    const key = downfloaters.map((p) => p.id).sort().join('|');
    const hit = completionCache.get(key);
    if (hit !== undefined) return hit;
    const value = completionPossible(downfloaters, collapsed, isTopscorer);
    completionCache.set(key, value);
    return value;
  };

  const ppb = pairBracket({
    mdps,
    residents,
    isTopscorer,
    initialColour,
    budget: opts.budget,
    candidateFilter: (c) => canComplete(c.downfloaters),
  });

  // The Collapsed Last Bracket: the PPB's downfloaters plus every player below.
  const clb = pairBracket({
    mdps: ppb.downfloaters,
    residents: collapsed,
    isTopscorer,
    initialColour,
    budget: opts.budget,
    candidateFilter: (c) =>
      c.downfloaters.length === 0 ||
      (c.downfloaters.length === 1 && !c.downfloaters[0].hasReceivedByeOrForfeitWin),
  });

  return {
    ppb,
    clb,
    ppbReport: toReport(ppb, residents, mdps, true, false),
    clbReport: toReport(clb, collapsed, ppb.downfloaters, false, true),
    byeId: clb.downfloaters.length === 1 ? clb.downfloaters[0].id : null,
    complete: clb.downfloaters.length <= 1,
  };
}

function toReport(
  result: BracketResult,
  residents: readonly PlayerState[],
  mdps: readonly PlayerState[],
  isPpb: boolean,
  isClb: boolean,
): BracketReport {
  const all = pairingOrder([...mdps, ...residents]);
  return {
    score: residents.length ? residents[0].score : 0,
    homogeneous: result.homogeneous,
    m0: result.m0,
    playerIds: all.map((p) => p.id),
    pairs: result.pairs.map(([a, b]) => [a.id, b.id] as [string, string]),
    downfloaterIds: result.downfloaters.map((p) => p.id),
    isPpb,
    isClb,
    candidatesExamined: result.candidatesExamined,
    quality: result.quality,
  };
}
