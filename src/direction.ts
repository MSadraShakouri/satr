import type { Text } from '@codemirror/state';
import { isMathBlockBoundary, maskMathAndCode } from './mathScan';

// One direction policy for source lines and rendered blocks. This sets the
// paragraph base direction, NEVER a bidi override: dates/digits remain in
// their natural order, and embedded math/code retain LTR isolation.
export type TextDirection = 'ltr' | 'rtl';
export interface DirectionUnit {
  own: TextDirection | null;
  heading?: number;
  excluded?: boolean; // math, code and metadata never vote
}

export function strongDirection(text: string): TextDirection | null {
  // Script=Arabic includes digits/punctuation; only LETTERS count as strong.
  const first = /[\u200e\u200f\u061c]|\p{L}/u.exec(text)?.[0];
  if (!first) return null;
  return /[\u200f\u061c\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u.test(first) ? 'rtl' : 'ltr';
}

/** The note's own majority: which script has more strong letters. Math, code
 * and URLs don't vote. The line-number gutter and the outline tree follow
 * this. */
export function majorityDirection(markdown: string): TextDirection {
  const masked = maskMathAndCode(markdown);
  let rtl = 0, ltr = 0;
  for (const ch of masked) {
    if (!/\p{L}/u.test(ch)) continue;
    if (/[\u200f\u061c\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u.test(ch)) rtl += 1;
    else ltr += 1;
  }
  return rtl > ltr ? 'rtl' : 'ltr';
}

// A line with no strong letter of its own continues the line above it: a new
// line is written in the language you are writing in, and a `#`, a list
// marker or a date never flips it. Only real prose proves otherwise — the
// line's own first strong letter, once there is one, always wins.
function withCarried(units: readonly DirectionUnit[]): DirectionUnit[] {
  let carried: TextDirection | null = null;
  return units.map((unit) => {
    if (unit.excluded) return unit; // math, code and metadata never vote and never carry
    if (unit.own) {
      carried = unit.own;
      return unit;
    }
    return carried ? { ...unit, own: carried } : unit;
  });
}

export function resolveDirections(units: readonly DirectionUnit[]): TextDirection[] {
  const result: TextDirection[] = [];
  const headings: { level: number; dir: TextDirection }[] = [];
  let start = 0;
  while (start < units.length) {
    const heading = units[start];
    if (heading.heading) {
      while (headings.length && headings[headings.length - 1].level >= heading.heading) headings.pop();
      let below: TextDirection | null = null;
      for (let i = start + 1; i < units.length && !units[i].heading; i++) {
        if (!units[i].excluded && units[i].own) { below = units[i].own; break; }
      }
      const dir = heading.own ?? headings.at(-1)?.dir ?? below ?? 'ltr';
      result[start++] = dir;
      headings.push({ level: heading.heading, dir });
    }
    let end = start;
    while (end < units.length && !units[end].heading) end++;
    const next: (TextDirection | null)[] = [];
    let below: TextDirection | null = null;
    for (let i = end - 1; i >= start; i--) {
      next[i - start] = below;
      if (!units[i].excluded && units[i].own) below = units[i].own;
    }
    for (let i = start; i < end; i += 1) {
      const unit = units[i];
      // `own` is already carried (withCarried), so a line without one can only
      // be in the note's leading run before any prose: look below it, then at
      // the heading above, then left to right.
      result[i] = unit.excluded ? 'ltr' : unit.own ?? next[i - start] ?? headings.at(-1)?.dir ?? 'ltr';
    }
    start = end;
  }
  return result;
}

const withoutSyntax = (line: string): string => line
  .replace(/!\[([^\]]*)\]\([^)]*\)|!\[\[[^\]]*\]\]/g, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
  .replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, '$2')
  .replace(/\[\^[^\]]+\]:?/g, '')
  .replace(/https?:\/\/\S+/g, '')
  .replace(/<[^>]*>/g, '')
  .replace(/^(?:\s*>\s*)*/, '')
  .replace(/^\s*(?:[-*+]|[0-9۰-۹٠-٩]+[.)])\s+(?:\[[ xX]\]\s*)?/, '')
  .replace(/^\s*[a-zA-Z][.)]\s*$/, '');

