// Images in the reading view and the PDF. The renderer (src/markdown.ts)
// writes <img class="md-image" data-src="…">; this fills in the pictures.
// - http(s) and data: sources load as they are.
// - Anything else is a file in your folders: a path relative to the note
//   (or to the top of the folders, with a leading "/"), and failing that,
//   for ![[embeds]] and bare names, the first file with that name anywhere,
//   as Obsidian finds them. Files are read once and kept, up to a cap in
//   bytes (KEEP_BYTES below); past it the least recently seen is read again.
// A picture that can't be found becomes a quiet placeholder with its name.
import { backend, basename, dirname, findFileByName, joinPath } from './vault';

const cache = new Map<string, Promise<string | null>>();
// Loaded ones, for re-renders: the picture is there at once, no flicker.
const loaded = new Map<string, string>();

/**
 * How much of what has been read is kept, in characters of data: URL.
 *
 * It used to be all of it, for the life of the session -- "files are read
 * once per session and kept", which is fine for a dozen diagrams and not
 * fine for a folder of photographs. A data URL is base64: a 3MB photo is a
 * 4MB string, held on top of the decoded bitmap the browser is already
 * holding, and nothing ever let one go. The 12:47 log has the app killed
 * three times by Android at 349, 478 and 299MB.
 *
 * 24MB is about eight phone photographs, or every diagram in a long note,
 * and it is a third of what the document cache is allowed (KEPT_BYTES,
 * src/pdfView.ts). Past it the least recently used picture is dropped and
 * read again next time it is on screen -- a read, not a redraw, and the
 * reading view already handles a picture arriving a moment late.
 */
const KEEP_BYTES = 24 * 1024 * 1024;
let held = 0;

/** Drop one picture from both maps; they must not drift apart, because the
 *  promise in `cache` holds the same string the map in `loaded` does. */
function forget(key: string): void {
  const had = loaded.get(key);
  if (had === undefined) return;
  held -= had.length;
  loaded.delete(key);
  cache.delete(key);
}

/** Keep a picture, and let the oldest ones go until we are under the cap. */
function remember(key: string, url: string): void {
  forget(key);
  loaded.set(key, url);
  held += url.length;
  for (const oldest of loaded.keys()) {
    if (held <= KEEP_BYTES || oldest === key) break;
    forget(oldest);
  }
}

/** Reading a picture makes it the newest; a Map keeps insertion order, so
 *  re-inserting is what moves it to the end of the queue. */
function touch(key: string): string | undefined {
  const url = loaded.get(key);
  if (url === undefined) return undefined;
  loaded.delete(key);
  loaded.set(key, url);
  return url;
}

/** How much is held, in characters. For the tests and the log. */
export const picturesHeld = (): { bytes: number; count: number } => ({ bytes: held, count: loaded.size });

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

async function locate(src: string, notePath: string, wiki: boolean): Promise<string | null> {
  let clean = src.split(/[?#]/)[0];
  try { clean = decodeURIComponent(clean); } catch { /* keep as written */ }
  const candidates = clean.startsWith('/')
    ? [normalize(clean)]
    : [normalize(joinPath(dirname(notePath), clean)), normalize(clean)];
  for (const candidate of candidates) {
    const entry = await backend.stat(candidate).catch(() => null);
    if (entry?.kind === 'file') return candidate;
  }
  if (wiki || !clean.includes('/')) return findFileByName(basename(clean));
  return null;
}

/** A picture beside a note, as a data: URL, or null. */
export function dataUrl(src: string, notePath: string, wiki: boolean): Promise<string | null> {
  const key = `${wiki ? 'w' : 'm'}\n${notePath}\n${src}`;
  let pending = cache.get(key);
  if (pending) touch(key);
  else {
    pending = locate(src, notePath, wiki).then((path) => (path ? backend.readDataUrl(path) : null)).catch(() => null);
    cache.set(key, pending);
    // A miss isn't remembered: the file may be added later.
    void pending.then((url) => { if (url) remember(key, url); else cache.delete(key); });
  }
  return pending;
}

function missing(img: HTMLImageElement): void {
  const note = document.createElement('span');
  note.className = 'md-image-missing';
  note.textContent = img.alt || basename(img.dataset.src ?? '') || 'Image';
  img.replaceWith(note);
}

/** Fill in the images under `root`. Resolves once every one has loaded or
 *  been replaced by its placeholder. */
export async function loadImages(root: HTMLElement, notePath: string): Promise<void> {
  const images = [...root.querySelectorAll<HTMLImageElement>('img.md-image[data-src]:not([src])')];
  for (const img of images) {
    const ready = touch(`${img.dataset.wiki === '1' ? 'w' : 'm'}\n${notePath}\n${img.dataset.src ?? ''}`);
    if (ready) img.src = ready;
  }
  await Promise.all(images.filter((img) => !img.src).map(async (img) => {
    const src = img.dataset.src ?? '';
    const url = /^(https?:|data:|blob:)/i.test(src) ? src : await dataUrl(src, notePath, img.dataset.wiki === '1');
    if (!url) { missing(img); return; }
    img.src = url;
    try { await img.decode(); } catch { if (!img.naturalWidth) missing(img); }
  }));
}
