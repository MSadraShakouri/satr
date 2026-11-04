// Launches that began and never got anywhere.
//
// A phone can stop an app in the middle of starting it -- out of memory
// while a book is being read is the likely one here -- and the app then
// starts again, opens the same file, and is stopped again. Nothing about
// that loop is visible from inside it: every run believes it is the first,
// and the reader sees a splash screen and nothing else, over and over.
//
// One mark, written when a launch begins and removed the moment the first
// file is on screen. A launch that finds the mark already there knows the
// run before it never got that far. Two in a row is a loop, and the app
// steps out of it by opening on nothing and forgetting where files were
// left -- the two things it does before the first screen that it can undo.
//
// It has to be the app that does this, not the reader: Settings cannot be
// reached from a launch that never finishes, so the way out cannot live
// there.
//
// localStorage, not the view store: this is read and written before the
// database is open, and it is two short strings a launch.

const KEY = 'satr:launching';

export interface BadStart {
  /** Launches before this one that began and never finished. */
  times: number;
  /** What the last of them was opening, when it was opening anything. */
  path: string;
}

const NONE: BadStart = { times: 0, path: '' };

function read(): BadStart {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<BadStart> | null;
    if (!value || typeof value.times !== 'number' || !Number.isFinite(value.times)) return NONE;
    return { times: Math.max(0, Math.round(value.times)), path: typeof value.path === 'string' ? value.path : '' };
  } catch {
    return NONE;
  }
}

/** Two interrupted launches in a row. One can be the reader closing the app
 *  while it starts, or the system wanting the memory back once; two in a row
 *  with nothing in between is the loop. */
export const ENOUGH = 2;

/** Mark this launch as begun, and say what the ones before it did. Call it
 *  first, with the file this launch is about to open. */
export function launchBegan(path: string): BadStart {
  const before = read();
  try {
    localStorage.setItem(KEY, JSON.stringify({ times: before.times + 1, path }));
  } catch { /* a full or refused store costs the guard, not the launch */ }
  return before;
}

/** The first file is on screen: this launch arrived. */
export function launchFinished(): void {
  try {
    localStorage.removeItem(KEY);
  } catch { /* nothing to do */ }
}

/** Has the app failed to start often enough to do something about it? */
export const inALoop = (bad: BadStart): boolean => bad.times >= ENOUGH;
