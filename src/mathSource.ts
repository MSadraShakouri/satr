// Math in the editor source: $inline$ and $$ blocks $$. Nothing is rendered
// while editing (that's what preview is for); the source is marked so it
// reads left-to-right inside RTL text, with the dollar signs faint, and
// editor.ts switches the on-screen keyboard to its no-suggestions mode while
// the caret is inside. Typing "$" pairs up the way Obsidian does.
//
// Where math starts and ends is src/mathScan.ts — the same policy the reading
// view uses. Only the things between the dollar signs are monospace: the
// dollars keep the accent colour in the note's own font, and a line holding
// only "$$" never turns monospace. A lone unpaired "$$", "$$$$" / "$$ $$" with
// nothing between, and a pair a heading or a list broke are plain text, so
// their dollars are not coloured and nothing inside them is styled as math.
import { scanMath, spansHold, spansOverlap, closingDelimiterEnd, inCodeAt, type MathSpan } from './mathScan';
import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { mathFault } from './math';

/** Every math span of the document, cached until the text changes. The
 * preview's renderMarkdown() computes the same spans from the same source. */
export const mathSpans = StateField.define<MathSpan[]>({
  create: (state) => scanMath(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? scanMath(tr.newDoc.toString()) : value),
});

export function inMath(state: EditorState, pos: number): boolean {
  return spansHold(state.field(mathSpans, false) ?? [], pos);
}

export function overlapsMath(state: EditorState, from: number, to: number): boolean {
  return spansOverlap(state.field(mathSpans, false) ?? [], from, to);
}

export function inCode(state: EditorState, pos: number): boolean {
  return inCodeAt(state, pos);
}

const mathText = Decoration.mark({ class: 'cm-math' });
const mathDelim = Decoration.mark({ class: 'cm-math-delim' });
const mathDelimWrong = Decoration.mark({ class: 'cm-math-delim cm-math-delim-wrong' });

// ---- What the formula is made of ----
// A code fence is colourful because a language has many KINDS of word:
// keywords, strings, numbers, comments, types, functions. Run CodeMirror's
// `stex` over a formula — which is what Obsidian does — and almost
// everything comes back as one kind, "tag": \frac, \alpha, \sum, _ and ^ are
// all the same red, `+` and `=` get no colour at all, and the formula ends
// up two hues and some grey. That is the whole of Obsidian's math colouring
// too, so matching it exactly was always going to look thin next to the
// fence sitting above it.
//
// LaTeX does have the kinds; they are just not in the token name, they are
// in which command it is. So the formula is read here, and a backslash word
// is placed in one of three families:
//
//   structure   \begin \end \left \right \big \displaystyle   --code-keyword
//   functions   \frac \sqrt \sum \int \lim \text \mathbb      --code-function
//   symbols     \alpha \infty \to \leq \cdot \partial         --code-important
//
// ...and the rest of the formula gets the same palette the reading view
// gives code, with the names Obsidian uses for them:
//
//   numbers     1  3.14  ۴۲          --code-value
//   variables   x  y  n              --code-property
//   _ ^ & \\                         --code-tag
//   + - = < > | '                    --code-operator
//   { } [ ] ( ) , ;                  --code-punctuation
//   % to end of line                 --code-comment
//   what is inside \text{…}, and the environment name in \begin{…}
//                                    --code-string
//
// Seven hues in a formula where there were two. This is deliberately denser
// than Obsidian: Obsidian's own source math is the sparse version, and the
// ask was for the fence's density, not for Obsidian's.
const STRUCTURE = new Set(('begin end left right middle over atop choose above brace brack'
  + ' big Big bigg Bigg bigl Bigl biggl Biggl bigr Bigr biggr Biggr bigm Bigm biggm Biggm'
  + ' displaystyle textstyle scriptstyle scriptscriptstyle limits nolimits substack'
  + ' hline hdashline cline newline cr noalign').split(' '));
