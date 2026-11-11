// Ordinary and Shift+arrows use CodeMirror visual motion, including during IME
// composition. Browser caret affinity can still differ at some nested bidi slots. The capture listener is needed because CodeMirror ignores
// keyboard events while composing. Selection can span multiple logical
// characters in a single visual step at a bidirectional boundary.

import { EditorSelection, EditorState, StateEffect, StateField, Prec, RangeSetBuilder, Transaction, type Text, type Range} from '@codemirror/state';
import { Decoration, Direction, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { cursorCharLeft, cursorCharRight, selectCharLeft, selectCharRight } from '@codemirror/commands';
import { directionsField, type TextDirection } from './direction';
import { inMath } from './mathSource';

/** A candidate for the other edge of the run `head` bounds. In a simple
 *  embedded run the two edges share their two homes, but nested runs need not
 *  do so; the caller checks their coordinates before using the candidate. */
function mateOf(view: EditorView, head: number): number | null {
  const line = view.state.doc.lineAt(head);
  const at = head - line.from;
  const base = view.textDirectionAt(line.from);
  for (const span of view.bidiSpans(line)) {
    if (span.dir === base) continue;
    if (at === span.from) return line.from + span.to;
    if (at === span.to) return line.from + span.from;
  }
  return null;
}

function move(view: EditorView, dir: -1 | 1, extend: boolean): boolean {
  if (!extend) {
    const from = view.state.selection.main.head;
    if (!(dir === -1 ? cursorCharLeft(view) : cursorCharRight(view))) return false;
    // CodeMirror picks a shared slot's meaning from the way the caret came.
    // Pinned instead to the one this note gives it (the rule below), so the
    // place the caret is drawn means the same thing in simple runs. Without this,
    // going right through `اب ABC د` lands on the caret *after* `ABC` drawn
    // between `اب` and `ABC`, and the caret before `A` is never reached.
    const sel = view.state.selection.main;
    const want = sideAt(view.state.doc, view.state.field(directionsField, false)?.dirs, sel.head);
    if (sel.assoc === want) return true;
    const mate = mateOf(view, sel.head);
    if (mate === null || mate === from) return true;
    const side = sideAt(view.state.doc, view.state.field(directionsField, false)?.dirs, mate);
    // Nested bidi runs do not always share a visual slot at their endpoints.
    // Only normalize if it leaves the caret at the very same drawn position.
    const here = view.coordsAtPos(sel.head, sel.assoc < 0 ? -1 : 1);
    const there = view.coordsAtPos(mate, side);
    if (!here || !there || Math.abs(here.left - there.left) > 1 ||
        Math.abs(here.top - there.top) > 1) return true;
    view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(mate, side)]) });
    return true;
  }
  return dir === -1 ? selectCharLeft(view) : selectCharRight(view);
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
    if (!event.shiftKey && !this.view.composing) {
      const v = this.view, sel = v.state.selection.main, line = v.state.doc.lineAt(sel.head);
      const ltr = v.state.field(directionsField, false)?.dirs[line.number - 1] !== 'rtl';
      if (ltr && sel.empty && sel.assoc === -1 && sel.head > line.from) {
        const span = v.bidiSpans(line).find(s => s.to === sel.head - line.from && s.dir === Direction.RTL);
        if (span) {
          const here = v.coordsAtPos(sel.head, -1), there = v.coordsAtPos(sel.head, 1);
          if (here && there && Math.abs(here.left - there.left) > 1) {
            v.dispatch({effects: rtlAffinityEffect.of({from: line.from + span.from, to: sel.head})});
          }
        }
      }
    }
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

