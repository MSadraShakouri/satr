// Math in the editor source: $inline$ and $$ blocks $$. Nothing is rendered
// while editing (that's what preview is for); the source is marked so it
// reads left-to-right inside RTL text, with the dollar signs faint, and
// editor.ts switches the on-screen keyboard to its no-suggestions mode while
// the caret is inside. Typing "$" pairs up the way Obsidian does.
import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

interface Span { from: number; to: number }

// Multiline display math. Count only unescaped delimiters outside code;
// same-line pairs are decorated separately. Rescanned on edits.
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
    for (const match of text.matchAll(/\$\$/g)) {
      let slashes = 0;
      for (let i = match.index! - 1; i >= 0 && text[i] === '\\'; i -= 1) slashes += 1;
      if (slashes % 2 || (open < 0 && isCode(state, line.from + match.index!))) continue;
      if (open < 0) open = line.from;
      else {
        if (open < line.from) blocks.push({ from: open, to: line.to });
        open = -1;
      }
    }
  }
  if (open >= 0) blocks.push({ from: open, to: state.doc.length });
  return blocks;
}

export const mathBlocks = StateField.define<Span[]>({
  create: scanBlocks,
  update: (value, tr) => (tr.docChanged ? scanBlocks(tr.state) : value),
});

// Inline math on one line, including single-character and spaced formulas.
// No digit right after the closing dollar ("$5 and $6" isn't math).
const INLINE = /(?<!\$)\$\$(.*?)\$\$|(?<!\$)\$([^$\n]+?)\$(?![\d$])/g;

function isCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (!/^(InlineCode|FencedCode|CodeBlock)$/.test(node.name)) continue;
    if (node.name === 'InlineCode') return pos > node.from && pos < node.to;
    const closedFence = node.name === 'FencedCode' && node.lastChild?.name === 'CodeMark' && node.lastChild.from > node.from;
    return pos > node.from && (pos < node.to || (pos === node.to && !closedFence));
  }
  return false;
}

function inlineSpans(state: EditorState, lineFrom: number, text: string): { from: number; to: number; open: number; close: number }[] {
  if (!text.includes('$')) return [];
  const spans = [];
  // Mask escaped dollars without shifting offsets; an even run of slashes
  // leaves the dollar active, exactly as the typing handler does.
  const unescaped = text.replace(/\\+\$/g, (run) => (run.length - 1) % 2 ? run.slice(0, -1) + '\0' : run);
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(unescaped); m; m = INLINE.exec(unescaped)) {
    const from = lineFrom + m.index;
    if (isCode(state, from)) continue;
    const open = m[1] !== undefined ? 2 : 1;
    spans.push({ from, to: from + m[0].length, open, close: open });
  }
  return spans;
}

function blockAt(state: EditorState, pos: number): Span | null {
  for (const block of (state.field(mathBlocks, false) ?? [])) {
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
  return isCode(state, pos);
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
        if (s.from + s.open < s.to - s.close) out.push(mathText.range(s.from + s.open, s.to - s.close));
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

// Pairing lives in delimiterInput.ts so keyboard and toolbar use one policy.
export const mathSource = [mathBlocks, mathDecorations];

/** Closing dollars, not an opening pair that merely happens to be next. */
export function closingMathDelimiter(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  const inline = inlineSpans(state, line.from, line.text).find((s) => pos >= s.to - s.close && pos < s.to);
  if (inline) return inline.to;
  const block = blockAt(state, pos);
  if (block && block.to === line.to && line.from > block.from) {
    const start = line.from + line.text.lastIndexOf('$$');
    if (start >= line.from && pos >= start && pos < start + 2) return start + 2;
  }
  return -1;
}
