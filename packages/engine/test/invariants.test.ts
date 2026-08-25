/**
 * The absolute rules, checked over many randomly-played tournaments.
 *
 * These are the properties that make a pairing legal at all, so rather than
 * pinning a handful of expected pairings this sweeps a wide range of field
 * sizes and results and asserts nothing illegal ever comes out. Field sizes are
 * chosen to include the awkward ones: odd fields that force a bye every round,
 * tiny fields where a 5-round event nearly exhausts the possible opponents, and
 * sizes that make the last bracket collapse.
 */

import { describe, expect, it } from 'vitest';
import { findLastRoundExceptions, findViolations, simulate } from './helpers.js';

describe('absolute pairing rules hold across simulated tournaments', () => {
  const fields = [6, 7, 8, 9, 10, 11, 12, 15, 16, 20, 23, 24, 30, 33, 40, 60, 100];

  for (const count of fields) {
    it(`${count} players, 5 rounds, 8 seeds`, () => {
      for (let seed = 1; seed <= 8; seed++) {
        const { tournament, missedCompletions } = simulate(count, 5, seed);
        const problems = findViolations(tournament, 5);
        expect(
          problems,
          `field=${count} seed=${seed}: ${problems
            .map((p) => `[${p.rule}] r${p.round} ${p.detail}`)
            .join('; ')}`,
        ).toEqual([]);

        // A round may legitimately be impossible in a small field; it is only a
        // fault if the engine gave up while a legal pairing was still there.
        expect(
          missedCompletions,
          `field=${count} seed=${seed}: gave up on rounds that were pairable`,
        ).toEqual([]);
      }
    });
  }
});

describe('long tournaments where opponents start running out', () => {
  // A Swiss system is not required to produce a round robin when rounds equal
  // players minus one, and it usually cannot: the pairing is driven by score,
  // so by the closing rounds the players who have not yet met are often exactly
  // the ones the scores keep apart. What must hold is that nothing illegal
  // happens and that the engine never gives up on a round it could have paired.
  it('8 players over 7 rounds stays legal', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { tournament, missedCompletions } = simulate(8, 7, seed);
      const problems = findViolations(tournament, 7);
      expect(problems, `seed=${seed}: ${JSON.stringify(problems)}`).toEqual([]);
      expect(missedCompletions, `seed=${seed}`).toEqual([]);
    }
  });

  it('10 players over 9 rounds stays legal', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { tournament, missedCompletions } = simulate(10, 9, seed);
      expect(findViolations(tournament, 9), `seed=${seed}`).toEqual([]);
      expect(missedCompletions, `seed=${seed}`).toEqual([]);
    }
  });
});

describe('forfeits and byes do not break the absolute rules', () => {
  it('survives a 12% forfeit rate', () => {
    for (const count of [9, 14, 21, 30]) {
      for (let seed = 1; seed <= 6; seed++) {
        const { tournament, missedCompletions } = simulate(count, 6, seed, 0.12);
        const problems = findViolations(tournament, 6);
        expect(
          problems,
          `field=${count} seed=${seed}: ${JSON.stringify(problems)}`,
        ).toEqual([]);
        expect(missedCompletions, `field=${count} seed=${seed}`).toEqual([]);
      }
    }
  });
});

describe('the last-round colour exception is only used where it is allowed', () => {
  it('every final-round colour breach involves a topscorer', () => {
    for (const count of [8, 9, 10, 12, 16, 21]) {
      for (let seed = 1; seed <= 10; seed++) {
        const rounds = count <= 10 ? count - 1 : 7;
        const { tournament } = simulate(count, rounds, seed);
        for (const e of findLastRoundExceptions(tournament)) {
          expect(
            e.topscorerInvolved,
            `field=${count} seed=${seed}: ${e.playerId} vs ${e.opponentId} ` +
              'broke a colour rule in the last round without a topscorer in the pair',
          ).toBe(true);
        }
      }
    }
  });
});

describe('every player is accounted for in every round', () => {
  it('each round pairs everyone exactly once', () => {
    for (const count of [7, 12, 25]) {
      const { pairings } = simulate(count, 5, 42);
      for (const pairing of pairings) {
        const seen = new Set<string>();
        for (const pair of pairing.pairs) {
          expect(seen.has(pair.whiteId)).toBe(false);
          expect(seen.has(pair.blackId)).toBe(false);
          seen.add(pair.whiteId);
          seen.add(pair.blackId);
        }
        if (pairing.pairingAllocatedByeId) {
          expect(seen.has(pairing.pairingAllocatedByeId)).toBe(false);
          seen.add(pairing.pairingAllocatedByeId);
        }
        for (const u of pairing.unpaired) seen.add(u.playerId);
        expect(seen.size).toBe(count);
      }
    }
  });

  it('a bye is given exactly when the field is odd', () => {
    for (const count of [11, 12]) {
      const { pairings } = simulate(count, 4, 7);
      for (const pairing of pairings) {
        if (count % 2 === 1) {
          expect(pairing.pairingAllocatedByeId).not.toBeNull();
        } else {
          expect(pairing.pairingAllocatedByeId).toBeNull();
        }
      }
    }
  });
});
