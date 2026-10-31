// What a document's text layer says, versus what the page says.
//
// A Persian page painted by Word (and by most things that lay Arabic script
// out visually) writes the lam-alef ligature as its two letters in the order
// they are *drawn* — the alef on the left, the lam on the right — so the text
// PDFium reads back has them the wrong way round: the page says «انقلاب» and
// the file says «انقالب». Nothing shows it on screen, because the glyphs are
// painted where they belong; it only bites when the text is read, and then it
// bites hard. Searching his 52-page handout for «انقلاب» found nothing at all,
// while «انقالب» found 141. Of the Persian words in that document, the ones
// carrying a lam-alef are most of the interesting ones: انقلاب، اسلامی، بالا،
// لازم.
//
// Measured, not guessed: over five pages of that handout the only *letter*
// pair that ever comes back in reverse order is ا followed by ل (43 times).
// Everything else reads in order; the other reversed pairs are digits, which
// run left to right inside a right-to-left line and are supposed to.

/** The alef forms a lam can be tied to. */
const ALEFS = '\u0627\u0622\u0623\u0625'; // ا آ أ إ
const LAM = '\u0644';

/** True when the text has a lam-alef in it at all. */
export const hasLamAlef = (text: string): boolean =>
  new RegExp(`[${LAM}][${ALEFS}]`, 'u').test(text);

/**
 * A query as the file would have written it: every lam-alef turned round.
 * The swap is all-or-nothing on purpose — the file is consistent, so one
 * extra search covers a query with any number of them, where trying each
 * combination would cost a search per ligature.
 */
export const asFileWroteIt = (query: string): string =>
  query.replace(new RegExp(`([${LAM}])([${ALEFS}])`, 'gu'), '$2$1');

/** A glyph box, as little of one as this file needs. */
export interface GlyphBox { origin: { x: number; y: number }; isSpace?: boolean }

/**
 * Text read out of a page, put back into reading order using the boxes the
 * glyphs were painted in: an alef immediately followed by a lam whose glyph
 * sits to its *right* is a lam-alef that came back reversed, and the two
 * letters swap. A real «ال» — the Arabic article, which is just as common —
 * is painted the other way round and is left alone, so this cannot damage
 * text that was already correct.
 *
 * `glyphs[i]` belongs to `text[i]`; a missing box (a space, a character with
 * no glyph of its own) just means the pair is not a ligature.
 */
export function inReadingOrder(text: string, glyphs: (GlyphBox | null | undefined)[]): string {
  const out = text.split('');
  for (let i = 0; i + 1 < out.length; i += 1) {
    if (!ALEFS.includes(out[i]) || out[i + 1] !== LAM) continue;
    const alef = glyphs[i];
    const lam = glyphs[i + 1];
    if (!alef || !lam || alef.isSpace || lam.isSpace) continue;
    // Same line, and the second letter painted to the right of the first:
    // that is the pair back to front.
    if (Math.abs(alef.origin.y - lam.origin.y) > 2) continue;
    if (lam.origin.x <= alef.origin.x) continue;
    out[i] = LAM;
    out[i + 1] = text[i];
    i += 1;
  }
  return out.join('');
}

// ---- The joiners the other way out of a page drops ----
//
// A page gives its text up two ways, and each one keeps something the other
// loses. The geometry — the runs and glyph boxes the contents list is read
// from — has the letters in the order they are read, but no zero-width
// non-joiner at all, so «ریشه‌های» comes back «ریشههای» and the contents
// read like a phone with its Persian keyboard broken. The text layer keeps
// every ZWNJ and reverses the ligatures, which is the fault above.
//
// So the two are put together: the line as the geometry read it, with the
// joiners of the line as the text layer wrote it. Both are the same
// characters otherwise, and a turned-round ligature does not change a
// line's length, so once the line is found in the page the positions of
// the joiners are the positions to put them back at.

/** The zero-width non-joiner: a space in Persian that is not a space. */
const ZWNJ = '\u200c';

/** A page's text with its joiners taken out, and where each one was. */
export interface Joiners {
  /** The page's text without any ZWNJ. */
  bare: string;
  /** For each character of `bare`, where it sits in the page's own text. */
  at: number[];
  /** The page's text as the file wrote it. */
  raw: string;
}

/** Read a page's joiners once, for all the lines that come off that page. */
export const joinersIn = (pageText: string): Joiners | null => {
  if (!pageText.includes(ZWNJ)) return null;
  const at: number[] = [];
  let bare = '';
  for (let i = 0; i < pageText.length; i += 1) {
    if (pageText[i] === ZWNJ) continue;
    at.push(i);
    bare += pageText[i];
  }
  return { bare, at, raw: pageText };
};

/**
 * A line read off the page's geometry, with the joiners the text layer has
 * for it. The line is looked for as it reads and, failing that, as the file
 * spells it — a file that writes its ligatures backwards holds the second,
 * one that does not holds the first. A line that cannot be found is given
 * back untouched: a contents list missing a joiner is a small thing beside
 * one with a word in it that was never on the page.
 */
const asPageHasIt = (piece: string, joiners: Joiners): string | null => {
  if (piece.length < 3) return null; // nothing that short has a joiner inside it
  let found = joiners.bare.indexOf(piece);
  if (found < 0 && hasLamAlef(piece)) found = joiners.bare.indexOf(asFileWroteIt(piece));
  if (found < 0) return null;
  let out = '';
  for (let i = 0; i < piece.length; i += 1) {
    out += piece[i];
    const here = joiners.at[found + i];
    const next = i + 1 < piece.length ? joiners.at[found + i + 1] : here + 1;
    for (let j = here + 1; j < next; j += 1) if (joiners.raw[j] === ZWNJ) out += ZWNJ;
  }
  return out;
};

export const withJoiners = (text: string, joiners: Joiners | null): string => {
  if (!joiners || !text) return text;
  const whole = asPageHasIt(text, joiners);
  if (whole !== null) return whole;
  // Not on the page as one piece: a heading wrapped over two lines is
  // joined before it gets here, and a bracket in a right-to-left line is
  // turned back the right way round, so neither reads as the file wrote
  // it. A word is still a word, though, and where its joiners go is the
  // word's own business -- so each one is looked up on its own.
  // A bracket or a colon hanging off a word is not part of it -- and a
  // bracket is exactly what will not match, since a right-to-left line
  // keeps the one it was drawn with, mirrored.
  const EDGES = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;
  return text.split(/(\s+)/u).map((part) => {
    if (/^\s/u.test(part) || !part) return part;
    const found = asPageHasIt(part, joiners);
    if (found !== null) return found;
    const [, head, core, tail] = EDGES.exec(part) ?? [];
    if (!core) return part;
    return `${head}${asPageHasIt(core, joiners) ?? core}${tail}`;
  }).join('');
};
