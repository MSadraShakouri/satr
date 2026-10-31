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
