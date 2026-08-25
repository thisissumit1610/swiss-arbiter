import { useState } from 'react';
import {
  computeStandings,
  DEFAULT_TIEBREAKS,
  serializeTrf,
  TIEBREAK_LABELS,
} from '@swiss-arbiter/engine';
import { useStore } from '../lib/store.js';
import { download, formatScore, toCsv, tournamentFilename } from '../lib/format.js';

export function ExportScreen() {
  const { current } = useStore();
  const tournament = current!;
  const [meta, setMeta] = useState({ city: '', federation: '', chiefArbiter: '' });

  const exportJson = () => {
    download(
      tournamentFilename(tournament, 'json'),
      JSON.stringify(tournament, null, 2),
      'application/json',
    );
  };

  const exportTrf = () => {
    const text = serializeTrf(tournament, {
      name: tournament.name,
      city: meta.city || undefined,
      federation: meta.federation || undefined,
      chiefArbiter: meta.chiefArbiter || undefined,
    });
    download(tournamentFilename(tournament, 'trf'), text);
  };

  const exportStandingsCsv = () => {
    const rows = computeStandings(tournament, {
      tiebreaks: DEFAULT_TIEBREAKS,
      throughRound: tournament.roundsPaired,
    });
    const header = [
      'Rank',
      'Name',
      'Rating',
      'Federation',
      'Points',
      ...DEFAULT_TIEBREAKS.map((id) => TIEBREAK_LABELS[id]),
    ];
    const body = rows.map((row) => [
      row.rank,
      row.name,
      row.rating ?? '',
      row.federation ?? '',
      formatScore(row.score),
      ...row.tiebreaks.map((tb) => (tb.value === null ? '' : tb.value)),
    ]);
    download(
      `${tournamentFilename(tournament, '')}standings.csv`,
      toCsv([header, ...body]),
      'text/csv',
    );
  };

  const exportCrosstable = () => {
    const players = [...tournament.players].sort(
      (a, b) => a.pairingNumber - b.pairingNumber,
    );
    const header = [
      '#',
      'Name',
      ...Array.from({ length: tournament.roundsPaired }, (_, i) => `R${i + 1}`),
      'Total',
    ];
    const body = players.map((player) => {
      const outcomes = tournament.results[player.id] ?? [];
      const cells = Array.from({ length: tournament.roundsPaired }, (_, i) => {
        const o = outcomes.find((x) => x.round === i + 1);
        if (!o) return '';
        if (o.kind === 'pairing-allocated-bye' || o.kind === 'full-point-bye') {
          return 'bye';
        }
        if (o.kind === 'half-point-bye' || o.kind === 'zero-point-bye') return 'req';
        const opponent = tournament.players.find((p) => p.id === o.opponentId);
        const seed = opponent?.pairingNumber ?? '?';
        const colour = o.colour === 'white' ? 'w' : o.colour === 'black' ? 'b' : '-';
        const mark =
          o.kind === 'forfeit-win'
            ? '+'
            : o.kind === 'forfeit-loss'
              ? '-'
              : o.points >= tournament.scoring.win
                ? '1'
                : o.points >= tournament.scoring.draw
                  ? '='
                  : '0';
        return `${seed}${colour}${mark}`;
      });
      const total = outcomes.reduce((s, o) => s + o.points, 0);
      return [player.pairingNumber, player.name, ...cells, formatScore(total)];
    });
    download(
      `${tournamentFilename(tournament, '')}crosstable.csv`,
      toCsv([header, ...body]),
      'text/csv',
    );
  };

  return (
    <>
      <div className="card">
        <h1>Export</h1>
        <p className="muted">
          Take a copy at the end of every round. The tournament lives in this
          browser's storage and nowhere else, so an export is the only thing that
          survives a lost or wiped device.
        </p>

        <div className="stack">
          <div className="list-item">
            <div className="grow">
              <div className="title">Full backup (JSON)</div>
              <div className="muted small">
                Everything, exactly as stored. Import it here to carry on where
                you left off, on this device or another.
              </div>
            </div>
            <button className="primary" onClick={exportJson}>
              Download
            </button>
          </div>

          <div className="list-item">
            <div className="grow">
              <div className="title">FIDE tournament report (TRF)</div>
              <div className="muted small">
                The interchange format used for rating submission and read by
                Swiss-Manager, Vega, JaVaFo and bbpPairings.
              </div>
            </div>
            <button onClick={exportTrf} disabled={tournament.roundsPaired === 0}>
              Download
            </button>
          </div>

          <div className="list-item">
            <div className="grow">
              <div className="title">Standings (CSV)</div>
              <div className="muted small">
                Final order with tie-break columns, for a spreadsheet or a notice
                board.
              </div>
            </div>
            <button onClick={exportStandingsCsv} disabled={tournament.roundsPaired === 0}>
              Download
            </button>
          </div>

          <div className="list-item">
            <div className="grow">
              <div className="title">Cross-table (CSV)</div>
              <div className="muted small">
                One row per player, one column per round, in the usual
                opponent-colour-result notation.
              </div>
            </div>
            <button onClick={exportCrosstable} disabled={tournament.roundsPaired === 0}>
              Download
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Details for the TRF header</h2>
        <p className="muted small">
          Optional, but rating submissions expect them.
        </p>
        <div className="grid">
          <div className="field">
            <label htmlFor="x-city">City</label>
            <input
              id="x-city"
              value={meta.city}
              placeholder="Varanasi"
              onChange={(e) => setMeta({ ...meta, city: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="x-fed">Federation</label>
            <input
              id="x-fed"
              value={meta.federation}
              maxLength={3}
              placeholder="IND"
              onChange={(e) =>
                setMeta({ ...meta, federation: e.target.value.toUpperCase() })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="x-arbiter">Chief arbiter</label>
            <input
              id="x-arbiter"
              value={meta.chiefArbiter}
              onChange={(e) => setMeta({ ...meta, chiefArbiter: e.target.value })}
            />
          </div>
        </div>
      </div>
    </>
  );
}
