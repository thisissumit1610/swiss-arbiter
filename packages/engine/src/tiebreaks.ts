/**
 * Tie-breaks, following FIDE C.07 (the revision effective 1 March 2026).
 *
 * The subtle part is not the sums — it is article 16, which decides what an
 * unplayed round is worth. Two different adjustments apply, and confusing them
 * is the classic way to get Buchholz wrong:
 *
 *   16.3  when a player appears as somebody *else's* opponent, their score is
 *         adjusted: rounds they did not play count as the result matching the
 *         points they were awarded, except a requested bye that is followed only
 *         by further voluntary unplayed rounds (or falls in the last round),
 *         which counts as a draw.
 *
 *   16.4  when computing a player's *own* Buchholz or Sonneborn-Berger, each
 *         round they did not play is treated as a game against a dummy, whose
 *         score is capped — by the scheduled opponent's adjusted score after a
 *         forfeit (16.4.1), and by draw-points × rounds otherwise (16.4.2).
 *
 * See docs/TIEBREAKS.md for the worked examples these are checked against.
 */

import type { RoundOutcome, Tournament } from './types.js';

export type TiebreakId =
  | 'buchholz'
  | 'buchholz-cut-1'
  | 'buchholz-cut-2'
  | 'buchholz-median-1'
  | 'sonneborn-berger'
  | 'sonneborn-berger-cut-1'
  | 'direct-encounter'
  | 'wins'
  | 'wins-with-black'
  | 'games-with-black'
  | 'games-played'
  | 'average-rating-of-opponents'
  | 'average-rating-of-opponents-cut-1'
  | 'cumulative'
  | 'cumulative-cut-1'
  | 'rating';

/** A round's contribution to one player's opponent-based tie-breaks. */
interface Contribution {
  round: number;
  /** null when the round was unplayed and stands in for a dummy (16.4). */
  opponentId: string | null;
  /** The opponent's adjusted score, or the dummy's capped score. */
  opponentScore: number;
  /** Points the player themselves scored that round. */
  pointsScored: number;
  played: boolean;
  /** Voluntary unplayed round: a requested bye or a forfeit loss (16.1.2). */
  isVur: boolean;
  /** The opponent's rating, for the rating-based tie-breaks; null if unplayed. */
  opponentRating: number | null;
}

export interface TiebreakContext {
  tournament: Tournament;
  throughRound: number;
  /** Adjusted scores per article 16.3, keyed by player id. */
  adjustedScores: Map<string, number>;
  contributions: Map<string, Contribution[]>;
  scores: Map<string, number>;
}

const isRequestedBye = (k: RoundOutcome['kind']) =>
  k === 'half-point-bye' || k === 'zero-point-bye';

/** 16.1.2 — a round the player was not available for. */
const isVur = (k: RoundOutcome['kind']) =>
  isRequestedBye(k) || k === 'forfeit-loss';

/**
 * Article 16.3 — the score a player contributes when they are somebody else's
 * opponent. Only category 16.2.5 differs from the plain score: a requested bye
 * with nothing but further voluntary unplayed rounds after it, or one in the
 * final round, counts as a draw however many points it was actually worth.
 */
export function adjustedScore(
  outcomes: readonly RoundOutcome[],
  totalRounds: number,
  drawPoints: number,
): number {
  const sorted = [...outcomes].sort((a, b) => a.round - b.round);
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    const o = sorted[i];
    if (o.kind === 'played') {
      total += o.points;
      continue;
    }
    if (isRequestedBye(o.kind)) {
      const isFinalRound = o.round === totalRounds;
      const laterAllVur = sorted
        .slice(i + 1)
        .every((later) => later.kind !== 'played' && isVur(later.kind));
      const noLaterPlayed = sorted
        .slice(i + 1)
        .every((later) => later.kind !== 'played');
      // 16.2.5: nothing but voluntary unplayed rounds follows, or it is last.
      if (isFinalRound || (noLaterPlayed && laterAllVur)) {
        total += drawPoints;
        continue;
      }
    }
    // 16.2.1 – 16.2.4: worth the points that were awarded.
    total += o.points;
  }
  return total;
}

