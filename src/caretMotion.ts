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
import { EditorSelection, EditorState, Prec, Transaction } from '@codemirror/state';
import { Direction, EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';

type Stop = { pos: number; assoc: -1 | 1; x: number; top: number };

// One stop per distinct caret slot (same visual row, same x). When a slot
// hosts two boundary positions, the one chosen is the same one the eye is
// next to: the smaller position on the slot's right face, the larger on its
// left face — which is also the side typing will visibly change.
function stopAt(stops: { pos: number; assoc: -1 | 1; x: number; top: number }[]): Stop {
  const positions = [...new Set(stops.map((s) => s.pos))];
  // A sample's assoc is the side that measured at this spot, so it is the
  // side the caret must take to paint here again. It matters at a soft wrap,
  // where the break position has two slots — the end of one row and the start
  // of the next — and always asking for side +1 sent the caret back to the
  // row it came from instead of stepping along the line (3).
  if (positions.length === 1) return { pos: positions[0], assoc: stops[0].assoc, x: stops[0].x, top: stops[0].top };
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
  // Match the stop on the caret's own visual row first: on a soft-wrapped
  // line the same x exists once per row, and a wrong-row match would send the
  // caret up or down instead of stepping along the row.
  let here = stops.findIndex((s) => Math.abs(s.x - current.left) <= 0.5 && Math.abs(s.top - current.top) <= 4);
  if (here < 0) here = stops.findIndex((s) => Math.abs(s.x - current.left) <= 0.5);
  const target = here < 0 ? null : stops[here + step];
  if (!target) return false;
  // Plain motion is a cursor at the stop, on the stop's side — the side is
  // what paints the caret where the step visually landed. The range has to
  // be wrapped in an EditorSelection, or the transaction drops its assoc.
  const range = extend ? sel.extend(sel.anchor, target.pos, target.assoc) : EditorSelection.cursor(target.pos, target.assoc);
  view.dispatch({ selection: EditorSelection.create([range]) });
  return true;
}

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

export const caretMotion = [
  lineSide,
  Prec.highest(keymap.of([
    { key: 'ArrowLeft', run: (view) => move(view, -1, false), shift: (view) => move(view, -1, true) },
    { key: 'ArrowRight', run: (view) => move(view, 1, false), shift: (view) => move(view, 1, true) },
  ])),
];
