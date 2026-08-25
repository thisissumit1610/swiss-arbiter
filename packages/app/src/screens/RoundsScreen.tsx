import { useEffect, useMemo, useState } from 'react';
import {
  buildStates,
  commitRound,
  pairRound,
  type GameResult,
  type Pair,
  type RoundPairing,
  type Tournament,
} from '@swiss-arbiter/engine';
import { useStore } from '../lib/store.js';
import { formatScore } from '../lib/format.js';

/**
 * The screen an arbiter actually stands in front of.
 *
 * A round is paired, the pairings go on the wall, results come back board by
 * board, and only then is the round committed. Results are held here until the
 * arbiter saves, so a half-entered round never affects the next pairing.
 */
export function RoundsScreen() {
  const { current, update } = useStore();
  const tournament = current!;
  const [round, setRound] = useState(
    Math.min(tournament.roundsPaired + 1, tournament.totalRounds),
  );
  const [pairing, setPairing] = useState<RoundPairing | null>(null);
  const [results, setResults] = useState<Map<number, GameResult>>(new Map());
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const isPaired = round <= tournament.roundsPaired;

  // A round already played is reconstructed from the stored results rather than
  // re-paired, so looking back at round 2 never disturbs what actually happened.
  const historic = useMemo(
    () => (isPaired ? reconstruct(tournament, round) : null),
    [tournament, round, isPaired],
  );

  useEffect(() => {
    setPairing(null);
    setResults(new Map());
    setPairingError(null);
  }, [round, tournament.id]);

  const doPair = () => {
    setWorking(true);
    setPairingError(null);
    // Let the button repaint before the search starts; a big field can take a
    // second or two and a frozen button looks like a crash.
    setTimeout(() => {
      try {
        const next = pairRound(tournament, round);
        setPairing(next);
        setResults(new Map());
      } catch (e) {
        setPairingError(e instanceof Error ? e.message : String(e));
      } finally {
        setWorking(false);
      }
    }, 20);
  };

  const setResult = (board: number, result: GameResult) => {
    setResults((previous) => {
      const next = new Map(previous);
      if (next.get(board) === result) next.delete(board);
      else next.set(board, result);
      return next;
    });
  };

  const save = () => {
    if (!pairing) return;
    void update(commitRound(tournament, pairing, results));
    setPairing(null);
    setResults(new Map());
    setRound((r) => Math.min(r + 1, tournament.totalRounds));
  };

  const states = useMemo(() => buildStates(tournament, round), [tournament, round]);
  const nameOf = (id: string) =>
    tournament.players.find((p) => p.id === id)?.name ?? id;
  const seedOf = (id: string) =>
    tournament.players.find((p) => p.id === id)?.pairingNumber ?? 0;
  const scoreOf = (id: string) => states.get(id)?.score ?? 0;

  const shown = pairing ?? historic;
  const complete = results.size === (pairing?.pairs.length ?? 0);

  return (
    <>
      <div className="card no-print">
        <div className="card-head">
          <h1>Round {round}</h1>
          <div className="spacer" />
          <div className="row">
            <button
              className="small"
              disabled={round <= 1}
              onClick={() => setRound((r) => r - 1)}
            >
              ‹ Previous
            </button>
            <button
              className="small"
              disabled={round >= tournament.totalRounds}
              onClick={() => setRound((r) => r + 1)}
            >
              Next ›
            </button>
          </div>
        </div>

        <div className="muted small">
          {tournament.roundsPaired} of {tournament.totalRounds} rounds played ·{' '}
          {tournament.players.filter((p) => p.withdrawnAfterRound === undefined).length}{' '}
          players still in
        </div>
      </div>

      {!isPaired && !pairing && (
        <div className="card no-print">
          {tournament.players.length < 2 ? (
            <div className="empty">
              <h2>Add some players first</h2>
              <p>A round needs at least two of them.</p>
            </div>
          ) : round > tournament.roundsPaired + 1 ? (
            <div className="notice info">
              Round {tournament.roundsPaired + 1} has to be played before this one
              can be paired.
            </div>
          ) : (
            <div className="row">
              <button className="primary" onClick={doPair} disabled={working}>
                {working ? 'Pairing…' : `Pair round ${round}`}
              </button>
              <span className="muted small">
                FIDE Dutch system, Handbook C.04.3.
              </span>
            </div>
          )}
          {pairingError && (
            <div className="notice bad" style={{ marginTop: 12 }}>
              <strong>The pairing failed.</strong> {pairingError}
            </div>
          )}
        </div>
      )}

      {shown && (
        <>
          {pairing && !pairing.complete && (
            <div className="notice bad no-print">
              <strong>This round could not be completed.</strong> Every legal
              pairing has been exhausted — with these players, these scores and
              who has already met whom, there is no arrangement that satisfies
              the absolute rules. C.04.3.A.9 leaves this to the arbiter: the
              usual remedies are to allow a repeat pairing, or to give someone a
              bye by hand.
            </div>
          )}
          {pairing && pairing.complete && !pairing.exhaustive && (
            <div className="notice warn no-print">
              <strong>Pairing found, but not proved optimal.</strong> One bracket
              was too large to search to the end, so a marginally better
              arrangement of colours or floats may exist. Every absolute rule
              still holds and the pairing is legal to publish.
            </div>
          )}

          <div className="card">
            <div className="print-only print-head">
              <h1>{tournament.name}</h1>
              <div>Round {round} pairings</div>
            </div>
            <div className="card-head no-print">
              <h2>Pairings</h2>
              <span className="badge">{shown.pairs.length} boards</span>
              <div className="spacer" />
              <button className="small" onClick={() => window.print()}>
                Print
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num">Bd</th>
                    <th>White</th>
                    <th>Black</th>
                    <th className="no-print">Result</th>
                    <th className="print-only">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.pairs.map((pair) => (
                    <BoardRow
                      key={pair.board}
                      pair={pair}
                      nameOf={nameOf}
                      seedOf={seedOf}
                      scoreOf={scoreOf}
                      editable={pairing !== null}
                      chosen={results.get(pair.board)}
                      onChoose={(r) => setResult(pair.board, r)}
                      historicResult={
                        historic ? historicResultFor(tournament, round, pair) : undefined
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {(shown.pairingAllocatedByeId || shown.unpaired.length > 0) && (
              <div style={{ marginTop: 14 }}>
                <h3>Not playing</h3>
                <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
                  {shown.pairingAllocatedByeId && (
                    <li>
                      <strong>{nameOf(shown.pairingAllocatedByeId)}</strong> — bye,{' '}
                      {formatScore(tournament.scoring.pairingAllocatedBye)} point
                    </li>
                  )}
                  {shown.unpaired.map((u) => (
                    <li key={u.playerId}>
                      <strong>{nameOf(u.playerId)}</strong> — {label(u.reason)}
                      {u.reason !== 'withdrawn' && u.reason !== 'not-yet-entered'
                        ? `, ${formatScore(u.points)} point`
                        : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {pairing && (
            <div className="card no-print">
              <div className="row">
                <button className="primary" onClick={save}>
                  {complete
                    ? 'Save round'
                    : `Save round (${results.size} of ${pairing.pairs.length} entered)`}
                </button>
                <button className="ghost" onClick={() => setPairing(null)}>
                  Discard
                </button>
                <div className="spacer" />
                <span className="muted small">
                  Boards left blank stay unplayed and can be filled in later.
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

function BoardRow({
  pair,
  nameOf,
  seedOf,
  scoreOf,
  editable,
  chosen,
  onChoose,
  historicResult,
}: {
  pair: Pair;
  nameOf: (id: string) => string;
  seedOf: (id: string) => number;
  scoreOf: (id: string) => number;
  editable: boolean;
  chosen?: GameResult;
  onChoose: (result: GameResult) => void;
  historicResult?: string;
}) {
  return (
    <tr>
      <td className="num seed">{pair.board}</td>
      <td className="name">
        <span className="colour-dot white" />
        {nameOf(pair.whiteId)}{' '}
        <span className="seed">
          ({seedOf(pair.whiteId)}, {formatScore(scoreOf(pair.whiteId))})
        </span>
      </td>
      <td className="name">
        <span className="colour-dot black" />
        {nameOf(pair.blackId)}{' '}
        <span className="seed">
          ({seedOf(pair.blackId)}, {formatScore(scoreOf(pair.blackId))})
        </span>
      </td>
      <td className="no-print">
        {editable ? (
          <div className="result-group">
            <button
              aria-pressed={chosen === 'white-wins'}
              title="White wins"
              onClick={() => onChoose('white-wins')}
            >
              1–0
            </button>
            <button
              aria-pressed={chosen === 'draw'}
              title="Draw"
              onClick={() => onChoose('draw')}
            >
              ½–½
            </button>
            <button
              aria-pressed={chosen === 'black-wins'}
              title="Black wins"
              onClick={() => onChoose('black-wins')}
            >
              0–1
            </button>
            <button
              aria-pressed={chosen === 'white-forfeit' || chosen === 'black-forfeit'}
              title="Somebody did not appear"
              onClick={() =>
                onChoose(chosen === 'black-forfeit' ? 'white-forfeit' : 'black-forfeit')
              }
            >
              {chosen === 'white-forfeit' ? '−/+' : chosen === 'black-forfeit' ? '+/−' : 'ff'}
            </button>
          </div>
        ) : (
          <span className="score">{historicResult ?? '—'}</span>
        )}
      </td>
      <td className="print-only" style={{ minWidth: '80pt' }} />
    </tr>
  );
}

function label(reason: string): string {
  switch (reason) {
    case 'withdrawn':
      return 'withdrawn';
    case 'half-point-bye':
      return 'requested bye';
    case 'zero-point-bye':
      return 'requested bye, no points';
    case 'not-yet-entered':
      return 'not yet entered';
    default:
      return reason;
  }
}

/** Rebuild a played round's pairings from the stored results. */
function reconstruct(tournament: Tournament, round: number): RoundPairing {
  const pairs: Pair[] = [];
  const seen = new Set<string>();
  let byeId: string | null = null;
  const unpaired: RoundPairing['unpaired'] = [];

  for (const player of tournament.players) {
    const outcome = (tournament.results[player.id] ?? []).find(
      (o) => o.round === round,
    );
    if (!outcome) continue;

    if (outcome.kind === 'pairing-allocated-bye' || outcome.kind === 'full-point-bye') {
      byeId = player.id;
      continue;
    }
    if (outcome.kind === 'half-point-bye' || outcome.kind === 'zero-point-bye') {
      unpaired.push({
        playerId: player.id,
        reason: outcome.kind,
        points: outcome.points,
      });
      continue;
    }
    if (!outcome.opponentId || seen.has(player.id)) continue;

    seen.add(player.id);
    seen.add(outcome.opponentId);
    const white = outcome.colour === 'black' ? outcome.opponentId : player.id;
    const black = white === player.id ? outcome.opponentId : player.id;
    pairs.push({ board: pairs.length + 1, whiteId: white, blackId: black });
  }

  return {
    round,
    pairs,
    pairingAllocatedByeId: byeId,
    unpaired,
    brackets: [],
    exhaustive: true,
    complete: true,
  };
}

function historicResultFor(
  tournament: Tournament,
  round: number,
  pair: Pair,
): string {
  const outcome = (tournament.results[pair.whiteId] ?? []).find(
    (o) => o.round === round,
  );
  if (!outcome) return '—';
  if (outcome.kind === 'forfeit-win') return '+/−';
  if (outcome.kind === 'forfeit-loss') return '−/+';
  const { win, draw } = tournament.scoring;
  if (outcome.points >= win) return '1–0';
  if (outcome.points >= draw) return '½–½';
  return '0–1';
}