/** `plain` with the masked characters of `hidden` carried over, one line at
 * a time: a line the masker did not touch is reused whole, and only a line it
 * did touch is walked character by character. `touched` records which lines
 * the masker changed, for the editor's fast path. */
function maskedLines(plain: readonly string[], original: readonly string[], hidden: string, touched: boolean[]): string[] {
  const hiddenLines = hidden.split('\n');
  return plain.map((line, index) => {
    const masked = hiddenLines[index] ?? '';
    if (masked === original[index]) return line;
    touched[index] = true;
    const chars = line.split('');
    for (let i = 0; i < chars.length; i += 1) if (chars[i] !== ' ' && masked[i] === ' ') chars[i] = ' ';
    return chars.join('');
  });
}

/** Everything the editor keeps between keystrokes: the answer, the per-line
 * decision it came from, and which lines the blanker and the masker touched.
 * The last two let a keystroke that cannot change a decision skip the note. */
export interface DirectionSnapshot {
  dirs: TextDirection[];
  units: DirectionUnit[];
  /** The line sits inside frontmatter, a comment or a link definition. */
  blanked: boolean[];
  /** The masker changed characters on this line. */
  masked: boolean[];
}

/** Full-document context, cached by the editor's StateField. No viewport
 * cutoff: scrolling 200 lines away must not change a number's direction. */
