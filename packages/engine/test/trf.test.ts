/**
 * TRF(x) reading and writing — the format arbiter software exchanges.
 *
 * The `001` record is fixed-column, so the fixtures here are built by placing
 * each field at the column the specification gives it rather than by counting
 * spaces in a string literal. That way the test states what the format is,
 * and a fixture cannot drift out of alignment without the intent being obvious.
 */

import { describe, expect, it } from 'vitest';
import {
  commitRound,
  createTournament,
  pairRound,
  parseTrf,
  serializeTrf,
  type GameResult,
} from '../src/index.js';

/** Place `text` at 1-based columns [from, to] of a line under construction. */
function put(line: string, from: number, to: number, text: string, right = false): string {
  const width = to - from + 1;
  const padded = right
    ? text.slice(0, width).padStart(width, ' ')
    : text.slice(0, width).padEnd(width, ' ');
  const base = line.padEnd(from - 1, ' ');
  return base.slice(0, from - 1) + padded + base.slice(from - 1 + width);
}

interface Round {
  opponent: number;
  colour: 'w' | 'b' | '-';
  result: string;
}

function playerLine(fields: {
  rank: number;
  title?: string;
  name: string;
  rating: number;
  federation: string;
  fideId: string;
  birthDate: string;
  points: string;
  rounds: Round[];
}): string {
  let line = '001';
  line = put(line, 5, 8, String(fields.rank), true);
  line = put(line, 11, 13, fields.title ?? '');
  line = put(line, 15, 47, fields.name);
  line = put(line, 49, 52, String(fields.rating), true);
  line = put(line, 54, 56, fields.federation);
  line = put(line, 58, 68, fields.fideId, true);
  line = put(line, 70, 79, fields.birthDate);
  line = put(line, 81, 84, fields.points, true);

  fields.rounds.forEach((r, i) => {
    const start = 92 + i * 10; // opponent occupies [start, start + 3]
    line = put(line, start, start + 3, String(r.opponent), true);
    line = put(line, start + 5, start + 5, r.colour);
    line = put(line, start + 7, start + 7, r.result);
  });
  return line;
}

const SAMPLE = [
  '012 Campus Open',
  '022 Varanasi',
  '032 IND',
  '102 A. Arbiter',
  'XXR 3',
  playerLine({
    rank: 1, name: 'Carlsen Magnus', rating: 2830, federation: 'NOR',
    fideId: '1503014', birthDate: '1990/11/30', points: '3.0',
    rounds: [
      { opponent: 3, colour: 'w', result: '1' },
      { opponent: 2, colour: 'b', result: '1' },
      { opponent: 4, colour: 'w', result: '1' },
    ],
  }),
  playerLine({
    rank: 2, name: 'Gukesh D', rating: 2794, federation: 'IND',
    fideId: '46616543', birthDate: '2006/05/29', points: '2.0',
    rounds: [
      { opponent: 4, colour: 'b', result: '1' },
      { opponent: 1, colour: 'w', result: '0' },
      { opponent: 3, colour: 'b', result: '1' },
    ],
  }),
  playerLine({
    rank: 3, name: 'Nakamura Hikaru', rating: 2802, federation: 'USA',
    fideId: '2016192', birthDate: '1987/12/09', points: '0.5',
    rounds: [
      { opponent: 1, colour: 'b', result: '0' },
      { opponent: 4, colour: 'w', result: '=' },
      { opponent: 2, colour: 'w', result: '0' },
    ],
  }),
  playerLine({
    rank: 4, name: 'Caruana Fabiano', rating: 2805, federation: 'USA',
    fideId: '2020009', birthDate: '1992/07/30', points: '0.5',
    rounds: [
      { opponent: 2, colour: 'w', result: '0' },
      { opponent: 3, colour: 'b', result: '=' },
      { opponent: 1, colour: 'b', result: '0' },
    ],
  }),
].join('\n');

