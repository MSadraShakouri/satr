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
// between are plain text. A display block never runs through a list, heading,
// quote, rule or footnote — those stop the monospace, as in Obsidian.
import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

interface Block { open: number; close: number }

// Block boundaries that should stop a display-math span from continuing.
export function isMathBlockBoundary(text: string): boolean {
  return /^\s{0,3}#{1,6}(?:\s|$)/.test(text) ||
    /^\s{0,3}(?:=+|-+)\s*$/.test(text) ||
    /^\s*[-*+]\s+/.test(text) ||
    /^\s*[0-9۰-۹٠-٩]+[.)]\s+/.test(text) ||
    /^\s*>/.test(text) ||
    /^\s{0,3}(?:-{3,}|_{3,}|\*{3,})\s*$/.test(text) ||
    /^\s*\[\^/.test(text);
}

function scanBlocks(state: EditorState): Block[] {
  const blocks: Block[] = [];
  let open = -1;
  let openLine = -1;
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
    if (fence !== null) continue;

    if (open >= 0 && isMathBlockBoundary(text) && !text.includes('$$')) {
      const between = state.sliceDoc(open + 2, line.from);
      if (between.trim() && state.doc.lineAt(open).number < n) {
        const prev = state.doc.line(n - 1);
        blocks.push({ open, close: prev.to });
      }
      open = -1;
      continue;
    }
    if (!text.includes('$$')) continue;

    for (const match of text.matchAll(/\$\$/g)) {
      let slashes = 0;
      for (let i = match.index! - 1; i >= 0 && text[i] === '\\\\'; i -= 1) slashes += 1;
      if (slashes % 2 || (open < 0 && isCode(state, line.from + match.index!))) continue;
      if (open < 0) {
        open = line.from + match.index!;
        openLine = n;
      } else {
        const close = line.from + match.index!;
        let hasBoundary = false;
        for (let k = openLine + 1; k < n; k += 1) {
          if (isMathBlockBoundary(state.doc.line(k).text)) { hasBoundary = true; break; }
        }
        if (hasBoundary) {
          open = close;
          openLine = n;
          continue;
        }
        if (close > open + 2 && state.doc.lineAt(close).number > state.doc.lineAt(open).number) blocks.push({ open, close });
        open = -1;
      }
    }
  }
  return blocks;
}

export const mathBlocks = StateField.define<Block[]>({
  create: scanBlocks,
  update: (value, tr) => (tr.docChanged ? scanBlocks(tr.state) : value),
});

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
  const unescaped = text.replace(/\\+\$/g, (run) => (run.length - 1) % 2 ? run.slice(0, -1) + '\0' : run);
  INLINE.lastIndex = 0;
  for (const m of unescaped.matchAll(INLINE)) {
    if (!(m[1] ?? m[2]).trim()) continue;
    const from = lineFrom + m.index;
    if (isCode(state, from)) continue;
    const open = m[1] !== undefined ? 2 : 1;
    spans.push({ from, to: from + m[0].length, open, close: open });
  }
  return spans;
}

export function inMath(state: EditorState, pos: number): boolean {
  for (const block of state.field(mathBlocks, false) ?? []) {
    if (block.open > pos) break;
    if (pos >= block.open + 2 && pos <= block.close) return true;
  }
  const line = state.doc.lineAt(pos);
  return inlineSpans(state, line.from, line.text).some((s) => pos >= s.from + s.open && pos <= s.to - s.close);
}

export function overlapsMath(state: EditorState, from: number, to: number): boolean {
  if (from >= to) return false;
  for (const block of state.field(mathBlocks, false) ?? []) {
    if (block.open + 2 < to && block.close > from) return true;
    if (block.open > to) break;
  }
  for (let p = from; p < to;) {
    const line = state.doc.lineAt(p);
    for (const s of inlineSpans(state, line.from, line.text)) {
      if (s.from + s.open < to && s.to - s.close > from) return true;
    }
    p = line.to + 1;
    if (p <= from) break;
  }
  return false;
}

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
      out.push(mathDelim.range(block.open, block.open + 2));
      // Only the things between the dollars are monospace, and a boundary
      // line inside a $$ … $$ pair is never monospace.
      let cur = block.open + 2;
      for (let ln = lineFrom; ln <= lineTo; ln += 1) {
        const l = state.doc.line(ln);
        if (ln !== lineFrom && isMathBlockBoundary(l.text)) break;
        const segEnd = ln === lineTo ? block.close : l.to;
        if (cur < segEnd) {
          const seg = state.sliceDoc(cur, segEnd);
          if (seg.trim()) out.push(mathText.range(cur, segEnd));
        }
        cur = l.to + 1;
        if (cur > block.close) break;
      }
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

export const mathSource = [mathBlocks, mathDecorations];

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