export function buildTiebreakContext(
  tournament: Tournament,
  throughRound: number = tournament.totalRounds,
): TiebreakContext {
  const drawPoints = tournament.scoring.draw;
  const ratings = new Map<string, number>();
  for (const p of tournament.players) ratings.set(p.id, p.rating ?? 0);

  const outcomesOf = (id: string): RoundOutcome[] =>
    (tournament.results[id] ?? [])
      .filter((o) => o.round <= throughRound)
      .sort((a, b) => a.round - b.round);

  const adjustedScores = new Map<string, number>();
  const scores = new Map<string, number>();
  for (const p of tournament.players) {
    const outcomes = outcomesOf(p.id);
    adjustedScores.set(
      p.id,
      adjustedScore(outcomes, tournament.totalRounds, drawPoints),
    );
    scores.set(
      p.id,
      outcomes.reduce((s, o) => s + o.points, 0),
    );
  }

  // 16.4.2 — the general ceiling on a dummy's score.
  const generalCap = drawPoints * tournament.totalRounds;

  const contributions = new Map<string, Contribution[]>();
  for (const p of tournament.players) {
    const list: Contribution[] = [];
    for (const o of outcomesOf(p.id)) {
      if (o.kind === 'played' && o.opponentId) {
        list.push({
          round: o.round,
          opponentId: o.opponentId,
          opponentScore: adjustedScores.get(o.opponentId) ?? 0,
          pointsScored: o.points,
          played: true,
          isVur: false,
          opponentRating: ratings.get(o.opponentId) ?? 0,
        });
        continue;
      }

      // 16.4 — a dummy stands in for the round that was not played.
      const cap =
        (o.kind === 'forfeit-win' || o.kind === 'forfeit-loss') && o.opponentId
          ? (adjustedScores.get(o.opponentId) ?? 0) // 16.4.1
          : generalCap; // 16.4.2
      list.push({
        round: o.round,
        opponentId: null,
        opponentScore: Math.min(o.points, cap),
        pointsScored: o.points,
        played: false,
        isVur: isVur(o.kind),
        opponentRating: null,
      });
    }
    contributions.set(p.id, list);
  }

  return { tournament, throughRound, adjustedScores, contributions, scores };
}

/**
 * Drop `count` values, honouring 16.5: when the player has voluntary unplayed
 * rounds, a VUR's contribution is cut in preference to the plain lowest value,
 * as long as it is not lower than that value.
 */
function cutLowest(
  values: readonly number[],
  vurFlags: readonly boolean[],
  count: number,
): number[] {
  let items = values.map((value, i) => ({ value, vur: vurFlags[i] }));
  for (let c = 0; c < count && items.length > 0; c++) {
    let lowestIdx = 0;
    for (let i = 1; i < items.length; i++) {
      if (items[i].value < items[lowestIdx].value) lowestIdx = i;
    }
    // 16.5.1 — prefer a VUR contribution when it is not below the lowest value.
    let cutIdx = lowestIdx;
    let bestVur = -1;
    for (let i = 0; i < items.length; i++) {
      if (!items[i].vur) continue;
      if (items[i].value < items[lowestIdx].value) continue;
      if (bestVur === -1 || items[i].value < items[bestVur].value) bestVur = i;
    }
    if (bestVur !== -1) cutIdx = bestVur;
    items = items.filter((_, i) => i !== cutIdx);
  }
  return items.map((i) => i.value);
}

