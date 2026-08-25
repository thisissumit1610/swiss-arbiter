/**
 * TRF(x) — the FIDE tournament report format.
 *
 * This is the interchange format every serious pairing program speaks, so being
 * able to read and write it is what lets a tournament run here be checked
 * against JaVaFo or bbpPairings, submitted for rating, or rescued into
 * Swiss-Manager if a laptop dies mid-event.
 *
 * The player record (`001`) is fixed-column:
 *
 *   1–3    "001"
 *   5–8    starting rank number
 *   10     sex
 *   11–13  title
 *   15–47  name
 *   49–52  rating
 *   54–56  federation
 *   58–68  FIDE number
 *   70–79  birth date
 *   81–84  points
 *   86–89  rank
 *   then, from column 92, one 10-wide block per round:
 *   92–95  opponent's starting rank    97  colour    99  result
 *
 * Columns are 1-based in the specification and converted to 0-based slices here.
 */

import type {
  Colour,
  Player,
  RoundOutcome,
  ScoringSystem,
  Tournament,
} from './types.js';
import { CLASSICAL_SCORING } from './types.js';

export interface TrfMeta {
  name?: string;
  city?: string;
  federation?: string;
  startDate?: string;
  endDate?: string;
  numberOfPlayers?: number;
  numberOfRatedPlayers?: number;
  tournamentType?: string;
  chiefArbiter?: string;
  deputyArbiters?: string;
  timeControl?: string;
  totalRounds?: number;
}

const FIELD = {
  rank: [4, 8],
  sex: [9, 10],
  title: [10, 13],
  name: [14, 47],
  rating: [48, 52],
  federation: [53, 56],
  fideId: [57, 68],
  birthDate: [69, 79],
  points: [80, 84],
  finalRank: [85, 89],
} as const;

const ROUND_START = 91;
const ROUND_WIDTH = 10;

const slice = (line: string, from: number, to: number): string =>
  line.slice(from, to).trim();

/** Result codes as they appear in column 99 of an `001` line. */
type TrfResult = string;

function resultToOutcome(
  code: TrfResult,
  colourCode: string,
  opponentId: string | null,
  round: number,
  scoring: ScoringSystem,
): RoundOutcome {
  const colour: Colour | null =
    colourCode === 'w' ? 'white' : colourCode === 'b' ? 'black' : null;

  switch (code) {
    case '1':
    case 'W':
      return { round, kind: 'played', opponentId, colour, points: scoring.win };
    case '=':
    case 'D':
      return { round, kind: 'played', opponentId, colour, points: scoring.draw };
    case '0':
    case 'L':
      return { round, kind: 'played', opponentId, colour, points: scoring.loss };
    case '+':
      return {
        round,
        kind: 'forfeit-win',
        opponentId,
        colour: null,
        points: scoring.forfeitWin,
      };
    case '-':
      return {
        round,
        kind: 'forfeit-loss',
        opponentId,
        colour: null,
        points: scoring.loss,
      };
    case 'H':
      return {
        round,
        kind: 'half-point-bye',
        opponentId: null,
        colour: null,
        points: scoring.draw,
      };
    case 'F':
      return {
        round,
        kind: 'full-point-bye',
        opponentId: null,
        colour: null,
        points: scoring.win,
      };
    case 'U':
      return {
        round,
        kind: 'pairing-allocated-bye',
        opponentId: null,
        colour: null,
        points: scoring.pairingAllocatedBye,
      };
    case 'Z':
    default:
      return {
        round,
        kind: 'zero-point-bye',
        opponentId: null,
        colour: null,
        points: scoring.loss,
      };
  }
}

function outcomeToResult(o: RoundOutcome, scoring: ScoringSystem): string {
  switch (o.kind) {
    case 'played':
      if (o.points >= scoring.win) return '1';
      if (o.points >= scoring.draw) return '=';
      return '0';
    case 'forfeit-win':
      return '+';
    case 'forfeit-loss':
      return '-';
    case 'half-point-bye':
      return 'H';
    case 'full-point-bye':
      return 'F';
    case 'pairing-allocated-bye':
      return 'U';
    case 'zero-point-bye':
      return 'Z';
  }
}

