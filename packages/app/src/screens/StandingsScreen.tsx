import { useMemo, useState } from 'react';
import {
  computeStandings,
  DEFAULT_TIEBREAKS,
  TIEBREAK_LABELS,
  type TiebreakId,
} from '@swiss-arbiter/engine';
import { useStore } from '../lib/store.js';
import { formatScore, formatTiebreak } from '../lib/format.js';

const AVAILABLE: TiebreakId[] = [
  'buchholz-cut-1',
  'buchholz',
  'buchholz-median-1',
  'buchholz-cut-2',
  'sonneborn-berger',
  'sonneborn-berger-cut-1',
  'direct-encounter',
  'wins',
  'wins-with-black',
  'games-with-black',
  'cumulative',
  'average-rating-of-opponents',
  'rating',
];

export function StandingsScreen() {
  const { current } = useStore();
  const tournament = current!;
  const [tiebreaks, setTiebreaks] = useState<TiebreakId[]>(DEFAULT_TIEBREAKS);
  const [editing, setEditing] = useState(false);

  const rows = useMemo(
    () =>
      computeStandings(tournament, {
        tiebreaks,
        throughRound: tournament.roundsPaired,
      }),
    [tournament, tiebreaks],
  );

  const toggle = (id: TiebreakId) => {
    setTiebreaks((current) =>
      current.includes(id) ? current.filter((t) => t !== id) : [...current, id],
    );
  };

  const move = (id: TiebreakId, delta: number) => {
    setTiebreaks((current) => {
      const index = current.indexOf(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  if (tournament.roundsPaired === 0) {
    return (
      <div className="card">
        <div className="empty">
          <h2>No rounds played yet</h2>
          <p>Standings appear once the first round has been saved.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card no-print">
        <div className="card-head">
          <h1>Standings</h1>
          <span className="badge">after round {tournament.roundsPaired}</span>
          <div className="spacer" />
          <button className="small" onClick={() => setEditing((v) => !v)}>
            Tie-breaks
          </button>
          <button className="small" onClick={() => window.print()}>
            Print
          </button>
        </div>

        {editing && (
          <div className="stack">
            <p className="muted small">
              Applied in order, and only to players still tied after the previous
              one (C.07 art. 4.2). Announce the list before the tournament starts.
            </p>
            <div>
              {tiebreaks.map((id, index) => (
                <div className="list-item" key={id}>
                  <span className="seed">{index + 1}</span>
                  <div className="grow">{TIEBREAK_LABELS[id]}</div>
                  <button
                    className="small ghost"
                    disabled={index === 0}
                    onClick={() => move(id, -1)}
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    className="small ghost"
                    disabled={index === tiebreaks.length - 1}
                    onClick={() => move(id, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button className="small ghost danger" onClick={() => toggle(id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div>
              <label>Add a tie-break</label>
              <div className="row">
                {AVAILABLE.filter((id) => !tiebreaks.includes(id)).map((id) => (
                  <button key={id} className="small" onClick={() => toggle(id)}>
                    + {TIEBREAK_LABELS[id]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="print-only print-head">
          <h1>{tournament.name}</h1>
          <div>Standings after round {tournament.roundsPaired}</div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Name</th>
                <th className="num">Rtg</th>
                <th className="num">Pts</th>
                {tiebreaks.map((id) => (
                  <th key={id} className="num" title={TIEBREAK_LABELS[id]}>
                    {abbreviate(id)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.playerId}>
                  <td className="num seed">
                    {row.rank}
                    {row.sharedRank ? '=' : ''}
                  </td>
                  <td className="name">
                    {row.title ? (
                      <span className="badge" style={{ marginRight: 6 }}>
                        {row.title}
                      </span>
                    ) : null}
                    {row.name}
                  </td>
                  <td className="num">{row.rating || '—'}</td>
                  <td className="num score">{formatScore(row.score)}</td>
                  {row.tiebreaks.map((tb) => (
                    <td key={tb.id} className="num">
                      {formatTiebreak(tb.value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
          Tie-breaks:{' '}
          {tiebreaks.map((id) => `${abbreviate(id)} = ${TIEBREAK_LABELS[id]}`).join(' · ')}
        </p>
      </div>
    </>
  );
}

function abbreviate(id: TiebreakId): string {
  const map: Partial<Record<TiebreakId, string>> = {
    buchholz: 'BH',
    'buchholz-cut-1': 'BH-1',
    'buchholz-cut-2': 'BH-2',
    'buchholz-median-1': 'MBH',
    'sonneborn-berger': 'SB',
    'sonneborn-berger-cut-1': 'SB-1',
    'direct-encounter': 'DE',
    wins: 'W',
    'wins-with-black': 'BW',
    'games-with-black': 'BG',
    'games-played': 'GP',
    'average-rating-of-opponents': 'ARO',
    'average-rating-of-opponents-cut-1': 'ARO-1',
    cumulative: 'CUM',
    'cumulative-cut-1': 'CUM-1',
    rating: 'RTG',
  };
  return map[id] ?? id;
}
