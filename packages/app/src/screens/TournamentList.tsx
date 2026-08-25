import { useRef, useState } from 'react';
import {
  CLASSICAL_SCORING,
  createTournament,
  parseTrf,
  type Colour,
  type Tournament,
} from '@swiss-arbiter/engine';
import { useStore } from '../lib/store.js';
import { formatScore } from '../lib/format.js';

export function TournamentList() {
  const { tournaments, open, create, remove } = useStore();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h1>Tournaments</h1>
          <div className="spacer" />
          {!creating && (
            <button className="primary" onClick={() => setCreating(true)}>
              New tournament
            </button>
          )}
        </div>

        {creating ? (
          <NewTournamentForm
            onCancel={() => setCreating(false)}
            onCreate={async (t) => {
              await create(t);
              setCreating(false);
            }}
          />
        ) : tournaments.length === 0 ? (
          <div className="empty">
            <h2>Nothing here yet</h2>
            <p>
              Create a tournament, or bring one in from another program as a TRF
              file or a previous export.
            </p>
          </div>
        ) : (
          <div>
            {tournaments.map((t) => (
              <div className="list-item" key={t.id}>
                <div className="grow">
                  <div className="title">{t.name}</div>
                  <div className="muted small">
                    {t.players.length} players · {t.totalRounds} rounds ·{' '}
                    {t.roundsPaired === 0
                      ? 'not started'
                      : `after round ${t.roundsPaired}`}{' '}
                    · saved {new Date(t.updatedAt).toLocaleString()}
                  </div>
                </div>
                <button onClick={() => void open(t.id)}>Open</button>
                <button
                  className="danger ghost small"
                  onClick={() => {
                    const ok = window.confirm(
                      `Delete "${t.name}" and all of its results? This cannot be undone.`,
                    );
                    if (ok) void remove(t.id);
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ImportCard onImported={create} />

      <div className="card">
        <h2>How this works</h2>
        <p className="muted">
          Pairings follow the FIDE Dutch system (Handbook C.04.3), and tie-breaks
          follow the Play-Off and Tie-Break Regulations. Everything is stored on
          this device and nothing is sent anywhere, so the app works identically
          with the network switched off. Keep an export at the end of each round
          if the tournament matters.
        </p>
      </div>
    </>
  );
}

function NewTournamentForm({
  onCreate,
  onCancel,
}: {
  onCreate: (t: Tournament) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [rounds, setRounds] = useState(5);
  const [initialColour, setInitialColour] = useState<Colour>('white');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    void onCreate(
      createTournament({
        name: name.trim(),
        totalRounds: rounds,
        players: [],
        scoring: CLASSICAL_SCORING,
        initialColour,
      }),
    );
  };

  return (
    <form onSubmit={submit} className="stack">
      <div className="grid">
        <div className="field">
          <label htmlFor="t-name">Tournament name</label>
          <input
            id="t-name"
            value={name}
            autoFocus
            placeholder="Campus Open 2026"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="t-rounds">Rounds</label>
          <input
            id="t-rounds"
            type="number"
            min={1}
            max={23}
            value={rounds}
            onChange={(e) => setRounds(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <div className="field">
          <label htmlFor="t-colour">Board 1 colour, round 1</label>
          <select
            id="t-colour"
            value={initialColour}
            onChange={(e) => setInitialColour(e.target.value as Colour)}
          >
            <option value="white">White to the top seed</option>
            <option value="black">Black to the top seed</option>
          </select>
        </div>
      </div>
      <p className="muted small">
        The number of rounds has to be fixed before play starts (C.04.1.a), and
        board 1's colour is drawn by lot before the first pairing (C.04.3.E).
      </p>
      <div className="row">
        <button type="submit" className="primary" disabled={!name.trim()}>
          Create
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ImportCard({
  onImported,
}: {
  onImported: (t: Tournament) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const handleFile = async (file: File) => {
    setError(null);
    setWarnings([]);
    const text = await file.text();

    try {
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(text) as Tournament;
        if (!parsed.players || !parsed.results) {
          throw new Error('That JSON file is not a tournament export.');
        }
        // A fresh id avoids silently overwriting a tournament already stored.
        await onImported({
          ...parsed,
          id: `${parsed.id}-imported-${Date.now().toString(36)}`,
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      const { tournament, warnings: found } = parseTrf(text);
      if (tournament.players.length === 0) {
        throw new Error('No player records were found in that file.');
      }
      setWarnings(found);
      await onImported(tournament);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.');
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Import</h2>
        <div className="spacer" />
        <button onClick={() => fileRef.current?.click()}>Choose a file</button>
      </div>
      <p className="muted">
        A TRF file from Swiss-Manager, Vega or any FIDE-compatible program, or a
        JSON export from this app.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".trf,.trfx,.txt,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />
      {error && <div className="notice bad">{error}</div>}
      {warnings.length > 0 && (
        <div className="notice warn">
          <strong>Imported with {warnings.length} warning(s).</strong>
          <ul>
            {warnings.slice(0, 6).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Exported for the tournament list summary line. */
export function summarise(t: Tournament): string {
  const totals = Object.values(t.results).map((rounds) =>
    rounds.reduce((s, r) => s + r.points, 0),
  );
  const best = totals.length ? Math.max(...totals) : 0;
  return `leader on ${formatScore(best)}`;
}
