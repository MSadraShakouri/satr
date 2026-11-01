/**
 * A few pages of the last few documents, kept across a tab change and a
 * refresh.
 *
 * The viewer already keeps a hundred-pixel picture of every page it has
 * drawn (the sketch book in pdfView.ts), which is what makes flicking
 * through a book show pages rather than empty boxes. It lives for exactly
 * as long as the view does, and the view is torn down and built again
 * every time the reader changes tab: coming back to a document meant
 * waiting on the engine for the page in front of them, a tenth of a
 * second of white on his book, and a refresh meant the same.
 *
 * So a handful of those pictures outlive the view. Deliberately a
 * handful: he asked for this to be small, and small is also what makes
 * it fast — the pages he is on, of the documents he is actually reading,
 * and nothing else. Ten pages of four documents, as JPEG at a hundred
 * pixels, is under a hundred kilobytes all told, which is a third of one
 * page of his book as the engine draws it.
 *
 * Two shelves hold the same thing. The one in memory answers a tab
 * change, which happens inside one page and would be slower through a
 * database than through the engine. The one in IndexedDB answers a
 * refresh, where memory is gone.
 */

import { asideKeys, dropAside, getAside, putAside } from './webStore';

/** How many documents are remembered at once. The most recently read
 *  win; a fifth one pushes the oldest out, rather than every PDF ever
 *  opened staying on the phone forever. */
const FILES = 4;
/** How many pages of each: the ones nearest where the reader was, which
 *  is where they will be when they come back. */
const PAGES = 10;
/** A hundred-pixel page is three kilobytes at this quality and four at
 *  0.8; what it is for is being stretched across a whole page while a
 *  sharp one is drawn, and at that size the difference cannot be seen. */
const QUALITY = 0.6;

const SHELF = 'pdf-sketches/';
const LIST = 'pdf-sketches-list';

/** A page's picture, kept by the index the sketch book knows it by. */
type Leaf = { page: number; shot: Blob };
/** One document's shelf. The page count is the only check that the
 *  document is the one the pictures came from — the key is already the
 *  document's own bytes (pdfKey), so this is a belt on top of braces. */
type Shelf = { at: number; pages: number; leaves: Leaf[] };

const shelves = new Map<string, Shelf>();

/** When each document was last put down, oldest first out. Kept apart
 *  from the shelves so that deciding what to drop does not mean reading
 *  every picture back out of the database. */
const readList = async (): Promise<Record<string, number>> =>
  (await getAside<Record<string, number>>(LIST)) ?? {};

const asJpeg = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    try { canvas.toBlob((blob) => resolve(blob), 'image/jpeg', QUALITY); }
    catch { resolve(null); }
  });

/** A copy of a picture, taken now. The canvases handed in belong to a
 *  view that is usually being torn down around us, and toBlob reads them
 *  when it gets to them rather than when it is asked: by then the page
 *  they came from can have handed its bitmap back. */
const copyOf = (from: HTMLCanvasElement): HTMLCanvasElement | null => {
  if (!from.width || !from.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = from.width;
  canvas.height = from.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  try { context.drawImage(from, 0, 0); } catch { return null; }
  return canvas;
};

/** Drop everything but the FILES most recently read documents. */
async function prune(): Promise<void> {
  const list = await readList();
  const keys = Object.keys(list).sort((first, second) => (list[second] ?? 0) - (list[first] ?? 0));
  for (const key of keys.slice(FILES)) {
    delete list[key];
    shelves.delete(key);
    await dropAside(SHELF + key);
  }
  // Anything the list has lost track of — a write that was cut off
  // halfway by the tab closing — goes with them.
  for (const key of await asideKeys()) {
    if (key.startsWith(SHELF) && !(key.slice(SHELF.length) in list)) await dropAside(key);
  }
  for (const key of [...shelves.keys()]) if (!(key in list)) shelves.delete(key);
  await putAside(LIST, list);
}

/**
 * Put a document's nearest pages down, for the next time it is opened.
 *
 * `near` is the page the reader is on, as an index from zero, and the
 * pictures kept are the ones closest to it on either side.
 */
export async function keepSketches(
  key: string,
  pages: number,
  near: number,
  book: Map<number, HTMLCanvasElement>,
): Promise<void> {
  if (!key || !book.size) return;
  const chosen = [...book.keys()]
    .sort((first, second) => Math.abs(first - near) - Math.abs(second - near))
    .slice(0, PAGES);
  // Copied first, every one of them, before a single await: see copyOf.
  const copies = chosen.map((page) => ({ page, canvas: copyOf(book.get(page)!) }));
  const leaves: Leaf[] = [];
  for (const { page, canvas } of copies) {
    if (!canvas) continue;
    const shot = await asJpeg(canvas);
    if (shot) leaves.push({ page, shot });
  }
  if (!leaves.length) return;
  const shelf: Shelf = { at: Date.now(), pages, leaves };
  shelves.set(key, shelf);
  const list = await readList();
  list[key] = shelf.at;
  await putAside(LIST, list);
  await putAside(SHELF + key, shelf);
  await prune();
}

/** Turn a kept picture back into a canvas the sketch book can hold. */
async function paint(shot: Blob): Promise<HTMLCanvasElement | null> {
  try {
    const picture = await createImageBitmap(shot);
    const canvas = document.createElement('canvas');
    canvas.width = picture.width;
    canvas.height = picture.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(picture, 0, 0);
    picture.close();
    return canvas;
  } catch { return null; }
}

/**
 * What was kept of a document, ready to go straight into its pages.
 *
 * Memory first, the database behind it, and nothing at all if neither
 * has it or the document has changed length since.
 */
export async function recallSketches(
  key: string,
  pages: number,
): Promise<{ page: number; canvas: HTMLCanvasElement }[]> {
  if (!key) return [];
  const shelf = shelves.get(key) ?? await getAside<Shelf>(SHELF + key);
  if (!shelf || shelf.pages !== pages || !shelf.leaves?.length) return [];
  shelves.set(key, shelf);
  // All of them at once, not one after another. The decoding itself is
  // the browser's own and happens off this thread, but each promise has
  // to be picked up on it -- and the thread it has to be picked up on is
  // the one the engine is drawing the first page with, a hundred
  // milliseconds at a time. Ten pages in a row waited for ten of those
  // turns and arrived half a second late, which on a document this size
  // is after the engine had drawn the page itself: the whole point of
  // keeping them is to be there first.
  const painted = await Promise.all(shelf.leaves.map(async (leaf) => ({ page: leaf.page, canvas: await paint(leaf.shot) })));
  const out: { page: number; canvas: HTMLCanvasElement }[] = [];
  for (const leaf of painted) if (leaf.canvas) out.push({ page: leaf.page, canvas: leaf.canvas });
  // Opening a document is reading it: it goes to the front of the queue
  // even if it is closed again without a page being drawn.
  if (out.length) {
    const list = await readList();
    list[key] = Date.now();
    await putAside(LIST, list);
  }
  return out;
}

/** Everything, gone — the reader deleting a document, or a test. */
export async function forgetSketches(): Promise<void> {
  shelves.clear();
  for (const key of await asideKeys()) if (key.startsWith(SHELF) || key === LIST) await dropAside(key);
}

/** What the shelves hold, in bytes, for anyone counting. */
export async function sketchShelfBytes(): Promise<number> {
  let bytes = 0;
  for (const key of await asideKeys()) {
    if (!key.startsWith(SHELF)) continue;
    const shelf = await getAside<Shelf>(key);
    for (const leaf of shelf?.leaves ?? []) bytes += leaf.shot.size;
  }
  return bytes;
}
