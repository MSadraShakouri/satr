// Images in the reading view and the PDF. The renderer (src/markdown.ts)
// writes <img class="md-image" data-src="…">; this fills in the pictures.
// - http(s) and data: sources load as they are.
// - Anything else is a file in your folders: a path relative to the note
//   (or to the top of the folders, with a leading "/"), and failing that,
//   for ![[embeds]] and bare names, the first file with that name anywhere,
//   as Obsidian finds them. Files are read once per session and kept.
// A picture that can't be found becomes a quiet placeholder with its name.
import { backend, basename, dirname, findFileByName, joinPath } from './vault';

const cache = new Map<string, Promise<string | null>>();
// Loaded ones, for re-renders: the picture is there at once, no flicker.
const loaded = new Map<string, string>();

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

function dataUrl(src: string, notePath: string, wiki: boolean): Promise<string | null> {
  const key = `${wiki ? 'w' : 'm'}\n${notePath}\n${src}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = locate(src, notePath, wiki).then((path) => (path ? backend.readDataUrl(path) : null)).catch(() => null);
    cache.set(key, pending);
    // A miss isn't remembered: the file may be added later.
    void pending.then((url) => { if (url) loaded.set(key, url); else cache.delete(key); });
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
    const ready = loaded.get(`${img.dataset.wiki === '1' ? 'w' : 'm'}\n${notePath}\n${img.dataset.src ?? ''}`);
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
