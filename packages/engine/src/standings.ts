/**
 * Standings: rank by score, then apply the configured tie-breaks in order.
 *
 * C.07 art. 4.2 is specific about how the list is applied: a tie-break is only
 * used on the players still tied after the previous one, so the groups get
 * narrower as we go rather than every tie-break being computed against the whole
 * field. Direct encounter in particular is only meaningful inside a tied group,
 * which is why it is resolved group by group here.
 */

import type { Tournament } from './types.js';
import {
  buildTiebreakContext,
  computeTiebreak,
  type TiebreakContext,
  type TiebreakId,
} from './tiebreaks.js';

export interface StandingRow {
  rank: number;
  playerId: string;
  name: string;
  rating?: number;
  title?: string;
  federation?: string;
  score: number;
  /** Tie-break values in the order they were configured. */
  tiebreaks: Array<{ id: TiebreakId; value: number | null }>;
  /** True when this player is still tied with a neighbour after every tie-break. */
  sharedRank: boolean;
}

export interface StandingsOptions {
  tiebreaks?: TiebreakId[];
  throughRound?: number;
}

export const DEFAULT_TIEBREAKS: TiebreakId[] = [
  'buchholz-cut-1',
  'buchholz',
  'sonneborn-berger',
  'direct-encounter',
  'wins',
];

export function computeStandings(
  tournament: Tournament,
  options: StandingsOptions = {},
): StandingRow[] {
  const tiebreaks = options.tiebreaks ?? DEFAULT_TIEBREAKS;
  const throughRound = options.throughRound ?? tournament.totalRounds;
  const ctx = buildTiebreakContext(tournament, throughRound);

  const ids = tournament.players.map((p) => p.id);

  // Group by score first, then refine each group tie-break by tie-break.
  const groups = groupBy(ids, (id) => ctx.scores.get(id) ?? 0);
  groups.sort((a, b) => b.key - a.key);

  const ordered: string[][] = [];
  for (const group of groups) {
    ordered.push(...refine(group.items, tiebreaks, 0, ctx));
  }

  const rows: StandingRow[] = [];
  let rank = 1;
  for (const block of ordered) {
    for (const id of block) {
      const player = tournament.players.find((p) => p.id === id)!;
      rows.push({
        rank,
        playerId: id,
        name: player.name,
        rating: player.rating,
        title: player.title,
        federation: player.federation,
        score: ctx.scores.get(id) ?? 0,
        tiebreaks: tiebreaks.map((tb) => ({
          id: tb,
          value: computeTiebreak(ctx, id, tb, block),
        })),
        sharedRank: block.length > 1,
      });
    }
    rank += block.length;
  }
  return rows;
}

/**
 * Split a still-tied block using tie-break `index`, then recurse into whatever
 * remains tied. Returns blocks in final order; a block with more than one member
 * is a tie that survived every configured tie-break.
 */
function refine(
  items: readonly string[],
  tiebreaks: readonly TiebreakId[],
  index: number,
  ctx: TiebreakContext,
): string[][] {
  if (items.length <= 1 || index >= tiebreaks.length) {
    return [[...items].sort(byPairingNumber(ctx))];
  }

  const tb = tiebreaks[index];
  const values = new Map<string, number | null>();
  for (const id of items) values.set(id, computeTiebreak(ctx, id, tb, items));

  // A tie-break that cannot be applied to this group (direct encounter with an
  // incomplete round-robin) is skipped rather than treated as zero.
  if ([...values.values()].some((v) => v === null)) {
    return refine(items, tiebreaks, index + 1, ctx);
  }

  const groups = groupBy(items, (id) => values.get(id) as number);
  groups.sort((a, b) => b.key - a.key);

  const out: string[][] = [];
  for (const g of groups) {
    out.push(...refine(g.items, tiebreaks, index + 1, ctx));
  }
  return out;
}

function byPairingNumber(ctx: TiebreakContext) {
  const numbers = new Map<string, number>();
  for (const p of ctx.tournament.players) numbers.set(p.id, p.pairingNumber);
  return (a: string, b: string) => (numbers.get(a) ?? 0) - (numbers.get(b) ?? 0);
}

function groupBy<T>(
  items: readonly T[],
  key: (item: T) => number,
): Array<{ key: number; items: T[] }> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return [...map.entries()].map(([k, v]) => ({ key: k, items: v }));
}