describe('parsing TRF', () => {
  it('reads the header fields', () => {
    const { meta, tournament } = parseTrf(SAMPLE);
    expect(meta.name).toBe('Campus Open');
    expect(meta.city).toBe('Varanasi');
    expect(meta.federation).toBe('IND');
    expect(meta.chiefArbiter).toBe('A. Arbiter');
    expect(tournament.totalRounds).toBe(3);
  });

  it('reads the players in starting-rank order', () => {
    const { tournament } = parseTrf(SAMPLE);
    expect(tournament.players).toHaveLength(4);
    expect(tournament.players[0]).toMatchObject({
      name: 'Carlsen Magnus',
      rating: 2830,
      federation: 'NOR',
      fideId: '1503014',
      birthDate: '1990/11/30',
      pairingNumber: 1,
    });
    expect(tournament.players[3]).toMatchObject({
      name: 'Caruana Fabiano',
      pairingNumber: 4,
    });
  });

  it('reads results, colours and opponents', () => {
    const { tournament } = parseTrf(SAMPLE);
    const first = tournament.results['p1'];
    expect(first).toHaveLength(3);
    expect(first[0]).toMatchObject({
      round: 1,
      kind: 'played',
      opponentId: 'p3',
      colour: 'white',
      points: 1,
    });
    expect(first[1]).toMatchObject({ opponentId: 'p2', colour: 'black', points: 1 });
    expect(first.reduce((s, o) => s + o.points, 0)).toBe(3);
  });

  it('agrees with the points column for every player', () => {
    const { tournament } = parseTrf(SAMPLE);
    const expected: Record<string, number> = { p1: 3, p2: 2, p3: 0.5, p4: 0.5 };
    for (const [id, points] of Object.entries(expected)) {
      const total = tournament.results[id].reduce((s, o) => s + o.points, 0);
      expect(total, `${id}`).toBe(points);
    }
  });

  it('reports references to players that are not in the file', () => {
    const broken = SAMPLE.split('\n').map((line) =>
      line.startsWith('001') && line.slice(4, 8).trim() === '1'
        ? put(line, 92, 95, '99', true)
        : line,
    ).join('\n');
    const { warnings } = parseTrf(broken);
    expect(warnings.join(' ')).toContain('99');
  });
});

describe('writing TRF', () => {
  it('round-trips a parsed tournament', () => {
    const { tournament } = parseTrf(SAMPLE);
    const text = serializeTrf(tournament, { name: 'Campus Open' });
    const again = parseTrf(text);

    expect(again.tournament.players.map((p) => p.name)).toEqual(
      tournament.players.map((p) => p.name),
    );
    for (const player of tournament.players) {
      const before = tournament.results[player.id];
      const after = again.tournament.results[player.id];
      expect(after, player.name).toHaveLength(before.length);
      for (let i = 0; i < before.length; i++) {
        expect(after[i], `${player.name} round ${i + 1}`).toMatchObject({
          round: before[i].round,
          kind: before[i].kind,
          colour: before[i].colour,
          points: before[i].points,
        });
        expect(after[i].opponentId).toBe(before[i].opponentId);
      }
    }
  });

  it('keeps the fixed columns the format specifies', () => {
    const { tournament } = parseTrf(SAMPLE);
    const lines = serializeTrf(tournament)
      .split('\n')
      .filter((l) => l.startsWith('001'));

    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line.slice(0, 3)).toBe('001');
      expect(line.slice(4, 8).trim()).toMatch(/^\d+$/); // rank, columns 5-8
      expect(line.slice(48, 52).trim()).toMatch(/^\d+$/); // rating, columns 49-52
      expect(line.slice(53, 56).trim()).toMatch(/^[A-Z]{3}$/); // federation
      expect(line.slice(80, 84).trim()).toMatch(/^\d+\.\d$/); // points
      expect(line.slice(91, 95).trim()).toMatch(/^\d+$/); // round 1 opponent
      expect(line[96]).toMatch(/^[wb-]$/); // round 1 colour
    }
  });

  it('writes byes and forfeits with the right codes', () => {
    let tournament = createTournament({
      name: 'bye test',
      totalRounds: 2,
      players: [
        { id: 'a', name: 'Alpha', rating: 2000 },
        { id: 'b', name: 'Bravo', rating: 1900 },
        { id: 'c', name: 'Charlie', rating: 1800 },
      ],
    });
    const pairing = pairRound(tournament, 1);
    expect(pairing.pairingAllocatedByeId).not.toBeNull();

    const results = new Map<number, GameResult>([[1, 'black-forfeit']]);
    tournament = commitRound(tournament, pairing, results);

    const lines = serializeTrf(tournament)
      .split('\n')
      .filter((l) => l.startsWith('001'));
    const codes = lines.map((l) => l[98]);

    expect(codes).toContain('U'); // pairing-allocated bye
    expect(codes).toContain('+'); // forfeit win
    expect(codes).toContain('-'); // forfeit loss
  });
});
