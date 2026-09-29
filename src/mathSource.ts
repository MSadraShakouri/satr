// Math in the editor source: $inline$ and $$ blocks $$. Nothing is rendered
// while editing (that's what preview is for); the source is marked so it
// reads left-to-right inside RTL text, with the dollar signs faint, and
// editor.ts switches the on-screen keyboard to its no-suggestions mode while
// the caret is inside. Typing "$" pairs up the way Obsidian does.
//
// Only the things between the dollar signs are monospace: the dollars keep
// the accent colour in the note's own font, and a line holding only "$$"
// never turns monospace. Only a matched $$ … $$ pair with real content is
// math — a lone unpaired $$ (which opens nothing) and $$ with nothing
// between are plain text.
import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { isDisplayMathContent } from './markdownSyntax';

interface Block { open: number; close: number }

// Multiline display math. Count only unescaped delimiters outside code;
// same-line pairs are inline spans. A pair becomes a block when its
// delimiters sit on different lines — including the empty writing line
// ("$$" alone on its own lines is the block being written). A pair with
// nothing between its dollars on one line ("$$$$", "$$ $$") is not math,
// and an unmatched $$ opens nothing (it is text, not an unfinished block).
// A pair that has grown a list, a heading, a quote or a fence between its
// dollars is not math either: those lines mean the writer left the formula,
// so the whole pair stays plain text (no line-swallowing monospace region).
// Rescanned on edits.
function scanBlocks(state: EditorState): Block[] {
  const blocks: Block[] = [];
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
      if (open < 0) {
        open = line.from + match.index!;
      } else {
        const close = line.from + match.index!;
        const spansLines = close > open + 2 && state.doc.lineAt(close).number > state.doc.lineAt(open).number;
        if (spansLines && isDisplayMathContent(state.sliceDoc(open + 2, close))) {
          blocks.push({ open, close });
          open = -1;
        } else if (spansLines) {
          // A list / heading / fence grew between the dollars: this pair is
          // plain text, and the dollar that would have closed it may open a
          // real block further down.
          open = close;
        } else {
          // "$$$$" / "$$ $$": nothing between the dollars, both are text.
          open = -1;
        }
      }
    }
  }
  return blocks;
}

export const mathBlocks = StateField.define<Block[]>({
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
  for (const m of unescaped.matchAll(INLINE)) {
    // "$$" with nothing between is not math either.
    if (!(m[1] ?? m[2]).trim()) continue;
    const from = lineFrom + m.index;
    if (isCode(state, from)) continue;
    const open = m[1] !== undefined ? 2 : 1;
    spans.push({ from, to: from + m[0].length, open, close: open });
  }
  return spans;
}

/** Is the caret inside math (between the dollars, or inside a $$ block)? */
export function inMath(state: EditorState, pos: number): boolean {
  for (const block of state.field(mathBlocks, false) ?? []) {
    if (block.open > pos) break;
    if (pos >= block.open + 2 && pos <= block.close) return true;
  }
  const line = state.doc.lineAt(pos);
  return inlineSpans(state, line.from, line.text).some((s) => pos >= s.from + s.open && pos <= s.to - s.close);
}

/** Is the caret inside code (inline, fenced or indented)? */
export function inCode(state: EditorState, pos: number): boolean {
  return isCode(state, pos);
}

const mathText = Decoration.mark({ class: 'cm-math' });
const mathDelim = Decoration.mark({ class: 'cm-math-delim' });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const blocks = state.field(mathBlocks);
  const inBlock = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    for (const block of blocks) {
      if (block.close + 2 < from || block.open > to) continue;
      const lineFrom = state.doc.lineAt(block.open).number;
      const lineTo = state.doc.lineAt(block.close).number;
      for (let n = lineFrom; n <= lineTo; n += 1) inBlock.add(n);
      // Only the things between the dollars are monospace; the dollars
      // themselves keep the note's font in the accent colour. An empty
      // writing line has nothing between them to set in monospace.
      out.push(mathDelim.range(block.open, block.open + 2));
      if (state.sliceDoc(block.open + 2, block.close).trim()) out.push(mathText.range(block.open + 2, block.close));
      out.push(mathDelim.range(block.close, block.close + 2));
    }
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (inBlock.has(line.number)) continue;
      for (const s of inlineSpans(state, line.from, line.text)) {
        out.push(mathDelim.range(s.from, s.from + s.open));
        if (s.from + s.open < s.to - s.close) out.push(mathText.range(s.from + s.open, s.to - s.close));
        out.push(mathDelim.range(s.to - s.close, s.to));
      }
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

// Pairing lives in delimiterInput.ts so keyboard and toolbar use one policy.
export const mathSource = [mathBlocks, mathDecorations];

/** Closing dollars, not an opening pair that merely happens to be next. */
export function closingMathDelimiter(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  const inline = inlineSpans(state, line.from, line.text).find((s) => pos >= s.to - s.close && pos < s.to);
  if (inline) return inline.to;
  for (const block of state.field(mathBlocks, false) ?? []) {
    if (block.open > pos) break;
    if (pos >= block.close && pos < block.close + 2) return block.close + 2;
  }
  return -1;
}
