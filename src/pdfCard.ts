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

import { forgetShot } from './tabCards';
import { getAside, putAside } from './webStore';
import { cardEpoch, cardOperation, cardsSettled, currentCard, forgetPdfCardsWithin } from './pdfCardLifecycle';

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

/**
 * The card's own shape, width over height.
 *
 * Measured, on the phone this is for: a tab is half the width of a 390
 * point screen less the gaps, about 175 points across, and the picture box
 * is 200 tall (src/style.css, .mobile-tab-preview). Everything taller than
 * this gets its bottom cut off by the box, which is how a screenful --
 * 390 by 740 once the header and the navbar are taken off -- turned into a
 * card showing only its top third.
 */
const CARD_SHAPE = 175 / 200;

/**
 * Where the kept part of a screenful sits inside it, top to bottom.
 *
 * A third of the way down rather than the middle: what he zoomed to is
 * usually at the top of the view -- a heading, the top of a figure, the
 * first line of a column -- and a centred crop cuts it off. At a third,
 * a 740-point screenful keeps 446 of it: 13% goes off the top and 27%
 * off the bottom.
 */
const CARD_ANCHOR = 1 / 3;

/** Copied, synchronously, before anything is awaited: the canvas handed in
 *  belongs to a page that may be drawn over or thrown away the moment this
 *  yields. (The same trap the sketch shelf documents.)
 *
 *  Scaled to the card's own size on the way through -- taken from the page's
 *  real picture rather than its rough one, and shrunk, which is the cheap
 *  direction. */
function copyOf(canvas: HTMLCanvasElement, crop?: Crop | null): HTMLCanvasElement | null {
  try {
    const from = shaped(crop && crop.width >= 8 && crop.height >= 8 ? crop : null, canvas);
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

/**
 * The part of what he was looking at that the card can actually show.
 *
 * A screenful is 390 by 740 and a card is 175 by 200: a third of its
 * height has to go, and the only question is which third. Without this the
 * card kept the whole screenful, the box cut the bottom off it, and what
 * was left was the top -- including, before the rectangle itself was
 * measured properly, the part hidden behind the header.
 *
 * Nothing is done to a whole page: a sheet is kept as a sheet, scaled to
 * the card's width with its foot cut off by the box, which is what it has
 * always done and what he asked to keep.
 */
function shaped(crop: Crop | null, canvas: HTMLCanvasElement): Crop {
  if (!crop) return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const tall = crop.width / CARD_SHAPE;
  if (crop.height <= tall + 1) return crop;
  const y = crop.y + (crop.height - tall) * CARD_ANCHOR;
  return { x: crop.x, y: Math.max(0, Math.round(y)), width: crop.width, height: Math.round(tall) };
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
  how?: { dark?: boolean; crop?: Crop | null; rough?: boolean; epoch?: number },
): Promise<void> {
  if (!path) return;
  const epoch = how?.epoch ?? cardEpoch(path);
  if (!currentCard(path, epoch)) return;
  // The source canvas belongs to the viewer and may disappear at any await.
  const copy = copyOf(canvas, how?.crop);
  if (!copy) return;
  // Encoding need not hold up deletion or another card. The epoch is checked
  // again when encoding finishes and inside the serialized database operation.
  const shot = await asJpeg(copy);
  if (!shot || !currentCard(path, epoch)) return;
  await cardOperation(async () => {
    if (!currentCard(path, epoch)) return;
    // A sketch cannot paint over a real picture; it may make the first card.
    if (how?.rough) {
      const have = await getAside<Card>(CARD + path).catch(() => null);
      if (!currentCard(path, epoch) || (have?.shot && have.rough !== true)) return;
    }
    await putAside(CARD + path, { page, pages, shot, at: Date.now(), dark: how?.dark === true, rough: how?.rough === true } satisfies Card);
    // If invalidation began while putAside was in flight it is queued behind
    // this write, so it will remove it before any replacement is filed.
    if (currentCard(path, epoch)) forgetShot(path);
  });
}

/**
 * What to put on a tab's card, or null if this document has never been
 * opened on this phone.
 *
 * The picture itself, not a URL for it: the caller holds the blob (cards
 * are kept between openings of the switcher now, src/tabCards.ts) and makes
 * a URL each time it paints one. An object URL holds its blob in memory
 * until it is revoked, so whoever makes one owns letting it go -- a
 * switcher with four books in it would otherwise leave four behind every
 * time it was opened, a leak of exactly the kind this file exists to end.
 */
export async function recallCard(path: string): Promise<{ page: number; pages: number; shot: Blob; at: number; dark: boolean } | null> {
  if (!path) return null;
  const epoch = cardEpoch(path);
  await cardsSettled();
  if (!currentCard(path, epoch)) return null;
  const card = await getAside<Card>(CARD + path).catch(() => null);
  if (!card?.shot || !currentCard(path, epoch)) return null;
  return { page: card.page, pages: card.pages, shot: card.shot, at: card.at ?? 0, dark: card.dark === true };
}

/** A document deleted, renamed, or replaced: its picture goes with it, so a
 *  tab card can never show the inside of a file that is no longer there. */
export async function forgetCard(path: string): Promise<void> {
  if (!path) return;
  await forgetPdfCardsWithin(path).catch(() => {});
}
