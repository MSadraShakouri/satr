// Math rendering: KaTeX, plus two things on top.
//
// 1. Spaces. TeX ignores spaces in math, which kills "$ hello world $". A run
//    of spaces is kept visibly (as "\ ") only when it sits between two
//    letters (Latin or Persian) that aren't the name of a command. Spaces
//    next to symbols, digits or command arguments ("$ a = b $",
//    "$ \frac13 b $") are dropped, and leading/trailing spaces are trimmed.
//    A kept space outside braces is also a place the line may break
//    ("hello" / "world"), and the space goes at the break; + and − never are.
//
// 2. Line breaking at relations. The formula is split at its top-level
//    relations (=, ≡, ≈, ≤, arrows, ∴ ...), never at + or −, and never inside
//    braces, \left…\right or environments. Each piece is rendered as an
//    unbreakable unit; if a line ends at a relation, the next line repeats it
//    ("a = b =" / "= c"), the usual convention for continued relations. The
//    actual line choice happens in layoutMath() (src/mathLayout.ts), once the
//    units can be measured: display math is balanced (fewest lines, then the
//    most even line widths); inline math wraps with the paragraph.
import katex from 'katex';

const LETTER = /[A-Za-z\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN = /[A-Za-z]/;

// Kept spaces are marked with this character while the formula is split,
// then written as "\ ".
const SPACE = '\u0001';

export function normalizeMathSpaces(tex: string): string {
  return markMathSpaces(tex).split(SPACE).join('\\ ');
}

function markMathSpaces(tex: string): string {
  const source = tex.trim();
  return source.replace(/ +/g, (run: string, offset: number) => {
    const before = source[offset - 1] ?? '';
    const after = source[offset + run.length] ?? '';
    if (!LETTER.test(before) || !LETTER.test(after)) return ' ';
    // "\alpha b": the letters before are a command name; the space only ends it.
    if (LATIN.test(before)) {
      let k = offset - 1;
      while (k >= 0 && LATIN.test(source[k])) k -= 1;
      if (source[k] === '\\') return ' ';
    }
    return SPACE;
  });
}

// Splits a formula at its kept spaces outside braces, \left…\right and
// environments. Spaces inside those stay spaces.
function splitWords(tex: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < tex.length; i += 1) {
    const c = tex[i];
    if (c === '\\') {
      const name = /^\\([A-Za-z]+)/.exec(tex.slice(i))?.[1];
      if (name === 'left' || name === 'begin') depth += 1;
      else if (name === 'right' || name === 'end') depth -= 1;
      if (name) { i += name.length; continue; }
      i += 1; // an escaped character
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === SPACE && depth === 0) {
      words.push(tex.slice(start, i));
      start = i + 1;
    }
  }
  words.push(tex.slice(start));
  return words.map((word) => word.split(SPACE).join('\\ ')).filter((word) => word.length);
}

// Relations a line may break after. Vertical arrows are left out on purpose.
const RELATIONS = new Set([
  'le', 'leq', 'ge', 'geq', 'leqslant', 'geqslant', 'ne', 'neq', 'lt', 'gt',
  'equiv', 'approx', 'approxeq', 'sim', 'simeq', 'cong', 'propto', 'asymp', 'doteq', 'triangleq',
  'coloneqq', 'eqqcolon', 'Coloneqq', 'coloneq', 'eqcolon', 'defeq',
  'll', 'gg', 'lesssim', 'gtrsim', 'prec', 'succ', 'preceq', 'succeq',
  'in', 'notin', 'ni', 'subset', 'subseteq', 'supset', 'supseteq', 'subsetneq', 'supsetneq',
  'models', 'vdash', 'dashv',
  'therefore', 'because',
  'to', 'gets', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'leftrightarrow', 'Leftrightarrow',
  'longrightarrow', 'longleftarrow', 'Longrightarrow', 'Longleftarrow', 'longleftrightarrow', 'Longleftrightarrow',
  'implies', 'impliedby', 'iff', 'mapsto', 'longmapsto', 'hookrightarrow', 'hookleftarrow',
  'twoheadrightarrow', 'rightharpoonup', 'rightleftharpoons', 'leadsto',
]);
// Extensible arrows take an optional [below] and a {above} argument.
const EXT_ARROWS = new Set(['xrightarrow', 'xleftarrow', 'xRightarrow', 'xLeftarrow', 'xleftrightarrow', 'xLeftrightarrow', 'xmapsto', 'xlongequal', 'xtofrom']);
const STYLE_PREFIX = /^\s*(\\(?:displaystyle|textstyle)\b\s*)+/;

type Split = { terms: string[]; relations: string[] };

function skipGroup(tex: string, i: number, open: string, close: string): number {
  if (tex[i] !== open) return i;
  let depth = 0;
  for (let k = i; k < tex.length; k += 1) {
    if (tex[k] === '\\') { k += 1; continue; }
    if (tex[k] === open) depth += 1;
    else if (tex[k] === close && (depth -= 1) === 0) return k + 1;
  }
  return tex.length;
}

function skipSpaces(tex: string, i: number): number {
  while (tex[i] === ' ') i += 1;
  return i;
}

// Read one delimiter after \left / \right: "(", "\{", "\langle", ".".
function skipDelimiter(tex: string, i: number): number {
  i = skipSpaces(tex, i);
  if (tex[i] !== '\\') return i + 1;
  if (!LATIN.test(tex[i + 1] ?? '')) return i + 2;
  let k = i + 1;
  while (LATIN.test(tex[k] ?? '')) k += 1;
  return k;
}