const FUNCTIONS = new Set(('frac dfrac tfrac cfrac genfrac binom dbinom tbinom brace brack'
  + ' sqrt root overline underline overbrace underbrace overset underset stackrel'
  + ' hat widehat tilde widetilde bar vec overrightarrow overleftarrow dot ddot acute grave'
  + ' breve check mathring boxed fbox colorbox fcolorbox color textcolor phantom hphantom vphantom'
  + ' mathbb mathbf mathcal mathfrak mathrm mathit mathsf mathtt mathnormal boldsymbol bm pmb'
  + ' text textbf textit textrm texttt textsf textnormal operatorname tag label href htmlClass'
  + ' sum prod coprod int iint iiint iiiint oint oiint bigcup bigcap bigvee bigwedge bigoplus'
  + ' bigotimes bigodot biguplus bigsqcup lim limsup liminf max min sup inf arg det gcd deg dim'
  + ' hom ker Pr exp log ln lg sin cos tan cot sec csc sinh cosh tanh coth arcsin arccos arctan'
  + ' sgn mod bmod pmod pod').split(' '));
/** Commands whose first {…} is words or a name, not a formula: it reads as a
 *  string, the way a fence's quoted text does. \begin{matrix} is the same
 *  shape — the environment is named, not computed. */
const TEXTISH = new Set(('begin end text textbf textit textrm texttt textsf textnormal mathrm'
  + ' operatorname tag label color textcolor href htmlClass htmlId').split(' '));

const TOKEN = 'cm-math-token ';
const KEYWORD = 'cm-math-keyword';
const FUNCTION = 'cm-math-function';
const SYMBOL = 'cm-math-symbol';
const STRING = 'cm-math-string';
const NUMBER = 'cm-math-number';
const NAME = 'cm-math-name';
const SCRIPT = 'cm-math-script';
const OPERATOR = 'cm-math-operator';
const BRACE = 'cm-math-brace';
const PUNCT = 'cm-math-punct';
const COMMENT = 'cm-math-comment';
/** The part KaTeX blames, painted in the error colour INSTEAD of its own —
 *  not on top of it: two marks over one range leave it to the browser which
 *  span ends up inside, and the inner one wins whatever the stylesheet says. */
const WRONG = 'cm-math-wrong';

// Persian and Arabic-Indic digits count as digits: the formula may be
// written in either (src/math.ts maps them for KaTeX).
const DIGIT = /[0-9\u06f0-\u06f9\u0660-\u0669]/;
const LATIN = /[A-Za-z]/;
const OPERATORS = new Set(['+', '-', '=', '<', '>', '*', '/', '|', "'", '~', ':',
  '\u00b1', '\u00d7', '\u00f7', '\u2260', '\u2264', '\u2265', '\u2192', '\u2190']);
const PUNCTUATION = new Set(['{', '}', '[', ']', '(', ')', ',', ';', '.', '!', '?']);

type Token = [number, number, string];

/** The `}` that closes the `{` at `open`, or -1 while it is still being
 *  written. An escaped brace closes nothing. */
