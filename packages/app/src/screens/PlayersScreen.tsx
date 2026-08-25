import { useMemo, useState } from 'react';
import {
  addPlayer,
  assignPairingNumbers,
  buildStates,
  requestBye,
  withdrawPlayer,
  type Player,
} from '@swiss-arbiter/engine';
import { useStore } from '../lib/store.js';
import { formatScore, parsePlayerList } from '../lib/format.js';

export function PlayersScreen() {
  const { current, update } = useStore();
  const tournament = current!;
  const [bulk, setBulk] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const states = useMemo(
    () => buildStates(tournament, tournament.roundsPaired + 1),
    [tournament],
  );

  const ordered = useMemo(
    () => [...tournament.players].sort((a, b) => a.pairingNumber - b.pairingNumber),
    [tournament.players],
  );

  const locked = tournament.roundsPaired >= 4;

  const addOne = (fields: {
    name: string;
    rating?: number;
    federation?: string;
    title?: Player['title'];
  }) => {
    const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    return addPlayer(tournament, { id, ...fields });
  };

  const applyBulk = () => {
    const { players, problems: found } = parsePlayerList(bulk);
    setProblems(found);
    if (players.length === 0) return;

    let next = tournament;
    for (const p of players) {
      const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      next = addPlayer(next, { id, ...p });
    }
    void update(next);
    setBulk('');
    setBulkOpen(false);
  };

  return (
    <>
      <div className="card no-print">
        <div className="card-head">
          <h1>Players</h1>
          <span className="badge">{tournament.players.length} entered</span>
          <div className="spacer" />
          <button onClick={() => setBulkOpen((v) => !v)}>
            {bulkOpen ? 'Close list entry' : 'Paste a list'}
          </button>
        </div>

        {bulkOpen ? (
          <div className="stack">
            <div>
              <label htmlFor="bulk">
                One player per line — name, rating, federation, title, in any order
              </label>
              <textarea
                id="bulk"
                value={bulk}
                autoFocus
                placeholder={
                  'Ananya Sharma, 1842, IND\nRohit Verma, 1655\nFM Kabir Rao, 2105, IND\nMeera Nair'
                }
                onChange={(e) => setBulk(e.target.value)}
              />
            </div>
            {problems.length > 0 && (
              <div className="notice warn">
                {problems.map((p) => (
                  <div key={p}>{p}</div>
                ))}
              </div>
            )}
            <div className="row">
              <button className="primary" onClick={applyBulk} disabled={!bulk.trim()}>
                Add these players
              </button>
              <span className="muted small">
                Unrated players are fine — leave the number out.
              </span>
            </div>
          </div>
        ) : (
          <AddPlayerForm onAdd={(fields) => void update(addOne(fields))} />
        )}
      </div>

      {tournament.players.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Starting list</h2>
            <div className="spacer" />
            {!locked && tournament.players.length > 1 && (
              <button
                className="small"
                onClick={() =>
                  void update({
                    ...tournament,
                    players: assignPairingNumbers(tournament.players),
                    updatedAt: new Date().toISOString(),
                  })
                }
              >
                Re-seed by rating
              </button>
            )}
          </div>

          {locked && (
            <div className="notice info no-print">
              Pairing numbers are fixed from round four onwards (C.04.2.B.3), so
              re-seeding is no longer offered. Players added now go to the end of
              the list.
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Name</th>
                  <th className="num">Rating</th>
                  <th>Fed</th>
                  <th className="num">Score</th>
                  <th className="no-print">Status</th>
                  <th className="no-print" />
                </tr>
              </thead>
              <tbody>
                {ordered.map((player) => {
                  const state = states.get(player.id);
                  const withdrawn = player.withdrawnAfterRound !== undefined;
                  const nextRound = tournament.roundsPaired + 1;
                  const byeRequested = player.requestedByes?.some(
                    (b) => b.round === nextRound,
                  );
                  return (
                    <tr key={player.id}>
                      <td className="num seed">{player.pairingNumber}</td>
                      <td className="name">
                        {player.title ? (
                          <span className="badge" style={{ marginRight: 6 }}>
                            {player.title}
                          </span>
                        ) : null}
                        {player.name}
                      </td>
                      <td className="num">{player.rating || '—'}</td>
                      <td>{player.federation ?? '—'}</td>
                      <td className="num score">
                        {formatScore(state?.score ?? 0)}
                      </td>
                      <td className="no-print">
                        {withdrawn ? (
                          <span className="badge bad">
                            withdrew after r{player.withdrawnAfterRound}
                          </span>
                        ) : byeRequested ? (
                          <span className="badge warn">bye in r{nextRound}</span>
                        ) : (
                          <span className="badge good">playing</span>
                        )}
                      </td>
                      <td className="no-print">
                        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          {!withdrawn && (
                            <>
                              <button
                                className="small ghost"
                                title={`Do not pair in round ${nextRound}; award half a point`}
                                onClick={() =>
                                  void update(
                                    requestBye(
                                      tournament,
                                      player.id,
                                      nextRound,
                                      byeRequested ? 0 : 0.5,
                                    ),
                                  )
                                }
                              >
                                {byeRequested ? 'Cancel bye' : '½ bye'}
                              </button>
                              <button
                                className="small ghost danger"
                                onClick={() =>
                                  void update(
                                    withdrawPlayer(
                                      tournament,
                                      player.id,
                                      tournament.roundsPaired,
                                    ),
                                  )
                                }
                              >
                                Withdraw
                              </button>
                            </>
                          )}
                          {withdrawn && (
                            <button
                              className="small ghost"
                              onClick={() =>
                                void update({
                                  ...tournament,
                                  players: tournament.players.map((p) =>
                                    p.id === player.id
                                      ? { ...p, withdrawnAfterRound: undefined }
                                      : p,
                                  ),
                                  updatedAt: new Date().toISOString(),
                                })
                              }
                            >
                              Reinstate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function AddPlayerForm({
  onAdd,
}: {
  onAdd: (fields: {
    name: string;
    rating?: number;
    federation?: string;
    title?: Player['title'];
  }) => void;
}) {
  const [name, setName] = useState('');
  const [rating, setRating] = useState('');
  const [federation, setFederation] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd({
      name: trimmed,
      rating: rating ? Number(rating) : undefined,
      federation: federation.trim().toUpperCase() || undefined,
    });
    setName('');
    setRating('');
  };

  return (
    <form onSubmit={submit}>
      <div className="grid">
        <div className="field" style={{ flexBasis: 260 }}>
          <label htmlFor="p-name">Name</label>
          <input
            id="p-name"
            value={name}
            placeholder="Ananya Sharma"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="p-rating">Rating</label>
          <input
            id="p-rating"
            inputMode="numeric"
            value={rating}
            placeholder="unrated"
            onChange={(e) => setRating(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className="field">
          <label htmlFor="p-fed">Federation</label>
          <input
            id="p-fed"
            value={federation}
            maxLength={3}
            placeholder="IND"
            onChange={(e) => setFederation(e.target.value)}
          />
        </div>
        <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button type="submit" className="primary" disabled={!name.trim()}>
            Add player
          </button>
        </div>
      </div>
    </form>
  );
}
