import { useEffect, useState } from 'react';
import { useStore } from './lib/store.js';
import { TournamentList } from './screens/TournamentList.js';
import { PlayersScreen } from './screens/PlayersScreen.js';
import { RoundsScreen } from './screens/RoundsScreen.js';
import { StandingsScreen } from './screens/StandingsScreen.js';
import { ExportScreen } from './screens/ExportScreen.js';

type Tab = 'players' | 'rounds' | 'standings' | 'export';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'players', label: 'Players' },
  { id: 'rounds', label: 'Rounds' },
  { id: 'standings', label: 'Standings' },
  { id: 'export', label: 'Export' },
];

function readTab(): Tab {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return (TABS.find((t) => t.id === hash)?.id ?? 'players') as Tab;
}

export function App() {
  const { current, open, loading, storageOk, canUndo, undo } = useStore();
  const [tab, setTab] = useState<Tab>(readTab);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const go = (next: Tab) => {
    window.location.hash = `/${next}`;
    setTab(next);
  };

  if (loading) {
    return (
      <div className="app">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  if (!storageOk) {
    return (
      <div className="app">
        <main>
          <div className="notice bad">
            <strong>This browser will not let the app store anything.</strong> That
            usually means private browsing, or storage blocked for this site.
            Nothing entered here would survive a refresh, so the app has stopped
            rather than risk losing a round of results. Try a normal window, or a
            different browser.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="brand">
          Swiss Arbiter{current ? <span> · {current.name}</span> : null}
        </div>
        <div className="spacer" />
        {!online && (
          <span className="badge good" title="Everything works without a network">
            Offline
          </span>
        )}
        {current && (
          <>
            <button className="small ghost" onClick={() => void undo()} disabled={!canUndo}>
              Undo
            </button>
            <button className="small ghost" onClick={() => void open(null)}>
              Close
            </button>
          </>
        )}
      </header>

      {current ? (
        <>
          <nav className="tabs no-print">
            {TABS.map((t) => (
              <button
                key={t.id}
                aria-current={tab === t.id}
                onClick={() => go(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <main>
            {tab === 'players' && <PlayersScreen />}
            {tab === 'rounds' && <RoundsScreen />}
            {tab === 'standings' && <StandingsScreen />}
            {tab === 'export' && <ExportScreen />}
          </main>
        </>
      ) : (
        <main>
          <TournamentList />
        </main>
      )}
    </div>
  );
}
