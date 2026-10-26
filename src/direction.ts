import { StateField, type Text } from '@codemirror/state';
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
  /** The direction carried into the line from the prose above it. */
  carried: (TextDirection | null)[];
  /** The first line that has a strong letter of its own, or -1. */
  firstOwn: number;
  /** The last heading with no letters of its own, or -1. */
  lastNullHeading: number;
  /** The last line the masker touched, or -1. */
  lastMasked: number;
  /** Some `[` in the note does not close on the line it opened on. */
  openBracket: boolean;
  /** The note holds a character the masker reads, so a `$$ … $$` pair can form. */
  math: boolean;
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
  const carriedUnits = withCarried(units);
  const carried: (TextDirection | null)[] = [];
  let above: TextDirection | null = null;
  for (const unit of units) {
    carried.push(above);
    if (!unit.excluded && unit.own) above = unit.own;
  }
  return {
    dirs: resolveDirections(carriedUnits),
    units,
    carried,
    firstOwn: units.findIndex((unit) => !unit.excluded && unit.own),
    // A heading with no letters of its own reads the first line below it, and
    // a later one takes its direction from the heading stack — so it is the
    // last such heading in the note that a new heading above it can change.
    lastNullHeading: carriedUnits.reduce((last, unit, i) => (unit.heading && !unit.excluded && !unit.own ? i : last), -1),
    lastMasked: masked.lastIndexOf(true),
    math: /[`~$]/.test(source),
    openBracket: originalLines.some(opensBracket),
    blanked,
    masked,
  };
}

export function sourceDirections(markdown: string): TextDirection[] {
  return directionSnapshot(markdown).dirs;
}

// Characters the masker, the blanker and the code blanker read. A keystroke
// that carries one of them can move a formula, a fence, a comment or a link
// definition — and with them every line below. A newline is not one of them:
// it only moves its own two lines. Brackets count because the blanker's
// link-definition pattern reaches across newlines on its way to `]:`.
const STRUCTURAL = /[`~$<>[\]]/;
/** The two ends of an html comment: a line holding one can open or close it. */
const COMMENT = /<!--|-->/;
/** Characters whose presence on a line the masker reads. */
const DELIMITER = /[`~$]/;
/** A link definition: the one whole line the blanker reads outside comments. */
const LINK_DEFINITION = /^ {0,3}\[(?!\^)[^\]]+\]:/;
/** A line the blanker, the masker and the setext pass leave alone. */
const INDENTED = /^( {4}|\t)/;
/** A `[` that no `]` on the same line closes: the blanker's link-definition
 * pattern reaches across newlines to find one, so it blanks lines below. */
function opensBracket(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === '[') depth += 1;
    else if (ch === ']') depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}
const SETEXT_UNDERLINE = /^\s{0,3}(=+|-+)\s*$/;
/** A line the masker, the blanker and the setext pass leave alone. */
const proseLine = (text: string): boolean => text.trim() !== ''
  && !DELIMITER.test(text) && !COMMENT.test(text)
  && !opensBracket(text) && !LINK_DEFINITION.test(text) && !SETEXT_UNDERLINE.test(text);

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
): DirectionSnapshot | null {
  // Below the first line that has a strong letter of its own, a line's answer
  // is `excluded ? ltr : own ?? carried from above`, and every heading there
  // has something carried into it. Nothing depends on what comes after the
  // line, so a keystroke only has to settle the lines it touched, then walk
  // down until the carried direction is what it was. Above that first line,
  // and anywhere a `[` is left open (the blanker's link pattern reaches across
  // newlines to find its `]:`), the whole note decides and the caller rebuilds.
  if (prev.firstOwn < 0 || prev.openBracket) return null;
  let ok = true;
  let count = 0;
  let fromA = 0;
  let toA = 0;
  let fromB = 0;
  let toB = 0;
  changes.iterChanges((fa, ta, fb, tb, inserted) => {
    count += 1;
    if (count > 1) { ok = false; return; }
    // A delimiter moves math, code or a comment. A newline is fine: it only
    // moves its own two lines.
    if (STRUCTURAL.test(inserted.toString()) || STRUCTURAL.test(oldDoc.sliceString(fa, ta))) ok = false;
    fromA = fa; toA = ta; fromB = fb; toB = tb;
  });
  if (!ok || !count) return null;

  const a = oldDoc.lineAt(fromA).number;
  let b = oldDoc.lineAt(toA).number;
  let bNew = newDoc.lineAt(toB).number;
  if (newDoc.lineAt(fromB).number !== a) return null;
  // Strictly after the first prose line: the carried value above holds.
  if (a - 1 <= prev.firstOwn) return null;
  // The masker reads the note in one pass and a line of formulas only opens
  // where the blank lines let it, so adding or removing a line above one can
  // move the mask. Joining and splitting lines is only free below the last
  // formula in the note.
  if (newDoc.lines !== oldDoc.lines && prev.lastMasked >= a - 1) return null;

  // A line that is nothing but math or code is `ltr`, carries nothing and
  // decides nothing. A keystroke that stays inside one leaves every line of
  // the note exactly where it was — which is what typing in a formula is.
  if (a === b && a === bNew) {
    const index = a - 1;
    if (prev.units[index]?.excluded && prev.masked[index] && !prev.blanked[index]) {
      // The line has to keep something after its syntax: a line that is left
      // with nothing but a list marker stops being a line of math.
      const text = newDoc.line(a).text;
      if (!STRUCTURAL.test(text) && withoutSyntax(text).trim() !== '') return prev;
    }
  }

  // An indented line of code is decided by the line above it, so a keystroke
  // that changes an indentation changes the run of code under it too. Take
  // those lines in with the edit; they are code before and after.
  const last = b;
  const lastNew = bNew;
  while (b < oldDoc.lines && bNew < newDoc.lines
    && INDENTED.test(oldDoc.line(b + 1).text) && INDENTED.test(newDoc.line(bNew + 1).text)) { b += 1; bNew += 1; }

  // Every line the edit covers, old and new, must be ordinary prose: no
  // formula, no code, no blank, no underline, nothing the masker, the blanker
  // or the two whole-note passes read — except the run of code taken in above,
  // which must be code on both sides. A neighbour that is masked, blanked or
  // an underline decides something about the lines about to be written.
  for (let n = a; n <= last; n += 1) {
    const index = n - 1;
    if (prev.blanked[index] || prev.masked[index] || prev.units[index].excluded) return null;
    // A blank line carries the direction above it and nothing else, so the
    // first letter of a new paragraph costs no more than any other — unless
    // the blank sits in a run of formulas or code, where it is not prose.
    if (oldDoc.line(n).text.trim() === '') {
      if (prev.masked[index - 1] || prev.masked[index + 1]) return null;
    } else if (!proseLine(oldDoc.line(n).text)) return null;
    // A heading, list, rule or quote ends a `$$ … $$` pair, so a keystroke
    // that makes or breaks one moves the mask below it (src/mathScan.ts).
    // Only a note with a delimiter in it can have such a pair at all.
    const after = newDoc.line(Math.min(n, bNew)).text;
    if (prev.math && isMathBlockBoundary(oldDoc.line(n).text) !== isMathBlockBoundary(after)) return null;
  }
  for (let n = a; n <= lastNew; n += 1) {
    if (!proseLine(newDoc.line(n).text)) return null;
  }
  for (let n = last + 1; n <= b; n += 1) {
    if (!prev.units[n - 1].excluded || !INDENTED.test(newDoc.line(n + (bNew - b)).text)) return null;
  }
  for (const n of [a - 1, b + 1]) {
    if (n < 1 || n > oldDoc.lines) continue;
    if (prev.blanked[n - 1]) return null;
    if (SETEXT_UNDERLINE.test(oldDoc.line(n).text)) return null;
    if (n <= bNew && SETEXT_UNDERLINE.test(newDoc.line(n).text)) return null;
  }

  const fresh: DirectionUnit[] = [];
  for (let n = a; n <= bNew; n += 1) {
    fresh.push(lineUnit(newDoc.line(n).text, n > 1 ? newDoc.line(n - 1).text : '', n - 1));
  }
  for (let i = 0; i <= lastNew - a; i += 1) {
    if (fresh[i].excluded) return null;
    // A heading that lost its letters would start reading the note below it.
    if (fresh[i].heading && !fresh[i].own) return null;
  }
  const removed = b - a + 1;
  if (fresh.length === removed) {
    // A heading that appeared, vanished or changed level re-stacks the
    // headings below it — but only a heading with no letters of its own ever
    // reads that stack, so the change stays on its own line when there is
    // none of those below.
    for (let i = 0; i < fresh.length; i += 1) {
      if (fresh[i].heading !== prev.units[a - 1 + i].heading && a - 1 + i < prev.lastNullHeading) return null;
    }
  }

  // The common keystroke — a letter, a space, a full stop, anywhere after the
  // line's first strong one — leaves every line's own answer exactly as it
  // was. Hand back the snapshot untouched rather than copy the note.
  if (fresh.length === removed) {
    let same = true;
    for (let i = 0; i < fresh.length && same; i += 1) {
      const was = prev.units[a - 1 + i];
      same = was.own === fresh[i].own && was.heading === fresh[i].heading
        && Boolean(was.excluded) === Boolean(fresh[i].excluded);
    }
    if (same) return prev;
  }

  const units = prev.units.slice();
  const blanked = prev.blanked.slice();
  const masked = prev.masked.slice();
  const carried = prev.carried.slice();
  const dirs = prev.dirs.slice();
  const freshCarried: (TextDirection | null)[] = [];
  const freshDirs: TextDirection[] = [];
  let carry = prev.carried[a - 1] ?? null;
  for (const unit of fresh) {
    freshCarried.push(carry);
    freshDirs.push(unit.excluded ? 'ltr' : unit.own ?? carry ?? 'ltr');
    if (!unit.excluded && unit.own) carry = unit.own;
  }
  const none = fresh.map(() => false);
  units.splice(a - 1, removed, ...fresh);
  blanked.splice(a - 1, removed, ...none);
  masked.splice(a - 1, removed, ...none);
  carried.splice(a - 1, removed, ...freshCarried);
  dirs.splice(a - 1, removed, ...freshDirs);

  // Everything below reads one value — the direction carried into the line —
  // and its own letters. So the walk stops the moment the carried value is
  // what it was before the keystroke: from there down the note is unchanged.
  // A line of nothing but math or code is `ltr` either way and passes the
  // carried value along untouched.
  let below = carry;
  let was = b;
  for (let i = a - 1 + fresh.length; i < units.length; i += 1, was += 1) {
    if (prev.carried[was] === below) break;
    carried[i] = below;
    const unit = units[i];
    if (unit.excluded) continue;
    if (unit.own) below = unit.own;
    dirs[i] = unit.own ?? below ?? 'ltr';
  }

  return {
    dirs, units, carried, firstOwn: prev.firstOwn,
    lastMasked: prev.lastMasked, openBracket: prev.openBracket, math: prev.math,
    lastNullHeading: prev.lastNullHeading, blanked, masked,
  };
}


const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,dt,dd,summary,caption,.md-prose-fragment';
/** Boxes the renderer makes: a list, a quote, a table, a section wrapper. */
const MARKDOWN_BOXES = 'li,blockquote,ul,ol,table,.md-section';
/** Those, and the block containers a note can write in HTML. A container
 *  carries the direction of its first directional child, because the PDF
 *  unwraps the section wrappers (printableBody) and anything that leant on a
 *  wrapper for its direction would be left reading left to right on the page
 *  while the reading view, where the wrapper survives, shows it right to
 *  left. The two views have to agree, so the element itself holds the
 *  answer. */
const CONTAINERS = `${MARKDOWN_BOXES},div,section,article,aside,header,footer,main,nav,figure,details,address,fieldset,hgroup`;
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
  for (const el of [...root.querySelectorAll<HTMLElement>(CONTAINERS)].reverse()) {
    if (el.getAttribute('dir') === 'ltr' || el.getAttribute('dir') === 'rtl') continue;
    const direction = el.querySelector('[dir]')?.getAttribute('dir') ?? strongDirection(proseText(el));
    // A box Markdown itself builds is always given a direction, as it always
    // was. A box the note wrote is only given one when it holds prose to read
    // it from, so an empty decorative <div> keeps inheriting.
    if (direction) el.setAttribute('dir', direction);
    else if (el.matches(MARKDOWN_BOXES)) el.setAttribute('dir', 'ltr');
  }
  root.querySelectorAll<HTMLElement>('.math-display,.math-flow,.katex,pre,code').forEach((el) => el.setAttribute('dir', 'ltr'));
}

// The note's per-line directions, kept up to date as the document changes.
// The line's `dir` attribute is drawn from this (src/editor.ts), and so is the
// side the caret takes at a run boundary (src/caretMotion.ts): one answer, read
// from the document, never from the layout.
export const directionsField = StateField.define<DirectionSnapshot>({
  create: (state) => directionSnapshot(state.doc.toString()),
  update: (value, tr) => {
    if (!tr.docChanged) return value;
    return directionsAfter(value, tr.startState.doc, tr.newDoc, tr.changes) ?? directionSnapshot(tr.newDoc.toString());
  },
});
