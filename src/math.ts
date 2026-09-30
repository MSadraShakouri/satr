// Math rendering: KaTeX, plus two things on top.
//
// 1. Spaces. TeX ignores spaces in math, which kills "$ hello world $". A run
//    of spaces is kept visibly (as "\ ") only when it sits between two
//    letters (Latin or Persian) that aren't the name of a command. Spaces
//    next to symbols, digits or command arguments ("$ a = b $",
//    "$ \frac13 b $") are dropped, and leading/trailing spaces are trimmed.
//    A kept space outside braces is also a place the line may break
//    ("hello" / "world"), and the space goes at the break; + and − never are.
//    The same spaces inside a text command (\text, \textbf, …) are break
//    points too — otherwise "\text{is continuous on the interval}" is one
//    unbreakable unit and overflows the screen. The command is closed and
//    reopened around each word, so the space between those words is an
//    ordinary break. Spaces inside other braces still are not.
//
// 2. Line breaking. The formula is split at its top-level break points,
//    preferred in this order: the writer's own line ends, then commas, then
//    relations (=, ≡, ≈, ≤, arrows, ∴ ...), then the kept word spaces.
//    Commas stay at the end of the line they break; a line that ends at a
//    relation repeats it on the next line ("a = b =" / "= c"), the usual
//    convention for continued relations. Never at + or −, and never inside
//    braces, \left…\right or environments. Each piece is rendered as an
//    unbreakable unit; the actual line choice happens in layoutMath()
//    (src/mathLayout.ts), once the units can be measured: display math is
//    balanced (fewest lines, then preferred break points, then the most even
//    line widths); inline math wraps with the paragraph.
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

// Prose commands. Their braces would hide word spaces from the splitter, so
// lift those spaces out: \text{hello world} → \text{hello} · \text{world}.
// Math structure (\frac, \mathrm, \left…\right, other groups) is not prose.
const TEXT_COMMANDS = new Set([
  'text', 'textrm', 'textsf', 'texttt', 'textnormal',
  'textbf', 'textmd', 'textit', 'textup', 'emph',
]);

function commandName(tex: string, i: number): string | null {
  if (tex[i] !== '\\' || !LATIN.test(tex[i + 1] ?? '')) return null;
  let k = i + 1;
  while (LATIN.test(tex[k] ?? '')) k += 1;
  return tex.slice(i + 1, k);
}

function liftTextBreaks(tex: string): string {
  let depth = 0;
  let out = '';
  for (let i = 0; i < tex.length; i += 1) {
    const c = tex[i];
    if (c !== '\\') {
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      out += c;
      continue;
    }
    const name = commandName(tex, i);
    if (!name) {
      out += tex.slice(i, i + 2);
      i += 1; // the escaped character; the loop adds one more
      continue;
    }
    if (name === 'left' || name === 'begin') depth += 1;
    else if ((name === 'right' || name === 'end') && depth > 0) depth -= 1;
    const after = i + 1 + name.length;
    if (depth === 0 && TEXT_COMMANDS.has(name)) {
      const brace = skipSpaces(tex, after);
      if (tex[brace] === '{') {
        const end = skipGroup(tex, brace, '{', '}');
        if (tex[end - 1] === '}') {
          out += liftTextCommand(name, tex.slice(brace + 1, end - 1));
          i = end - 1;
          continue;
        }
      }
    }
    out += tex.slice(i, after);
    i = after - 1;
  }
  return out;
}