// Pick a stable representation of a shared visual slot for ordinary arrows.
// Preserve the existing side policy for edits; the primary caret is drawn by
// the browser, not a second CodeMirror caret layer.

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
  // Only edits: preserve the existing paragraph-side policy for typed text.
  // Composition is left to the keyboard; arrow movement is handled above.
  if (!tr.docChanged || tr.newSelection.ranges.length !== 1) return tr;
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
/** The isolates in a decoration set, and nothing else. CodeMirror isolates
 *  every range in a set handed to `bidiIsolatedRanges`, whether or not it
 *  asked to be one, so a plugin that paints colours and marks as well as
 *  isolates publishes the isolates on their own. Telling CodeMirror matters:
 *  it works out the line's bidi order itself, and an isolate it does not know
 *  about leaves its motion reasoning about a line that is not on the screen. */
export function isolatesOf(set: DecorationSet): DecorationSet {
  const out: Range<Decoration>[] = [];
  for (const iter = set.iter(); iter.value; iter.next()) {
    if (iter.value.spec?.bidiIsolate != null) out.push(iter.value.range(iter.from, iter.to));
  }
  return Decoration.set(out, true);
}

const ltrIsolate = Decoration.mark({
  attributes: { style: 'unicode-bidi: isolate; direction: ltr' },
  bidiIsolate: Direction.LTR,
});
const numberIsolate = ltrIsolate;
// A generated directional mark gives Chromium a native caret affinity on the
// right edge of an isolated number. It is not part of the document.
const numberIsolateCaret = Decoration.mark({
  attributes: { class: 'cm-number-caret-affinity', style: 'unicode-bidi: isolate; direction: ltr' },
  bidiIsolate: Direction.LTR,
});

function activeNumberEnd(view: EditorView): number {
  const s = view.state.selection.main;
  if (view.composing || !s.empty || s.assoc >= 0) return -1;
  const line = view.state.doc.lineAt(s.head);
  const offset = s.head - line.from;
  const next = line.text[offset] ?? '';
  const following = line.text[offset + 1] ?? '';
  if (/[0-9۰-۹٠-٩]/.test(next) || (CS_SEP.includes(next) && next !== '' && /[0-9۰-۹٠-٩]/.test(following))) return -1;
  const before = line.text.slice(0, offset);
  return /[0-9۰-۹٠-٩]+(?:[,.:/][0-9۰-۹٠-٩]+)+$/.test(before) ? s.head : -1;
}

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
  const activeEnd = activeNumberEnd(view);
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
      ranges.push({ from: start, to: start + match[0].length, deco: start + match[0].length === activeEnd ? numberIsolateCaret : numberIsolate });
    }
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const range of ranges) builder.add(range.from, range.to, range.deco);
  return builder.finish();
}

const numberRuns = ViewPlugin.fromClass(class {
  isolates: DecorationSet;
  private activeEnd: number;
  constructor(view: EditorView) { this.activeEnd = activeNumberEnd(view); this.isolates = numberIsolates(view); }
  update(update: ViewUpdate) {
    const end = activeNumberEnd(update.view);
    if (update.docChanged || update.viewportChanged || end !== this.activeEnd) {
      this.activeEnd = end;
      this.isolates = numberIsolates(update.view);
    }
  }
}, {
  provide: (plugin) => {
    const access = (view: EditorView) => view.plugin(plugin)?.isolates ?? Decoration.none;
    return Prec.lowest([EditorView.decorations.of(access), EditorView.bidiIsolatedRanges.of(access)]);
  },
});

// Chromium sometimes paints an RTL run's end at its other bidi edge even
// though the CM association and insertion offset are correct. A generated RLM
// on the run gives the native caret the right affinity without adding source
// characters. It is cleared on the next edit or selection change.
const rtlAffinityEffect = StateEffect.define<{from:number;to:number}>();
const rtlAffinity = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(old, tr) {
    let value = tr.docChanged || tr.selection ? Decoration.none : old;
    for (const effect of tr.effects) if (effect.is(rtlAffinityEffect)) {
      value = Decoration.set([Decoration.mark({class:'cm-rtl-caret-affinity'}).range(effect.value.from,effect.value.to)]);
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field)
});
export const caretMotion = [lineSide, arrowKeys, numberRuns, rtlAffinity];
