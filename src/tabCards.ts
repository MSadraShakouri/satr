/**
 * What each tab's card showed last time, kept so it does not have to be
 * worked out again.
 *
 * Opening the switcher builds every card from scratch, every time. For a
 * note that is a read of the file off the phone's disk and a markdown
 * render of its first fifteen hundred characters -- eight tabs, eight
 * reads, eight renders -- and until all of that lands the cards are blank
 * rectangles. The author's words: "right now it's not too interesting and
 * it takes a short moment to load, it doesn't need to load if it's saved
 * to the db".
 *
 * So it is saved. A card that has been built once is held here under its
 * file's path together with a stamp -- the file's modified time, or for the
 * tab being edited a mark taken off the text itself -- and handed back
 * whole when the stamp still matches. The memory copy answers without
 * waiting at all, which is what kills the blank moment; the database copy
 * survives the app being killed, so the first switcher of the morning is as
 * quick as the fifth.
 *
 * A document's card is a picture the reader already filed (src/pdfCard.ts),
 * so what is kept here for one of those is the picture itself rather than a
 * database read, and a fresh object URL is made for each showing -- a URL
 * outlives its revoke by nothing, and holding one open per tab is the kind
 * of leak the card pipeline exists to avoid.
 *
 * How many: "maybe 100 tabs before and after the current one, though I've
 * never had 20 tabs open at once". A hundred cards it is, oldest first out.
 * A note's card is a few kilobytes of HTML, so the whole shelf is smaller
 * than one page of one of his books.
 */

import { asideKeys, dropAside, getAside, putAside } from './webStore';

const KEY = 'tab-card/';

/**
 * How many cards are kept, memory and database alike.
 *
 * His own bound, and it is far above anything he does: twenty tabs is a
 * busy day. The limit is here so a vault browsed for a year cannot grow a
 * database of cards for files nobody has opened since.
 */
const KEEP = 100;

interface Held {
  /** What the card was built from: a modified time, or a live mark. */
  stamp: string;
  html: string;
  /** When it was last wanted -- the oldest is the first to go. */
  at: number;
}

/** A document's card: the picture, and what it is of. */
export interface Shot {
  /** When the reader filed it (Card.at, src/pdfCard.ts), so a card filed
   *  since the one in hand was taken replaces it. */
  at: number;
  shot: Blob;
  page: number;
  pages: number;
  dark: boolean;
}

const held = new Map<string, Held>();
const shots = new Map<string, Shot>();
let warming: Promise<void> | null = null;

/** Oldest out, by the order the map holds -- a hit re-inserts, so the order
 *  is least-recently-wanted first. */
function trim<T>(map: Map<string, T>, keep: number): string[] {
  const gone: string[] = [];
  while (map.size > keep) {
    const oldest = map.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
    gone.push(oldest);
  }
  return gone;
}

/**
 * The card for this file as it was last built, or null.
 *
 * Synchronous on purpose: the switcher draws its cards in one pass, and
 * anything that has to be waited for is a blank rectangle the reader sees.
 * The stamp is not checked here -- the caller paints what is known at once
 * and asks for the current one in the same breath (see `cardKept`), which
 * is the only way a card can be both instant and right.
 */
export function cardNow(path: string): string | null {
  const have = held.get(path);
  return have ? have.html : null;
}

/** The card for this file if the one kept was built from exactly this
 *  stamp; the database is consulted when memory has nothing. */
export async function cardKept(path: string, stamp: string): Promise<string | null> {
  const have = held.get(path);
  if (have) return have.stamp === stamp ? have.html : null;
  const stored = await getAside<Held>(KEY + path).catch(() => null);
  if (!stored?.html || stored.stamp !== stamp) return null;
  held.set(path, { ...stored, at: Date.now() });
  trim(held, KEEP);
  return stored.html;
}

/**
 * Keep what was just built.
 *
 * `lasting` is false for the card of the tab being typed in: its stamp is
 * taken off the text in the editor rather than off the disk, so it would
 * never match again after a restart and would sit in the database as so
 * much dead weight. It is still worth holding in memory, where the next
 * press of the tabs button will want it.
 */
export function rememberCard(path: string, stamp: string, html: string, lasting = true): void {
  if (!path || !html) return;
  held.delete(path);
  held.set(path, { stamp, html, at: Date.now() });
  for (const gone of trim(held, KEEP)) void dropAside(KEY + gone).catch(() => {});
  if (lasting) void putAside(KEY + path, { stamp, html, at: Date.now() } satisfies Held).catch(() => {});
}

/** The picture last recalled for a document, for painting without waiting. */
export function shotNow(path: string): Shot | null {
  return shots.get(path) ?? null;
}

export function rememberShot(path: string, shot: Shot): void {
  if (!path) return;
  shots.delete(path);
  shots.set(path, shot);
  trim(shots, KEEP);
}

/**
 * A fresh picture was filed for this document, so the one held here is the
 * page before it. Called by the reader as it files (src/pdfCard.ts): a card
 * shown from memory is then always the card the database holds, and the
 * only tab that can be out of date is the one being read -- which is never
 * painted from memory (src/main.ts, tabCardNow).
 */
export function forgetShot(path: string): void {
  shots.delete(path);
}

/** A file renamed, deleted, or replaced: its card goes with it, so a tab
 *  can never show the inside of a file that is no longer there. */
export function forgetTabCard(path: string): void {
  if (!path) return;
  held.delete(path);
  shots.delete(path);
  void dropAside(KEY + path).catch(() => {});
}

/**
 * Bring the kept cards in from the database.
 *
 * Called when the app is idle after a launch, so that the first press of
 * the tabs button in a run is answered from memory like every other press.
 * It is also where the shelf is pruned: cards are filed one at a time and
 * nothing else counts them, so the count is made here, once, against the
 * same hundred.
 */
export function warmTabCards(): Promise<void> {
  if (warming) return warming;
  warming = (async () => {
    const keys = (await asideKeys().catch(() => [] as string[])).filter((key) => key.startsWith(KEY));
    if (!keys.length) return;
    const all = await Promise.all(keys.map(async (key) => ({ key, card: await getAside<Held>(key).catch(() => null) })));
    const good = all.filter((one): one is { key: string; card: Held } => Boolean(one.card?.html));
    good.sort((a, b) => (a.card.at ?? 0) - (b.card.at ?? 0));
    for (const { key, card } of good.slice(-KEEP)) {
      const path = key.slice(KEY.length);
      if (!held.has(path)) held.set(path, card);
    }
    for (const { key } of good.slice(0, Math.max(0, good.length - KEEP))) void dropAside(key).catch(() => {});
    for (const { key } of all.filter((one) => !one.card?.html)) void dropAside(key).catch(() => {});
    trim(held, KEEP);
  })();
  return warming;
}

/** A stamp for text that is in the editor rather than on the disk: the
 *  length and a cheap running hash of what the card will be built from, so
 *  that typing a word invalidates the card and moving the caret does not. */
export function liveStamp(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return `live:${text.length}:${hash}`;
}

/** Everything this module is holding, for the tests. */
export function cardsHeldNow(): { cards: number; shots: number } {
  return { cards: held.size, shots: shots.size };
}