function liftTextCommand(name: string, inner: string): string {
  const lifted = liftTextBreaks(inner);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < lifted.length; i += 1) {
    const c = lifted[i];
    if (c === '\\') {
      const cmd = commandName(lifted, i);
      if (cmd) { i += cmd.length; continue; }
      i += 1; // an escaped character
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === SPACE && depth === 0) {
      parts.push(lifted.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(lifted.slice(start));
  if (parts.length < 2 || parts.some((part) => !part.length)) return `\\${name}{${inner}}`;
  return parts.map((part) => `\\${name}{${part}}`).join(SPACE);
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
  'twoheadrightarrow', 'rightharpoonup', 'rightrightarrows', 'rightleftharpoons', 'leadsto',
]);
// Extensible arrows take an optional [below] and a {above} argument.
const EXT_ARROWS = new Set(['xrightarrow', 'xleftarrow', 'xRightarrow', 'xLeftarrow', 'xleftrightarrow', 'xLeftrightarrow', 'xmapsto', 'xlongequal', 'xtofrom']);
const STYLE_PREFIX = /^\s*(\\(?:displaystyle|textstyle)\b\s*)+/;

// Break points, preferred in this order: the writer's own line ends, then
// commas, then relations (which repeat on the next line), then the spaces
// typed between words. The comma stays at the end of the line it breaks.
//
// A plain ( ) / [ ] group — and the visible braces \{ \} — is a step behind
// all of those (BREAK_INSIDE is added to its break points' priority): a group
// that fits is never broken, and a group too wide for the line can still
// break inside itself at its own comma, relation or space instead of at
// whatever atom the browser would otherwise split it at. Braces, \left…
// \right and environments never break: their halves must render together.
interface Cut { prio: number; rel: string; comma: boolean; prefix: string }
const newCut = (prio: number, fields: Partial<Cut> = {}): Cut => ({ prio, rel: '', comma: false, prefix: '', ...fields });
function mergeCuts(a: Cut, b: Cut): Cut {
  return newCut(Math.min(a.prio, b.prio), {
    rel: [a.rel, b.rel].filter(Boolean).join(' '),
    comma: a.comma || b.comma,
    prefix: a.prefix || b.prefix,
  });
}
function cutAfter(cut: Cut | null): string {
  return cut ? `${cut.rel ? ` ${cut.rel} {}` : ''}${cut.comma ? ',' : ''}` : '';
}
function cutCont(cut: Cut | null): string {
  return cut?.rel ? `${cut.rel} ` : '';
}

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

interface Split { terms: string[]; cuts: Cut[] }

/** Split at top-level break points; null when the writer's own layout rules
 * (manual \\ line breaks, alignment) mean the formula must be left alone. */
function splitCuts(rawTex: string): Split | null {
  const tex = liftTextBreaks(rawTex);
  const terms: string[] = [];
  const cuts: Cut[] = [];
  let termStart = 0;
  const cut = (from: number, to: number, descriptor: Cut): void => {
    const term = tex.slice(termStart, from);
    if (!term.trim() && !cuts.length) return; // nothing to break after at the start
    if (!term.trim()) {
      cuts[cuts.length - 1] = mergeCuts(cuts[cuts.length - 1], descriptor);
    } else {
      terms.push(term);
      cuts.push(descriptor);
    }
    termStart = to;
  };
  const LAST = 4; // every top-level break point stays ahead of a break inside a group
  let depth = 0; // braces, \left…\right and environments: never a break inside
  let plain = 0; // plain ( ) [ ] (and \{ \}): a break inside is the last resort
  let i = 0;
  while (i < tex.length) {
    const c = tex[i];
    // 0 = top level, 1 = inside a plain group (shifted by LAST), -1 = no break.
    const level = depth > 0 ? -1 : plain > 0 ? 1 : 0;
    const prio = (value: number): number => value + (level === 1 ? LAST : 0);
    if (c === '\\') {
      if (!LATIN.test(tex[i + 1] ?? '')) {
        if (tex[i + 1] === '\\' && depth === 0) return null; // manual line breaks: leave alone
        // A visible brace is a delimiter of its own, not an escape to skip.
        if (level === 0 && tex[i + 1] === '{') { plain += 1; i += 2; continue; }
        if (level === 1 && tex[i + 1] === '}') { plain -= 1; i += 2; continue; }
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
      if (level >= 0 && name === 'not') {
        // \not= , \not\equiv ...
        let end = skipSpaces(tex, k);
        if (tex[end] === '\\') { end += 1; while (LATIN.test(tex[end] ?? '')) end += 1; } else end += 1;
        cut(i, end, newCut(prio(2), { rel: tex.slice(i, end) }));
        i = end;
        continue;
      }
      if (level >= 0 && EXT_ARROWS.has(name)) {
        let end = skipGroup(tex, skipSpaces(tex, k), '[', ']');
        end = skipGroup(tex, skipSpaces(tex, end), '{', '}');
        cut(i, end, newCut(prio(2), { rel: tex.slice(i, end) }));
        i = end;
        continue;
      }
      if (level >= 0 && RELATIONS.has(name)) {
        cut(i, k, newCut(prio(2), { rel: tex.slice(i, k) }));
        i = k;
        continue;
      }
      i = k;
      continue;
    }
    if (c === '{') { depth += 1; i += 1; continue; }
    if (c === '}') { if (depth > 0) depth -= 1; i += 1; continue; }
    if (c === '(') { if (depth === 0) plain += 1; i += 1; continue; }
    if (c === ')') { if (depth === 0 && plain > 0) plain -= 1; i += 1; continue; }
    if (c === '[') { if (depth === 0) plain += 1; i += 1; continue; }
    if (c === ']') { if (depth === 0 && plain > 0) plain -= 1; i += 1; continue; }
    if (c === '&' && level >= 0) return null; // alignment: leave alone
    if (c === '\n' && level >= 0) {
      cut(i, i + 1, newCut(prio(0))); // the writer's own line end, preferred
      i += 1;
      continue;
    }
    if (c === SPACE && level >= 0) {
      cut(i, i + 1, newCut(prio(3), { prefix: '\\ ' }));
      i += 1;
      continue;
    }
    if (c === ',' && level >= 0) {
      cut(i, i + 1, newCut(prio(1), { comma: true }));
      i += 1;
      continue;
    }
    if (level >= 0 && c === ':' && tex[i + 1] === '=') {
      cut(i, i + 2, newCut(prio(2), { rel: ':=' }));
      i += 2;
      continue;
    }
    if (level >= 0 && (c === '=' || c === '<' || c === '>')) {
      cut(i, i + 1, newCut(prio(2), { rel: c }));
      i += 1;
      continue;
    }
    i += 1;
  }
  const last = tex.slice(termStart);
  if (!last.trim() && cuts.length) {
    // Trailing break point ("a = b ="): glue it back onto the last term.
    const trailing = cuts.pop()!;
    const glued = (trailing.rel ? ` ${trailing.rel}` : '') + (trailing.comma ? ',' : '');
    terms[terms.length - 1] += glued;
    return terms.length > 1 ? { terms, cuts } : null;
  }
  if (last) terms.push(last);
  return terms.length > 1 ? { terms, cuts } : null;
}

const render = (tex: string, displayMode = false): string =>
  katex.renderToString(tex, { displayMode, throwOnError: false });

// Math digit display (Settings → Editor): formulas can be shown with one
// digit set all through — including \text, \texttt and \tag — without the
// note ever being changed. "Auto" leaves the writer's digits alone.
export type MathDigits = 'auto' | 'english' | 'persian';
const DIGIT_SETS = ['0123456789', '۰۱۲۳۴۵۶۷۸۹', '٠١٢٣٤٥٦٧٨٩'];
let digitMode: MathDigits = 'auto';
export function setMathDigits(mode: MathDigits): void { digitMode = mode; }
function mapDigits(tex: string): string {
  if (digitMode === 'auto') return tex;
  const to = DIGIT_SETS[digitMode === 'persian' ? 1 : 0];
  return tex.replace(/[0-9\u06f0-\u06f9\u0660-\u0669]/g, (digit) => {
    const set = digit <= '9' ? 0 : digit >= '\u06f0' ? 1 : 2;
    return to[DIGIT_SETS[set].indexOf(digit)];
  });
}

export function renderMath(raw: string, display: boolean): string {
  // Empty display math is still a blank display line, not zero-height KaTeX.
  if (display && !raw.trim()) return '<div class="math-display"><br></div>';
  const marked = markMathSpaces(mapDigits(raw));
  const tex = marked.split(SPACE).join('\\ ');
  const styleMatch = STYLE_PREFIX.exec(tex);
  const style = (display ? '\\displaystyle ' : '') + (styleMatch ? styleMatch[0] : '');
  const body = styleMatch ? marked.slice(styleMatch[0].length) : marked;
  // Manual line breaks and alignment are the writer's own layout: left alone.
  const manual = /\\\\|&/.test(body);
  const split = manual ? null : splitCuts(body);
  if (!split) {
    if (display) return `<div class="math-display">${render(tex, true)}</div>`;
    return `<span class="math-flow"><span class="math-unit">${render(tex)}</span></span>`;
  }
  // Each piece ends at a break point: the piece plus what stays on its line
  // (a comma, or a relation that repeats on the next line). The form that
  // starts a line repeats the relation; a space there is dropped.
  const pieces = split.terms.map((term, index) => ({
    tex: term.split(SPACE).join('\\ '),
    before: index > 0 ? split.cuts[index - 1] : null,
    after: index < split.cuts.length ? split.cuts[index] : null,
  }));
  if (pieces.length < 2) {
    if (display) return `<div class="math-display">${render(tex, true)}</div>`;
    return `<span class="math-flow"><span class="math-unit">${render(tex)}</span></span>`;
  }
  // unit = the piece + what follows it; the continuation form is how it
  // looks at the start of a line. data-break is the cut before the unit,
  // in the order layoutMath() should prefer to break at.
  const units = pieces.map((piece, index) => {
    const after = cutAfter(piece.after);
    const plain = render(`${style}${piece.before?.prefix ?? ''}${piece.tex}${after}`);
    if (index === 0) return `<span class="math-unit" data-first><span class="math-plain">${plain}</span></span>`;
    const cont = render(`${style}${cutCont(piece.before)}${piece.tex}${after}`);
    return `<span class="math-unit" data-break="${piece.before!.prio}"><span class="math-plain">${plain}</span><span class="math-cont">${cont}</span></span>`;
  });
  const flow = `<span class="math-flow${display ? ' is-display' : ''}" data-units="${units.length}">${units.join('<wbr>')}</span>`;
  return display ? `<div class="math-display">${flow}</div>` : flow;
}
