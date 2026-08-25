/**
 * Tie-breaks under FIDE C.07 (effective 1 March 2026).
 *
 * The arithmetic is easy; what these pin down is article 16 — how a round that
 * was never played counts, both for the player who missed it and for everyone
 * who has them as an opponent.
 */

import { describe, expect, it } from 'vitest';
import {
  adjustedScore,
  buildTiebreakContext,
  buchholz,
  computeStandings,
  CLASSICAL_SCORING,
  directEncounter,
  sonnebornBerger,
  wins,
  type RoundOutcome,
  type Tournament,
} from '../src/index.js';

function played(
  round: number,
  opponentId: string,
  colour: 'white' | 'black',
  points: number,
): RoundOutcome {
  return { round, kind: 'played', opponentId, colour, points };
}

function build(
  results: Record<string, RoundOutcome[]>,
  totalRounds = 3,
): Tournament {
  const ids = Object.keys(results);
  return {
    id: 't',
    name: 'test',
    totalRounds,
    players: ids.map((id, i) => ({
      id,
      name: id.toUpperCase(),
      rating: 2000 - i * 100,
      pairingNumber: i + 1,
    })),
    results,
    scoring: CLASSICAL_SCORING,
    initialColour: 'white',
    roundsPaired: totalRounds,
    createdAt: '',
    updatedAt: '',
  };
}

describe('adjusted score (article 16.3)', () => {
  it('leaves a fully played record alone', () => {
    const outcomes = [
      played(1, 'x', 'white', 1),
      played(2, 'y', 'black', 0.5),
      played(3, 'z', 'white', 0),
    ];
    expect(adjustedScore(outcomes, 3, 0.5)).toBe(1.5);
  });

  it('counts a pairing-allocated bye at the points awarded', () => {
    const outcomes: RoundOutcome[] = [
      { round: 1, kind: 'pairing-allocated-bye', opponentId: null, colour: null, points: 1 },
      played(2, 'y', 'black', 0),
      played(3, 'z', 'white', 1),
    ];
    expect(adjustedScore(outcomes, 3, 0.5)).toBe(2);
  });

  it('counts a forfeit loss as a loss, not as a missing game', () => {
    const outcomes: RoundOutcome[] = [
      played(1, 'x', 'white', 1),
      { round: 2, kind: 'forfeit-loss', opponentId: 'y', colour: null, points: 0 },
      played(3, 'z', 'white', 1),
    ];
    expect(adjustedScore(outcomes, 3, 0.5)).toBe(2);
  });

  it('16.2.5 — a requested bye in the final round counts as a draw', () => {
    const outcomes: RoundOutcome[] = [
      played(1, 'x', 'white', 1),
      played(2, 'y', 'black', 1),
      { round: 3, kind: 'zero-point-bye', opponentId: null, colour: null, points: 0 },
    ];
    // The player scored 2, but as somebody else's opponent they count as 2.5.
    expect(outcomes.reduce((s, o) => s + o.points, 0)).toBe(2);
    expect(adjustedScore(outcomes, 3, 0.5)).toBe(2.5);
  });

  it('16.2.5 — a requested bye with only unplayed rounds after it counts as a draw', () => {
    const outcomes: RoundOutcome[] = [
      played(1, 'x', 'white', 1),
      { round: 2, kind: 'zero-point-bye', opponentId: null, colour: null, points: 0 },
      { round: 3, kind: 'forfeit-loss', opponentId: 'z', colour: null, points: 0 },
    ];
    expect(adjustedScore(outcomes, 3, 0.5)).toBe(1.5);
  });

  it('16.2.3 — a requested bye followed by a played round counts at face value', () => {
    const outcomes: RoundOutcome[] = [
      played(1, 'x', 'white', 1),
      { round: 2, kind: 'zero-point-bye', opponentId: null, colour: null, points: 0 },
      played(3, 'z', 'white', 1),
    ];
    expect(adjustedScore(outcomes, 3, 0.5)).toBe(2);
  });
});

