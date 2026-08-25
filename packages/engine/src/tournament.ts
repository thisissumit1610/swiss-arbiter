/**
 * Tournament operations.
 *
 * Every function here returns a new tournament rather than mutating one, which
 * keeps undo, autosave and the round-by-round audit trail trivial for callers.
 */

import type {
  Colour,
  Pair,
  Player,
  RoundOutcome,
  RoundPairing,
  ScoringSystem,
  Tournament,
} from './types.js';
import { CLASSICAL_SCORING } from './types.js';
import { assignPairingNumbers } from './order.js';

/** How a game on a board finished. */
export type GameResult =
  | 'white-wins'
  | 'black-wins'
  | 'draw'
  /** White appeared, black did not. */
  | 'black-forfeit'
  /** Black appeared, white did not. */
  | 'white-forfeit'
  /** Neither appeared. */
  | 'both-forfeit'
  /** Not yet played — the board is still running. */
  | 'pending';

export interface CreateTournamentInput {
  name: string;
  totalRounds: number;
  players: Array<Omit<Player, 'pairingNumber'> & { pairingNumber?: number }>;
  scoring?: ScoringSystem;
  initialColour?: Colour;
  id?: string;
}

export function createTournament(input: CreateTournamentInput): Tournament {
  const now = new Date().toISOString();
  const seeded = assignPairingNumbers(
    input.players.map((p) => ({ ...p, pairingNumber: p.pairingNumber ?? 0 })),
  );
  return {
    id: input.id ?? cryptoId(),
    name: input.name,
    totalRounds: input.totalRounds,
    players: seeded,
    results: Object.fromEntries(seeded.map((p) => [p.id, [] as RoundOutcome[]])),
    scoring: input.scoring ?? CLASSICAL_SCORING,
    initialColour: input.initialColour ?? 'white',
    roundsPaired: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Re-seed the field and reassign pairing numbers.
 *
 * C.04.2.B.3 only allows this before round four; the guard is enforced here so
 * a late rating correction cannot silently rewrite the pairing numbers of a
 * tournament already past that point.
 */
export function reseed(tournament: Tournament): Tournament {
  if (tournament.roundsPaired >= 4) {
    throw new Error(
      'Pairing numbers cannot be changed after the fourth round (C.04.2.B.3).',
    );
  }
  return {
    ...tournament,
    players: assignPairingNumbers(tournament.players),
    updatedAt: new Date().toISOString(),
  };
}

export function addPlayer(
  tournament: Tournament,
  player: Omit<Player, 'pairingNumber'>,
): Tournament {
  const players = [...tournament.players, { ...player, pairingNumber: 0 }];
  const seeded =
    tournament.roundsPaired < 4
      ? assignPairingNumbers(players)
      : players.map((p) =>
          p.pairingNumber === 0
            ? { ...p, pairingNumber: nextFreeNumber(tournament) }
            : p,
        );
  return {
    ...tournament,
    players: seeded,
    results: { ...tournament.results, [player.id]: [] },
    updatedAt: new Date().toISOString(),
  };
}

function nextFreeNumber(tournament: Tournament): number {
  return (
    tournament.players.reduce((max, p) => Math.max(max, p.pairingNumber), 0) + 1
  );
}

export function withdrawPlayer(
  tournament: Tournament,
  playerId: string,
  afterRound: number,
): Tournament {
  return {
    ...tournament,
    players: tournament.players.map((p) =>
      p.id === playerId ? { ...p, withdrawnAfterRound: afterRound } : p,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function requestBye(
  tournament: Tournament,
  playerId: string,
  round: number,
  points: number,
): Tournament {
  return {
    ...tournament,
    players: tournament.players.map((p) => {
      if (p.id !== playerId) return p;
      const existing = (p.requestedByes ?? []).filter((b) => b.round !== round);
      return { ...p, requestedByes: [...existing, { round, points }] };
    }),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Write a round's outcomes into the tournament.
 *
 * `results` maps a board number to how that game finished. Boards left
 * `pending` are recorded as unplayed and simply carry no points yet; calling
 * this again with the same round replaces that round's outcomes, which is how
 * a result correction is applied (C.04.2.D.8).
 */
export function commitRound(
  tournament: Tournament,
  pairing: RoundPairing,
  results: Map<number, GameResult>,
): Tournament {
  const { scoring } = tournament;
  const next: Record<string, RoundOutcome[]> = {};
  for (const [id, outcomes] of Object.entries(tournament.results)) {
    next[id] = outcomes.filter((o) => o.round !== pairing.round);
  }
  const push = (id: string, outcome: RoundOutcome) => {
    (next[id] ??= []).push(outcome);
  };

  for (const pair of pairing.pairs) {
    const result = results.get(pair.board) ?? 'pending';
    if (result === 'pending') continue;
    const [white, black] = outcomesForPair(pair, result, scoring, pairing.round);
    push(pair.whiteId, white);
    push(pair.blackId, black);
  }

  if (pairing.pairingAllocatedByeId) {
    push(pairing.pairingAllocatedByeId, {
      round: pairing.round,
      kind: 'pairing-allocated-bye',
      opponentId: null,
      colour: null,
      points: scoring.pairingAllocatedBye,
    });
  }

  for (const u of pairing.unpaired) {
    if (u.reason === 'withdrawn' || u.reason === 'not-yet-entered') continue;
    push(u.playerId, {
      round: pairing.round,
      kind: u.reason === 'half-point-bye' ? 'half-point-bye' : 'zero-point-bye',
      opponentId: null,
      colour: null,
      points: u.points,
    });
  }

  for (const list of Object.values(next)) list.sort((a, b) => a.round - b.round);

  return {
    ...tournament,
    results: next,
    roundsPaired: Math.max(tournament.roundsPaired, pairing.round),
    updatedAt: new Date().toISOString(),
  };
}

function outcomesForPair(
  pair: Pair,
  result: GameResult,
  scoring: ScoringSystem,
  round: number,
): [RoundOutcome, RoundOutcome] {
  const base = (
    id: string,
    opponentId: string,
    colour: Colour,
    kind: RoundOutcome['kind'],
    points: number,
  ): RoundOutcome => ({ round, kind, opponentId, colour, points });

  switch (result) {
    case 'white-wins':
      return [
        base(pair.whiteId, pair.blackId, 'white', 'played', scoring.win),
        base(pair.blackId, pair.whiteId, 'black', 'played', scoring.loss),
      ];
    case 'black-wins':
      return [
        base(pair.whiteId, pair.blackId, 'white', 'played', scoring.loss),
        base(pair.blackId, pair.whiteId, 'black', 'played', scoring.win),
      ];
    case 'draw':
      return [
        base(pair.whiteId, pair.blackId, 'white', 'played', scoring.draw),
        base(pair.blackId, pair.whiteId, 'black', 'played', scoring.draw),
      ];
    case 'black-forfeit':
      return [
        {
          round,
          kind: 'forfeit-win',
          opponentId: pair.blackId,
          colour: null,
          points: scoring.forfeitWin,
        },
        {
          round,
          kind: 'forfeit-loss',
          opponentId: pair.whiteId,
          colour: null,
          points: scoring.loss,
        },
      ];
    case 'white-forfeit':
      return [
        {
          round,
          kind: 'forfeit-loss',
          opponentId: pair.blackId,
          colour: null,
          points: scoring.loss,
        },
        {
          round,
          kind: 'forfeit-win',
          opponentId: pair.whiteId,
          colour: null,
          points: scoring.forfeitWin,
        },
      ];
    case 'both-forfeit':
      return [
        {
          round,
          kind: 'forfeit-loss',
          opponentId: pair.blackId,
          colour: null,
          points: scoring.loss,
        },
        {
          round,
          kind: 'forfeit-loss',
          opponentId: pair.whiteId,
          colour: null,
          points: scoring.loss,
        },
      ];
    case 'pending':
      throw new Error('pending results are not written');
  }
}

function cryptoId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
