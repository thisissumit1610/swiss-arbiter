/**
 * Local persistence.
 *
 * Everything lives in IndexedDB on the device running the tournament. There is
 * no server, no account and no network call anywhere in this app: an arbiter in
 * a hall with no wifi has exactly the same experience as one with it, which is
 * the whole point.
 *
 * Writes go through `saveTournament` on every state change, so a browser crash
 * or a flat battery costs at most the keystroke in progress.
 */

import type { Tournament } from '@swiss-arbiter/engine';

const DB_NAME = 'swiss-arbiter';
const DB_VERSION = 1;
const STORE = 'tournaments';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function listTournaments(): Promise<Tournament[]> {
  const all = await transact<Tournament[]>('readonly', (store) => store.getAll());
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadTournament(id: string): Promise<Tournament | undefined> {
  return transact<Tournament | undefined>('readonly', (store) => store.get(id));
}

export async function saveTournament(tournament: Tournament): Promise<void> {
  await transact('readwrite', (store) => store.put(tournament));
}

export async function deleteTournament(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id));
}

/**
 * IndexedDB can be unavailable — private browsing in some browsers, a blocked
 * origin, or storage pressure. The app has to say so rather than silently
 * losing an arbiter's results, so this is checked once at startup.
 */
export async function storageAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the browser not to evict this origin's storage when space runs low.
 * Best-effort: unsupported and denied both just mean the default policy applies.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
