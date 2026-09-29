// Caret motion across direction boundaries. In a mixed line like
// «اب ABC د» the two sides of the RTL↔LTR junction are separate stops in
// visual space, and each document position sitting on a junction renders on
// one side or the other depending on which way the caret arrived. The stock
// motion steps by position and then draws the caret at the default side, so
// at a junction the caret jumps across the embedded run and doubles back.
//
// This walks the line's visual slots instead: every caret side that paints
// somewhere is a stop; the stops are ordered by their x inside each visual
// row (rows top to bottom, the row's own reading order deciding how they
// chain at a soft wrap); and each stop remembers the position AND the side
// the caret must take there, so it always paints where it just moved to.
import { EditorSelection, Prec } from '@codemirror/state';
import { Direction, EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';

type Stop = { pos: number; assoc: -1 | 1; x: number };

// One stop per distinct caret slot (same visual row, same x). When a slot
// hosts two boundary positions, the one chosen is the same one the eye is
// next to: the smaller position on the slot's right face, the larger on its
// left face — which is also the side typing will visibly change.
function stopAt(stops: { pos: number; assoc: -1 | 1; x: number }[]): Stop {
  const positions = [...new Set(stops.map((s) => s.pos))];
  if (positions.length === 1) return { pos: positions[0], assoc: 1, x: stops[0].x };
  const left = stops[0].assoc === -1;
  const chosen = left
    ? stops.reduce((a, b) => (a.pos <= b.pos ? a : b))
    : stops.reduce((a, b) => (a.pos >= b.pos ? a : b));
  return chosen;
}

/** The line's visual stops, in reading order for the line's base direction. */
function lineStops(view: EditorView, head: number): Stop[] {
  const line = view.state.doc.lineAt(head);
  const samples: { pos: number; assoc: -1 | 1; x: number; top: number }[] = [];
  for (let pos = line.from; pos <= line.to; pos += 1) {
    for (const assoc of [-1, 1] as const) {
      const rect = view.coordsAtPos(pos, assoc);
      if (rect) samples.push({ pos, assoc, x: rect.left, top: rect.top });
    }
  }
  // Group into visual rows (a soft-wrapped line has more than one).
  const tops = [...new Set(samples.map((s) => Math.round(s.top)))].sort((a, b) => a - b);
  const rowOf = (top: number): number => tops.findIndex((t) => Math.abs(t - top) <= 4);
  const rows: (typeof samples)[] = tops.map(() => []);
  for (const s of samples) rows[rowOf(s.top)].push(s);
  const rtl = view.textDirectionAt(line.from) === Direction.RTL;
  const stops: Stop[] = [];
  for (const row of rows) {
    const xs = [...new Set(row.map((s) => s.x))].sort((a, b) => a - b);
    const rowStops = xs.map((x) => stopAt(row.filter((s) => Math.abs(s.x - x) <= 0.5)));
    stops.push(...(rtl ? rowStops.reverse() : rowStops));
  }
  return stops;
}

function move(view: EditorView, dir: -1 | 1, extend: boolean): boolean {
  if (view.composing) return false;
  const sel = view.state.selection.main;
  const stops = lineStops(view, sel.head);
  const rtl = view.textDirectionAt(view.state.doc.lineAt(sel.head).from) === Direction.RTL;
  // Visual right is larger x: the next stop in an LTR line, the previous one
  // in an RTL line (whose reading order runs right to left).
  const step = dir === (rtl ? -1 : 1) ? 1 : -1;
  const current = view.coordsAtPos(sel.head, sel.assoc || -1);
  if (!current) return false;
  const here = stops.findIndex((s) => Math.abs(s.x - current.left) <= 0.5);
  const target = here < 0 ? null : stops[here + step];
  if (!target) return false;
  // Plain motion is a cursor at the stop, on the stop's side — the side is
  // what paints the caret where the step visually landed. The range has to
  // be wrapped in an EditorSelection, or the transaction drops its assoc.
  const range = extend ? sel.extend(sel.anchor, target.pos, target.assoc) : EditorSelection.cursor(target.pos, target.assoc);
  view.dispatch({ selection: EditorSelection.create([range]) });
  return true;
}

const RTL_RE = /[\u0590-\u08FF\u200F\uFB50-\uFDFF\uFE70-\uFEFF]/;

function isRtlChar(ch: string): boolean {
  return RTL_RE.test(ch);
}

// After typing at a bidi junction the caret's assoc is still the one it had
// before the insert, so the caret paints on the old visual side and the next
// keystroke feels like it goes the wrong way. Fix the assoc to the side of
// the just-typed character's visual end.
const bidiCaretPlugin = ViewPlugin.fromClass(class {
  lastHead = 0;
  lastAssoc: -1 | 1 = -1;
  constructor(view: EditorView) {
    this.lastHead = view.state.selection.main.head;
    this.lastAssoc = (view.state.selection.main.assoc as -1 | 1) || -1;
  }
  update(update: ViewUpdate): void {
    const main = update.state.selection.main;
    const prevMain = update.startState.selection.main;
    // Only after a single-cursor input that inserted exactly one char (or a
    // short word) at the caret.
    if (!update.docChanged || !main.empty || update.state.selection.ranges.length !== 1) {
      this.lastHead = main.head;
      this.lastAssoc = (main.assoc as -1 | 1) || -1;
      return;
    }
    const tr = update.transactions.find((t) => t.docChanged);
    const userEvent = (tr?.annotation as any)?.type ? '' : (tr as any)?.isUserEvent?.('input.type') ? 'input' : '';
    // Heuristic: if the transaction is an input and head moved forward by 1..2,
    // treat the char before head as the typed char.
    const inserted = main.head - prevMain.head;
    if (inserted <= 0 || inserted > 4) {
      this.lastHead = main.head;
      this.lastAssoc = (main.assoc as -1 | 1) || -1;
      return;
    }
    const before = update.state.sliceDoc(Math.max(0, main.head - inserted), main.head);
    if (!before) {
      this.lastHead = main.head;
      this.lastAssoc = (main.assoc as -1 | 1) || -1;
      return;
    }
    const lastChar = before[before.length - 1];
    if (!lastChar) {
      this.lastHead = main.head;
      this.lastAssoc = (main.assoc as -1 | 1) || -1;
      return;
    }
    // Check if we are at a bidi boundary (two visual positions for same pos).
    const view = update.view;
    const left = view.coordsAtPos(main.head, -1);
    const right = view.coordsAtPos(main.head, 1);
    if (!left || !right || Math.abs(left.left - right.left) < 1) {
      this.lastHead = main.head;
      this.lastAssoc = (main.assoc as -1 | 1) || -1;
      return;
    }
    // Choose assoc whose x is on the visual end of the typed char.
    // LTR char: visual end is to the right (larger x in LTR base), RTL char:
    // visual end is to the left (smaller x). Use the char's own direction.
    const rtlTyped = isRtlChar(lastChar);
    // For mixed lines, the base direction matters, but the simplest robust
    // rule is: after typing, keep the caret on the side where the typed char
    // sits visually. The typed char's visual span is between coords of
    // (head-1) and head. Pick the head assoc that is farther in typing dir.
    const headLeftX = left.left;
    const headRightX = right.left;
    // Estimate typed char's center x from its start positions.
    const prevLeft = view.coordsAtPos(main.head - 1, -1);
    const prevRight = view.coordsAtPos(main.head - 1, 1);
    const charX = prevLeft && prevRight ? (prevLeft.left + prevRight.left) / 2 : prevLeft?.left ?? prevRight?.left ?? headLeftX;
    // If typed RTL, we want caret x < charX (to the left visually in LTR base
    // after an RTL run). If LTR, caret x > charX.
    let desiredAssoc: -1 | 1;
    if (rtlTyped) {
      desiredAssoc = headLeftX < headRightX ? (headLeftX < charX ? -1 : 1) : (headRightX < charX ? 1 : -1);
      // Fallback: pick smaller x for RTL
      if (headLeftX !== headRightX) desiredAssoc = headLeftX < headRightX ? -1 : 1;
    } else {
      desiredAssoc = headLeftX > headRightX ? -1 : 1;
      if (headLeftX !== headRightX) desiredAssoc = headLeftX > headRightX ? -1 : 1;
    }
    // Only dispatch if assoc would change.
    if (desiredAssoc !== main.assoc) {
      const range = EditorSelection.cursor(main.head, desiredAssoc);
      // Defer to avoid recursive update during the same frame.
      window.requestAnimationFrame(() => {
        if (view.state.selection.main.head === main.head) {
          view.dispatch({ selection: EditorSelection.create([range]) });
        }
      });
    }
    this.lastHead = main.head;
    this.lastAssoc = desiredAssoc;
    void userEvent;
  }
});

export const caretMotion = [
  bidiCaretPlugin,
  Prec.highest(keymap.of([
    { key: 'ArrowLeft', run: (view) => move(view, -1, false), shift: (view) => move(view, -1, true) },
    { key: 'ArrowRight', run: (view) => move(view, 1, false), shift: (view) => move(view, 1, true) },
  ])),
];
