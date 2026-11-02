// Per-file memory — where each file was left: a note's mode and line, a
// document's page and zoom. One small record per file, and a vault holds as
// many files as it likes, so this grows by its nature.
//
// It used to grow in localStorage, which is about 5 MiB for the whole origin
// and is written synchronously, on the main thread, in the middle of a
// frame. Nothing ever removed a record except deleting or renaming its file,
// so a vault kept one for every file it had ever opened — including
// documents opened once from another app and never seen again. IndexedDB
// holds a share of the disk rather than 5 MiB, and writing to it does not
// cost a frame.
//
// The catch is that IndexedDB is asynchronous and nothing that asks for this
// is: a file opens and asks where it was left in the same breath. So the
// whole store is read into memory once at startup — openViewStore(), awaited
// in boot before the first file opens — and every question is answered from
// there. Writes land in memory at once and in the database behind them.
//
// Before that read finishes, and in a browser with no IndexedDB at all,
// every call falls through to localStorage, which is where these records
// used to live: the app keeps working, it just keeps less.

const DB_NAME = 'satr-view';
const STORE = 'memory';
/** Records to keep. A record is a hundred bytes or so, so this is nothing
 *  against the quota; it is here because "grows forever" is what went wrong
 *  the first time, and a bound nobody can reach is still a bound. */
const KEEP = 2000;

interface Row { k: string; v: string; at: number }

/** Null until the store has been read: the signal to fall through. */
let cache: Map<string, { v: string; at: number }> | null = null;
let opening: Promise<IDBDatabase | null> | null = null;
/** Writes go out one after another, so a put and the drop that follows it
 *  cannot land the other way round. */
let writes: Promise<unknown> = Promise.resolve();

function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'k' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

function ask<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return db().then((open) => {
    if (!open) return null;
    return new Promise<T | null>((resolve) => {
      let request: IDBRequest;
      try { request = work(open.transaction(STORE, mode).objectStore(STORE)); } catch { resolve(null); return; }
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => resolve(null);
    });
  });
}

function queue(work: () => Promise<unknown>): void {
  writes = writes.then(work).catch(() => undefined);
}

/** The records that were still in localStorage from before this store
 *  existed. They are moved across and, whether or not the move lands, taken
 *  out of localStorage — getting them out of there is the point. */
function adopt(held: Map<string, { v: string; at: number }>): void {
  try {
    const moving: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('satr:view:') || key.startsWith('satr:place:'))) moving.push(key);
    }
    for (const key of moving) {
      const value = localStorage.getItem(key);
      localStorage.removeItem(key);
      if (value === null) continue;
      // The copy in localStorage always wins over the one in the database.
      // It is there for one of two reasons — an older version of the app
      // wrote it, or the last moments before this one was closed flushed it
      // — and both of those are later than anything already stored.
      held.set(key, { v: value, at: Date.now() });
      queue(() => ask('readwrite', (store) => store.put({ k: key, v: value, at: Date.now() } satisfies Row)));
    }
  } catch { /* nothing to move */ }
}

function trim(): void {
  if (!cache || cache.size <= KEEP) return;
  const going = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, cache.size - KEEP);
  for (const [key] of going) {
    cache.delete(key);
    queue(() => ask('readwrite', (store) => store.delete(key)));
  }
}

/** Read the store into memory. Awaited in boot before the first file opens,
 *  so that a file asking where it was left is answered rather than guessed
 *  at. Safe to call twice. */
export async function openViewStore(): Promise<void> {
  if (cache) return;
  const held = new Map<string, { v: string; at: number }>();
  const rows = await ask<Row[]>('readonly', (store) => store.getAll());
  for (const row of rows ?? []) {
    if (row && typeof row.k === 'string' && typeof row.v === 'string') held.set(row.k, { v: row.v, at: Number(row.at) || 0 });
  }
  adopt(held);
  cache = held;
  trim();
}

export function readRecord(key: string): string | null {
  if (!cache) { try { return localStorage.getItem(key); } catch { return null; } }
  return cache.get(key)?.v ?? null;
}

export function writeRecord(key: string, value: string): void {
  if (!cache) { try { localStorage.setItem(key, value); } catch { /* full, and not worth a frame */ } return; }
  const at = Date.now();
  cache.set(key, { v: value, at });
  unconfirmed.set(key, value);
  queue(() => ask('readwrite', (store) => store.put({ k: key, v: value, at } satisfies Row)).then((done) => {
    if (done !== null && unconfirmed.get(key) === value) unconfirmed.delete(key);
  }));
  trim();
}

export function dropRecord(key: string): void {
  unconfirmed.delete(key);
  if (!cache) { try { localStorage.removeItem(key); } catch { /* nothing to do */ } return; }
  cache.delete(key);
  // A flush may have left a copy behind; a deleted file must not come back.
  try { localStorage.removeItem(key); } catch { /* nothing to do */ }
  queue(() => ask('readwrite', (store) => store.delete(key)));
}

/** Records written but not yet confirmed by the database. */
const unconfirmed = new Map<string, string>();

/** Put anything unconfirmed into localStorage, where the next start finds
 *  and adopts it.
 *
 *  Synchronous on purpose. This runs as the app is going away, and an
 *  asynchronous write does not survive that — which is precisely what
 *  moving these records to IndexedDB would otherwise have cost: the place
 *  you were reading, lost every time the app was closed rather than left.
 *  localStorage is no longer where this memory lives, but it is still the
 *  only thing that can be written on the way out. */
export function flushViews(): void {
  if (!unconfirmed.size) return;
  try { for (const [key, value] of unconfirmed) localStorage.setItem(key, value); }
  catch { /* no room: the database still has all but the last few moments */ }
}

/** Every key held, for the rename path: a folder moves and the records of
 *  the files inside it follow. */
export function recordKeys(): string[] {
  if (cache) return [...cache.keys()];
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('satr:view:') || key.startsWith('satr:place:'))) keys.push(key);
    }
  } catch { /* none, then */ }
  return keys;
}

/** Everything, for a reset. Not the vault: this is only where files were
 *  left, never what is in them. */
export function forgetViews(): void {
  if (cache) cache.clear();
  queue(() => ask('readwrite', (store) => store.clear()));
  try {
    const going: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('satr:view:') || key.startsWith('satr:place:'))) going.push(key);
    }
    for (const key of going) localStorage.removeItem(key);
  } catch { /* nothing to do */ }
}

/** Ask that this origin's storage not be thrown away when the device is
 *  short of room. It covers everything the origin keeps, not just this
 *  store — on the web that includes the vault itself, which is best-effort
 *  by default and can be evicted silently, with no event: the app would
 *  find out when a read came back empty. The browser decides on its own
 *  heuristics and may refuse; there is nothing to do about that but ask. */
export function keepStorage(): void {
  try {
    void navigator.storage?.persisted?.()
      .then((already) => (already ? true : navigator.storage.persist()))
      .catch(() => undefined);
  } catch { /* no storage manager here */ }
}
