// One small picture of a document, for showing it without opening it.
//
// The tab switcher used to build its card for a pdf the same way it builds
// one for a note: read the file, render the first page and a half of it as
// markdown. On a note that is a few kilobytes and some text. On the author's
// 31 MB book it is a read of every byte, decoded into a string of forty-one
// million characters -- eighty megabytes of memory, several seconds of
// phone -- and then `.slice(0, 1500)` throws all but the first line and a
// half of it away. That is why pressing the tabs button with a book open was
// "really slow", and it is a memory spike big enough to be one of the kills
// in his log.
//
// A document's card is a picture instead, and the picture is one we already
// have: the pdf reader keeps a hundred-pixel sketch of the pages around the
// reader so a fast flick has something to show, and the one for the page
// being read is put down here on the way out, keyed by path. Showing it
// costs a database read of three kilobytes. Nothing is rendered, the engine
// is never started, and the file is never opened.

import { dropAside, getAside, putAside } from './webStore';

const CARD = 'pdf-card/';

interface Card {
  /** One-based, as the reader counts them. */
  page: number;
  pages: number;
  shot: Blob;
  at: number;
}

/**
 * How wide the picture is kept, in pixels.
 *
 * A card is about 150 points across on the phone, which at three device
 * pixels is 450 -- so this is that with a little to spare, and a jpeg of it
 * is thirty kilobytes or so. The first version of this took the hundred-pixel
 * sketch the flick layer uses, because it was already there and free; the
 * author's verdict on that was "thumbnail quality is really bad", and he is
 * right. A hundred pixels stretched across a card is exactly as rough as a
 * hundred pixels stretched across a page.
 */
const CARD_PX = 520;

/** Copied, synchronously, before anything is awaited: the canvas handed in
 *  belongs to a page that may be drawn over or thrown away the moment this
 *  yields. (The same trap the sketch shelf documents.)
 *
 *  Scaled to the card's own size on the way through -- taken from the page's
 *  real picture rather than its rough one, and shrunk, which is the cheap
 *  direction. */
function copyOf(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  try {
    const scale = Math.min(1, CARD_PX / Math.max(1, canvas.width));
    const copy = document.createElement('canvas');
    copy.width = Math.max(1, Math.round(canvas.width * scale));
    copy.height = Math.max(1, Math.round(canvas.height * scale));
    const context = copy.getContext('2d');
    if (!context) return null;
    // The browser's own downscale, which on a shrink this size is a mile
    // better than drawing it small in the first place.
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, 0, 0, copy.width, copy.height);
    return copy;
  } catch { return null; }
}

const asJpeg = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    try { canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82); } catch { resolve(null); }
  });

/** Put down what this document looks like where the reader left it. */
export async function keepCard(path: string, page: number, pages: number, canvas: HTMLCanvasElement): Promise<void> {
  if (!path) return;
  const copy = copyOf(canvas);
  if (!copy) return;
  const shot = await asJpeg(copy);
  if (!shot) return;
  await putAside(CARD + path, { page, pages, shot, at: Date.now() } satisfies Card);
}

/** What to put on a tab's card, or null if this document has never been
 *  opened on this phone. The URL is the caller's to revoke. */
export async function recallCard(path: string): Promise<{ page: number; pages: number; url: string } | null> {
  if (!path) return null;
  const card = await getAside<Card>(CARD + path).catch(() => null);
  if (!card?.shot) return null;
  try {
    const url = URL.createObjectURL(card.shot);
    // Let go of it once the browser has had time to decode it. An object
    // URL holds its blob in memory until it is revoked, and a switcher with
    // four books in it would otherwise leave four behind every time it was
    // opened -- a leak of exactly the kind this file exists to fix.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { page: card.page, pages: card.pages, url };
  } catch { return null; }
}

/** A document deleted, renamed, or replaced: its picture goes with it, so a
 *  tab card can never show the inside of a file that is no longer there. */
export async function forgetCard(path: string): Promise<void> {
  if (!path) return;
  await dropAside(CARD + path).catch(() => {});
}