/** Split at top-level relations; null when there's nothing to split. */
export function splitRelations(tex: string): Split | null {
  const terms: string[] = [];
  const relations: string[] = [];
  let depth = 0;
  let termStart = 0;
  let i = 0;
  const cut = (from: number, to: number): void => {
    const term = tex.slice(termStart, from);
    const previous = term.trimEnd().slice(-1);
    // "x^=" / "a_=" : a script, not a relation.
    if (previous === '^' || previous === '_') return;
    if (!term.trim() && relations.length) {
      relations[relations.length - 1] += ' ' + tex.slice(from, to); // "\le =" → one relation
    } else if (!term.trim()) {
      return; // relation at the very start: nothing to break after
    } else {
      terms.push(term);
      relations.push(tex.slice(from, to));
    }
    termStart = to;
  };
  while (i < tex.length) {
    const c = tex[i];
    if (c === '\\') {
      if (!LATIN.test(tex[i + 1] ?? '')) {
        if (tex[i + 1] === '\\' && depth === 0) return null; // manual line breaks: leave alone
        i += 2;
        continue;
      }
      let k = i + 1;
      while (LATIN.test(tex[k] ?? '')) k += 1;
      const name = tex.slice(i + 1, k);
      if (name === 'left') { depth += 1; i = skipDelimiter(tex, k); continue; }
      if (name === 'right') { depth -= 1; i = skipDelimiter(tex, k); continue; }
      if (name === 'begin') { depth += 1; i = skipGroup(tex, skipSpaces(tex, k), '{', '}'); continue; }
      if (name === 'end') { depth -= 1; i = skipGroup(tex, skipSpaces(tex, k), '{', '}'); continue; }
      if (depth === 0 && name === 'not') {
        // \not= , \not\equiv ...
        let end = skipSpaces(tex, k);
        if (tex[end] === '\\') { end += 1; while (LATIN.test(tex[end] ?? '')) end += 1; } else end += 1;
        cut(i, end);
        i = end;
        continue;
      }
      if (depth === 0 && EXT_ARROWS.has(name)) {
        let end = skipGroup(tex, skipSpaces(tex, k), '[', ']');
        end = skipGroup(tex, skipSpaces(tex, end), '{', '}');
        cut(i, end);
        i = end;
        continue;
      }
      if (depth === 0 && RELATIONS.has(name)) { cut(i, k); i = k; continue; }
      i = k;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '&' && depth === 0) return null; // alignment: leave alone
    else if (depth === 0 && c === ':' && tex[i + 1] === '=') { cut(i, i + 2); i += 2; continue; }
    else if (depth === 0 && (c === '=' || c === '<' || c === '>')) { cut(i, i + 1); i += 1; continue; }
    i += 1;
  }
  const last = tex.slice(termStart);
  if (!relations.length) return null;
  if (!last.trim()) {
    // Trailing relation ("a = b ="): glue it back onto the last term.
    const rel = relations.pop()!;
    terms[terms.length - 1] += ` ${rel}`;
    return relations.length ? { terms, relations } : null;
  }
  terms.push(last);
  return { terms, relations };
}

const render = (tex: string, displayMode = false): string =>
  katex.renderToString(tex, { displayMode, throwOnError: false });

export function renderMath(raw: string, display: boolean): string {
  const marked = markMathSpaces(raw);
  const tex = marked.split(SPACE).join('\\ ');
  const styleMatch = STYLE_PREFIX.exec(tex);
  const style = (display ? '\\displaystyle ' : '') + (styleMatch ? styleMatch[0] : '');
  const body = styleMatch ? marked.slice(styleMatch[0].length) : marked;
  // Manual line breaks and alignment are the writer's own layout: left alone.
  const manual = /\\\\|&/.test(body);
  const split = splitRelations(body) ?? (manual ? null : { terms: [body], relations: [] });
  if (!split) {
    if (display) return `<div class="math-display">${render(tex, true)}</div>`;
    return `<span class="math-flow"><span class="math-unit">${render(tex)}</span></span>`;
  }
  // The pieces a line may break between: each term split at its word spaces.
  // A piece after a relation repeats it when it starts a line; a piece after
  // a space drops the space there.
  const pieces: { tex: string; relation: string | null; spaced: boolean; after: string }[] = [];
  split.terms.forEach((term, index) => {
    const words = splitWords(term);
    words.forEach((word, w) => pieces.push({
      tex: word,
      relation: w === 0 && index > 0 ? split.relations[index - 1] : null,
      spaced: w > 0,
      after: w === words.length - 1 && index < split.relations.length ? ` ${split.relations[index]} {}` : '',
    }));
  });
  if (pieces.length < 2) {
    if (display) return `<div class="math-display">${render(tex, true)}</div>`;
    return `<span class="math-flow"><span class="math-unit">${render(tex)}</span></span>`;
  }
  // unit = the piece + the relation after it (+ "{}" so it keeps its right
  // spacing); the continuation form is how it looks at the start of a line.
  const units = pieces.map((piece, index) => {
    const plain = render(`${style}${piece.spaced ? '\\ ' : ''}${piece.tex}${piece.after}`);
    if (index === 0) return `<span class="math-unit" data-first><span class="math-plain">${plain}</span></span>`;
    const cont = render(`${style}${piece.relation ? `${piece.relation} ` : ''}${piece.tex}${piece.after}`);
    return `<span class="math-unit"><span class="math-plain">${plain}</span><span class="math-cont">${cont}</span></span>`;
  });
  const flow = `<span class="math-flow${display ? ' is-display' : ''}" data-units="${units.length}">${units.join('<wbr>')}</span>`;
  return display ? `<div class="math-display">${flow}</div>` : flow;
}