function braceEnd(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

function latexTokens(text: string): Token[] {
  const out: Token[] = [];
  const push = (from: number, to: number, cls: string): void => { if (to > from) out.push([from, to, cls]); };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // A comment runs to the end of its line, and takes the line break with
    // it the way TeX does.
    if (ch === '%') {
      const stop = text.indexOf('\n', i);
      const end = stop < 0 ? text.length : stop;
      push(i, end, COMMENT);
      i = end;
      continue;
    }
    if (ch === '\\') {
      const name = /^[A-Za-z]+/.exec(text.slice(i + 1))?.[0] ?? '';
      if (!name) {
        // \\ ends a row; \, \; \! \{ \% are one escaped character.
        const next = text[i + 1] ?? '';
        push(i, i + 2, next === '\\' ? SCRIPT : PUNCT);
        i += 2;
        continue;
      }
      const end = i + 1 + name.length;
      push(i, end, STRUCTURE.has(name) ? KEYWORD : FUNCTIONS.has(name) ? FUNCTION : SYMBOL);
      i = end;
      if (TEXTISH.has(name)) {
        let at = i;
        while (text[at] === ' ') at += 1;
        if (text[at] === '{') {
          const close = braceEnd(text, at);
          push(at, at + 1, BRACE);
          push(at + 1, close < 0 ? text.length : close, STRING);
          if (close < 0) return out; // still being written: the rest is its word
          push(close, close + 1, BRACE);
          i = close + 1;
        }
      }
      continue;
    }
    if (ch === '_' || ch === '^' || ch === '&') { push(i, i + 1, SCRIPT); i += 1; continue; }
    if (DIGIT.test(ch)) {
      let j = i;
      // 3.14 and 1,000 are one number; a comma that ends a number is not.
      while (j < text.length
        && (DIGIT.test(text[j]) || ((text[j] === '.' || text[j] === ',') && DIGIT.test(text[j + 1] ?? '')))) j += 1;
      push(i, j, NUMBER);
      i = j;
      continue;
    }
    if (LATIN.test(ch)) {
      let j = i;
      while (j < text.length && LATIN.test(text[j])) j += 1;
      push(i, j, NAME);
      i = j;
      continue;
    }
    if (PUNCTUATION.has(ch)) { push(i, i + 1, ch === ',' || ch === ';' || ch === '.' || ch === '!' || ch === '?' ? PUNCT : BRACE); i += 1; continue; }
    if (OPERATORS.has(ch)) { push(i, i + 1, OPERATOR); i += 1; continue; }
    i += 1; // spaces, and anything else, keep the formula's own colour
  }
  return out;
}

const tokenMarks = new Map<string, Decoration>();
function tokenMark(cls: string): Decoration {
  let deco = tokenMarks.get(cls);
  if (!deco) {
    deco = Decoration.mark({ class: TOKEN + cls });
    tokenMarks.set(cls, deco);
  }
  return deco;
}
/** One formula's tokens as [from, to, class] offsets from its own start,
 *  kept until its text changes: a redraw, a scroll or a caret moving must
 *  not read anything again. */
const tokenCache = new Map<string, Token[]>();
/** Long enough for any formula a note holds; past it the colouring is not
 *  worth the pass (and a pasted blob is not being read anyway). */
const MAX_TOKENISED = 4000;
function mathTokens(text: string): Token[] {
  const hit = tokenCache.get(text);
  if (hit) return hit;
  const out = text.length <= MAX_TOKENISED ? latexTokens(text) : [];
  if (tokenCache.size > 400) tokenCache.clear();
  tokenCache.set(text, out);
  return out;
}

// ---- Whether KaTeX can read it ----
// renderMath() renders with `throwOnError: false`, so a typo is a red
// formula in the reading view and in the PDF, and nothing says so while it
// is being written. mathFault() is KaTeX's own verdict on the same text the
// reading view will be given, plus where in the formula it gave up. KaTeX is
// in the app's first load either way (the reading view and the PDF both want
// it), and a verdict on a 90-character formula costs a tenth of a
// millisecond — so this runs on every keystroke, with no pause to wait
// through. Each answer is still kept until that formula's text changes, and
// only what is on screen is ever asked about, so a note full of formulas
// costs one parse per keystroke, not one per formula.
type Fault = { message: string; from: number; to: number };
const verdicts = new Map<string, Fault | null>();
function verdict(text: string, display: boolean): Fault | null {
  const key = `${display ? 'd' : 'i'}${text}`;
  const known = verdicts.get(key);
  if (known !== undefined) return known;
  const answer = mathFault(text, display);
  if (verdicts.size > 400) verdicts.clear();
  verdicts.set(key, answer);
  return answer;
}
const errorMarks = new Map<string, Decoration>();
function errorMark(message: string): Decoration {
  let deco = errorMarks.get(message);
  if (!deco) {
    // Colour, not a squiggle: a red underline reads as a spelling mistake,
    // and this is not prose. The formula keeps a faint red behind it — the
    // colour KaTeX will paint it in the reading view and in the PDF — its
    // dollars turn that red, and the piece KaTeX actually choked on is
    // painted red instead of its own colour. What it does NOT do any more is
    // take the whole formula red: that threw away the colouring the formula
    // had just been given, and said "something here is wrong" where it can
    // say "this". The reason rides in the title.
    deco = Decoration.mark({ class: 'cm-math-error', attributes: { title: message } });
    errorMarks.set(message, deco);
  }
  return deco;
}

