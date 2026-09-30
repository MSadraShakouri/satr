// Double tap to select a word, and drag to select more — the gesture every
// phone text field has, and the one Android's own selection handles are built
// on.
//
// The WebView does this itself when the caret lives in the DOM selection: a
// double tap selects the word under the finger and shows the handles and the
// cut/copy/paste bar. That is the path Satr wants (the keyboard's own
// suggestions and menus come with it), so everything here is a *fallback* for
// when the browser did not do it: the selection is left exactly as the browser
// left it whenever there is one, and only an empty caret is turned into a word.
// Nothing here ever guesses over a selection the writer can see.
//
// The rules are small and kept here rather than in the editor so they can be
// tested without a touch screen: what counts as a word, and when a second tap
// is a second tap.

export interface Range { from: number; to: number }

/** A word is a run of letters, digits and underscores — what a phone keyboard
 * calls a word, in either script. Everything else (space, punctuation,
 * Markdown) ends it, and a run of whitespace is not a word to select. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

export function wordRangeAt(text: string, pos: number): Range | null {
  const at = Math.min(Math.max(pos, 0), text.length);
  let from = at;
  let to = at;
  while (from > 0 && WORD_CHAR.test(text[from - 1])) from -= 1;
  while (to < text.length && WORD_CHAR.test(text[to])) to += 1;
  return to > from ? { from, to } : null;
}

/** Two taps make one double tap: the same window Android's own text fields
 * use, and within a finger's width of the first. */
export const DOUBLE_TAP_MS = 320;
export const TAP_SLOP_PX = 30;

/** Counts the taps of one finger. 0 means "not a tap": a second finger, or a
 * tap too far from the last one to belong to it. */
export class TapTracker {
  private last: { time: number; x: number; y: number } | null = null;

  /** The number of taps in a row: 1, 2, 3… 0 when this is not a tap. */
  start(time: number, x: number, y: number, fingers = 1): number {
    if (fingers !== 1) return this.cancel();
    const last = this.last;
    this.last = { time, x, y };
    if (!last) return 1;
    return time - last.time <= DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) <= TAP_SLOP_PX ? 2 : 1;
  }

  cancel(): number {
    this.last = null;
    return 0;
  }
}
