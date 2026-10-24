// Math rendering: KaTeX, plus two things on top.
//
// 1. Spaces. TeX ignores spaces in math, and so does this. A run of spaces
//    between two letters used to be kept and written as "\ ", so that
//    "$ hello world $" read as two words; that rule is gone. Words with gaps
//    in them come from \text{…}, which is what they were being written as
//    anyway, and a Persian run — its own spaces included — is wrapped in one
//    automatically before KaTeX sees it (persianTextRuns, below), so a
//    Persian phrase still reads as a phrase. What it cost: "$x y$" was set
//    wider than TeX sets it, and every
//    rule about where a line may break had to reason about an invisible
//    marker in the middle of the formula.
//    Spaces inside a text command (\text, \textbf, …) ARE break points —
//    otherwise "\text{is continuous on the interval}" is one unbreakable
//    unit and overflows the screen. The command is closed and reopened
//    around each word, so the space between those words is an ordinary
//    break, and the space goes at the break. Spaces inside other braces are
//    not break points; + and − never are.
//
// 2. Line breaking. The formula is split at its top-level break points,
//    preferred in this order: the writer's own line ends, then commas, then
//    relations (=, ≡, ≈, ≤, arrows, ∴ ...), then the word spaces lifted out
//    of a text command.
//    Commas stay at the end of the line they break; a line that ends at a
//    relation repeats it on the next line ("a = b =" / "= c"), the usual
//    convention for continued relations. Never at + or −, and never inside
//    braces, \left…\right or environments. Each piece is rendered as an
//    unbreakable unit; the actual line choice happens in layoutMath()
//    (src/mathLayout.ts), once the units can be measured: display math is
//    balanced (fewest lines, then preferred break points, then the most even
//    line widths); inline math wraps with the paragraph.
import katex from 'katex';

const LATIN = /[A-Za-z]/;
// A digit in any of the three sets a note may be written in.
const DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9]/;
// A letter in any script — a variable the writer typed as α or с, not \alpha.
const LETTERISH = /\p{L}/u;

// The one space a formula still carries: the gap between two words lifted out
// of a \text{…}, marked with this character while the formula is split and
// written back as "\ " in the piece that keeps it.
const SPACE = '\u0001';

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
  // A Persian phrase is one run of words in the reading order: handing the
  // browser its words as separate boxes would lay them out left to right
  // (\text{سلام دنیا} read backwards). The phrase stays in one atom, and the
  // bidi algorithm inside it reads it right to left.
  if (PERSIAN_LETTER.test(inner)) return `\\${name}{${inner}}`;
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
    else if (c === ' ' && depth === 0 && i > start) {
      // A run of spaces between two words. The space that opens or closes the
      // command ("\text{If }") belongs to the word it is written against —
      // it is the gap before the formula that follows, not a break point.
      let end = i;
      while (lifted[end] === ' ') end += 1;
      if (end >= lifted.length) break;
      parts.push(lifted.slice(start, i));
      start = end;
      i = end - 1;
    }
  }
  parts.push(lifted.slice(start));
  if (parts.length < 2 || parts.some((part) => !part.length)) return `\\${name}{${inner}}`;
  return parts.map((part) => `\\${name}{${part}}`).join(SPACE);
}

// Operators a line may break after, once there is nothing better left. The
// ones that are a single character (+ and -) are read in the loop below.
const OPERATORS = new Set([
  'pm', 'mp', 'cdot', 'cdotp', 'times', 'div', 'ast', 'star', 'circ', 'bullet',
  'oplus', 'ominus', 'otimes', 'oslash', 'odot',
  'cup', 'cap', 'sqcup', 'sqcap', 'uplus', 'setminus', 'smallsetminus',
  'wedge', 'vee', 'land', 'lor', 'amalg', 'dotplus', 'boxplus', 'boxtimes',
]);

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
// between words lifted out of a text command, and last the sum's own
// operators — + − · × and the like. The comma stays at the end of the line it
// breaks; so does the operator, which is how TeX itself breaks a long sum,
// and unlike a relation it is not repeated on the next line (a repeated "+"
// would read as a different sum). A sign that is not between two operands
// (the minus of "= -p", the plus of "(+3)") is not an operator at all.
//
// A plain ( ) / [ ] group — and the visible braces \{ \} — is a step behind
// all of those (BREAK_INSIDE is added to its break points' priority): a group
// that fits is never broken, and a group too wide for the line can still
// break inside itself at its own comma, relation, space or operator instead
// of at whatever atom the browser would otherwise split it at.
//
// A \left … \right group is a step behind that again, and it is the last
// place a line is ever cut. Each piece has to be TeX that renders on its
// own, so the halves of the delimiter cannot simply be parted: the line is
// closed with \right. and the next one opened with \left. — TeX's own way of
// writing half a delimited group, invisible on both sides. One pair per
// delimiter still open, so a cut two deep closes and reopens twice. A vector
// written as \left( x, y, z \right) is the shape this exists for: without it
// the whole tuple is one atom, and a tuple that does not fit is handed to the
// browser to break wherever it likes.
//
// Braces and environments never break: \frac{a}{b} has no halves, and the
// alignment of \begin{align} is the writer's own layout.
interface Cut { prio: number; rel: string; op: string; comma: string; prefix: string; close: string; open: string }
const newCut = (prio: number, fields: Partial<Cut> = {}): Cut =>
  ({ prio, rel: '', op: '', comma: '', prefix: '', close: '', open: '', ...fields });