function cutHighest(values: readonly number[], count: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.slice(0, Math.max(0, sorted.length - count));
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Article 8.1 — the sum of the opponents' scores. */
export function buchholz(ctx: TiebreakContext, id: string, cut = 0): number {
  const cs = ctx.contributions.get(id) ?? [];
  const values = cs.map((c) => c.opponentScore);
  const flags = cs.map((c) => c.isVur);
  return sum(cut > 0 ? cutLowest(values, flags, cut) : values);
}

/** Article 14.3 — cut the least significant value, then the most significant. */
export function buchholzMedian(ctx: TiebreakContext, id: string, cut = 1): number {
  const cs = ctx.contributions.get(id) ?? [];
  const values = cs.map((c) => c.opponentScore);
  const flags = cs.map((c) => c.isVur);
  return sum(cutHighest(cutLowest(values, flags, cut), cut));
}

/** Article 9.1 — opponents' scores weighted by the points scored against them. */
export function sonnebornBerger(
  ctx: TiebreakContext,
  id: string,
  cut = 0,
): number {
  const cs = ctx.contributions.get(id) ?? [];
  const products = cs.map((c) => c.opponentScore * c.pointsScored);
  if (cut === 0) return sum(products);

  // 14.1.1.d — cut the contribution belonging to the lowest-scoring opponent,
  // then 16.5.1's VUR preference on top of that.
  const flags = cs.map((c) => c.isVur);
  return sum(cutLowest(products, flags, cut));
}

/** Article 7.1 — rounds worth as many points as a win, played or not. */
export function wins(ctx: TiebreakContext, id: string): number {
  const winPoints = ctx.tournament.scoring.win;
  const outcomes = (ctx.tournament.results[id] ?? []).filter(
    (o) => o.round <= ctx.throughRound,
  );
  return outcomes.filter((o) => o.points >= winPoints).length;
}

/** Article 7.3 — games actually played with black. */
export function gamesWithBlack(ctx: TiebreakContext, id: string): number {
  const outcomes = (ctx.tournament.results[id] ?? []).filter(
    (o) => o.round <= ctx.throughRound,
  );
  return outcomes.filter((o) => o.kind === 'played' && o.colour === 'black').length;
}

/** Article 7.4 — games won over the board with black. */
export function winsWithBlack(ctx: TiebreakContext, id: string): number {
  const winPoints = ctx.tournament.scoring.win;
  const outcomes = (ctx.tournament.results[id] ?? []).filter(
    (o) => o.round <= ctx.throughRound,
  );
  return outcomes.filter(
    (o) => o.kind === 'played' && o.colour === 'black' && o.points >= winPoints,
  ).length;
}

export function gamesPlayed(ctx: TiebreakContext, id: string): number {
  const outcomes = (ctx.tournament.results[id] ?? []).filter(
    (o) => o.round <= ctx.throughRound,
  );
  return outcomes.filter((o) => o.kind === 'played').length;
}

/**
 * Article 10.1 — the average rating of opponents faced over the board, rounded
 * to the nearest whole number with .5 going up. Unplayed rounds are excluded
 * entirely (article 15.2), not replaced by a dummy.
 */
export function averageRatingOfOpponents(
  ctx: TiebreakContext,
  id: string,
  cut = 0,
): number {
  const cs = (ctx.contributions.get(id) ?? []).filter((c) => c.played);
  let ratings = cs.map((c) => c.opponentRating ?? 0);
  if (cut > 0) {
    ratings = [...ratings].sort((a, b) => a - b).slice(cut);
  }
  if (ratings.length === 0) return 0;
  return Math.floor(sum(ratings) / ratings.length + 0.5);
}

/**
 * Cumulative (progressive) score: the running total after each round, added up.
 * Not a FIDE type-letter tie-break but very widely used, and asked for by name
 * in most club regulations.
 */
export function cumulative(ctx: TiebreakContext, id: string, cut = 0): number {
  const outcomes = (ctx.tournament.results[id] ?? [])
    .filter((o) => o.round <= ctx.throughRound)
    .sort((a, b) => a.round - b.round);
  let running = 0;
  const totals: number[] = [];
  for (const o of outcomes) {
    running += o.points;
    totals.push(running);
  }
  const total = sum(totals);
  if (cut === 0) return total;
  // Cutting the first `cut` rounds is the usual form of this modifier.
  const deduction = sum(
    outcomes.slice(0, cut).map((o, i) => o.points * (outcomes.length - i)),
  );
  void deduction;
  return sum(totals.slice(cut));
}

/**
 * Article 6 — direct encounter, restricted to a set of tied players.
 *
 * Returns the points scored against the others in `tiedIds`, or null when the
 * tied players have not all met each other, in which case the tie-break does not
 * apply and the caller should fall through to the next one.
 */
export function directEncounter(
  ctx: TiebreakContext,
  id: string,
  tiedIds: readonly string[],
): number | null {
  const others = tiedIds.filter((t) => t !== id);
  if (others.length === 0) return null;

  const cs = (ctx.contributions.get(id) ?? []).filter(
    (c) => c.played && c.opponentId && others.includes(c.opponentId),
  );
  const met = new Set(cs.map((c) => c.opponentId));
  // 6.1 requires a full round-robin among the tied players.
  if (met.size !== others.length) return null;

  // 6.1.2 — repeated meetings count as their average, not as separate games.
  const byOpponent = new Map<string, number[]>();
  for (const c of cs) {
    const list = byOpponent.get(c.opponentId!) ?? [];
    list.push(c.pointsScored);
    byOpponent.set(c.opponentId!, list);
  }
  let total = 0;
  for (const results of byOpponent.values()) {
    total += sum(results) / results.length;
  }
  return total;
}

/** Compute one named tie-break. `tiedIds` is only needed by direct-encounter. */
export function computeTiebreak(
  ctx: TiebreakContext,
  id: string,
  tiebreak: TiebreakId,
  tiedIds: readonly string[] = [],
): number | null {
  switch (tiebreak) {
    case 'buchholz':
      return buchholz(ctx, id, 0);
    case 'buchholz-cut-1':
      return buchholz(ctx, id, 1);
    case 'buchholz-cut-2':
      return buchholz(ctx, id, 2);
    case 'buchholz-median-1':
      return buchholzMedian(ctx, id, 1);
    case 'sonneborn-berger':
      return sonnebornBerger(ctx, id, 0);
    case 'sonneborn-berger-cut-1':
      return sonnebornBerger(ctx, id, 1);
    case 'direct-encounter':
      return directEncounter(ctx, id, tiedIds);
    case 'wins':
      return wins(ctx, id);
    case 'wins-with-black':
      return winsWithBlack(ctx, id);
    case 'games-with-black':
      return gamesWithBlack(ctx, id);
    case 'games-played':
      return gamesPlayed(ctx, id);
    case 'average-rating-of-opponents':
      return averageRatingOfOpponents(ctx, id, 0);
    case 'average-rating-of-opponents-cut-1':
      return averageRatingOfOpponents(ctx, id, 1);
    case 'cumulative':
      return cumulative(ctx, id, 0);
    case 'cumulative-cut-1':
      return cumulative(ctx, id, 1);
    case 'rating':
      return ctx.tournament.players.find((p) => p.id === id)?.rating ?? 0;
  }
}

export const TIEBREAK_LABELS: Record<TiebreakId, string> = {
  buchholz: 'Buchholz',
  'buchholz-cut-1': 'Buchholz Cut-1',
  'buchholz-cut-2': 'Buchholz Cut-2',
  'buchholz-median-1': 'Median Buchholz-1',
  'sonneborn-berger': 'Sonneborn-Berger',
  'sonneborn-berger-cut-1': 'Sonneborn-Berger Cut-1',
  'direct-encounter': 'Direct Encounter',
  wins: 'Number of Wins',
  'wins-with-black': 'Wins with Black',
  'games-with-black': 'Games with Black',
  'games-played': 'Games Played',
  'average-rating-of-opponents': 'Average Rating of Opponents',
  'average-rating-of-opponents-cut-1': 'Average Rating of Opponents Cut-1',
  cumulative: 'Cumulative (Progressive)',
  'cumulative-cut-1': 'Cumulative Cut-1',
  rating: 'Rating',
};