export interface ParsedTrf {
  tournament: Tournament;
  meta: TrfMeta;
  warnings: string[];
}

/** Read a TRF(x) file into a tournament. */
export function parseTrf(
  text: string,
  options: { scoring?: ScoringSystem; id?: string } = {},
): ParsedTrf {
  const scoring = options.scoring ?? CLASSICAL_SCORING;
  const warnings: string[] = [];
  const meta: TrfMeta = {};
  const lines = text.split(/\r?\n/);

  interface Raw {
    rank: number;
    player: Player;
    rounds: Array<{ opponentRank: number | null; colour: string; result: string }>;
  }
  const raws: Raw[] = [];

  for (const line of lines) {
    if (line.length < 3) continue;
    const tag = line.slice(0, 3);

    switch (tag) {
      case '012':
        meta.name = line.slice(4).trim();
        continue;
      case '022':
        meta.city = line.slice(4).trim();
        continue;
      case '032':
        meta.federation = line.slice(4).trim();
        continue;
      case '042':
        meta.startDate = line.slice(4).trim();
        continue;
      case '052':
        meta.endDate = line.slice(4).trim();
        continue;
      case '062':
        meta.numberOfPlayers = Number(line.slice(4).trim()) || undefined;
        continue;
      case '072':
        meta.numberOfRatedPlayers = Number(line.slice(4).trim()) || undefined;
        continue;
      case '092':
        meta.tournamentType = line.slice(4).trim();
        continue;
      case '102':
        meta.chiefArbiter = line.slice(4).trim();
        continue;
      case '112':
        meta.deputyArbiters = line.slice(4).trim();
        continue;
      case '122':
        meta.timeControl = line.slice(4).trim();
        continue;
      case 'XXR':
        meta.totalRounds = Number(line.slice(4).trim()) || undefined;
        continue;
      case '001':
        break;
      default:
        continue;
    }

    const rank = Number(slice(line, ...FIELD.rank));
    if (!Number.isFinite(rank) || rank <= 0) {
      warnings.push(`Skipped a 001 line with an unreadable rank: "${line.slice(0, 20)}"`);
      continue;
    }

    const ratingText = slice(line, ...FIELD.rating);
    const player: Player = {
      id: `p${rank}`,
      name: slice(line, ...FIELD.name) || `Player ${rank}`,
      rating: ratingText ? Number(ratingText) || 0 : 0,
      title: (slice(line, ...FIELD.title) || undefined) as Player['title'],
      federation: slice(line, ...FIELD.federation) || undefined,
      fideId: slice(line, ...FIELD.fideId) || undefined,
      birthDate: slice(line, ...FIELD.birthDate) || undefined,
      pairingNumber: rank,
    };

    const rounds: Raw['rounds'] = [];
    for (let start = ROUND_START; start < line.length; start += ROUND_WIDTH) {
      const block = line.slice(start, start + ROUND_WIDTH);
      if (!block.trim()) continue;
      const opponentText = block.slice(0, 4).trim();
      const colour = block.slice(5, 6).trim().toLowerCase();
      const result = block.slice(7, 8).trim().toUpperCase();
      if (!result) continue;
      const opponentRank = opponentText && opponentText !== '0000'
        ? Number(opponentText) || null
        : null;
      rounds.push({ opponentRank, colour, result });
    }

    raws.push({ rank, player, rounds });
  }

  const byRank = new Map<number, Raw>();
  for (const r of raws) byRank.set(r.rank, r);

  const results: Record<string, RoundOutcome[]> = {};
  let maxRound = 0;
  for (const raw of raws) {
    const outcomes: RoundOutcome[] = [];
    raw.rounds.forEach((r, i) => {
      const round = i + 1;
      maxRound = Math.max(maxRound, round);
      const opponent = r.opponentRank ? byRank.get(r.opponentRank) : null;
      if (r.opponentRank && !opponent) {
        warnings.push(
          `Player ${raw.rank} round ${round} refers to unknown opponent ${r.opponentRank}.`,
        );
      }
      outcomes.push(
        resultToOutcome(
          r.result,
          r.colour,
          opponent ? opponent.player.id : null,
          round,
          scoring,
        ),
      );
    });
    results[raw.player.id] = outcomes;
  }

  const totalRounds = meta.totalRounds ?? maxRound;
  const now = new Date().toISOString();

  return {
    meta,
    warnings,
    tournament: {
      id: options.id ?? `trf-${Date.now().toString(36)}`,
      name: meta.name ?? 'Imported tournament',
      totalRounds: Math.max(totalRounds, maxRound),
      players: raws.map((r) => r.player),
      results,
      scoring,
      initialColour: 'white',
      roundsPaired: maxRound,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padEnd(width, ' ');
}

function padStart(text: string, width: number): string {
  return text.length >= width ? text.slice(-width) : text.padStart(width, ' ');
}

/** Write a tournament out as TRF(x). */
export function serializeTrf(
  tournament: Tournament,
  meta: TrfMeta = {},
  options: { throughRound?: number } = {},
): string {
  const throughRound = options.throughRound ?? tournament.roundsPaired;
  const { scoring } = tournament;
  const rankOf = new Map<string, number>();
  for (const p of tournament.players) rankOf.set(p.id, p.pairingNumber);

  const lines: string[] = [];
  const push = (tag: string, value: string | number | undefined) => {
    if (value === undefined || value === '') return;
    lines.push(`${tag} ${value}`);
  };

  push('012', meta.name ?? tournament.name);
  push('022', meta.city);
  push('032', meta.federation);
  push('042', meta.startDate);
  push('052', meta.endDate);
  push('062', meta.numberOfPlayers ?? tournament.players.length);
  push(
    '072',
    meta.numberOfRatedPlayers ??
      tournament.players.filter((p) => (p.rating ?? 0) > 0).length,
  );
  push('092', meta.tournamentType ?? 'Individual: Swiss-System');
  push('102', meta.chiefArbiter);
  push('112', meta.deputyArbiters);
  push('122', meta.timeControl);
  push('XXR', tournament.totalRounds);

  const sorted = [...tournament.players].sort(
    (a, b) => a.pairingNumber - b.pairingNumber,
  );

  for (const player of sorted) {
    const outcomes = (tournament.results[player.id] ?? []).filter(
      (o) => o.round <= throughRound,
    );
    const points = outcomes.reduce((s, o) => s + o.points, 0);

    // Build the fixed-column prefix, 1-based columns 1..89.
    let line = '001 ';
    line += padStart(String(player.pairingNumber), 4); // 5–8
    line += ' '; // 9
    line += ' '; // 10 sex, not modelled
    line += pad(player.title ?? '', 3); // 11–13
    line += ' '; // 14
    line += pad(player.name, 33); // 15–47
    line += ' '; // 48
    line += padStart(player.rating ? String(player.rating) : '0', 4); // 49–52
    line += ' '; // 53
    line += pad(player.federation ?? '', 3); // 54–56
    line += ' '; // 57
    line += padStart(player.fideId ?? '', 11); // 58–68
    line += ' '; // 69
    line += pad(player.birthDate ?? '', 10); // 70–79
    line += ' '; // 80
    line += padStart(formatPoints(points), 4); // 81–84
    line += ' '; // 85
    line += padStart('', 4); // 86–89 final rank, filled by the caller if wanted

    for (let round = 1; round <= throughRound; round++) {
      const o = outcomes.find((x) => x.round === round);
      line += '  '; // 90–91
      if (!o) {
        line += `${padStart('0000', 4)} ${'-'} ${'Z'}`;
        continue;
      }
      const opponentRank = o.opponentId ? rankOf.get(o.opponentId) : undefined;
      const colourCode =
        o.colour === 'white' ? 'w' : o.colour === 'black' ? 'b' : '-';
      line += padStart(opponentRank ? String(opponentRank) : '0000', 4);
      line += ` ${colourCode} ${outcomeToResult(o, scoring)}`;
    }

    lines.push(line.trimEnd());
  }

  return lines.join('\n') + '\n';
}

function formatPoints(points: number): string {
  return Number.isInteger(points) ? `${points}.0` : points.toFixed(1);
}
