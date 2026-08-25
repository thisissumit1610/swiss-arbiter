/**
 * Derived per-player state.
 *
 * Everything the pairing rules ask about a player — score, colour preference,
 * who they have met, how they floated — is computed here from their round
 * outcomes, so the rest of the engine never re-derives it inconsistently.
 */

import type {
  Colour,
  Player,
  RoundOutcome,
  ScoringSystem,
  Tournament,
} from './types.js';

/** Strength of a colour preference (C.04.3.A.6). */
export type PreferenceStrength = 'absolute' | 'strong' | 'mild' | 'none';

export interface ColourPreference {
  colour: Colour | null;
  strength: PreferenceStrength;
}

/** A float received in a round (C.04.3.A.4b). */
export type Float = 'down' | 'up' | null;

export interface PlayerState {
  player: Player;
  id: string;
  pairingNumber: number;
  score: number;
  /**
   * Colours of games actually played, oldest first. Unplayed rounds are removed
   * entirely rather than left as holes — C.04.2.D.5 says a history of B W B = W
   * is treated as = B W B W, i.e. the played colours simply close ranks.
   */
  colourHistory: Colour[];
  /** #white − #black over played games (C.04.3.A.6). */
  colourDifference: number;
  preference: ColourPreference;
  /** Ids of opponents actually faced over the board (C.04.1.b, C.04.2.D.6). */
  opponentsPlayed: Set<string>;
  /** True if a pairing-allocated bye or a forfeit win is already on record (C.04.1.d). */
  hasReceivedByeOrForfeitWin: boolean;
  /**
   * Float received in each round, indexed by round number. floats[r] is the float
   * from round r. Index 0 is unused.
   */
  floats: Float[];
  /** Float in the most recently completed round. */
  lastFloat: Float;
  /** Float two rounds back. */
  floatBeforeLast: Float;
  /** True once the player has stopped being paired (C.04.2.D.3). */
  withdrawn: boolean;
}

export function pointsFor(outcome: RoundOutcome): number {
  return outcome.points;
}

/** Sum of every point awarded, played or not. */
export function scoreOf(outcomes: readonly RoundOutcome[]): number {
  let total = 0;
  for (const o of outcomes) total += o.points;
  return total;
}

/**
 * Colour preference, per C.04.3.A.6.
 *
 *   absolute — |colour difference| > 1, or the same colour in the two latest
 *              games played. The preference then points the other way.
 *   strong   — colour difference is exactly +1 (wants black) or −1 (wants white).
 *   mild     — colour difference is zero; alternate from the previous game.
 *   none     — no games played yet; the opponent's preference is granted.
 */
export function colourPreference(
  colourHistory: readonly Colour[],
  colourDifference: number,
): ColourPreference {
  if (colourHistory.length === 0) {
    return { colour: null, strength: 'none' };
  }

  const last = colourHistory[colourHistory.length - 1];
  const secondLast =
    colourHistory.length >= 2 ? colourHistory[colourHistory.length - 2] : null;

  // Absolute by repetition: two most recent played games shared a colour.
  if (secondLast !== null && last === secondLast) {
    return { colour: opposite(last), strength: 'absolute' };
  }
  // Absolute by imbalance.
  if (colourDifference > 1) return { colour: 'black', strength: 'absolute' };
  if (colourDifference < -1) return { colour: 'white', strength: 'absolute' };

  if (colourDifference === 1) return { colour: 'black', strength: 'strong' };
  if (colourDifference === -1) return { colour: 'white', strength: 'strong' };

  return { colour: opposite(last), strength: 'mild' };
}

export function opposite(c: Colour): Colour {
  return c === 'white' ? 'black' : 'white';
}

/**
 * Float history, per C.04.3.A.4b:
 *   - after two players with *different* scores meet, the higher-ranked (i.e.
 *     higher-scoring) one has downfloated and the lower-scoring one upfloated;
 *   - a player who does not play at all in a round has downfloated.
 *
 * Scores are taken as they stood *going into* that round, not as they stand now,
 * so this walks the history forwards accumulating points round by round.
 */
