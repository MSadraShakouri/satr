/**
 * Where the browser vault keeps what is inside its files.
 *
 * The index — which files exist, in which folders, changed when — stays in
 * localStorage: it is a few kilobytes and the app wants it the moment it
 * starts. The contents do not belong there. localStorage holds text only, so
 * bytes have to be base64, which makes them a third bigger again, and the
 * whole origin gets about five megabytes for everything together. One
 * imported PDF spends a quarter of that, and when the budget runs out it is
 * not only the import that fails — saving a note starts throwing too.
 *
 * IndexedDB has no such ceiling, stores a Blob as the bytes it is, and is
 * asynchronous, which costs nothing here because every way into the vault
 * already returns a promise.
 */

const DB_NAME = 'satr';
const STORE = 'files';

/** A file's contents: text as text, anything else as the bytes themselves. */
export type Stored = { text: string } | { blob: Blob; mime: string };

let opening: Promise<IDBDatabase | null> | null = null;

/** The database, or null where there is none to be had — a browser with
 *  storage switched off still runs the app, it just cannot keep anything. */
function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
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

export const getStored = (path: string): Promise<Stored | null> => ask<Stored>('readonly', (store) => store.get(path));

export async function putStored(path: string, value: Stored): Promise<void> {
  await ask('readwrite', (store) => store.put(value, path));
}

/** Migration may discard the sole legacy copy only after the enclosing
 * transaction commits. A request's success alone is not that guarantee. */
export async function migrateStored(path: string, value: Stored): Promise<boolean> {
  const open = await db();
  if (!open) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const tx = open.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => resolve(false);
      tx.onerror = () => resolve(false);
      tx.objectStore(STORE).put(value, path);
    } catch { resolve(false); }
  });
}

export async function dropStored(path: string): Promise<void> {
  await ask('readwrite', (store) => store.delete(path));
}

export async function storedPaths(): Promise<string[]> {
  const keys = await ask<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  return (keys ?? []).map(String).filter((key) => !key.startsWith(ASIDE));
}

/**
 * The same database, for things that are not files.
 *
 * The PDF viewer keeps a few pages of the last few documents here so a
 * tab change and a refresh do not land on an empty page
 * (src/pdfSketchCache.ts). It is the same store because a second one
 * would mean a second version of the database, and an open tab on the
 * old version blocks that upgrade for every tab — including the one
 * reading the reader's files. The prefix holds a NUL, which no path in
 * the vault can contain, so nothing a reader can make collides with one
 * of these and storedPaths leaves them out.
 */
const ASIDE = '\u0000aside/';

export const getAside = <T>(key: string): Promise<T | null> =>
  ask<T>('readonly', (store) => store.get(ASIDE + key));

export async function putAside(key: string, value: unknown): Promise<void> {
  await ask('readwrite', (store) => store.put(value, ASIDE + key));
}

export async function dropAside(key: string): Promise<void> {
  await ask('readwrite', (store) => store.delete(ASIDE + key));
}

export async function asideKeys(): Promise<string[]> {
  const keys = await ask<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  return (keys ?? []).map(String).filter((key) => key.startsWith(ASIDE)).map((key) => key.slice(ASIDE.length));
}

/** Text as it is; bytes as the data: URL the rest of the app reads them by. */
export function storedText(value: Stored): Promise<string> {
  if ('text' in value) return Promise.resolve(value.text);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(value.blob);
  });
}

/** What the app hands down is always a string: a data: URL is the bytes it
 *  encodes and is kept as those, anything else is text. */
export function asStored(text: string): Stored {
  const mark = ';base64,';
  if (text.startsWith('data:') && text.includes(mark)) {
    const cut = text.indexOf(mark);
    const mime = text.slice(5, cut);
    try {
      const binary = atob(text.slice(cut + mark.length));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return { blob: new Blob([bytes], { type: mime }), mime };
    } catch { /* not the base64 it claimed to be: kept as the text it is */ }
  }
  return { text };
}
