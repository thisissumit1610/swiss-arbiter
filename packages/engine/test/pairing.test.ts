/**
 * Round pairing: the shapes an arbiter can check by eye.
 */

import { describe, expect, it } from 'vitest';
import {
  assignPairingNumbers,
  commitRound,
  createTournament,
  pairRound,
  requestBye,
  withdrawPlayer,
  type GameResult,
  type Tournament,
} from '../src/index.js';

function field(count: number, totalRounds = 5): Tournament {
  return createTournament({
    name: `field of ${count}`,
    totalRounds,
    players: Array.from({ length: count }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Player ${String(i + 1).padStart(2, '0')}`,
      // Descending ratings, so pairing number i+1 is exactly seed i+1.
      rating: 2000 - i,
    })),
  });
}

/** Map a pairing to "higherSeed v lowerSeed" strings, board order. */
function boards(t: Tournament, pairing: ReturnType<typeof pairRound>): string[] {
  const seed = new Map(t.players.map((p) => [p.id, p.pairingNumber]));
  return pairing.pairs.map((p) => `${seed.get(p.whiteId)}w-${seed.get(p.blackId)}b`);
}

describe('initial ranking (C.04.2.B)', () => {
  it('orders by rating, then title, then name', () => {
    const players = assignPairingNumbers([
      { id: 'c', name: 'Carol', rating: 1800, pairingNumber: 0 },
      { id: 'a', name: 'Alice', rating: 2000, pairingNumber: 0 },
      { id: 'b', name: 'Bob', rating: 2000, title: 'IM', pairingNumber: 0 },
      { id: 'd', name: 'Dave', rating: 1800, title: 'FM', pairingNumber: 0 },
    ]);
    // Bob and Alice both 2000; Bob has a title so he ranks first.
    // Dave and Carol both 1800; Dave has a title so he ranks first.
    expect(players.map((p) => p.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(players.map((p) => p.pairingNumber)).toEqual([1, 2, 3, 4]);
  });
});

describe('round one', () => {
  it('pairs the top half against the bottom half in order', () => {
    const t = field(10);
    const pairing = pairRound(t, 1);
    const seed = new Map(t.players.map((p) => [p.id, p.pairingNumber]));

    expect(pairing.pairs).toHaveLength(5);
    const meetings = pairing.pairs
      .map((p) => {
        const a = seed.get(p.whiteId)!;
        const b = seed.get(p.blackId)!;
        return [Math.min(a, b), Math.max(a, b)] as const;
      })
      .sort((x, y) => x[0] - y[0]);

    expect(meetings).toEqual([
      [1, 6],
      [2, 7],
      [3, 8],
      [4, 9],
      [5, 10],
    ]);
  });

  it('alternates colours down the top half (E.5)', () => {
    const t = field(10);
    // The initial colour is white, so odd seeds take white and even seeds black.
    expect(boards(t, pairRound(t, 1))).toEqual([
      '1w-6b',
      '7w-2b',
      '3w-8b',
      '9w-4b',
      '5w-10b',
    ]);
  });

  it('follows the drawn initial colour', () => {
    const t = { ...field(10), initialColour: 'black' as const };
    expect(boards(t, pairRound(t, 1))).toEqual([
      '6w-1b',
      '2w-7b',
      '8w-3b',
      '4w-9b',
      '10w-5b',
    ]);
  });

  it('gives the bye to the lowest-ranked player of an odd field', () => {
    const t = field(9);
    const pairing = pairRound(t, 1);
    expect(pairing.pairs).toHaveLength(4);
    expect(pairing.pairingAllocatedByeId).toBe('p9');
  });
});

describe('publishing order (C.04.2.D.9)', () => {
  it('sorts boards by the higher player’s score, then the pair total', () => {
    let t = field(8, 3);
    const first = pairRound(t, 1);
    // Give the top two boards decisive results so the scores spread out.
    const results = new Map<number, GameResult>([
      [1, 'white-wins'],
      [2, 'white-wins'],
      [3, 'draw'],
      [4, 'draw'],
    ]);
    t = commitRound(t, first, results);

    const second = pairRound(t, 2);
    const scoreOf = (id: string) =>
      (t.results[id] ?? []).reduce((s, o) => s + o.points, 0);

    const topScores = second.pairs.map((p) =>
      Math.max(scoreOf(p.whiteId), scoreOf(p.blackId)),
    );
    // Board 1 carries the highest-scoring player, and it never goes back up.
    for (let i = 1; i < topScores.length; i++) {
      expect(topScores[i]).toBeLessThanOrEqual(topScores[i - 1]);
    }
  });
});

describe('players who are not paired', () => {
  it('leaves out a withdrawn player', () => {
    let t = field(8, 3);
    t = withdrawPlayer(t, 'p3', 1);
    const pairing = pairRound(t, 2);
    expect(pairing.pairs).toHaveLength(3);
    expect(pairing.unpaired).toContainEqual({
      playerId: 'p3',
      reason: 'withdrawn',
      points: 0,
    });
    const paired = pairing.pairs.flatMap((p) => [p.whiteId, p.blackId]);
    expect(paired).not.toContain('p3');
  });

  it('honours a requested half-point bye', () => {
    let t = field(8, 3);
    t = requestBye(t, 'p5', 1, 0.5);
    const pairing = pairRound(t, 1);
    expect(pairing.unpaired).toContainEqual({
      playerId: 'p5',
      reason: 'half-point-bye',
      points: 0.5,
    });
    // Seven players remain, so one of them also takes the allocated bye.
    expect(pairing.pairs).toHaveLength(3);
    expect(pairing.pairingAllocatedByeId).not.toBeNull();

    const committed = commitRound(t, pairing, new Map());
    expect(committed.results['p5'][0]).toMatchObject({
      kind: 'half-point-bye',
      points: 0.5,
    });
  });

  it('does not pair a late entrant before they arrive', () => {
    const base = field(8, 3);
    const t: Tournament = {
      ...base,
      players: base.players.map((p) =>
        p.id === 'p4' ? { ...p, entersAtRound: 2 } : p,
      ),
    };
    const first = pairRound(t, 1);
    expect(first.unpaired.map((u) => u.playerId)).toContain('p4');

    const second = pairRound(commitRound(t, first, new Map()), 2);
    const paired = second.pairs.flatMap((p) => [p.whiteId, p.blackId]);
    expect([...paired, second.pairingAllocatedByeId]).toContain('p4');
  });
});

describe('score groups', () => {
  it('pairs winners with winners in round two', () => {
    let t = field(8, 3);
    const first = pairRound(t, 1);
    t = commitRound(
      t,
      first,
      new Map<number, GameResult>([
        [1, 'white-wins'],
        [2, 'white-wins'],
        [3, 'white-wins'],
        [4, 'white-wins'],
      ]),
    );

    const scoreOf = (id: string) =>
      (t.results[id] ?? []).reduce((s, o) => s + o.points, 0);
    const second = pairRound(t, 2);

    for (const pair of second.pairs) {
      expect(scoreOf(pair.whiteId)).toBe(scoreOf(pair.blackId));
    }
  });
});