function computeFloats(
  outcomes: readonly RoundOutcome[],
  scoreBeforeRound: (id: string, round: number) => number,
  selfId: string,
): Float[] {
  const floats: Float[] = [];
  for (const o of outcomes) {
    if (o.kind !== 'played') {
      // "A player who, for whatever reason, does not play in a round, also
      // receives a downfloat."
      floats[o.round] = 'down';
      continue;
    }
    if (o.opponentId === null) {
      floats[o.round] = 'down';
      continue;
    }
    const mine = scoreBeforeRound(selfId, o.round);
    const theirs = scoreBeforeRound(o.opponentId, o.round);
    if (mine > theirs) floats[o.round] = 'down';
    else if (mine < theirs) floats[o.round] = 'up';
    else floats[o.round] = null;
  }
  return floats;
}

/**
 * Build the derived state for every player in a tournament, as of the start of
 * `upToRound` (i.e. using results from rounds 1 .. upToRound − 1).
 */
export function buildStates(
  tournament: Tournament,
  upToRound: number,
): Map<string, PlayerState> {
  const byId = new Map<string, Player>();
  for (const p of tournament.players) byId.set(p.id, p);

  // Results restricted to completed rounds.
  const history = new Map<string, RoundOutcome[]>();
  for (const p of tournament.players) {
    const all = tournament.results[p.id] ?? [];
    history.set(
      p.id,
      all.filter((o) => o.round < upToRound).sort((a, b) => a.round - b.round),
    );
  }

  // Cumulative score *before* a given round, for the float computation.
  const cumulative = new Map<string, number[]>();
  for (const [id, outcomes] of history) {
    const running: number[] = [0];
    let total = 0;
    for (let r = 1; r < upToRound; r++) {
      running[r] = total;
      const o = outcomes.find((x) => x.round === r);
      if (o) total += o.points;
    }
    running[upToRound] = total;
    cumulative.set(id, running);
  }
  const scoreBeforeRound = (id: string, round: number): number => {
    const running = cumulative.get(id);
    if (!running) return 0;
    return running[round] ?? running[running.length - 1] ?? 0;
  };

  const states = new Map<string, PlayerState>();
  for (const p of tournament.players) {
    const outcomes = history.get(p.id) ?? [];

    const colourHistory: Colour[] = [];
    const opponentsPlayed = new Set<string>();
    let hasReceivedByeOrForfeitWin = false;

    for (const o of outcomes) {
      if (o.kind === 'played') {
        if (o.colour) colourHistory.push(o.colour);
        if (o.opponentId) opponentsPlayed.add(o.opponentId);
      }
      if (
        o.kind === 'pairing-allocated-bye' ||
        o.kind === 'full-point-bye' ||
        o.kind === 'forfeit-win'
      ) {
        hasReceivedByeOrForfeitWin = true;
      }
    }

    const whites = colourHistory.filter((c) => c === 'white').length;
    const colourDifference = whites - (colourHistory.length - whites);
    const floats = computeFloats(outcomes, scoreBeforeRound, p.id);

    const withdrawn =
      p.withdrawnAfterRound !== undefined && upToRound > p.withdrawnAfterRound;

    states.set(p.id, {
      player: p,
      id: p.id,
      pairingNumber: p.pairingNumber,
      score: scoreOf(outcomes),
      colourHistory,
      colourDifference,
      preference: colourPreference(colourHistory, colourDifference),
      opponentsPlayed,
      hasReceivedByeOrForfeitWin,
      floats,
      lastFloat: floats[upToRound - 1] ?? null,
      floatBeforeLast: floats[upToRound - 2] ?? null,
      withdrawn,
    });
  }
  return states;
}

/** Points a player would be awarded for `kind` under `scoring`. */
export function pointsForKind(
  kind: RoundOutcome['kind'],
  scoring: ScoringSystem,
  playedResult?: 'win' | 'draw' | 'loss',
): number {
  switch (kind) {
    case 'played':
      if (playedResult === 'win') return scoring.win;
      if (playedResult === 'draw') return scoring.draw;
      return scoring.loss;
    case 'pairing-allocated-bye':
      return scoring.pairingAllocatedBye;
    case 'full-point-bye':
      return scoring.win;
    case 'forfeit-win':
      return scoring.forfeitWin;
    case 'forfeit-loss':
      return scoring.loss;
    case 'half-point-bye':
      return scoring.draw;
    case 'zero-point-bye':
      return scoring.loss;
  }
}
