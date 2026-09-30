// Where math starts and ends. One policy, shared by the editor's source
// styling (src/mathSource.ts), the reading view (src/markdown.ts) and the
// direction of a note (src/direction.ts) — so the editor and the preview can
// never disagree about what is a formula.
//
//   $inline$          the content between the dollars is math
//   $$display$$       a pair whose dollars sit on different lines
//
// A `$$` line is not math on its own: the pair has to close, with nothing
// between the two dollars that ends a maths block — a heading, a list item,
// a quote, a rule, a footnote definition, a fence or a setext underline. A
// `$$` with nothing between (a lone line, `$$$$`, `$$ $$`) is plain text, and
// so are both dollars of a pair a heading or a list broke: the markdown
// between them is ordinary prose then, in the editor and in the preview
// alike. The writer's own line ends inside a pair are kept.
//
// Code is never math: fenced blocks and backtick spans are blanked first (the
// blanks keep every offset, so the caller maps straight back to the source).
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export interface MathSpan {
  /** The opening delimiter's first character. */
  from: number;
  /** One past the closing delimiter's last character. */
  to: number;
  /** 1 for `$…$`, 2 for `$$…$$`. */
  delim: number;
  /** Rendered as display math (every `$$…$$`; `$…$` never). */
  display: boolean;
}

/** Blocks that end a `$$ … $$` pair: markdown structure, not formula. */
export function isMathBlockBoundary(line: string): boolean {
  return /^ {0,3}#{1,6}(?:\s|$)/.test(line) ||
    /^ {0,3}(?:=+|-+)\s*$/.test(line) ||
    /^\s*(?:[-*+]|\d+[.)]|[۰-۹]+[.)]|[٠-٩]+[.)])\s+/.test(line) ||
    /^ {0,3}(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*\[\^/.test(line) ||
    /^ {0,3}(?:`{3,}|~{3,})/.test(line);
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

/** Fenced blocks and backtick spans, blanked; newlines and offsets hold. */
export function maskCode(source: string): string {
  if (!source.includes('`') && !source.includes('~')) return source;
  const chars = source.split('');
  const erase = (from: number, to: number): void => {
    for (let i = from; i < to; i += 1) if (chars[i] !== '\n') chars[i] = ' ';
  };
  const lines = source.split('\n');
  let offset = 0;
  let fence: { char: string; len: number } | null = null;
  for (const line of lines) {
    const match = FENCE.exec(line);
    if (fence) {
      erase(offset, offset + line.length);
      if (match && match[1][0] === fence.char && match[1].length >= fence.len && !match[2].trim()) fence = null;
    } else if (match) {
      fence = { char: match[1][0], len: match[1].length };
      erase(offset, offset + line.length);
    }
    offset += line.length + 1;
  }
  if (fence) return chars.join(''); // an unclosed fence runs to the end
  // Backtick spans, which may wrap lines but never a blank one (CommonMark).
  const text = chars.join('');
  const isBlankBefore = (at: number): boolean => {
    let i = at - 1;
    while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) i -= 1;
    return text[i] === '\n' || i < 0;
  };
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '`') continue;
    let end = i;
    while (text[end] === '`') end += 1;
    const len = end - i;
    let close = -1;
    for (let j = end; j < text.length; j += 1) {
      if (text[j] === '\n' && isBlankBefore(j)) break;
      if (text[j] !== '`') continue;
      let run = j;
      while (text[run] === '`') run += 1;
      if (run - j === len) { close = run; break; }
      j = run - 1;
    }
    if (close < 0) { i = end - 1; continue; }
    erase(i, close);
    i = close - 1;
  }
  return chars.join('');
}