/** Where the word under the caret starts. A backslash command is spelled out
 *  one letter at a time, and \a, \al, \alp are all undefined control
 *  sequences on the way to \alpha — so a complaint that begins inside the
 *  word being written waits for the word to end, and nothing else waits for
 *  anything. Typing the `{` after it is enough; so is a space, a digit, or
 *  moving the caret away. */
function writingFrom(text: string, caret: number): number {
  const word = /\\[A-Za-z]*$/.exec(text.slice(0, caret));
  return word ? word.index : caret;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const spans = state.field(mathSpans);
  for (const { from, to } of view.visibleRanges) {
    for (const span of spans) {
      if (span.to < from || span.from > to) continue;
      const open = span.from + span.delim;
      const close = span.to - span.delim;
      const text = open < close ? state.sliceDoc(open, close) : '';
      // Only the things between the dollars are monospace; an empty pair (the
      // writing line of a block being opened) has nothing between them.
      if (!text.trim()) {
        out.push(mathDelim.range(span.from, open));
        out.push(mathDelim.range(close, span.to));
        continue;
      }
      const fault = verdict(text, span.delim > 1);
      // Where the caret is inside THIS formula, if it is: the only thing
      // that holds a complaint back, and only for the word it is in.
      let caret = -1;
      for (const range of state.selection.ranges) {
        if (range.head >= open && range.head <= close) caret = range.head - open;
      }
      const writing = caret >= 0 && (fault === null || fault.from < 0 || fault.from >= writingFrom(text, caret));
      const wrong = fault !== null && !(caret >= 0 && writing);
      out.push((wrong ? mathDelimWrong : mathDelim).range(span.from, open));
      if (wrong) out.push(errorMark(fault.message).range(open, close));
      out.push(mathText.range(open, close));
      // The blamed range in the formula's own coordinates, clamped: KaTeX
      // points past the end for "unexpected end of input", and there is
      // nothing there to paint.
      const blameFrom = wrong && fault !== null && fault.from >= 0 ? Math.min(fault.from, text.length) : -1;
      const blameTo = blameFrom < 0 || fault === null ? -1 : Math.min(Math.max(fault.to, blameFrom), text.length);
      let blamed = false;
      for (const [tokenFrom, tokenTo, cls] of mathTokens(text)) {
        const hit = blameFrom >= 0 && tokenFrom < blameTo && tokenTo > blameFrom;
        blamed = blamed || hit;
        out.push(tokenMark(hit ? WRONG : cls).range(open + tokenFrom, open + tokenTo));
      }
      if (blameFrom >= 0 && blameTo > blameFrom && !blamed) {
        out.push(tokenMark(WRONG).range(open + blameFrom, open + blameTo));
      }
      out.push((wrong ? mathDelimWrong : mathDelim).range(close, span.to));
    }
  }
  // Sorted by where a mark starts, and the widest of those first: a token
  // sits inside the formula's own mark, and CodeMirror wants the outer one
  // handed to it before the inner.
  return Decoration.set(out.sort((a, b) => a.from - b.from || b.to - a.to), true);
}

const mathDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view); }
  update(update: ViewUpdate): void {
    // A selection change counts: the caret leaving the word it was writing
    // is what lets that word's complaint through, and it is the only thing
    // the caret still decides.
    const moved = update.selectionSet && update.state.field(mathSpans).length > 0;
    if (update.docChanged || update.viewportChanged || moved) this.decorations = build(update.view);
  }
}, { decorations: (value) => value.decorations });

export const mathSource = [mathSpans, mathDecorations];

export function closingMathDelimiter(state: EditorState, pos: number): number {
  return closingDelimiterEnd(state.field(mathSpans, false) ?? [], pos);
}
