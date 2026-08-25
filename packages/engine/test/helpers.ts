import {
  buildStates,
  commitRound,
  createTournament,
  maximumMatching,
  pairIsLegal,
  pairRound,
  type GameResult,
  type RoundPairing,
  type Tournament,
} from '../src/index.js';

/** A deterministic PRNG so a failing simulation can always be replayed. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

export function makeField(count: number, seed = 1): Tournament {
  const rng = makeRng(seed);
  return createTournament({
    name: `Test field of ${count}`,
    totalRounds: 9,
    players: Array.from({ length: count }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Player ${String(i + 1).padStart(3, '0')}`,
      rating: 2400 - Math.floor(rng() * 900),
    })),
  });
}

/**
 * Play a round out. Results are biased by rating so the score distribution
 * looks like a real tournament rather than a coin-flip, which is what makes the
 * later brackets awkward enough to be worth testing.
 */
export function playRound(
  tournament: Tournament,
  pairing: RoundPairing,
  rng: () => number,
  forfeitRate = 0,
): Tournament {
  const results = new Map<number, GameResult>();
  const ratingOf = (id: string) =>
    tournament.players.find((p) => p.id === id)?.rating ?? 1500;

  for (const pair of pairing.pairs) {
    if (forfeitRate > 0 && rng() < forfeitRate) {
      results.set(pair.board, rng() < 0.5 ? 'white-forfeit' : 'black-forfeit');
      continue;
    }
    const diff = ratingOf(pair.whiteId) - ratingOf(pair.blackId);
    const expected = 1 / (1 + Math.pow(10, -diff / 400));
    const roll = rng();
    if (roll < expected * 0.8) results.set(pair.board, 'white-wins');
    else if (roll < expected * 0.8 + 0.25) results.set(pair.board, 'draw');
    else results.set(pair.board, 'black-wins');
  }
  return commitRound(tournament, pairing, results);
}

export interface Violation {
  round: number;
  rule: string;
  detail: string;
}

/**
 * Check every absolute rule the FIDE Swiss system guarantees, over a completed
 * tournament. These are the properties an arbiter would be within their rights
 * to insist on, so any violation is a hard failure rather than a quality issue.
 */
export function findViolations(
  tournament: Tournament,
  roundsPlayed: number,
): Violation[] {
  const problems: Violation[] = [];
  const met = new Map<string, Set<string>>();

  for (const player of tournament.players) {
    const outcomes = (tournament.results[player.id] ?? [])
      .filter((o) => o.round <= roundsPlayed)
      .sort((a, b) => a.round - b.round);

    // C.04.1.b — never the same opponent twice, counting played games.
    const seen = new Set<string>();
    for (const o of outcomes) {
      if (o.kind !== 'played' || !o.opponentId) continue;
      if (seen.has(o.opponentId)) {
        problems.push({
          round: o.round,
          rule: 'C.04.1.b',
          detail: `${player.id} met ${o.opponentId} more than once`,
        });
      }
      seen.add(o.opponentId);
    }
    met.set(player.id, seen);

    // C.04.1.d — a player who already has a bye, or a forfeit win from an
    // opponent not turning up, must not be given the pairing-allocated bye.
    //
    // Note what this does *not* say: a second forfeit win is perfectly legal.
    // A player whose opponent fails to appear twice has broken no rule, and the
    // pairing engine has no say in it either way. Only the allocated bye is
    // restricted, and only by what came before it.
    const disqualifying = new Set([
      'pairing-allocated-bye',
      'full-point-bye',
      'forfeit-win',
    ]);
    let seenDisqualifying = false;
    for (const o of outcomes) {
      if (o.kind === 'pairing-allocated-bye' && seenDisqualifying) {
        problems.push({
          round: o.round,
          rule: 'C.04.1.d',
          detail: `${player.id} was given a second pairing-allocated bye`,
        });
      }
      if (disqualifying.has(o.kind)) seenDisqualifying = true;
    }

    // Colour history uses played games only (C.04.2.D.5).
    const played = outcomes.filter((o) => o.kind === 'played' && o.colour);
    const colours = played.map((o) => o.colour!);

    // C.04.1.f and C.04.1.g both end with "Each system may have exceptions to
    // this rule in the last round of a tournament", and C.04.3 spends that
    // exception in exactly one place: C.3 only stops *non-topscorers* with the
    // same absolute preference from meeting, so a last-round pairing involving a
    // leader may hand somebody a third white. Both rules are therefore checked
    // strictly everywhere except the final round.
    const isFinal = (round: number) => round === tournament.totalRounds;

    const whites = colours.filter((c) => c === 'white').length;
    const diff = whites - (colours.length - whites);
    if (Math.abs(diff) > 2) {
      // Recover the round at which it first went out of range.
      let running = 0;
      let breachRound = roundsPlayed;
      for (const o of played) {
        running += o.colour === 'white' ? 1 : -1;
        if (Math.abs(running) > 2) {
          breachRound = o.round;
          break;
        }
      }
      if (!isFinal(breachRound)) {
        problems.push({
          round: breachRound,
          rule: 'C.04.1.f',
          detail: `${player.id} has colour difference ${diff} (${colours.join('')})`,
        });
      }
    }

    for (let i = 2; i < colours.length; i++) {
      if (colours[i] !== colours[i - 1] || colours[i] !== colours[i - 2]) continue;
      const round = played[i].round;
      if (isFinal(round)) continue;
      problems.push({
        round,
        rule: 'C.04.1.g',
        detail: `${player.id} had ${colours[i]} three times in a row`,
      });
    }
  }

  // Symmetry: if A played B in round r, B played A in round r with the other colour.
  for (const player of tournament.players) {
    for (const o of tournament.results[player.id] ?? []) {
      if (o.round > roundsPlayed || o.kind !== 'played' || !o.opponentId) continue;
      const mirror = (tournament.results[o.opponentId] ?? []).find(
        (x) => x.round === o.round,
      );
      if (!mirror || mirror.opponentId !== player.id) {
        problems.push({
          round: o.round,
          rule: 'symmetry',
          detail: `${player.id} vs ${o.opponentId} is not mirrored`,
        });
      } else if (mirror.colour === o.colour) {
        problems.push({
          round: o.round,
          rule: 'symmetry',
          detail: `${player.id} and ${o.opponentId} both had ${o.colour}`,
        });
      }
    }
  }

  return problems;
}

