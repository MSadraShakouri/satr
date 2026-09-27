// Text-tight selection drawing. CodeMirror's stock selection layer paints
// selection-style blocks: every line fully crossed by the selection becomes one
// rectangle from the left edge to the right edge, so indentation and empty
// lines turn into solid slabs. This layer paints only what is actually
// selected text instead:
//   - one box per visual row, from the first to the last selected glyph
//   - leading indentation is skipped
//   - an empty line, or a line break inside the selection, gets a small
//     caret-sized mark instead of a full-width block
// The native selection (and Android's handles + copy/paste menu) stays active
// underneath; drawSelection() keeps it invisible and draws the caret.
import { Direction, EditorView, RectangleMarker, layer } from '@codemirror/view';

const MARK = 'cm-satr-selection';
const BREAK_WIDTH = 5; // px, the line-break anchor
const PAD_Y = 2; // px of extra height above and below each glyph row

function base(view: EditorView): { left: number; top: number } {
  // Same origin CodeMirror's own layers use (see getBase in @codemirror/view).
  const rect = view.scrollDOM.getBoundingClientRect();
  const left = view.textDirection === Direction.LTR ? rect.left : rect.right - view.scrollDOM.clientWidth * view.scaleX;
  return { left: left - view.scrollDOM.scrollLeft * view.scaleX, top: rect.top - view.scrollDOM.scrollTop * view.scaleY };
}

type Row = { top: number; bottom: number; left: number; right: number };

function glyphRows(view: EditorView, from: number, to: number): Row[] {
  const start = view.domAtPos(from);
  const end = view.domAtPos(to);
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return [];
  }
  const rows: Row[] = [];
  for (const rect of range.getClientRects()) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    const mid = (rect.top + rect.bottom) / 2;
    const row = rows.find((item) => mid > item.top && mid < item.bottom);
    if (row) {
      row.left = Math.min(row.left, rect.left);
      row.right = Math.max(row.right, rect.right);
      row.top = Math.min(row.top, rect.top);
      row.bottom = Math.max(row.bottom, rect.bottom);
    } else {
      rows.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
    }
  }
  return rows;
}

function markers(view: EditorView): RectangleMarker[] {
  const out: RectangleMarker[] = [];
  const origin = base(view);
  const push = (left: number, top: number, width: number, height: number): void => {
    out.push(new RectangleMarker(MARK, left - origin.left, top - PAD_Y - origin.top, width, height + 2 * PAD_Y));
  };
  const { doc } = view.state;
  for (const range of view.state.selection.ranges) {
    if (range.empty) continue;
    const from = Math.max(range.from, view.viewport.from);
    const to = Math.min(range.to, view.viewport.to);
    if (from >= to) continue;
    for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n += 1) {
      const line = doc.line(n);
      const indent = /^[\t ]*/.exec(line.text)![0].length;
      const breakSelected = range.to > line.to && range.from <= line.to;
      if (indent === line.length) {
        // Empty (or whitespace-only) line: a caret-sized mark if it is inside.
        if (!breakSelected && !(range.from <= line.from && range.to >= line.to)) continue;
        const caret = view.coordsAtPos(line.from, 1);
        if (caret) push(caret.left, caret.top, BREAK_WIDTH, caret.bottom - caret.top);
        continue;
      }
      const textFrom = Math.max(from, line.from + indent);
      const textTo = Math.min(to, line.to);
      const rows = textFrom < textTo ? glyphRows(view, textFrom, textTo) : [];
      if (breakSelected) {
        // The line break: a caret-wide anchor after the last glyph, merged
        // into the last row when the selected text reaches the line end.
        const end = view.coordsAtPos(line.to, -1);
        if (end) {
          const rtl = view.textDirectionAt(line.from) === Direction.RTL;
          const mid = (end.top + end.bottom) / 2;
          const row = rows.find((item) => mid > item.top && mid < item.bottom);
          if (row && rtl) row.left = Math.min(row.left, end.left - BREAK_WIDTH);
          else if (row) row.right = Math.max(row.right, end.right + BREAK_WIDTH);
          else rows.push({ top: end.top, bottom: end.bottom, left: rtl ? end.left - BREAK_WIDTH : end.right, right: rtl ? end.left : end.right + BREAK_WIDTH });
        }
      }
      for (const row of rows) push(row.left, row.top, row.right - row.left, row.bottom - row.top);
    }
  }
  return out;
}

export const tightSelection = [
  layer({
    above: false,
    class: 'cm-satr-selectionLayer',
    markers,
    update: (update) => update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged,
  }),
  EditorView.theme({
    // Hide CodeMirror's block-style selection; ours replaces it.
    '.cm-selectionLayer': { display: 'none !important' },
  }),
];