export function directionSnapshot(markdown: string): DirectionSnapshot {
  const source = markdown.replace(/\r\n?/g, '\n');
  const originalLines = source.split('\n');
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  const plain = source.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/^ {0,3}\[(?!\^)[^\]]+\]:[^\n]*$/gm, blank);
  // Math and code never vote; the shared scanner says where they are, so the
  // editor, the preview and this agree on the same lines (src/mathScan.ts).
  const plainLines = plain.split('\n');
  const blanked = plainLines.map((line, index) => line !== originalLines[index]);
  // The masked copy of the whole note, line by line. When nothing was masked
  // the function hands back the very same string (an identity comparison, not
  // a scan), and a line the masker left alone is reused as it stands — so a
  // note without formulas or code never builds the copy at all.
  const hidden = maskMathAndCode(source);
  const masked: boolean[] = new Array(originalLines.length).fill(false);
  const lines = hidden === source ? plainLines : maskedLines(plainLines, originalLines, hidden, masked);
  // Lines that are nothing but math or code: they never vote, never carry, and
  // a blank line between two of them is part of their flow (see below).
  const notProse: boolean[] = [];
  const units: DirectionUnit[] = lines.map((raw, index) => {
    const text = withoutSyntax(raw);
    const explicit = /<[a-z][^>]*\bdir\s*=\s*["'](rtl|ltr)["']/i.exec(raw)?.[1].toLowerCase() as TextDirection | undefined;
    const heading = /^\s{0,3}(#{1,6})(?:\s|$)/.exec(text)?.[1].length;
    const indentedCode = /^( {4}|\t)/.test(originalLines[index]) && (index === 0 || !originalLines[index - 1].trim() || /^( {4}|\t)/.test(originalLines[index - 1]));
    // A line that was nothing but math or code is not prose: it never votes.
    const wasMath = !text.trim() && withoutSyntax(plainLines[index]).trim() !== '';
    notProse[index] = wasMath || indentedCode;
    return { own: explicit ?? strongDirection(text), heading, excluded: wasMath || indentedCode };
  });

  // A blank line between two math (or code) blocks belongs to them, not to the
  // prose around them: `$$ … $$`, an empty line, `$$ … $$` — the empty line is
  // between two LTR blocks, so a caret on it sits at the left, where both
  // blocks start, instead of at the right because the note is Persian. A blank
  // line against prose on either side keeps the prose's direction, as before.
  for (let i = 0; i < units.length; i += 1) {
    if (originalLines[i].trim() !== '' || notProse[i]) continue;
    let above = i - 1;
    while (above >= 0 && originalLines[above].trim() === '') above -= 1;
    let below = i + 1;
    while (below < units.length && originalLines[below].trim() === '') below += 1;
    if (above >= 0 && below < units.length && notProse[above] && notProse[below]) units[i] = { ...units[i], excluded: true };
  }

  for (let i = 1; i < lines.length; i++) {
    if (!units[i].excluded && /^\s{0,3}(=+|-+)\s*$/.test(lines[i]) && lines[i - 1].trim() && !units[i - 1].excluded && !units[i - 1].heading) {
      units[i - 1].heading = lines[i].trim()[0] === '=' ? 1 : 2;
    }
  }
  return { dirs: resolveDirections(withCarried(units)), units, blanked, masked };
}

export function sourceDirections(markdown: string): TextDirection[] {
  return directionSnapshot(markdown).dirs;
}

// Characters the blanker and the masker read: a keystroke that carries one of
// them can move a comment, a formula, a fence or a link definition, and with
// them every line below. Letters, spaces and ordinary punctuation carry none.
const STRUCTURAL = /[\n`~$<>!\[\]:]/;
const STRUCTURAL_LINE = /[`~$]/;
const SETEXT_UNDERLINE = /^\s{0,3}(=+|-+)\s*$/;

/** One line's decision, taken exactly the way the whole-note pass takes it.
 * Only valid for a line the masker and the blanker left alone: then the raw
 * text *is* the text they decide on. */
function lineUnit(text: string, above: string, index: number): DirectionUnit {
  const stripped = withoutSyntax(text);
  const explicit = /<[a-z][^>]*\bdir\s*=\s*["'](rtl|ltr)["']/i.exec(text)?.[1].toLowerCase() as TextDirection | undefined;
  const heading = /^\s{0,3}(#{1,6})(?:\s|$)/.exec(stripped)?.[1].length;
  const indentedCode = /^( {4}|\t)/.test(text) && (index === 0 || !above.trim() || /^( {4}|\t)/.test(above));
  return { own: explicit ?? strongDirection(stripped), heading, excluded: indentedCode };
}

/** The direction rules on a keystroke: the previous answer when the edit
 * cannot have changed it, or null when the caller has to recompute the note.
 *
 * A line's direction comes from its own text, the line above it (indentation),
 * its neighbours when it is blank, and through carry and look-below from the
 * rest of its section. So an edit that leaves every touched line's own
 * decision identical — and that cannot move math, code, a comment, a blank
 * line or a setext underline — leaves every direction in the note identical. */
export function directionsAfter(
  prev: DirectionSnapshot,
  oldDoc: Text,
  newDoc: Text,
  changes: { iterChanges(f: (fromA: number, toA: number, fromB: number, toB: number, inserted: Text) => void): void },
): TextDirection[] | null {
  if (newDoc.lines !== oldDoc.lines) return null;
  const touched = new Set<number>();
  let ok = true;
  changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (!ok) return;
    // A structural character would move math, code, a comment or a link
    // definition; a newline would move every line.
    if (STRUCTURAL.test(inserted.toString()) || STRUCTURAL.test(oldDoc.sliceString(fromA, toA))) { ok = false; return; }
    const line = newDoc.lineAt(fromB);
    if (oldDoc.lineAt(fromA).number !== line.number) { ok = false; return; }
    // `-` on the first line could open or close frontmatter.
    if (line.number === 1 && inserted.toString().includes('-')) { ok = false; return; }
    touched.add(line.number - 1);
  });
  if (!ok || !touched.size) return null;
  for (const index of touched) {
    if (prev.blanked[index] || prev.masked[index]) return null;
    const before = oldDoc.line(index + 1).text;
    const after = newDoc.line(index + 1).text;
    // A line holding a delimiter takes part in the masker's state machine —
    // run lengths, escapes, a price after a closing dollar — even when the
    // keystroke itself carried none.
    if (STRUCTURAL_LINE.test(before) || STRUCTURAL_LINE.test(after)) return null;
    // Going blank or leaving blank moves the blank-line-between-math pass.
    if ((before.trim() === '') !== (after.trim() === '')) return null;
    // A setext underline decides the heading above it.
    if (SETEXT_UNDERLINE.test(before) || SETEXT_UNDERLINE.test(after)) return null;
    // A line that ends a `$$` pair changes what is math below it.
    if (isMathBlockBoundary(before) !== isMathBlockBoundary(after)) return null;
    const unit = lineUnit(after, index > 0 ? newDoc.line(index).text : '', index);
    const was = prev.units[index];
    if (!was) return null;
    if (unit.own !== was.own || unit.heading !== was.heading || Boolean(unit.excluded) !== Boolean(was.excluded)) return null;
  }
  return prev.dirs;
}

const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,dt,dd,summary,caption,.md-prose-fragment';
const EXCLUDED = '.math-display,.math-flow,.katex,pre,code,.footnote-ref,.footnote-backref,.copy-code-button';
function proseText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(EXCLUDED).forEach((node) => node.remove());
  return (clone.textContent ?? '').replace(/https?:\/\/\S+/g, '');
}

