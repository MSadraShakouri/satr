// Caret motion: one position a press, the way the platform's own fields do it.
//
// Read off the reference first. In a Persian line, Chrome's own ← / → step one
// *logical* position a press and paint the caret at the paragraph's own side —
// an arrow is a visual direction, and the visual right in an RTL paragraph is
// the *previous* position, so the key mirrors exactly as it does in the
// phone's text fields. Stepping by *drawing* position instead (the walk this
// file used to do) is where the formula went wrong: the two faces of an inline
// formula share slots, so a shift+→ from just after `$a^2 + b$` grew the
// selection by the whole formula in one press — the skip the writer reported.
// One position a press also keeps the `$` signs stoppable and the formula's
// edges on the line's side; and it needs no special case for math at all. Math
// and code never vote for a line's direction anywhere else in the app
// (src/direction.ts), and a line that is nothing but math or code is LTR
// there — so display math reads left to right whatever the note around it
// says, and an inline formula is simply characters of its paragraph.
//
// The side is +1, "forward along the paragraph's own flow" — the same side the
// edit filter below keeps — so a moved caret paints exactly where a typed one
// does.
//
// The keys are read from a capture listener on the editor element rather than
// from a keymap, because CodeMirror drops *every* key event while an IME
// composition is open (@codemirror/view's InputState.handleEvent gives up on
// key events while composing). Gboard keeps a word composed until it commits,
// and that is where the phone's → was dead: the browser's own motion inside a
// composition goes nowhere, and no keymap is even reached. Owning the two keys
// here means the note answers them the same way whether or not a word is still
// with the keyboard.
import { EditorSelection, EditorState, Prec, RangeSetBuilder, Transaction, type Text } from '@codemirror/state';
import { Decoration, Direction, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { directionsField, type TextDirection } from './direction';
import { inMath } from './mathSource';

function move(view: EditorView, dir: -1 | 1, extend: boolean): boolean {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  // The line's direction is the app's own policy, worn as the line's `dir`
  // attribute: the first strong letter with math and code masked out, and a
  // line that is nothing but math or code is LTR (src/direction.ts).
  const rtl = view.textDirectionAt(line.from) === Direction.RTL;
  // The keys are visual: the visual right is the next position in an LTR
  // paragraph and the previous one in an RTL paragraph. Flat document offsets,
  // so a step across a line break lands on the previous line's end or the next
  // line's start — the paragraph's own order, as the platform has it.
  const step = rtl ? -dir : dir;
  const target = sel.head + step;
  if (target < 0 || target > view.state.doc.length) return false;
  // assoc 1: the paragraph's own side, as the filter below keeps it. The range
  // has to be wrapped in an EditorSelection, or the transaction drops its side.
  const range = extend ? sel.extend(sel.anchor, target, 1) : EditorSelection.cursor(target, 1);
  view.dispatch({ selection: EditorSelection.create([range]) });
  return true;
}

/** The four keys of a physical keyboard, and Gboard's own arrow row: the IME
 *  sends the same key codes, and an old one may report only the code. */
function arrowDir(event: KeyboardEvent): -1 | 1 | 0 {
  if (event.ctrlKey || event.metaKey || event.altKey) return 0;
  if (event.key === 'ArrowLeft' || event.keyCode === 37) return -1;
  if (event.key === 'ArrowRight' || event.keyCode === 39) return 1;
  return 0;
}

const arrowKeys = ViewPlugin.fromClass(class {
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return; // a page listener before us took the key
    const dir = arrowDir(event);
    if (!dir) return;
    if (!move(this.view, dir, event.shiftKey)) return;
    // Claim the key: the browser's own motion would otherwise follow ours, and
    // CodeMirror's keymaps would step a second time.
    event.preventDefault();
  };

  constructor(readonly view: EditorView) {
    // Capture, on the editor element: ahead of CodeMirror's own listener on
    // the content element, and reached while a composition is open.
    view.dom.addEventListener('keydown', this.onKeyDown, true);
  }

  destroy(): void {
    this.view.dom.removeEventListener('keydown', this.onKeyDown, true);
  }
});

// The caret follows the line, never the run it happens to sit next to.
//
// A position where two runs meet has TWO homes — one at each end of the
// embedded run — and the caret's side (assoc) is what picks between them.
// −1 means "I belong to the character before me", +1 "to the one after me".
//
// The rule is the line's own: the caret belongs to the text written in the
// line's direction, never to the run embedded in it. In a Persian line that
// means the side of the Persian on one side or the other of an English word:
//
//     سلام |test تست     the caret is before `test`, so it belongs to the
//                        Persian BEFORE it (−1) and is painted between سلام
//                        and the word — where a reader reads "before test"
//     سلام test| تست     the caret is after `test`, so it belongs to the
//                        Persian AFTER it (+1) and is painted on the far
//                        side of the word — where a reader reads "after test"
//
// Pinning the side to +1 everywhere, as this file used to, only answers the
// second of those. At the start of the word +1 attaches the caret to the
// word, and it was painted at the word's far left: the writer put the caret
// after سلام and the note showed it after `test`, so a keystroke there read
// as if it were going to the wrong side of the English. Measured on
// `سلام test تست`: offset 5 painted at x=925, with سلام at 955 and the word
// from 925 to 951. It now paints at 951.
//
// Inside a word, and at the two ends of the line, the two homes are the same
// place and the side changes nothing — so this only ever speaks where a
// reader would otherwise have to guess.
//
// Applied in the same transaction as whatever moved the caret (a filter, not
// a follow-up dispatch), so it never paints one frame on the wrong side, and
// the one rule covers every way of getting there: typing, the arrow keys, a
// tap. Only a single collapsed caret is touched — a selection keeps its own
// ends. Composing text is left alone entirely: the keyboard owns the caret
// while a word is still being composed.

