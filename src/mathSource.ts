// Math in the editor source: $inline$ and $$ blocks $$. Nothing is rendered
// while editing (that's what preview is for); the source is marked so it
// reads left-to-right inside RTL text, with the dollar signs faint, and
// editor.ts switches the on-screen keyboard to its no-suggestions mode while
// the caret is inside. Typing "$" pairs up the way Obsidian does.
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

interface Span { from: number; to: number }

// $$ blocks for the whole note. A line with an odd number of "$$" opens or
// closes a block; fenced code is skipped. Rescanned on edits: one pass over
// the text, far cheaper than the rendering it replaces.
function scanBlocks(state: EditorState): Span[] {
  const blocks: Span[] = [];
  let open = -1;
  let fence: string | null = null;
  for (let n = 1; n <= state.doc.lines; n += 1) {
    const line = state.doc.line(n);
    const text = line.text;
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(text);
    if (open < 0 && fenceMatch) {
      if (fence === null) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null || !text.includes('$$')) continue;
    const count = text.split('$$').length - 1;
    if (count % 2 === 0) continue;
    if (open < 0) open = line.from;
    else { blocks.push({ from: open, to: line.to }); open = -1; }
  }
  if (open >= 0) blocks.push({ from: open, to: state.doc.length });
  return blocks;
}

export const mathBlocks = StateField.define<Span[]>({
  create: scanBlocks,
  update: (value, tr) => (tr.docChanged ? scanBlocks(tr.state) : value),
});

// Inline math on one line: "$$…$$", or "$…$" with no space just inside the
// dollars and no digit right after the closing one ("$5 and $6" isn't math).
const INLINE = /\$\$(.+?)\$\$|(?<![\\$])\$(?=[^\s$])((?:\\.|[^$\\])*?[^\s\\])\$(?![\d$])/g;

function isCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/^(InlineCode|FencedCode|CodeBlock)$/.test(node.name)) return true;
  }
  return false;
}

function inlineSpans(state: EditorState, lineFrom: number, text: string): { from: number; to: number; open: number; close: number }[] {
  if (!text.includes('$')) return [];
  const spans = [];
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(text); m; m = INLINE.exec(text)) {
    const from = lineFrom + m.index;
    if (isCode(state, from)) continue;
    const open = m[1] !== undefined ? 2 : 1;
    spans.push({ from, to: from + m[0].length, open, close: open });
  }
  return spans;
}

function blockAt(state: EditorState, pos: number): Span | null {
  for (const block of state.field(mathBlocks)) {
    if (pos < block.from) return null;
    if (pos <= block.to) return block;
  }
  return null;
}

/** Is the caret inside math (between the dollars, or inside a $$ block)? */
export function inMath(state: EditorState, pos: number): boolean {
  if (blockAt(state, pos)) return true;
  const line = state.doc.lineAt(pos);
  return inlineSpans(state, line.from, line.text).some((s) => pos >= s.from + s.open && pos <= s.to - s.close);
}

/** Is the caret inside code (inline, fenced or indented)? */
export function inCode(state: EditorState, pos: number): boolean {
  return isCode(state, pos) || (pos > 0 && isCode(state, pos - 1) && !/\s/.test(state.sliceDoc(pos - 1, pos)));
}

const mathLine = Decoration.line({ class: 'cm-math-line' });
const mathText = Decoration.mark({ class: 'cm-math' });
const mathDelim = Decoration.mark({ class: 'cm-math-delim' });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const blocks = state.field(mathBlocks);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      const block = blocks.find((b) => line.from >= b.from && line.from <= b.to);
      if (block) {
        out.push(mathLine.range(line.from));
        const at = line.text.indexOf('$$');
        const first = line.from === block.from;
        const last = line.to === block.to;
        if ((first || last) && at >= 0) {
          if (first && at > 0) continue; // text before an opening $$ stays as is
          const d = line.from + (last && !first ? line.text.lastIndexOf('$$') : at);
          out.push(mathDelim.range(d, d + 2));
        }
        continue;
      }
      for (const s of inlineSpans(state, line.from, line.text)) {
        out.push(mathDelim.range(s.from, s.from + s.open));
        out.push(mathText.range(s.from + s.open, s.to - s.close));
        out.push(mathDelim.range(s.to - s.close, s.to));
      }
    }
  }
  return Decoration.set(out, true);
}

const mathDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view); }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
  }
}, { decorations: (value) => value.decorations });

// "$" pairing, as in Obsidian: "$" → "$|$"; "$" again in an empty pair →
// "$$|$$" (a block); "$" in front of a closing "$" steps over it; with a
// selection, wraps it. Backspace in an empty pair removes both.
let opened: { pos: number; at: number; extra: number } | null = null;
const dollarInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '$' || view.composing || isCode(view.state, from)) return false;
  const { state } = view;
  const before = state.sliceDoc(from - 1, from);
  const after = state.sliceDoc(to, to + 1);
  // "$$$$" alone on its line (typed as "$" "$", which pairs to "$$|$$", or as
  // four dollars) opens a block with the caret on the empty line inside:
  //   $$
  //   |
  //   $$
  if (from === to) {
    const line = state.doc.lineAt(from);
    const head = state.sliceDoc(line.from, from);
    const tail = state.sliceDoc(to, line.to);
    const indent = /^\s*/.exec(head)![0];
    const lead = head.slice(indent.length);
    const rest = tail.trim();
    // "$|$" (pairs to "$$|$$"), "$$$|" and "$$$|$" (steps over the last one)
    const four = (lead === '$' && rest === '$') || (lead === '$$$' && (rest === '' || rest === '$'));
    // Typing on after the block opened ("$$$$" typed in full): the third and
    // fourth "$" land on the empty line inside; they're taken as the closing
    // pair that already exists.
    if (opened && opened.pos === from && performance.now() - opened.at < 1500 && !head.trim() && !tail.trim() && opened.extra < 2) {
      opened.extra += 1;
      return true;
    }
    {
      if (four && !(line.from > 0 && blockAt(state, line.from - 1))) {
        opened = { pos: line.from + indent.length * 2 + 3, at: performance.now(), extra: 0 };
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: `${indent}$$\n${indent}\n${indent}$$` },
          selection: { anchor: line.from + indent.length * 2 + 3 },
          userEvent: 'input.type', scrollIntoView: true,
        });
        return true;
      }
    }
  }
  if (from !== to) {
    view.dispatch(state.changeByRange((range) => ({
      changes: [{ from: range.from, insert: '$' }, { from: range.to, insert: '$' }],
      range: EditorSelection.range(range.from + 1, range.to + 1),
    })), { userEvent: 'input.type' });
    return true;
  }
  if (after === '$' && before === '$' && state.sliceDoc(from - 2, from - 1) !== '$') {
    view.dispatch({ changes: { from, insert: '$$' }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
    return true;
  }
  if (after === '$') {
    view.dispatch({ selection: { anchor: from + 1 }, userEvent: 'select' });
    return true;
  }
  if (after && !/[\s)\]}.,;:!?،؛»]/.test(after)) return false; // mid-word: a plain "$"
  if (before === '\\') return false;
  view.dispatch({ changes: { from, insert: '$$' }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
  return true;
});

export function deleteDollarPair(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const pos = range.head;
  if (state.sliceDoc(pos - 1, pos + 1) !== '$$' || isCode(state, pos)) return false;
  view.dispatch({ changes: { from: pos - 1, to: pos + 1 }, userEvent: 'delete.backward' });
  return true;
}

export const mathSource = [mathBlocks, mathDecorations, dollarInput];
