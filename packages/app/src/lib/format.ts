/**
 * Formatting and file helpers shared across screens.
 */

import type { Player, Tournament } from '@swiss-arbiter/engine';

/** Scores read better as 3, 3½, 0 than as 3, 3.5, 0. */
export function formatScore(points: number): string {
  const whole = Math.floor(points);
  const fraction = points - whole;
  if (Math.abs(fraction - 0.5) < 1e-9) return whole === 0 ? '½' : `${whole}½`;
  if (Math.abs(fraction) < 1e-9) return String(whole);
  return points.toFixed(1);
}

export function formatTiebreak(value: number | null): string {
  if (value === null) return '–';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, '');
}

export function playerLabel(player: Player | undefined): string {
  if (!player) return 'unknown';
  return player.title ? `${player.title} ${player.name}` : player.name;
}

export function download(filename: string, contents: string, type = 'text/plain') {
  const blob = new Blob([contents], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'tournament'
  );
}

/**
 * Parse a pasted player list.
 *
 * Accepts one player per line, fields separated by commas or tabs:
 *
 *   Name, rating, federation, title
 *
 * Only the name is required, and the remaining fields may be given in any
 * order the parser can recognise — a 3–4 digit number is a rating, three
 * capitals are a federation, and a known abbreviation is a title. Entering a
 * field list is exactly the kind of fiddly step that goes wrong under time
 * pressure on the morning of a tournament, so the parser works it out instead.
 */
export interface ParsedPlayer {
  name: string;
  rating?: number;
  federation?: string;
  title?: Player['title'];
}

const TITLES = new Set(['GM', 'IM', 'WGM', 'FM', 'WIM', 'CM', 'WFM', 'WCM']);

export function parsePlayerList(text: string): {
  players: ParsedPlayer[];
  problems: string[];
} {
  const players: ParsedPlayer[] = [];
  const problems: string[] = [];

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .forEach((line, index) => {
      const fields = line
        .split(/[\t,;]/)
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
      if (fields.length === 0) return;

      const entry: ParsedPlayer = { name: '' };
      const leftovers: string[] = [];

      for (const field of fields) {
        const upper = field.toUpperCase();
        if (!entry.title && TITLES.has(upper)) {
          entry.title = upper as Player['title'];
        } else if (entry.rating === undefined && /^\d{3,4}$/.test(field)) {
          entry.rating = Number(field);
        } else if (!entry.federation && /^[A-Za-z]{3}$/.test(field) && field === upper) {
          entry.federation = upper;
        } else {
          leftovers.push(field);
        }
      }

      entry.name = leftovers.join(' ').trim();
      if (!entry.name) {
        problems.push(`Line ${index + 1}: could not find a name in "${line}"`);
        return;
      }
      players.push(entry);
    });

  return { players, problems };
}

export function toCsv(rows: Array<Array<string | number>>): string {
  const escape = (cell: string | number) => {
    const text = String(cell);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(escape).join(',')).join('\n') + '\n';
}

export function tournamentFilename(tournament: Tournament, extension: string): string {
  return `${slug(tournament.name)}.${extension}`;
}