describe('Buchholz and Sonneborn-Berger', () => {
  // a beat b, drew with c, lost to d.
  const tournament = build({
    a: [played(1, 'b', 'white', 1), played(2, 'c', 'black', 0.5), played(3, 'd', 'white', 0)],
    b: [played(1, 'a', 'black', 0), played(2, 'd', 'white', 1), played(3, 'c', 'black', 1)],
    c: [played(1, 'd', 'white', 0.5), played(2, 'a', 'white', 0.5), played(3, 'b', 'white', 0)],
    d: [played(1, 'c', 'black', 0.5), played(2, 'b', 'black', 0), played(3, 'a', 'black', 1)],
  });

  it('sums the opponents’ scores', () => {
    const ctx = buildTiebreakContext(tournament);
    // b scored 2, c scored 1, d scored 1.5.
    expect(ctx.scores.get('b')).toBe(2);
    expect(ctx.scores.get('c')).toBe(1);
    expect(ctx.scores.get('d')).toBe(1.5);
    expect(buchholz(ctx, 'a')).toBe(4.5);
  });

  it('drops the lowest opponent for Cut-1', () => {
    const ctx = buildTiebreakContext(tournament);
    expect(buchholz(ctx, 'a', 1)).toBe(3.5); // 2 + 1.5, dropping c's 1
  });

  it('weights each opponent by what was scored against them', () => {
    const ctx = buildTiebreakContext(tournament);
    // beat b (2 x 1) + drew c (1 x 0.5) + lost to d (1.5 x 0)
    expect(sonnebornBerger(ctx, 'a')).toBe(2.5);
  });

  it('counts an unplayed round through a capped stand-in (article 16.4)', () => {
    const withBye = build({
      a: [
        { round: 1, kind: 'pairing-allocated-bye', opponentId: null, colour: null, points: 1 },
        played(2, 'b', 'black', 1),
        played(3, 'c', 'white', 1),
      ],
      b: [played(1, 'c', 'white', 1), played(2, 'a', 'white', 0), played(3, 'c', 'black', 0)],
      c: [played(1, 'b', 'black', 0), played(3, 'a', 'black', 0), played(3, 'b', 'white', 1)],
    });
    const ctx = buildTiebreakContext(withBye);
    // The bye contributes the points it was worth, capped by draw x rounds.
    // b finished on 1 and c on 1, so Buchholz is 1 (bye) + 1 + 1.
    expect(buchholz(ctx, 'a')).toBe(3);
  });
});

describe('direct encounter (article 6)', () => {
  const tournament = build({
    a: [played(1, 'b', 'white', 1), played(2, 'c', 'black', 1), played(3, 'd', 'white', 0)],
    b: [played(1, 'a', 'black', 0), played(2, 'd', 'white', 1), played(3, 'c', 'black', 1)],
    c: [played(1, 'd', 'white', 1), played(2, 'a', 'white', 0), played(3, 'b', 'white', 0)],
    d: [played(1, 'c', 'black', 0), played(2, 'b', 'black', 0), played(3, 'a', 'black', 1)],
  });

  it('scores only the games between the tied players', () => {
    const ctx = buildTiebreakContext(tournament);
    expect(directEncounter(ctx, 'a', ['a', 'b'])).toBe(1);
    expect(directEncounter(ctx, 'b', ['a', 'b'])).toBe(0);
  });

  it('does not apply when the tied players have not all met', () => {
    const ctx = buildTiebreakContext(tournament);
    // a never played... every pair met here, so use a player outside the group.
    const partial = build({
      a: [played(1, 'b', 'white', 1)],
      b: [played(1, 'a', 'black', 0)],
      c: [],
    });
    const ctx2 = buildTiebreakContext(partial, 1);
    expect(directEncounter(ctx2, 'a', ['a', 'b', 'c'])).toBeNull();
    expect(ctx).toBeTruthy();
  });
});

describe('number of wins (article 7.1)', () => {
  it('counts rounds worth a win, whether or not they were played', () => {
    const tournament = build({
      a: [
        played(1, 'b', 'white', 1),
        { round: 2, kind: 'pairing-allocated-bye', opponentId: null, colour: null, points: 1 },
        played(3, 'b', 'black', 0.5),
      ],
      b: [played(1, 'a', 'black', 0), played(3, 'a', 'white', 0.5)],
    });
    const ctx = buildTiebreakContext(tournament);
    expect(wins(ctx, 'a')).toBe(2);
    expect(wins(ctx, 'b')).toBe(0);
  });
});

describe('standings', () => {
  it('ranks by score, then applies tie-breaks only within a tie', () => {
    const tournament = build({
      a: [played(1, 'b', 'white', 1), played(2, 'c', 'black', 1), played(3, 'd', 'white', 1)],
      b: [played(1, 'a', 'black', 0), played(2, 'd', 'white', 1), played(3, 'c', 'black', 1)],
      c: [played(1, 'd', 'white', 1), played(2, 'a', 'white', 0), played(3, 'b', 'white', 0)],
      d: [played(1, 'c', 'black', 0), played(2, 'b', 'black', 0), played(3, 'a', 'black', 0)],
    });
    const rows = computeStandings(tournament);
    expect(rows.map((r) => r.playerId)).toEqual(['a', 'b', 'c', 'd']);
    expect(rows[0].score).toBe(3);
    expect(rows[3].score).toBe(0);
    expect(rows.every((r) => !r.sharedRank)).toBe(true);
  });

  it('marks a tie that survives every tie-break', () => {
    const tournament = build({
      a: [played(1, 'b', 'white', 0.5)],
      b: [played(1, 'a', 'black', 0.5)],
    }, 1);
    const rows = computeStandings(tournament, { tiebreaks: ['buchholz'] });
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(1);
    expect(rows.every((r) => r.sharedRank)).toBe(true);
  });
});