function mergeCuts(a: Cut, b: Cut): Cut {
  return newCut(Math.min(a.prio, b.prio), {
    rel: [a.rel, b.rel].filter(Boolean).join(' '),
    op: a.op || b.op,
    comma: a.comma + b.comma, // "x,,y" is two commas, and stays two
    prefix: a.prefix || b.prefix,
    // Both cuts are at the same place, so the delimiters open at that place
    // are the same for both.
    close: a.close || b.close,
    open: a.open || b.open,
  });
}
function cutAfter(cut: Cut | null): string {
  if (!cut) return '';
  // The empty group keeps the sign binary: "a +" on its own would be set as
  // a sign in front of nothing, with the space around it gone.
  const tail = cut.rel ? ` ${cut.rel} {}` : cut.op ? ` ${cut.op} {}` : '';
  return `${tail}${cut.comma}`;
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
  const LAST = 5; // every top-level break point stays ahead of a break inside a group
  let delims = 0; // \left … \right still open here
  // Is the sign at `at` between two operands, or in front of one? Only the
  // first is an operator a line may break after.
  const binary = (at: number): boolean => {
    let k = at - 1;
    while (k >= 0 && (tex[k] === ' ' || tex[k] === SPACE)) k -= 1;
    const before = tex[k] ?? '';
    if (!before) return false;
    if (LATIN.test(before)) {
      // The tail of a command name: an operand (\alpha, \pi) or not (\to, \pm).
      let start = k;
      while (start >= 0 && LATIN.test(tex[start])) start -= 1;
      if (tex[start] === '\\') {
        const name = tex.slice(start + 1, k + 1);
        return !RELATIONS.has(name) && !OPERATORS.has(name) && !EXT_ARROWS.has(name) && name !== 'left';
      }
      return true;
    }
    // A sign that is a script of its own: R^+ \times R^- is a product.
    if ((before === '+' || before === '-') && (tex[k - 1] === '^' || tex[k - 1] === '_')) return true;
    // Any letter (α, с, س), a digit in any script, a closing bracket, a
    // prime, a factorial: the end of an operand.
    return LETTERISH.test(before) || DIGIT.test(before) || /[)\]}|!'’]/.test(before);
  };
  let depth = 0; // braces, \left…\right and environments: never a break inside
  let plain = 0; // plain ( ) [ ] (and \{ \}): a break inside is the last resort
  let i = 0;
  while (i < tex.length) {
    const c = tex[i];
    // 0 = top level, 1 = inside a plain group, 2 = inside \left … \right
    // (each shifted a whole class of break points behind), -1 = no break.
    const level = depth > 0 ? -1 : delims > 0 ? 2 : plain > 0 ? 1 : 0;
    const prio = (value: number): number => value + level * LAST;
    // A cut inside \left … \right closes every delimiter still open and the
    // next line reopens them, so that both halves are TeX in their own right.
    const parted = (): Partial<Cut> => (delims > 0
      ? { close: '\\right.'.repeat(delims), open: '\\left.'.repeat(delims) }
      : {});
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
      if (name === 'left') { delims += 1; i = skipDelimiter(tex, k); continue; }
      if (name === 'right') { if (delims > 0) delims -= 1; i = skipDelimiter(tex, k); continue; }
      if (name === 'begin') { depth += 1; i = skipGroup(tex, skipSpaces(tex, k), '{', '}'); continue; }
      if (name === 'end') { depth -= 1; i = skipGroup(tex, skipSpaces(tex, k), '{', '}'); continue; }
      if (level >= 0 && name === 'not') {
        // \not= , \not\equiv ...
        let end = skipSpaces(tex, k);
        if (tex[end] === '\\') { end += 1; while (LATIN.test(tex[end] ?? '')) end += 1; } else end += 1;
        cut(i, end, newCut(prio(2), { rel: tex.slice(i, end), ...parted() }));
        i = end;
        continue;
      }
      if (level >= 0 && EXT_ARROWS.has(name)) {
        let end = skipGroup(tex, skipSpaces(tex, k), '[', ']');
        end = skipGroup(tex, skipSpaces(tex, end), '{', '}');
        cut(i, end, newCut(prio(2), { rel: tex.slice(i, end), ...parted() }));
        i = end;
        continue;
      }
      if (level >= 0 && RELATIONS.has(name)) {
        cut(i, k, newCut(prio(2), { rel: tex.slice(i, k), ...parted() }));
        i = k;
        continue;
      }
      if (level >= 0 && (name === 'quad' || name === 'qquad')) {
        // A written gap is the writer separating two things on one line —
        // the best place to put the line end they did not have room for.
        // It stays at the end of its line and is not repeated on the next.
        cut(i, k, newCut(prio(3), { op: tex.slice(i, k), ...parted() }));
        i = k;
        continue;
      }
      if (level >= 0 && OPERATORS.has(name) && binary(i)) {
        cut(i, k, newCut(prio(4), { op: tex.slice(i, k), ...parted() }));
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
      cut(i, i + 1, newCut(prio(0), parted())); // the writer's own line end, preferred
      i += 1;
      continue;
    }
    if (c === SPACE && level >= 0) {
      // Always a break: the only spaces left are the ones lifted out of a
      // \text{…}, and a Persian phrase is never lifted in the first place
      // (liftTextCommand — its words would be laid out left to right).
      cut(i, i + 1, newCut(prio(3), { prefix: '\\ ', ...parted() }));
      i += 1;
      continue;
    }
    if ((c === ',' || c === '\u060C') && level >= 0) {
      // Between two digits a comma is a decimal mark or a thousands
      // separator — half the world writes 1,5 for one and a half — and a
      // number is never cut in two. (The Persian marks ٫ and ٬ are not
      // commas at all and are not break points anywhere.)
      if (DIGIT.test(tex[i - 1] ?? '') && DIGIT.test(tex[i + 1] ?? '')) { i += 1; continue; }
      cut(i, i + 1, newCut(prio(1), { comma: c, ...parted() })); // written back as typed
      i += 1;
      continue;
    }
    if (level >= 0 && c === ':' && tex[i + 1] === '=') {
      cut(i, i + 2, newCut(prio(2), { rel: ':=', ...parted() }));
      i += 2;
      continue;
    }
    if (level >= 0 && (c === '=' || c === '<' || c === '>')) {
      cut(i, i + 1, newCut(prio(2), { rel: c, ...parted() }));
      i += 1;
      continue;
    }
    if (level >= 0 && (c === '+' || c === '-') && binary(i)) {
      cut(i, i + 1, newCut(prio(4), { op: c, ...parted() }));
      i += 1;
      continue;
    }
    i += 1;
  }
  const last = tex.slice(termStart);
  if (!last.trim() && cuts.length) {
    // Trailing break point ("a = b ="): glue it back onto the last term.
    const trailing = cuts.pop()!;
    const glued = (trailing.rel ? ` ${trailing.rel}` : trailing.op ? ` ${trailing.op}` : '') + trailing.comma;
    terms[terms.length - 1] += glued;
    return terms.length > 1 ? { terms, cuts } : null;
  }
  if (last) terms.push(last);
  return terms.length > 1 ? { terms, cuts } : null;
}