/** A character the line reads against its own flow: a letter of the other
 *  script, and in a Persian line a digit too — digits are their own little
 *  left-to-right run inside Persian text. */
function embedded(ch: string, rtl: boolean): boolean {
  if (/\p{L}/u.test(ch)) return RTL_LETTER.test(ch) !== rtl;
  return rtl && /[0-9\u06f0-\u06f9\u0660-\u0669]/.test(ch);
}

/** Which neighbour the caret at `head` belongs to: −1 the character before
 *  it, +1 the one after. The line's directions are read from the document
 *  (src/direction.ts), never from the layout. */
function sideAt(doc: Text, dirs: readonly TextDirection[] | undefined, head: number): 1 | -1 {
  const line = doc.lineAt(head);
  const at = head - line.from;
  if (at === 0 || at === line.text.length) return 1; // one home at either end of a line
  const rtl = (dirs?.[line.number - 1] ?? 'ltr') === 'rtl';
  const before = line.text[at - 1];
  const after = line.text[at];
  return !embedded(before, rtl) && embedded(after, rtl) ? -1 : 1;
}

const lineSide = EditorState.transactionFilter.of((tr) => {
  if (tr.newSelection.ranges.length !== 1) return tr;
  const main = tr.newSelection.main;
  if (!main.empty) return tr;
  if (tr.annotation(Transaction.userEvent)?.includes('compose')) return tr;
  const want = sideAt(tr.newDoc, tr.startState.field(directionsField, false)?.dirs, main.head);
  if (main.assoc === want) return tr;
  // `sequential` so the head is read in the coordinates of the edit, not of
  // the document before it. Wrapped in EditorSelection.create, because a bare
  // SelectionRange in a spec is flattened to a plain cursor and loses its side.
  const side = EditorSelection.create([EditorSelection.cursor(main.head, want)]);
  return [tr, { selection: side, sequential: true }];
});

// CM6 bidi (Unicode): after Persian letters, digits become a number run.
// CS (, . : /) between two numbers joins them; at the end of a number it
// becomes a neutral and the *next* digit opens a new run — the caret jump
// on YYYY/MM/DD and 12:30, and `/` is NI in CM6 but splits dates the same.
// Isolating each digit+separator sequence as one LTR run stops the extra
// run so you can still walk through 2026. Inline `$…$` is already its own
// run; leave it.
//
// A separator only joins when a digit follows it, and only a run that holds
// one is isolated. A trailing separator belongs to the line, not to the
// number: in an RTL line `۲` then `.` reads period-left, which is what a
// list marker or a sentence ending in a number looks like in the reading
// view. Inside an LTR isolate the same two characters read period-right,
// so `۲.` at the head of a Persian line drew `.۲` and a Persian sentence
// ending in `۵.` flipped its full stop. A plain run of digits needs no
// isolate at all — it is already one run.
//
// Only the separators that hold two numbers together are in the class. ES
// (`-` `+`) and ET (`%` `#` `$`) do not, once a Persian letter has made the
// digits Arabic numbers (Unicode W2): isolating across one paints `۳-۲` as a
// single LTR unit and the editor reads 2-then-3 where the reading view
// (src/markdown.ts) reads 3-then-2. Nothing is lost by leaving them out —
// a press is one position either way (this file), and a hyphenated date
// traces the same x as a slashed one.
// Read off LowTypes in @codemirror/view (charType).
//
// An isolate is itself a neutral to the text around it, and Unicode hands a
// neutral standing between two opposite directions to the *paragraph* (UAX #9,
// N2). So an isolate with a word of the other script beside it is carried
// across that word: `از Satr 2.0 استفاده کن` drew `2.0 Satr`, and the mirror
// of it moved a number off a Persian word in an English line. The isolates
// below therefore go only where they cannot do that — where the nearest letter
// on each side is the line's own direction. Beside a word of the other script
// nothing needs isolating anyway: Unicode already keeps the digits with that
// word (W7 after a Latin letter, W2 after a Persian one) and the brackets of a
// link inside the Latin run around them (N1).
const CS_SEP = ',.:/';
const NUMBER_RUN = new RegExp(`[0-9۰-۹٠-٩]+(?:[${CS_SEP}][0-9۰-۹٠-٩]+)+`, 'g');
const ltrIsolate = Decoration.mark({
  attributes: { style: 'unicode-bidi: isolate; direction: ltr' },
  bidiIsolate: Direction.LTR,
});
const numberIsolate = ltrIsolate;

