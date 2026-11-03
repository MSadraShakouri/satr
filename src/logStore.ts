// The log, kept across a restart.
//
// A log that only lives in memory answers nothing about the run that went
// wrong, because the run that went wrong is the one that ended. So lines are
// written to a database behind the app -- but carefully, because the whole
// point of this log is to find out where time goes, and a log that costs
// frames would be measuring itself.
//
// Three rules come out of that:
//
//  - IndexedDB, not localStorage. src/viewStore.ts already learned this one:
//    localStorage is about 5 MiB for the whole origin and is written
//    synchronously, on the main thread, in the middle of a frame.
//  - Lines are written in batches, when nothing else is happening, and once
//    more on the way to the background -- never on the path being timed.
//  - Nothing is read at startup. The earlier runs are only fetched when
//    somebody opens the log or exports it, so this costs the boot nothing at
//    all.
//
// Where there is no database -- a browser refusing it, private browsing --
// the app keeps logging to memory and simply keeps less. Same fall-through as
// the view store.

import { type Line, onLine, startedAt } from './log';

const DB_NAME = 'satr-log';
const STORE = 'lines';
/** Lines kept across runs. Each is a small object; this is a couple of MB at
 *  the very worst, against a quota that is a share of the disk. The bound is
 *  here for the same reason the view store has one: "grows forever" is what
 *  went wrong the last time something kept a record. */
export const KEEP_STORED = 20000;
/** How long after a line arrives the batch goes out, when the phone never
 *  gets round to being idle. */
const FLUSH_AFTER_MS = 4000;

/** A stored line is a line plus which run wrote it, so the viewer can show
 *  this run alone or everything it has. */
export interface StoredLine extends Line { run: number }

let opening: Promise<IDBDatabase | null> | null = null;
let writes: Promise<unknown> = Promise.resolve();
let waiting: StoredLine[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let idle = 0;
let watching: (() => void) | null = null;
/** Counted rather than queried: a count() on every flush would be a
 *  transaction we do not need. */
let stored = -1;

function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { autoIncrement: true });
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

/** Writes go out one after another, so a batch and the trim behind it cannot
 *  land the other way round. */
function queue(work: () => Promise<unknown>): Promise<unknown> {
  writes = writes.then(work).catch(() => undefined);
  return writes;
}

/** Older runs, oldest first. Only ever called by the viewer or an export, so
 *  the cost lands on somebody who asked for it. */
export async function earlier(): Promise<StoredLine[]> {
  await flush();
  const rows = await ask<StoredLine[]>('readonly', (store) => store.getAll());
  return rows ?? [];
}

/** Everything the database holds, thrown away. The viewer's "clear". */
export async function forgetStored(): Promise<void> {
  waiting = [];
  stored = 0;
  await queue(() => ask('readwrite', (store) => store.clear()));
}

/** Once the store has more than it should, the oldest keys go. Auto-increment
 *  keys are in order of writing, so the cursor walks from the oldest.
 *
 *  This cannot go through ask(): a cursor answers once per step and ask()
 *  resolves on the first answer, so it would delete one row and call it done.
 *  The transaction finishing is the only honest end of a walk. */
function trim(over: number): Promise<void> {
  return db().then((open) => new Promise<void>((resolve) => {
    if (!open) { resolve(); return; }
    let transaction: IDBTransaction;
    try { transaction = open.transaction(STORE, 'readwrite'); } catch { resolve(); return; }
    const request = transaction.objectStore(STORE).openCursor();
    let left = over;
    request.onsuccess = () => {
      const at = request.result;
      if (!at || left <= 0) return;
      at.delete();
      left -= 1;
      at.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  }));
}

/** Write what has been waiting. Safe to call at any time; does nothing when
 *  there is nothing to write. */
export function flush(): Promise<unknown> {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (idle && typeof cancelIdleCallback === 'function') { cancelIdleCallback(idle); idle = 0; }
  if (!waiting.length) return writes;
  const going = waiting;
  waiting = [];
  return queue(async () => {
    const open = await db();
    if (!open) return;
    await new Promise<void>((resolve) => {
      let transaction: IDBTransaction;
      try { transaction = open.transaction(STORE, 'readwrite'); } catch { resolve(); return; }
      const store = transaction.objectStore(STORE);
      for (const line of going) { try { store.add(line); } catch { /* one line is not worth an exception */ } }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
    if (stored < 0) stored = (await ask<number>('readonly', (s) => s.count())) ?? going.length;
    else stored += going.length;
    if (stored > KEEP_STORED) {
      const over = stored - KEEP_STORED;
      stored -= over;
      await trim(over);
    }
  });
}

/** requestIdleCallback is Chrome 47 and so is everywhere Android can reach,
 *  but Safari only got it in 16.4 -- so there is a timeout behind it. Either
 *  way the batch goes out within a few seconds. */
function flushSoon(): void {
  if (timer === null) timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_AFTER_MS);
  if (!idle && typeof requestIdleCallback === 'function') {
    idle = requestIdleCallback(() => { idle = 0; void flush(); }, { timeout: FLUSH_AFTER_MS });
  }
}

/** Start keeping what the log writes. Called once, from boot.
 *
 *  The flush on the way out listens to visibilitychange and pagehide rather
 *  than unload: on a phone an app is very often never unloaded at all, it is
 *  hidden and then killed, and the hidden moment is the last one anybody is
 *  promised. */
export function startKeeping(): void {
  if (watching) return;
  const stop = onLine((line) => {
    waiting.push({ ...line, run: startedAt });
    flushSoon();
  });
  const onHide = (): void => { if (document.visibilityState === 'hidden') void flush(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', () => { void flush(); });
  watching = () => {
    stop();
    document.removeEventListener('visibilitychange', onHide);
  };
}

/** For the tests, and for a setting that turns the keeping off. */
export function stopKeeping(): void {
  watching?.();
  watching = null;
}

/** Whether anything is being kept at all. */
export function keeping(): boolean { return watching !== null; }