// A Persian word inside a formula is Persian, not a sequence of maths
// variables: left to itself KaTeX lays the letters out left to right as
// separate italics, which is unreadable. Every Persian run outside a text
// command is therefore wrapped in `\text{…}` — upright, and read right to
// left by the `.katex .text` rule in the stylesheet — while the formula around
// it stays left to right (23). Runs already inside `\text{}` (or another text
// command) are left alone; `\ ` is the marker for a space the writer typed,
// which is a plain space again inside text mode.
const PERSIAN_CHAR = '[\\u0620-\\u065F\\u0670\\u0671-\\u06D3\\u06D5\\u06D6-\\u06ED\\u06EE-\\u06EF\\u06FA-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF\\u200C\\u200D]';
// A run is a letter, more letters, and the spaces between them: it must start
// and end with a letter, so the space that follows the phrase (the gap before
// the formula goes on) is left outside it. The spaces inside the run survive
// because the run becomes a \text{…}, where a space is a space — a Persian
// phrase is prose, and prose is the one place a formula keeps its spaces.
/** One Persian (or Arabic-script) character. */
const PERSIAN_LETTER = new RegExp(PERSIAN_CHAR);
const PERSIAN_RUN = new RegExp(`${PERSIAN_CHAR}(?:${PERSIAN_CHAR}| |\\\\ )*${PERSIAN_CHAR}|${PERSIAN_CHAR}`, 'g');
const TEXT_COMMAND = /\\(?:text|mbox|hbox|textnormal|textrm|textsf|texttt|operatorname|textsuperscript|textsubscript)\b\s*\{/g;

/** [from, to) of every group argument of a text command in `tex`. */
function textRanges(tex: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  TEXT_COMMAND.lastIndex = 0;
  for (let match = TEXT_COMMAND.exec(tex); match; match = TEXT_COMMAND.exec(tex)) {
    const open = match.index + match[0].length - 1;
    let depth = 1;
    for (let at = open + 1; at < tex.length; at += 1) {
      if (tex[at] === '\\') { at += 1; continue; }
      if (tex[at] === '{') depth += 1;
      else if (tex[at] === '}') {
        depth -= 1;
        if (!depth) { ranges.push([open + 1, at]); break; }
      }
    }
  }
  return ranges;
}

function persianTextRuns(tex: string): string {
  if (!PERSIAN_RUN.test(tex)) return tex;
  PERSIAN_RUN.lastIndex = 0;
  const inside = textRanges(tex);
  const isText = (at: number): boolean => inside.some(([from, to]) => at >= from && at < to);
  return tex.replace(PERSIAN_RUN, (run: string, offset: number) =>
    isText(offset) ? run : `\\text{${run.replace(/\\ /g, ' ')}}`);
}

const render = (tex: string, displayMode = false): string =>
  katex.renderToString(persianTextRuns(tex), { displayMode, throwOnError: false });

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

/** What KaTeX makes of a formula, for the editor to mark: the message
 *  render() swallows — it runs with `throwOnError: false`, which is why a
 *  typo is otherwise a silent red formula in the reading view and in the PDF
 *  (PLAN.md's lint criterion 7) — or null when the formula is sound. The
 *  preparation is render()'s own, digits, spaces and Persian runs included,
 *  so the editor can never disagree with what the reading view will draw. */
// KaTeX writes for someone debugging TeX: "Unexpected end of input in a
// macro argument, expected '}' at end of input: \frac". The gray above the
// pill (src/main.ts) has one line to say it in, beside a formula the writer
// is already looking at, and the colour has already said WHERE. So every
// shape KaTeX actually produces is said in the fewest words that still name
// the thing to go and fix. Anything not listed passes through in KaTeX's
// own words rather than being guessed at.
function plainly(message: string): string {
  // "… at end of input: \frac{1}" is the text KaTeX had read when it ran
  // out; the last command in it is the one still waiting for something.
  const read = /\bat end of input:\s*(.*)$/.exec(message)?.[1] ?? '';
  const names = read.match(/\\[A-Za-z]+/g);
  const last = names ? names[names.length - 1] : null;
  const said = message.replace(/\s*\bat end of input:.*$/, '').trim();
  let m: RegExpExecArray | null;
  if ((m = /^Undefined control sequence:\s*(\S+)/.exec(said))) return `${m[1]} is not a command`;
  if ((m = /^No such environment:\s*(\S+)/.exec(said))) return `There is no ${m[1]} environment`;
  if ((m = /^Unexpected end of input in a macro argument, expected '(.)'/.exec(said))) {
    const want = m[1] === ']' ? '[…]' : '{…}';
    return last ? `${last} is missing its ${want}` : `A ${want} is never closed`;
  }
  if (/^Expected & or/.test(said)) return 'This \\begin has no \\end';
  if (/^Expected '\\right'/.test(said)) return '\\left has no \\right';
  if ((m = /^Expected '(.+?)', got '(.+?)'/.exec(said))) {
    const want = m[1];
    const got = m[2];
    if (got === 'EOF') return want === '}' ? 'A { is never closed' : `${want} is missing`;
    if (got === '}') return 'One } too many';
    if (got === '\\end') return '\\end without \\begin';
    if (got === '\\right') return '\\right without \\left';
    if (want === 'EOF') return `${got} does not belong here`;
    return `${want} was expected, not ${got}`;
  }
  if ((m = /^Expected group after '(.)'/.exec(said))) return `Nothing after ${m[1]}`;
  if (/^Double superscript/.test(said)) return 'Two ^ on one thing';
  if (/^Double subscript/.test(said)) return 'Two _ on one thing';
  if ((m = /^Mismatch: (\S+) matched by (\S+)/.exec(said))) return `${m[1]} ends with ${m[2]}`;
  if ((m = /^Can't use function '(.+?)' in math mode/.exec(said))) return `${m[1]} does not belong in a formula`;
  if ((m = /^Unexpected character: '(.+?)'/.exec(said))) return `${m[1]} does not belong here`;
  if (/^Limit controls must follow/.test(said)) return '\\limits must follow an operator';
  return said;
}

export function mathError(raw: string, display: boolean): string | null {
  if (!raw.trim()) return null;
  const tex = mapDigits(raw).trim();
  try {
    katex.renderToString(persianTextRuns(tex), { displayMode: display, throwOnError: true });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // KaTeX says "KaTeX parse error: Undefined control sequence: \fracc at
    // position 1: …" — the reader needs the complaint, not the prefix, and
    // not the caret diagram it draws with the source it was given.
    return plainly(message.replace(/^KaTeX\s+(parse|auto-render)\s+error:\s*/i, '').split(' at position ')[0].trim());
  }
}

/** The same verdict, plus where in the formula KaTeX gave up, so the editor
 *  can paint that piece rather than the whole thing.
 *
 *  Two questions, because they are about two different texts. WHETHER a
 *  formula is broken has to be asked about the text the reading view will be
 *  given — digits mapped, spaces marked, Persian runs wrapped — or the
 *  editor could disagree with the page. WHERE it broke has to be in the
 *  writer's own characters, and that preparation moves them (one space can
 *  become "\ "), so the position is read from a second parse of the raw
 *  text. It costs a tenth of a millisecond and only runs when something is
 *  already wrong. If the raw text parses where the prepared one did not, the
 *  blame has nowhere to land and `from` stays -1. */
export type MathFault = { message: string; from: number; to: number };
export function mathFault(raw: string, display: boolean): MathFault | null {
  const message = mathError(raw, display);
  if (message === null) return null;
  let from = -1;
  let to = -1;
  try {
    // __parse is KaTeX's own entry point for "read this, don't draw it";
    // the published types stop at render/renderToString.
    (katex as unknown as { __parse: (tex: string, options: object) => unknown })
      .__parse(raw, { displayMode: display, throwOnError: true });
  } catch (error) {
    const spot = error as { position?: number; length?: number };
    if (typeof spot.position === 'number' && spot.position >= 0) {
      from = spot.position;
      to = from + (typeof spot.length === 'number' ? spot.length : 0);
    }
  }
  return { message, from, to };
}

export function renderMath(raw: string, display: boolean): string {
  // Empty display math is still a blank display line, not zero-height KaTeX.
  if (display && !raw.trim()) return '<div class="math-display"><br></div>';
  const tex = mapDigits(raw).trim();
  const marked = tex;
  const styleMatch = STYLE_PREFIX.exec(tex);
  const style = (display ? '\\displaystyle ' : '') + (styleMatch ? styleMatch[0] : '');
  const body = styleMatch ? marked.slice(styleMatch[0].length) : marked;
  // Manual line breaks and alignment are the writer's own layout, and
  // splitCuts leaves such a formula alone — but only when the \\ or the & is
  // the formula's own. One inside \begin{vmatrix} … \end{vmatrix} belongs to
  // that matrix, and used to freeze the whole line around it: "\det A =
  // \begin{vmatrix}…\end{vmatrix} = 12" could not break at either = sign.
  const split = splitCuts(body);
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
    // A piece reopens what the cut before it closed, and closes what the cut
    // after it will reopen: \left. … \right. is a whole formula to KaTeX.
    const after = `${cutAfter(piece.after)}${piece.after?.close ?? ''}`;
    const reopen = piece.before?.open ?? '';
    const plain = render(`${style}${reopen}${piece.before?.prefix ?? ''}${piece.tex}${after}`);
    if (index === 0) return `<span class="math-unit" data-first><span class="math-plain">${plain}</span></span>`;
    const lead = cutCont(piece.before);
    // An operator break repeats nothing, so both forms are the same TeX.
    const cont = lead || piece.before?.prefix
      ? render(`${style}${reopen}${lead}${piece.tex}${after}`)
      : plain;
    return `<span class="math-unit" data-break="${piece.before!.prio}"><span class="math-plain">${plain}</span><span class="math-cont">${cont}</span></span>`;
  });
  const flow = `<span class="math-flow${display ? ' is-display' : ''}" data-units="${units.length}">${units.join('<wbr>')}</span>`;
  return display ? `<div class="math-display">${flow}</div>` : flow;
}
