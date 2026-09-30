// Math in the editor source: $inline$ and $$ blocks $$. Nothing is rendered
// while editing (that's what preview is for); the source is marked so it
// reads left-to-right inside RTL text, with the dollar signs faint, and
// editor.ts switches the on-screen keyboard to its no-suggestions mode while
// the caret is inside. Typing "$" pairs up the way Obsidian does.
//
// Where math starts and ends is src/mathScan.ts — the same policy the reading
// view uses. Only the things between the dollar signs are monospace: the
// dollars keep the accent colour in the note's own font, and a line holding
// only "$$" never turns monospace. A lone unpaired "$$", "$$$$" / "$$ $$" with
// nothing between, and a pair a heading or a list broke are plain text, so
// their dollars are not coloured and nothing inside them is styled as math.
import { scanMath, spansHold, spansOverlap, closingDelimiterEnd, inCodeAt, type MathSpan } from './mathScan';
import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/** Every math span of the document, cached until the text changes. The
 * preview's renderMarkdown() computes the same spans from the same source. */
export const mathSpans = StateField.define<MathSpan[]>({
  create: (state) => scanMath(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? scanMath(tr.newDoc.toString()) : value),
});

export function inMath(state: EditorState, pos: number): boolean {
  return spansHold(state.field(mathSpans, false) ?? [], pos);
}

export function overlapsMath(state: EditorState, from: number, to: number): boolean {
  return spansOverlap(state.field(mathSpans, false) ?? [], from, to);
}

export function inCode(state: EditorState, pos: number): boolean {
  return inCodeAt(state, pos);
}

const mathText = Decoration.mark({ class: 'cm-math' });
const mathDelim = Decoration.mark({ class: 'cm-math-delim' });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (const span of state.field(mathSpans)) {
      if (span.to < from || span.from > to) continue;
      const open = span.from + span.delim;
      const close = span.to - span.delim;
      out.push(mathDelim.range(span.from, open));
      // Only the things between the dollars are monospace; an empty pair (the
      // writing line of a block being opened) has nothing between them.
      if (open < close && state.sliceDoc(open, close).trim()) out.push(mathText.range(open, close));
      out.push(mathDelim.range(close, span.to));
    }
  }
  return Decoration.set(out.sort((a, b) => a.from - b.from || a.to - b.to), true);
}

const mathDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view); }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
  }
}, { decorations: (value) => value.decorations });

export const mathSource = [mathSpans, mathDecorations];

export function closingMathDelimiter(state: EditorState, pos: number): number {
  return closingDelimiterEnd(state.field(mathSpans, false) ?? [], pos);
}
