/**
 * Application state.
 *
 * One tournament is open at a time. Every mutation produces a new Tournament
 * object from the engine's pure helpers and is written straight to IndexedDB,
 * which keeps undo trivial and means the on-screen state and the saved state
 * can never disagree.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Tournament } from '@swiss-arbiter/engine';
import {
  deleteTournament as dbDelete,
  listTournaments,
  loadTournament,
  requestPersistentStorage,
  saveTournament,
  storageAvailable,
} from './db.js';

interface StoreValue {
  tournaments: Tournament[];
  current: Tournament | null;
  loading: boolean;
  storageOk: boolean;
  /** Past states of the open tournament, most recent first. */
  canUndo: boolean;
  open: (id: string | null) => Promise<void>;
  update: (next: Tournament) => Promise<void>;
  create: (tournament: Tournament) => Promise<void>;
  remove: (id: string) => Promise<void>;
  undo: () => Promise<void>;
  refresh: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

const UNDO_DEPTH = 30;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [current, setCurrent] = useState<Tournament | null>(null);
  const [history, setHistory] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageOk, setStorageOk] = useState(true);

  const refresh = useCallback(async () => {
    setTournaments(await listTournaments());
  }, []);

  useEffect(() => {
    void (async () => {
      const ok = await storageAvailable();
      setStorageOk(ok);
      if (ok) {
        void requestPersistentStorage();
        await refresh();
      }
      setLoading(false);
    })();
  }, [refresh]);

  const open = useCallback(async (id: string | null) => {
    if (id === null) {
      setCurrent(null);
      setHistory([]);
      return;
    }
    const tournament = await loadTournament(id);
    setCurrent(tournament ?? null);
    setHistory([]);
  }, []);

  const update = useCallback(
    async (next: Tournament) => {
      setHistory((past) => {
        if (!current) return past;
        return [current, ...past].slice(0, UNDO_DEPTH);
      });
      setCurrent(next);
      await saveTournament(next);
      await refresh();
    },
    [current, refresh],
  );

  const create = useCallback(
    async (tournament: Tournament) => {
      await saveTournament(tournament);
      await refresh();
      setCurrent(tournament);
      setHistory([]);
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await dbDelete(id);
      await refresh();
      setCurrent((c) => (c?.id === id ? null : c));
    },
    [refresh],
  );

  const undo = useCallback(async () => {
    const [previous, ...rest] = history;
    if (!previous) return;
    setHistory(rest);
    setCurrent(previous);
    await saveTournament(previous);
    await refresh();
  }, [history, refresh]);

  const value = useMemo<StoreValue>(
    () => ({
      tournaments,
      current,
      loading,
      storageOk,
      canUndo: history.length > 0,
      open,
      update,
      create,
      remove,
      undo,
      refresh,
    }),
    [
      tournaments,
      current,
      loading,
      storageOk,
      history.length,
      open,
      update,
      create,
      remove,
      undo,
      refresh,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside a StoreProvider');
  return value;
}

/** The open tournament, for screens that only render when one is open. */
export function useTournament(): Tournament {
  const { current } = useStore();
  if (!current) throw new Error('no tournament is open');
  return current;
}
