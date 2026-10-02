// LaTeX-style math delimiters, rewritten into Satr's own.
//
// `\(x\)` and `\[…\]` are how Pandoc, remark-math, KaTeX's own docs and most
// LaTeX-to-markdown converters write a formula, and they are what arrives in a
// note pasted from anywhere else. Satr speaks `$x$` and `$$…$$`, so this turns
// the first pair into the second.
//
// Nothing here teaches the editor a second dialect. The scanner
// (src/mathScan.ts) stays dollars-only, which is the point: the reading view,
// the PDF, print, the direction of a note and the live preview all read that
// one policy and need no new case, because after the rewrite there is no
// `\(…\)` left to disagree about. The cost is that `\(…\)` renders as the
// literal text it is until the reader asks for this — the deliberate trade for
// never reinterpreting somebody's backslash escape.
//
// Three rules keep it safe to offer at any moment, on any note:
//
//   Only *paired* delimiters are rewritten. A lone `\(` is far more likely a
//   CommonMark escape — or a typo — than half a formula, so it is left exactly
//   as typed. That also makes the whole thing idempotent: a second run finds
//   nothing to do, which is the property worth testing first.
//
//   `\(…\)` is inline: both halves on one line, or nothing. `\[…\]` is a
//   display pair like `$$` — it may span lines, and a line that ends a maths
//   block (a heading, a list, a quote, a rule, a fence) breaks it, so a
//   `\[…\]` the writer straddled across a heading stays prose.
//
//   Code is never math, and neither is a formula that already exists: a fenced
//   block, a backtick span, or a `$…$` / `$$…$$` pair the note already had is
//   skipped, so normalizing can never nest dollars inside dollars.
import { isMathBlockBoundary, maskCode, scanMath, type MathSpan } from './mathScan';

export interface MathRewrite {
  /** The opening backslash. */
  from: number;
  /** One past the closing backslash. */
  to: number;
  /** The dollars this pair becomes, content carried over verbatim. */
  insert: string;
}

/** A backslash escaped by another one (`\\(`) is a literal backslash. */
function escapedAt(text: string, at: number): boolean {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && text[i] === '\\'; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

/** Line start offsets, so a position in one line maps back to the source. */
function lineStarts(lines: string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length + 1; }
  return starts;
}

/** Does this rewrite touch math the note already had, or another rewrite? */
function clashes(span: MathRewrite, dollars: readonly MathSpan[], taken: readonly MathRewrite[]): boolean {
  const hits = (from: number, to: number): boolean => from < span.to && to > span.from;
  return dollars.some((d) => hits(d.from, d.to)) || taken.some((t) => hits(t.from, t.to));
}

/** Every `\(…\)` and `\[…\]` pair in [from, to), as dollars. */
export function findLatexMath(source: string, from = 0, to = source.length): MathRewrite[] {
  if (!source.includes('\\')) return [];
  const masked = maskCode(source);
  if (!masked.includes('\\')) return [];
  const lines = source.split('\n');
  const maskedLines = masked.split('\n');
  const starts = lineStarts(lines);
  const dollars = scanMath(source);
  const found: MathRewrite[] = [];

  // \( … \): both halves on one line. The first closer after an opener takes
  // it, exactly as `$…$` pairs, and scanning resumes past the pair so that
  // `\(a\) and \(b\)` is two rewrites rather than one that swallows the prose.
  for (let n = 0; n < lines.length; n++) {
    const text = maskedLines[n];
    const lineStart = starts[n];
    for (let i = 0; i < text.length - 1; i += 1) {
      if (text[i] !== '\\' || escapedAt(text, i) || text[i + 1] !== '(') continue;
      const open = lineStart + i;
      // Offsets are absolute the moment they leave the line, so the content is
      // sliced from the source and not from the line.
      let close = -1;
      for (let j = i + 2; j < text.length - 1; j += 1) {
        if (text[j] !== '\\' || escapedAt(text, j) || text[j + 1] !== ')') continue;
        close = lineStart + j;
        i = j + 1;
        break;
      }
      // No closer on this line: an escape, a typo, or half of a display pair
      // the writer meant to span lines. Either way, not ours to touch.
      if (close < 0) break;
      const content = source.slice(open + 2, close);
      if (content.trim() && !content.includes('$') && !clashes({ from: open, to: close + 2, insert: '' }, dollars, found)) {
        found.push({ from: open, to: close + 2, insert: `$${content}$` });
      }
    }
  }

  // \[ … \]: a display pair, opened and closed like `$$`. A boundary line ends
  // a pair still looking for its close, and `\[\]` with nothing between is not
  // a formula — the same two rules the dollars obey.
  let open = -1;
  let openLine = -1;
  for (let n = 0; n < lines.length; n++) {
    const text = maskedLines[n];
    const lineStart = starts[n];
    if (open >= 0 && openLine !== n && isMathBlockBoundary(lines[n])) open = -1;
    for (let i = 0; i < text.length - 1; i += 1) {
      if (text[i] !== '\\' || escapedAt(text, i)) continue;
      const at = lineStart + i;
      if (text[i + 1] === '[') { if (open < 0) { open = at; openLine = n; } continue; }
      if (text[i + 1] !== ']' || open < 0) continue;
      const content = source.slice(open + 2, at);
      if (content.trim() && !content.includes('$') && !clashes({ from: open, to: at + 2, insert: '' }, dollars, found)) {
        found.push({ from: open, to: at + 2, insert: `$$${content}$$` });
      }
      open = -1;
    }
  }

  return found
    .filter((rewrite) => rewrite.to > from && rewrite.from < to)
    .sort((a, b) => a.from - b.from);
}

/** The note (or the range) with every `\(…\)` / `\[…\]` pair as dollars. */
export function normalizeLatexMath(source: string, from = 0, to = source.length): { text: string; count: number } {
  const rewrites = findLatexMath(source, from, to);
  if (!rewrites.length) return { text: source, count: 0 };
  let text = '';
  let cursor = 0;
  for (const rewrite of rewrites) {
    text += source.slice(cursor, rewrite.from) + rewrite.insert;
    cursor = rewrite.to;
  }
  return { text: text + source.slice(cursor), count: rewrites.length };
}
