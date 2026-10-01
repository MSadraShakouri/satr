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
  const rows: Row[] = [];
  const add = (rect: { top: number; bottom: number; left: number; right: number } | null | undefined): void => {
    if (!rect || rect.right <= rect.left || rect.bottom <= rect.top) return;
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
  };
  // Measure the selected TEXT one run at a time. Widgets (the file title,
  // inline replacements) and any non-text node are walked past instead of
  // being painted — or of failing the whole line when an endpoint lands in
  // one and the range can't be built at all.
  try {
    const start = view.domAtPos(from);
    const end = view.domAtPos(to);
    const clamp = (node: Node, offset: number): number =>
      node.nodeType === Node.TEXT_NODE ? Math.min(offset, (node.nodeValue ?? '').length) : offset;
    const scope = document.createRange();
    scope.setStart(start.node, clamp(start.node, start.offset));
    scope.setEnd(end.node, clamp(end.node, end.offset));
    const collect = (node: Text, fromOffset: number, toOffset: number): void => {
      if (toOffset <= fromOffset) return;
      if (node.parentElement?.closest('.cm-widget, .cm-file-title')) return;
      const run = document.createRange();
      run.setStart(node, fromOffset);
      run.setEnd(node, toOffset);
      for (const rect of run.getClientRects()) add(rect);
    };
    if (scope.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
      collect(scope.commonAncestorContainer as Text, clamp(start.node, start.offset), clamp(end.node, end.offset));
    } else {
      const walker = document.createTreeWalker(scope.commonAncestorContainer, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const inside = node === start.node || node === end.node
          || scope.isPointInRange(node, 0) || scope.isPointInRange(node, node.length);
        if (!inside) continue;
        collect(node,
          node === start.node ? clamp(node, start.offset) : 0,
          node === end.node ? clamp(node, end.offset) : node.length);
      }
    }
  } catch { /* the fallback below */ }
  if (!rows.length) {
    // No text geometry to measure (widgets only, or endpoints that refuse to
    // resolve): the caret boxes at the two ends are the row boxes. A caret
    // rect is zero-wide, so give it the width of the break marks.
    for (const [pos, side] of [[from, 1], [to, -1]] as const) {
      const rect = view.coordsAtPos(pos, side);
      if (rect) add({ top: rect.top, bottom: rect.bottom, left: rect.left, right: Math.max(rect.right, rect.left + BREAK_WIDTH) });
    }
  }
  return rows;
}

function markers(view: EditorView): RectangleMarker[] {
  const boxes: Row[] = [];
  const origin = base(view);
  const push = (left: number, top: number, width: number, height: number): void => {
    boxes.push({ left, right: left + width, top, bottom: top + height });
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
  // Font ascent/descent rectangles can exceed the CSS line pitch (especially
  // Vazirmatn, headings and the phone's font scale). Padding those independently
  // painted neighbouring rows would overlap them. Clamp each box at the
  // midpoint between row centres, so neighbouring rows share that edge
  // exactly: no gap between them, and no overlap either.
  const centres = [...new Set(boxes.map((b) => (b.top + b.bottom) / 2))].sort((a, b) => a - b);
  return boxes.map((box) => {
    const centre = (box.top + box.bottom) / 2;
    const i = centres.indexOf(centre);
    const top = Math.max(box.top - PAD_Y, i > 0 ? (centres[i - 1] + centre) / 2 : -Infinity);
    const bottom = Math.min(box.bottom + PAD_Y, i + 1 < centres.length ? (centre + centres[i + 1]) / 2 : Infinity);
    return new RectangleMarker(MARK, box.left - origin.left, top - origin.top, box.right - box.left, Math.max(0, bottom - top));
  });
}

export const tightSelection = [
  layer({
    above: false,
    class: 'cm-satr-selectionLayer',
    markers,
    update: (update) => update.docChanged || update.selectionSet || update.geometryChanged || update.focusChanged,
  }),
  EditorView.theme({
    // Hide CodeMirror's block-style selection; ours replaces it.
    '.cm-selectionLayer': { display: 'none !important' },
  }),
];
