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
  /**
   * This page was authored dark -- a slide deck, a dark poster -- and must
   * not be inverted a second time by the dark theme. Measured off the drawn
   * pixels by the reader, the same fact its own `is-dark-page` carries.
   *
   * Absent on cards filed before this was recorded, which reads as false:
   * the overwhelming majority of pages are paper-coloured, and the first
   * card the reader files puts it right either way.
   */
  dark?: boolean;
  /** Taken from the hundred-pixel sketch rather than the page's own
   *  picture, because the page was still being drawn when the app was put
   *  away. Replaceable by anything better. */
  rough?: boolean;
}

/** The part of the page to keep, in the pixels of the picture it is cropped
 *  from; absent for the whole page. */
export interface Crop { x: number; y: number; width: number; height: number }

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
function copyOf(canvas: HTMLCanvasElement, crop?: Crop | null): HTMLCanvasElement | null {
  try {
    const from = crop && crop.width >= 8 && crop.height >= 8
      ? crop
      : { x: 0, y: 0, width: canvas.width, height: canvas.height };
    const scale = Math.min(1, CARD_PX / Math.max(1, from.width));
    const copy = document.createElement('canvas');
    copy.width = Math.max(1, Math.round(from.width * scale));
    copy.height = Math.max(1, Math.round(from.height * scale));
    const context = copy.getContext('2d');
    if (!context) return null;
    // The browser's own downscale, which on a shrink this size is a mile
    // better than drawing it small in the first place.
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, from.x, from.y, from.width, from.height, 0, 0, copy.width, copy.height);
    return copy;
  } catch { return null; }
}

const asJpeg = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    try { canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82); } catch { resolve(null); }
  });

/**
 * Put down what this document looks like where the reader left it.
 *
 * Where he left it, not what page he was on: a reader zoomed into a figure
 * or a column of a two-column paper was shown the whole sheet on the card,
 * shrunk to a hundred and fifty points, which is the one view of that page
 * he had deliberately zoomed out of. The crop is the part of the page that
 * was actually on his screen, and it is taken from the sharpest picture
 * that covers it -- the zoom tile where there is one, the whole-page
 * picture otherwise.
 */
export async function keepCard(
  path: string, page: number, pages: number, canvas: HTMLCanvasElement,
  how?: { dark?: boolean; crop?: Crop | null; rough?: boolean },
): Promise<void> {
  if (!path) return;
  // A sketch does not paint over a picture. The reader files its card as
  // the app is being put away, and a page scrolled to a moment before that
  // is still being drawn -- so what is to hand is sometimes the hundred
  // pixels the flick layer keeps, stretched across a card, which is the
  // "thumbnail quality is really bad" this file was written to end. It may
  // still make the first card for a document, where the choice is between
  // a rough picture and no picture at all.
  if (how?.rough) {
    const have = await getAside<Card>(CARD + path).catch(() => null);
    if (have?.shot && have.rough !== true) return;
  }
  const copy = copyOf(canvas, how?.crop);
  if (!copy) return;
  const shot = await asJpeg(copy);
  if (!shot) return;
  await putAside(CARD + path, { page, pages, shot, at: Date.now(), dark: how?.dark === true, rough: how?.rough === true } satisfies Card);
}

/** What to put on a tab's card, or null if this document has never been
 *  opened on this phone. The URL is the caller's to revoke. */
export async function recallCard(path: string): Promise<{ page: number; pages: number; url: string; dark: boolean } | null> {
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
    return { page: card.page, pages: card.pages, url, dark: card.dark === true };
  } catch { return null; }
}

/** A document deleted, renamed, or replaced: its picture goes with it, so a
 *  tab card can never show the inside of a file that is no longer there. */
export async function forgetCard(path: string): Promise<void> {
  if (!path) return;
  await dropAside(CARD + path).catch(() => {});
}