// `![Screenshot_20261014-082559_MiXplorer](_res/Screenshot_20261014-082559_MiXplorer.png)`
// on a Persian line drew as `) …png(] … ![`: the picture's `!` at the line's
// right edge, the closing `)` at its left, the brackets scattered between. No
// direction is given to `!`, `[`, `]`, `(` and `)` by the language they are
// written in — they are neutrals — and a neutral beside the paragraph's edge
// takes the paragraph's own direction, so on an RTL line the whole construct
// mirrors. An isolate with a direction of its own settles every one of them
// where the markdown wrote it, the same way the number runs above keep a date
// in its natural order.
//
// Which construct: one whose label carries no Persian (Hebrew, Syriac…) letter
// is read as a single LTR unit, brackets, link, URL and all — `![picture](…)`,
// `[Wikipedia](https://…)`, `![[chart.png]]`. A construct whose label *is*
// Persian keeps the line's direction (`[متن](url)`) and only its URL is
// isolated, so a link reads with its text and the address still lies in one
// piece. Same test the direction policy uses for a line's own direction
// (src/direction.ts).
const LINK_RUN = /!?\[[^\]\n]*\]\([^)\n]*\)|!?\[\[[^\]\n]+\]\]/g;
const RTL_LETTER = /[\u200f\u061c\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u;

/** The nearest letter beyond one edge of a run, or null when the line has
 *  none on that side. Digits and punctuation are not letters and do not
 *  answer: they are the neutrals the question is about. */
function nearestLetter(text: string, start: number, step: -1 | 1): 'rtl' | 'ltr' | null {
  for (let at = start; at >= 0 && at < text.length; at += step) {
    if (!/\p{L}/u.test(text[at])) continue;
    return RTL_LETTER.test(text[at]) ? 'rtl' : 'ltr';
  }
  return null;
}

/** True when a Latin word stands beside the run. These isolates are LTR
 *  islands and only ever help inside Persian text; against a Latin word the
 *  island is the thing that gets carried away, and Unicode holds the run in
 *  place on its own. Nothing on a side (the line's edge) is no objection.
 *
 *  Read from the document, never from the layout: `textDirectionAt` and the
 *  rest of the measuring API throw inside a plugin update, and a plugin that
 *  throws is switched off for the rest of the session — with it went every
 *  isolate in the note. */
function carriedAway(view: EditorView, from: number, to: number): boolean {
  const line = view.state.doc.lineAt(from);
  const before = nearestLetter(line.text, from - line.from - 1, -1);
  const after = nearestLetter(line.text, to - line.from, 1);
  return before === 'ltr' || after === 'ltr';
}

/** The isolate for one markdown construct, or null when it needs none. */
function linkIsolate(match: string): { from: number; to: number } | null {
  const url = /\]\([^)]*\)$/.exec(match);
  if (url) {
    const label = match.slice(0, url.index);
    if (!RTL_LETTER.test(label)) return { from: 0, to: match.length };
    // A Persian label: the brackets around the address alone.
    return { from: url.index, to: match.length };
  }
  return RTL_LETTER.test(match) ? null : { from: 0, to: match.length };
}

function numberIsolates(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    const links: [number, number][] = [];
    LINK_RUN.lastIndex = 0;
    for (let match = LINK_RUN.exec(text); match; match = LINK_RUN.exec(text)) {
      const isolate = linkIsolate(match[0]);
      if (!isolate) continue;
      const start = from + match.index + isolate.from;
      const end = from + match.index + isolate.to;
      if (carriedAway(view, start, end)) continue;
      links.push([start, end]);
      ranges.push({ from: start, to: end, deco: ltrIsolate });
    }
    NUMBER_RUN.lastIndex = 0;
    for (let match = NUMBER_RUN.exec(text); match; match = NUMBER_RUN.exec(text)) {
      const start = from + match.index;
      if (inMath(view.state, start)) continue;
      if (links.some(([a, b]) => start >= a && start < b)) continue; // inside a link's run
      if (carriedAway(view, start, start + match[0].length)) continue;
      ranges.push({ from: start, to: start + match[0].length, deco: numberIsolate });
    }
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const range of ranges) builder.add(range.from, range.to, range.deco);
  return builder.finish();
}

const numberRuns = ViewPlugin.fromClass(class {
  isolates: DecorationSet;
  constructor(view: EditorView) { this.isolates = numberIsolates(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) this.isolates = numberIsolates(update.view);
  }
}, {
  provide: (plugin) => {
    const access = (view: EditorView) => view.plugin(plugin)?.isolates ?? Decoration.none;
    return Prec.lowest([EditorView.decorations.of(access), EditorView.bidiIsolatedRanges.of(access)]);
  },
});

export const caretMotion = [lineSide, arrowKeys, numberRuns];