function escaped(text: string, at: number): boolean {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && text[i] === '\\'; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

/** The closing dollar of a one-line `$…$`, or -1. Content must be real text,
 * may not contain a dollar, and a digit after the closer ("$5 and $10") is a
 * price, not math. `masked` finds the delimiters (a `$` inside a code span is
 * not one, and offsets hold), while the content itself is judged from the
 * original line: a backtick pair inside a formula is part of the formula, not
 * code, so the masking must not make the pair look empty. */
function inlineClose(masked: string, from: number, source: string): number {
  for (let j = from; j < masked.length; j += 1) {
    if (masked[j] !== '$' || escaped(masked, j)) continue;
    if (masked[j - 1] === '$' || masked[j + 1] === '$') return -1; // a $$ run
    if (!source.slice(from, j).trim()) return -1;
    return /[\d$]/.test(masked[j + 1] ?? '') ? -1 : j;
  }
  return -1;
}

/** Every math span of the source, in order; empty when there is no math. */
export function scanMath(source: string): MathSpan[] {
  if (!source.includes('$')) return [];
  const masked = maskCode(source);
  if (!masked.includes('$')) return [];
  const spans: MathSpan[] = [];
  const lines = source.split('\n');
  const maskedLines = masked.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length + 1; }
  let open = -1;
  let openLine = -1;
  for (let n = 0; n < lines.length; n += 1) {
    const text = maskedLines[n];
    const lineStart = starts[n];
    // A boundary line ends a pair still looking for its close: the two
    // dollars are ordinary text and the line's own dollars may start a pair.
    if (open >= 0 && openLine !== n && isMathBlockBoundary(lines[n])) open = -1;
    for (let at = text.indexOf('$'); at >= 0; at = text.indexOf('$', at + 1)) {
      if (escaped(text, at)) continue;
      if (text[at + 1] === '$') {
        if (open < 0) { open = lineStart + at; openLine = n; }
        else if (openLine === n) {
          // Same line: `$$$$` and `$$ $$` are text, `$$x$$` is a formula.
          if (source.slice(open + 2, lineStart + at).trim()) {
            spans.push({ from: open, to: lineStart + at + 2, delim: 2, display: true });
          }
          open = -1;
        } else {
          spans.push({ from: open, to: lineStart + at + 2, delim: 2, display: true });
          open = -1;
        }
        at += 1;
        continue;
      }
      if (open >= 0) continue; // inside a display pair: only its close counts
      const close = inlineClose(text, at + 1, lines[n]);
      if (close < 0) continue;
      spans.push({ from: lineStart + at, to: lineStart + close + 1, delim: 1, display: false });
      at = close;
    }
  }
  return spans;
}

/** The source with math and code blanked out (newlines and offsets kept). */
export function maskMathAndCode(source: string): string {
  const masked = maskCode(source);
  if (!masked.includes('$')) return masked;
  const spans = scanMath(source);
  if (!spans.length) return masked;
  const chars = masked.split('');
  for (const span of spans) {
    for (let i = span.from; i < span.to; i += 1) if (chars[i] !== '\n') chars[i] = ' ';
  }
  return chars.join('');
}

/** Does this position sit inside a formula (delimiters excluded)? */
export function spansHold(spans: readonly MathSpan[], pos: number): boolean {
  for (const span of spans) {
    if (span.from > pos) break;
    if (pos >= span.from + span.delim && pos <= span.to - span.delim) return true;
  }
  return false;
}

/** Does [from, to) touch the content of a formula? */
export function spansOverlap(spans: readonly MathSpan[], from: number, to: number): boolean {
  if (from >= to) return false;
  for (const span of spans) {
    if (span.from + span.delim >= to) break;
    if (span.to - span.delim > from) return true;
  }
  return false;
}

/** The end of the closing delimiter at (or just after) pos, or -1. */
export function closingDelimiterEnd(spans: readonly MathSpan[], pos: number): number {
  for (const span of spans) {
    if (span.from > pos) break;
    if (pos >= span.to - span.delim && pos < span.to) return span.to;
  }
  return -1;
}

/** The tree-aware code test the editor uses (the preview has maskCode). */
export function inCodeAt(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (!/^(InlineCode|FencedCode|CodeBlock)$/.test(node.name)) continue;
    if (node.name === 'InlineCode') return pos > node.from && pos < node.to;
    const closedFence = node.name === 'FencedCode' && node.lastChild?.name === 'CodeMark' && node.lastChild.from > node.from;
    return pos > node.from && (pos < node.to || (pos === node.to && !closedFence));
  }
  return false;
}
