/**
 * When something under a folder last changed.
 *
 * "The file order is unpleasant... sorting by time doesn't see inside
 * folders." A folder on the phone has a modified time of its own and the
 * app can read it without opening the folder -- which the author
 * remembered correctly -- but that time is when the folder's own entry
 * changed: a note added, deleted or renamed. Rewriting a note that is
 * already there does not touch it. So a folder whose every note he edited
 * this morning sits at the bottom of "recently edited", which is the
 * complaint.
 *
 * Reading the real answer means walking the tree, and his own verdict on
 * that was "I personally have no idea how to do it while keeping it
 * light". So nothing is walked. The answer is kept instead: when the app
 * writes a file it marks the folder that file is in and every folder above
 * it, which is three or four entries of a map per save, and the sidebar
 * reads the mark it already has. Drawing a tree costs nothing it did not
 * cost before.
 *
 * What this cannot know is a write made by something else -- a sync
 * client, a file manager -- and that is what the folder's own modified
 * time still covers: the two are taken together, newest wins. The marks
 * live in localStorage because they are a few hundred bytes and the first
 * draw of the tree wants them before anything else has loaded.
 */

const KEY = 'satr:folder-times';
/** Enough for a vault with a lot of folders; the oldest marks go first.
 *  Each entry is a path and a number -- a thousand of them is tens of
 *  kilobytes, and localStorage is where the file index already lives. */
const KEEP = 1000;

let times: Record<string, number> | null = null;

function load(): Record<string, number> {
  if (times) return times;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
    times = raw && typeof raw === 'object' ? raw : {};
  } catch { times = {}; }
  return times;
}

function save(): void {
  if (!times) return;
  const paths = Object.keys(times);
  if (paths.length > KEEP) {
    // Oldest first out: a folder nobody has written to in a thousand
    // writes is a folder whose own modified time is answer enough.
    const order = paths.sort((a, b) => (times![a] ?? 0) - (times![b] ?? 0));
    for (const path of order.slice(0, paths.length - KEEP)) delete times![path];
  }
  try { localStorage.setItem(KEY, JSON.stringify(times)); } catch { /* no room: the folder's own time is the fallback */ }
}

/**
 * A file was written: its folder and every folder above it changed, as
 * far as a reader looking for what he was working on is concerned.
 *
 * `at` is the time to record, which is the write's own -- passed in
 * rather than taken here so that a file restored from somewhere else can
 * be marked with the time it really has.
 */
export function wroteInside(path: string, at = Date.now()): void {
  if (!path || path.includes('://')) return;
  const marks = load();
  let changed = false;
  for (let dir = path.slice(0, path.lastIndexOf('/')); ; dir = dir.slice(0, dir.lastIndexOf('/'))) {
    if ((marks[dir] ?? 0) < at) { marks[dir] = at; changed = true; }
    if (!dir.includes('/')) break;
  }
  // The vault root as well, so a space that is the root of its own tree
  // has a time like any other folder.
  if ((marks[''] ?? 0) < at) { marks[''] = at; changed = true; }
  if (changed) save();
}

/** The newest the app knows of under this folder, or 0. */
export function wroteInsideAt(path: string): number {
  return load()[path] ?? 0;
}

/** A folder's time for sorting: the newest of what the phone says about
 *  the folder itself and what the app knows about its insides. */
export const folderTime = (path: string, own: number): number => Math.max(own || 0, wroteInsideAt(path));

/** A folder that is gone takes its mark with it, and everything under it. */
export function forgetInside(path: string): void {
  if (!path) return;
  const marks = load();
  let changed = false;
  for (const held of Object.keys(marks)) {
    if (held === path || held.startsWith(`${path}/`)) { delete marks[held]; changed = true; }
  }
  if (changed) save();
}

/** For the tests, and for a vault that has just been swapped underneath. */
export function forgetAllFolderTimes(): void {
  times = {};
  try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}
