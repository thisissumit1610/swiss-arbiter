/**
 * Core domain types.
 *
 * Rule references in this package point at the FIDE Handbook:
 *   C.04.1  Basic rules for Swiss Systems
 *   C.04.2  General handling rules for Swiss tournaments
 *   C.04.3  FIDE (Dutch) System  — the version approved at the 87th FIDE Congress, Baku 2016
 *   C.07    Play-Off and Tie-Break Regulations (the revision effective 1 March 2026)
 *
 * See docs/PAIRING_ALGORITHM.md for how the rule text maps onto this code.
 */

/** The two colours. Byes and unplayed games carry no colour (C.04.2.D.5). */
export type Colour = 'white' | 'black';

/**
 * What happened to a player in one round.
 *
 * The distinction between these matters in three separate places, and they do
 * not agree with each other, which is why the kind is stored rather than derived:
 *
 *   - colour history      only `played` entries count            (C.04.2.D.5)
 *   - opponent history    only `played` entries count            (C.04.2.D.6)
 *   - tie-breaks          every kind counts, but differently     (C.07 art. 16)
 */
export type RoundOutcomeKind =
  /** A real game on the board. */
  | 'played'
  /** Odd player out; awarded win-points, no opponent, no colour (C.04.1.c). */
  | 'pairing-allocated-bye'
  /** Opponent was paired but did not appear in time (C.04.1.d). */
  | 'forfeit-win'
  /** Player was paired but did not appear in time. */
  | 'forfeit-loss'
  /** Player asked in advance not to be paired, and was awarded half a point. */
  | 'half-point-bye'
  /** Player asked in advance not to be paired, and was awarded nothing. */
  | 'zero-point-bye'
  /** Player was not paired but was awarded win-points by the regulations. */
  | 'full-point-bye';

/** One player's record for one round. */
export interface RoundOutcome {
  /** 1-based round number. */
  round: number;
  kind: RoundOutcomeKind;
  /**
   * The opponent's id, or null when there was no opponent at all.
   * A `forfeit-win` / `forfeit-loss` *does* have an opponent: the pairing existed,
   * the game did not. That pair may legally meet again later (C.04.2.D.6).
   */
  opponentId: string | null;
  /** Non-null only when `kind === 'played'` — nothing else enters colour history. */
  colour: Colour | null;
  /** Points awarded for this round under the tournament's scoring system. */
  points: number;
}

/** A tournament participant. */
export interface Player {
  id: string;
  name: string;
  /** Rating used for the initial ranking (C.04.2.B.2a). 0 / undefined = unrated. */
  rating?: number;
  /** FIDE title, used as the second initial-ranking key (C.04.2.B.2b). */
  title?: FideTitle;
  federation?: string;
  /** FIDE ID, carried through TRF import/export. */
  fideId?: string;
  birthDate?: string;
  /**
   * Tournament pairing number (TPN), 1-based, assigned from the initial ranking
   * list (C.04.2.B.3). Lower is "higher ranked" for every ordering rule.
   */
  pairingNumber: number;
  /** Round from which the player is no longer paired (C.04.2.D.3). */
  withdrawnAfterRound?: number;
  /** Rounds the player asked not to be paired in, with the points awarded. */
  requestedByes?: Array<{ round: number; points: number }>;
  /** Late entrant: not paired before this round (C.04.2.C.2). */
  entersAtRound?: number;
}

export type FideTitle = 'GM' | 'IM' | 'WGM' | 'FM' | 'WIM' | 'CM' | 'WFM' | 'WCM';

/** Rank order of titles for the initial ranking list (C.04.2.B.2b). */
export const TITLE_ORDER: readonly FideTitle[] = [
  'GM',
  'IM',
  'WGM',
  'FM',
  'WIM',
  'CM',
  'WFM',
  'WCM',
];

/** Points awarded per result. Defaults to the classical 1 / 0.5 / 0 scheme. */
export interface ScoringSystem {
  win: number;
  draw: number;
  loss: number;
  /** Points for the pairing-allocated bye. C.04.1.c: "as many points as ... a win". */
  pairingAllocatedBye: number;
  /** Points for a forfeit win. */
  forfeitWin: number;
}

export const CLASSICAL_SCORING: ScoringSystem = {
  win: 1,
  draw: 0.5,
  loss: 0,
  pairingAllocatedBye: 1,
  forfeitWin: 1,
};

/** A pairing produced for a round. */
export interface Pair {
  /** 1-based board number, assigned by the publishing sort (C.04.2.D.9). */
  board: number;
  whiteId: string;
  blackId: string;
}

/** The complete result of pairing one round. */
export interface RoundPairing {
  round: number;
  pairs: Pair[];
  /** The player who received the pairing-allocated bye, if any (C.04.1.c). */
  pairingAllocatedByeId: string | null;
  /** Players not paired because they asked not to be, withdrew, or had not entered. */
  unpaired: Array<{ playerId: string; reason: UnpairedReason; points: number }>;
  /** Diagnostics: one entry per bracket, in the order they were paired. */
  brackets: BracketReport[];
  /**
   * False when the search hit its node budget in at least one bracket. The
   * pairing is still legal (all absolute criteria hold) but is not provably the
   * one the FIDE rules prescribe. Surfaced so an arbiter is never misled.
   */
  exhaustive: boolean;
  /**
   * False when no legal round-pairing could be produced even after collapsing
   * the lower scoregroups. C.04.3.A.9 hands this case to the arbiter, so the
   * caller must surface it rather than publishing the pairing.
   */
  complete: boolean;
}

export type UnpairedReason =
  | 'withdrawn'
  | 'half-point-bye'
  | 'zero-point-bye'
  | 'not-yet-entered';

/** Per-bracket diagnostics, so an arbiter can audit why a pairing came out as it did. */
export interface BracketReport {
  /** Score of the bracket's resident players. */
  score: number;
  /** True when every player in the bracket has the same score (C.04.3.A.3). */
  homogeneous: boolean;
  /** Number of moved-down players entering the bracket (C.04.3.B.1a). */
  m0: number;
  /** Players in the bracket, by pairing number. */
  playerIds: string[];
  pairs: Array<[string, string]>;
  downfloaterIds: string[];
  /** True if this bracket was re-paired as the Penultimate Pairing Bracket. */
  isPpb: boolean;
  /** True if this is the Collapsed Last Bracket (C.04.3.A.9). */
  isClb: boolean;
  /** Candidates examined before settling — a rough cost measure. */
  candidatesExamined: number;
  /** The winning candidate's quality-criteria vector, C.5 first. */
  quality: number[];
}

/** A tournament: the players plus every round played so far. */
export interface Tournament {
  id: string;
  name: string;
  /** Total rounds declared in advance (C.04.1.a). */
  totalRounds: number;
  players: Player[];
  /** Every player's record, keyed by player id. */
  results: Record<string, RoundOutcome[]>;
  scoring: ScoringSystem;
  /**
   * Colour given to the higher-ranked player of board 1 in round 1, drawn by lot
   * before the first pairing (C.04.3.E, "Initial-colour").
   */
  initialColour: Colour;
  /** Rounds already paired and published. */
  roundsPaired: number;
  createdAt: string;
  updatedAt: string;
}