/**
 * Final-round colour-rule exceptions, with whether they were legitimate.
 *
 * C.04.1.f/g may be broken in the last round, but C.04.3 only creates the
 * opening for it through C.3, which exempts a pair when at least one side is a
 * topscorer. So every exception the engine takes should be traceable to a
 * last-round pairing involving a player above 50% — anything else means the
 * engine is helping itself to a licence the rules did not give it.
 */
export function findLastRoundExceptions(
  tournament: Tournament,
): Array<{ playerId: string; opponentId: string | null; topscorerInvolved: boolean }> {
  const finalRound = tournament.totalRounds;
  const winPoints = tournament.scoring.win;
  const maxBeforeFinal = (finalRound - 1) * winPoints;

  // A.7 — scores as they stood when the final round was paired.
  const scoreBeforeFinal = new Map<string, number>();
  for (const p of tournament.players) {
    const total = (tournament.results[p.id] ?? [])
      .filter((o) => o.round < finalRound)
      .reduce((s, o) => s + o.points, 0);
    scoreBeforeFinal.set(p.id, total);
  }
  const isTopscorer = (id: string) =>
    (scoreBeforeFinal.get(id) ?? 0) > maxBeforeFinal / 2;

  const found: Array<{
    playerId: string;
    opponentId: string | null;
    topscorerInvolved: boolean;
  }> = [];

  for (const player of tournament.players) {
    const played = (tournament.results[player.id] ?? [])
      .filter((o) => o.kind === 'played' && o.colour)
      .sort((a, b) => a.round - b.round);
    const colours = played.map((o) => o.colour!);
    if (colours.length === 0) continue;

    const last = played[played.length - 1];
    if (last.round !== finalRound) continue;

    let running = 0;
    for (const c of colours) running += c === 'white' ? 1 : -1;

    const threeInARow =
      colours.length >= 3 &&
      colours[colours.length - 1] === colours[colours.length - 2] &&
      colours[colours.length - 1] === colours[colours.length - 3];

    if (Math.abs(running) > 2 || threeInARow) {
      found.push({
        playerId: player.id,
        opponentId: last.opponentId,
        topscorerInvolved:
          isTopscorer(player.id) ||
          (last.opponentId !== null && isTopscorer(last.opponentId)),
      });
    }
  }
  return found;
}

/**
 * Was a complete round-pairing available at all?
 *
 * A Swiss tournament can genuinely run out of legal pairings — a small field
 * over many rounds exhausts the opponents nobody has met, and C.04.3.A.9 hands
 * that case to the arbiter rather than pretending a pairing exists. So an
 * incomplete round is only a bug if one *was* possible, which this answers
 * independently of the pairing engine: pure matching over the legal-pair graph,
 * with the bye handled the way C.2 requires.
 */
export function roundWasPossible(
  tournament: Tournament,
  round: number,
): boolean {
  const states = buildStates(tournament, round);
  const pool = tournament.players
    .map((p) => states.get(p.id)!)
    .filter((s) => !s.withdrawn);

  // A.7 — topscorers only exist when the final round is being paired, and they
  // loosen C.3, so the graph is denser in that round.
  const isFinal = round === tournament.totalRounds;
  const maxBefore = (round - 1) * tournament.scoring.win;
  const isTopscorer = (id: string) =>
    isFinal && (pool.find((p) => p.id === id)?.score ?? 0) > maxBefore / 2;

  const legalIn = (players: typeof pool) => (i: number, j: number) =>
    pairIsLegal(players[i], players[j], isTopscorer);

  if (pool.length % 2 === 0) {
    return maximumMatching(pool.length, legalIn(pool)) === pool.length / 2;
  }
  for (let k = pool.length - 1; k >= 0; k--) {
    if (pool[k].hasReceivedByeOrForfeitWin) continue;
    const rest = pool.filter((_, i) => i !== k);
    if (maximumMatching(rest.length, legalIn(rest)) === rest.length / 2) return true;
  }
  return false;
}

/** Run a whole tournament and hand back the finished state plus each pairing. */
export function simulate(
  playerCount: number,
  rounds: number,
  seed: number,
  forfeitRate = 0,
): {
  tournament: Tournament;
  pairings: RoundPairing[];
  /** Rounds the engine failed to complete although a legal pairing existed. */
  missedCompletions: number[];
} {
  const rng = makeRng(seed);
  let tournament = { ...makeField(playerCount, seed), totalRounds: rounds };
  const pairings: RoundPairing[] = [];
  const missedCompletions: number[] = [];

  for (let round = 1; round <= rounds; round++) {
    const pairing = pairRound(tournament, round);
    if (!pairing.complete && roundWasPossible(tournament, round)) {
      missedCompletions.push(round);
    }
    pairings.push(pairing);
    tournament = playRound(tournament, pairing, rng, forfeitRate);
  }
  return { tournament, pairings, missedCompletions };
}
