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
import { EditorSelection, EditorState, Prec, RangeSetBuilder, Transaction } from '@codemirror/state';
import { Decoration, Direction, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
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
// A bidi position on a run boundary has two visual homes — one on each side of
// the run — and which one is picked is the "side" (assoc) of the selection.
// When that side is re-derived from what was just typed, a digit or an English
// word inside Persian text throws the caret over to the other side of what is
// being written: within one line it goes right, then left, then right again
// (3, 17). The writer asked for the one rule the phone's own text fields
// follow: take the side from the LINE — from its first letter — and keep it,
// whatever is being typed.
//
// Side `+1` is that side. It means "forward along the paragraph's own flow",
// and the line's direction is what sets the paragraph's direction here, so in
// a Persian line it paints at the left of the text the line just grew and in
// an English line at its right — the same place every keystroke, whether the
// key was a Persian letter, a digit, a space or a Latin letter.
//
// Applied in the same transaction as the edit (a filter, not a follow-up
// dispatch), so the caret never paints one frame on the wrong side. Only a
// single collapsed caret is touched: a selection keeps its own ends, and the
// filter leaves deliberate movement alone, because it only looks at
// transactions that changed the document. Composing text is left alone
// entirely: the keyboard owns the caret while a word is still being composed.
const lineSide = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.newSelection.ranges.length !== 1) return tr;
  const main = tr.newSelection.main;
  if (!main.empty || main.assoc === 1) return tr;
  if (tr.annotation(Transaction.userEvent)?.includes('compose')) return tr;
  // `sequential` so the head is read in the coordinates of the edit, not of
  // the document before it. Wrapped in EditorSelection.create, because a bare
  // SelectionRange in a spec is flattened to a plain cursor and loses its side.
  const side = EditorSelection.create([EditorSelection.cursor(main.head, 1)]);
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
// Only the separators that hold two numbers together are in the class. ES
// (`-` `+`) and ET (`%` `#` `$`) do not, once a Persian letter has made the
// digits Arabic numbers (Unicode W2): isolating across one paints `۳-۲` as a
// single LTR unit and the editor reads 2-then-3 where the reading view
// (src/markdown.ts) reads 3-then-2. Nothing is lost by leaving them out —
// a press is one position either way (this file), and a hyphenated date
// traces the same x as a slashed one.
// Read off LowTypes in @codemirror/view (charType).
const CS_SEP = ',.:/';
const NUMBER_RUN = new RegExp(`[0-9۰-۹٠-٩][0-9۰-۹٠-٩${CS_SEP}]*`, 'g');
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
      links.push([start, end]);
      ranges.push({ from: start, to: end, deco: ltrIsolate });
    }
    NUMBER_RUN.lastIndex = 0;
    for (let match = NUMBER_RUN.exec(text); match; match = NUMBER_RUN.exec(text)) {
      const start = from + match.index;
      if (inMath(view.state, start)) continue;
      if (links.some(([a, b]) => start >= a && start < b)) continue; // inside a link's run
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

/** −1 at the start of a number run, +1 at the end, else 0. */
function numberRunEdge(text: string, offset: number): -1 | 0 | 1 {
  NUMBER_RUN.lastIndex = 0;
  for (let match = NUMBER_RUN.exec(text); match; match = NUMBER_RUN.exec(text)) {
    if (offset === match.index) return -1;
    if (offset === match.index + match[0].length) return 1;
  }
  return 0;
}

// Both edges of that isolate have two homes. Outward assoc points at the
// line, not the number: −1 before the first digit, +1 after the last.
// Interior digits stay as they are so arrows still walk 2026. Typing is
// left to lineSide; this only pins select/move (assoc 0, or arrows’ +1
// at the start).
const numberEdgeSide = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || tr.newSelection.ranges.length !== 1) return tr;
  const main = tr.newSelection.main;
  if (!main.empty) return tr;
  if (tr.annotation(Transaction.userEvent)?.includes('compose')) return tr;
  const line = tr.newDoc.lineAt(main.head);
  if (inMath(tr.startState, main.head)) return tr;
  const edge = numberRunEdge(line.text, main.head - line.from);
  if (!edge || main.assoc === edge) return tr;
  return [tr, { selection: EditorSelection.create([EditorSelection.cursor(main.head, edge)]), sequential: true }];
});

export const caretMotion = [lineSide, arrowKeys, numberRuns, numberEdgeSide];