/** The same policy over semantic blocks, before HTML is shared by preview
 * and PDF. Explicit user dir attributes are honoured. Containers follow
 * their first directional child so list markers/quote borders match too.
 * The table element carries its own dir (its first cell's): a table's
 * column order follows the note, and the attribute — unlike the section
 * wrappers it sits in — survives the print path, which unwraps sections. */
export function applyReadingDirections(root: HTMLElement): void {
  const nodes = [...root.querySelectorAll<HTMLElement>(`${BLOCKS},pre,.math-display`)];
  const leaves = nodes.filter((el) => !el.parentElement?.closest('pre,code,.math-display,.math-flow,.katex')
    && (!el.matches('li,blockquote') || !el.querySelector(BLOCKS)));
  const units: DirectionUnit[] = [];
  const starts: number[] = [];
  const ownDirections: (TextDirection | null)[] = [];
  leaves.forEach((el) => {
    const prose = proseText(el);
    const explicit = el.getAttribute('dir');
    const own = explicit === 'rtl' || explicit === 'ltr' ? explicit : strongDirection(prose);
    const excluded = el.matches('pre,.math-display') || (!prose.trim() && Boolean(el.querySelector('.math-flow,.katex,code')));
    starts.push(units.length);
    ownDirections.push(excluded ? 'ltr' : own);
    // Soft source newlines still vote individually, even though Markdown
    // displays them in one paragraph. Mixed prose must not become a false
    // unanimous prefix merely because the renderer joined its lines.
    prose.split('\n').forEach((line, index) => units.push({
      own: explicit === 'rtl' || explicit === 'ltr' ? explicit : strongDirection(line),
      heading: index === 0 && /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : undefined,
      excluded,
    }));
  });
  const directions = resolveDirections(withCarried(units));
  leaves.forEach((el, index) => el.setAttribute('dir', ownDirections[index] ?? directions[starts[index]]));
  for (const el of [...root.querySelectorAll<HTMLElement>('li,blockquote,ul,ol,table,.md-section')].reverse()) {
    if (el.getAttribute('dir') === 'ltr' || el.getAttribute('dir') === 'rtl') continue;
    el.setAttribute('dir', el.querySelector('[dir]')?.getAttribute('dir') ?? strongDirection(proseText(el)) ?? 'ltr');
  }
  root.querySelectorAll<HTMLElement>('.math-display,.math-flow,.katex,pre,code').forEach((el) => el.setAttribute('dir', 'ltr'));
}
