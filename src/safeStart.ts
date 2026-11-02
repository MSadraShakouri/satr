// Getting back in.
//
// Reported: three documents open, the app stopped answering, and a force
// stop and a cleared cache did not help. That last part is the whole of the
// diagnosis. A force stop throws away everything the app is holding, so
// whatever was wrong was not being held -- it was being *read back*: the
// tabs are in localStorage, and starting up opened the same three documents
// again and arrived at the same place. Clearing the cache does not touch
// localStorage or IndexedDB, so it changed nothing either. The app had no
// way to decide that the thing it does on every start was the thing
// stopping it from starting.
//
// So it counts. A start writes down that it is trying before it tries
// anything, and rubs it out once the reader can actually see a file. A
// start that never gets there leaves its mark behind, and the next one
// reads it:
//
//   one mark   -- the start that is running now. Nothing is wrong.
//   two marks  -- the last start did not finish. Open no documents: notes
//                 are cheap and a document is the expensive thing.
//   three      -- that did not help either. Put the session back to nothing:
//                 one empty tab, no remembered places, no picture shelf.
//                 The vault is never touched. Notes are not session.
//
// Three bad starts in a row is the worst case, and it costs the reader two
// restarts to get out of it with their notes untouched. A reset of what is
// kept here is a reset of *where the reader was*, never of what they wrote.
//
// The mark is also used for the upgrade itself, but narrowly. A build that
// has never run on this device cannot know whether the session it is about
// to restore is the one that wedged the build before it -- and a device that
// cannot start is a device that cannot be rescued by a fix it never gets to
// run. So the first start on a new build leaves documents closed *when the
// session holds more than one of them*. One document is the ordinary way to
// read and is cheap; several at once is the rare, expensive case, and the
// one that was open when this went wrong. An upgrade in the middle of
// reading a single book does not lose the reader their page.

/** Bumped by hand when a release needs the first start on it to be careful.
 *  Compared, never parsed: any difference means "this build has not run
 *  here before". */
const BUILD = '0.18.1';

const ATTEMPTS = 'satr:boot:attempts';
const BUILD_SEEN = 'satr:boot:build';

/** `normal` restores the session as it was. `documents-closed` restores the
 *  notes but opens no document. `session-reset` starts at one empty tab. */
export type StartMode = 'normal' | 'documents-closed' | 'session-reset';

let mode: StartMode = 'normal';
let marks = 0;
let firstRunOfBuild = false;
let documentsWereClosed = false;

/** Why the session is not the one the reader left, in their words, or '' when
 *  it is. */
export function startTrouble(): string {
  if (mode === 'session-reset') {
    return 'The app did not finish starting twice, so it started clean. Your notes are all here — only the open tabs and reading places were let go.';
  }
  if (mode === 'documents-closed') {
    return 'The app did not finish starting last time, so it left the documents closed. Open one when you are ready.';
  }
  if (documentsWereClosed) {
    return 'First run of this version: the documents you had open were left closed. Open one when you are ready.';
  }
  return '';
}

export const startMode = (): StartMode => mode;

/** Whether the documents in the saved session should be left closed, given
 *  how many of them there are. A start that has already failed closes them
 *  whatever the count; the first start on a new build only does so when the
 *  session holds more than one. */
export function leaveDocumentsClosed(count: number): boolean {
  if (mode === 'documents-closed') return true;
  if (firstRunOfBuild && count >= 2) { documentsWereClosed = true; return true; }
  return false;
}

/**
 * Called before anything is restored. Leaves a mark, reads the marks left by
 * starts that never finished, and decides how careful to be.
 *
 * Every access is wrapped: a storage that throws (private mode, a full
 * origin) must not be the reason the app cannot start, which would be the
 * same fault in a new place.
 */
export function openingUp(): StartMode {
  let seen: string | null = null;
  try {
    marks = (Number(localStorage.getItem(ATTEMPTS)) || 0) + 1;
    seen = localStorage.getItem(BUILD_SEEN);
    localStorage.setItem(ATTEMPTS, String(marks));
    localStorage.setItem(BUILD_SEEN, BUILD);
  } catch {
    mode = 'normal';
    return mode;
  }
  firstRunOfBuild = seen !== BUILD;
  if (marks >= 3) mode = 'session-reset';
  else if (marks >= 2) mode = 'documents-closed';
  else mode = 'normal';
  if (mode === 'session-reset') clearSession();
  return mode;
}

/** The reader can see a file: this start worked. Rubs out every mark,
 *  including the ones left by the starts that failed. */
export function openedFine(): void {
  try { localStorage.removeItem(ATTEMPTS); } catch { /* nothing to do */ }
}

/**
 * Everything about *where the reader was*, and nothing about what they
 * wrote. The vault is `satr:fs:*` in localStorage and the `satr`/`files`
 * store in IndexedDB; neither is touched here, and neither is listed below.
 */
export function clearSession(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key === 'satr:tabs' || key === 'satr:spaces'
        || key.startsWith('satr:place:') || key.startsWith('satr:view:')) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch { /* nothing to do */ }
  // The shelf of page pictures is the biggest thing the app keeps that is
  // not the reader's, and a document that would not open is exactly the
  // kind of thing that leaves a bad one behind.
  void import('./pdfSketchCache')
    .then((module) => module.forgetSketches())
    .catch(() => undefined);
}
