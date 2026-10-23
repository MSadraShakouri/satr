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
// StringStream from the package the legacy modes are typed against: the
// copy @codemirror/language re-exports is the same class, but TypeScript
// counts the two declarations as different types.
import { StringStream } from '@codemirror/streamparser';
import { stexMath } from '@codemirror/legacy-modes/mode/stex';
import { mathError } from './math';

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

// ---- What the formula is made of ----
// Obsidian runs CodeMirror's `stex` mode over its math source and colours
// the tokens from its --code-* palette; this is that, token for token. The
// mode has two faces and the difference is the whole point: plain `stex` is
// the document mode, which only ever sees commands and braces, while
// `stexMath` is the one inside the dollars — it tells a subscript from a
// superscript, a variable from a number, an alignment & from a stray \\.
// Obsidian's own map, read out of its app.css:
//   .cm-tag → --code-tag          \frac, \alpha, _, ^, &
//   .cm-bracket → --code-punctuation
//   .cm-number → --code-value
//   .cm-variable-2 → --code-property
//   .cm-string → --code-string    .cm-comment → --code-comment
//   .cm-builtin → --code-function .cm-keyword → --code-keyword
//   .cm-error → --text-error
// The monospace italic the formula already had stays underneath all of it.
const TOKEN_CLASS: Record<string, string> = {
  tag: 'cm-math-command',
  bracket: 'cm-math-brace',
  number: 'cm-math-number',
  atom: 'cm-math-number',
  variableName: 'cm-math-name',
  string: 'cm-math-string',
  comment: 'cm-math-comment',
  keyword: 'cm-math-keyword',
  builtin: 'cm-math-builtin',
  operator: 'cm-math-operator',
  error: 'cm-math-wrong',
};
const tokenMarks = new Map<string, Decoration>();
function tokenMark(cls: string): Decoration {
  let deco = tokenMarks.get(cls);
  if (!deco) {
    deco = Decoration.mark({ class: `cm-math-token ${cls}` });
    tokenMarks.set(cls, deco);
  }
  return deco;
}
/** One formula's tokens as [from, to, class] offsets from its own start,
 *  kept until its text changes: a redraw, a scroll or a caret moving must
 *  not tokenise anything again. */
const tokenCache = new Map<string, [number, number, string][]>();
/** Long enough for any formula a note holds; past it the colouring is not
 *  worth the pass (and a pasted blob is not being read anyway). */
const MAX_TOKENISED = 4000;
function mathTokens(text: string): [number, number, string][] {
  const hit = tokenCache.get(text);
  if (hit) return hit;
  const out: [number, number, string][] = [];
  if (text.length <= MAX_TOKENISED) {
    const state = stexMath.startState?.(2) ?? {};
    let at = 0;
    for (const line of text.split('\n')) {
      if (line) {
        const stream = new StringStream(line, 4, 2);
        // A mode that returns without consuming would spin: every turn of
        // this loop must move, and the line's own length bounds it.
        for (let guard = 0; !stream.eol() && guard <= line.length; guard += 1) {
          const type = stexMath.token(stream, state) ?? '';
          if (stream.pos === stream.start) stream.pos += 1;
          // "variableName.special" and the like: the family decides.
          const cls = TOKEN_CLASS[type.split('.')[0].split(' ')[0]];
          if (cls) out.push([at + stream.start, at + stream.pos, cls]);
          stream.start = stream.pos;
        }
      } else {
        stexMath.blankLine?.(state, 2);
      }
      at += line.length + 1;
    }
  }
  if (tokenCache.size > 400) tokenCache.clear();
  tokenCache.set(text, out);
  return out;
}

// ---- Whether KaTeX can read it ----
// renderMath() renders with `throwOnError: false`, so a typo is a red
// formula in the reading view and in the PDF, and nothing says so while it
// is being written. mathError() is KaTeX's own verdict on the same text the
// reading view will be given. KaTeX is in the app's first load either way
// (the reading view and the PDF both want it), so asking it is a function
// call, not a download — but it is a parse, so each answer is kept until
// that formula's text changes, and only what is on screen is ever asked
// about.
const verdicts = new Map<string, string | null>();
function verdict(text: string, display: boolean): string | null {
  const key = `${display ? 'd' : 'i'}${text}`;
  const known = verdicts.get(key);
  if (known !== undefined || verdicts.has(key)) return known ?? null;
  const answer = mathError(text, display);
  if (verdicts.size > 400) verdicts.clear();
  verdicts.set(key, answer);
  return answer;
}
const errorMarks = new Map<string, Decoration>();
function errorMark(message: string): Decoration {
  let deco = errorMarks.get(message);
  if (!deco) {
    // Colour, not a squiggle: a red underline reads as a spelling mistake,
    // and this is not prose. The formula goes the colour KaTeX will paint it
    // in the reading view and in the PDF (--text-error, which is what
    // Obsidian gives .cm-error too), so the editor is showing what is about
    // to happen rather than commenting on it. The reason rides along in the
    // title for anything that can show one.
    deco = Decoration.mark({ class: 'cm-math-error', attributes: { title: message } });
    errorMarks.set(message, deco);
  }
  return deco;
}
/** How long the writing has to stop before a half-typed formula is called
 *  wrong. "Math syntax checking while typing" is the ask, but a formula is
 *  wrong for every keystroke of the time it takes to write one, so the
 *  colour waits for the writer to pause rather than following the caret. */
const TYPING_PAUSE_MS = 700;

function build(view: EditorView, typing = false): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const spans = state.field(mathSpans);
  for (const { from, to } of view.visibleRanges) {
    for (const span of spans) {
      if (span.to < from || span.from > to) continue;
      const open = span.from + span.delim;
      const close = span.to - span.delim;
      out.push(mathDelim.range(span.from, open));
      const text = open < close ? state.sliceDoc(open, close) : '';
      // Only the things between the dollars are monospace; an empty pair (the
      // writing line of a block being opened) has nothing between them.
      if (text.trim()) {
        // The formula under the caret is only judged once the writing stops:
        // half of what is being typed is wrong on the way to being right.
        // Every other formula is judged as it stands.
        const here = state.selection.ranges.some((range) => range.to >= span.from && range.from <= span.to);
        const message = here && typing ? null : verdict(text, span.delim > 1);
        if (message) out.push(errorMark(message).range(open, close));
        out.push(mathText.range(open, close));
        for (const [tokenFrom, tokenTo, cls] of mathTokens(text)) {
          out.push(tokenMark(cls).range(open + tokenFrom, open + tokenTo));
        }
      }
      out.push(mathDelim.range(close, span.to));
    }
  }
  // Sorted by where a mark starts, and the widest of those first: a token
  // sits inside the formula's own mark, and CodeMirror wants the outer one
  // handed to it before the inner.
  return Decoration.set(out.sort((a, b) => a.from - b.from || b.to - a.to), true);
}

const mathDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  /** Set while the writing is still going on, so the formula being typed is
   *  not called wrong between two keystrokes. */
  private typing = false;
  private timer = 0;
  constructor(private view: EditorView) { this.decorations = build(view); }
  update(update: ViewUpdate): void {
    const hasMath = update.state.field(mathSpans).length > 0;
    if (update.docChanged && hasMath) {
      this.typing = true;
      window.clearTimeout(this.timer);
      // The pause the colour waits for. A measure, not a transaction: the
      // writer has stopped, nothing in the document has changed, and the
      // only thing that needs re-reading is the formula they left behind.
      this.timer = window.setTimeout(() => {
        this.typing = false;
        this.decorations = build(this.view, false);
        this.view.requestMeasure();
        this.view.dispatch({});
      }, TYPING_PAUSE_MS);
    }
    // The caret moving into a formula and out of it changes which one is
    // being written, so a selection change counts too — but only in a note
    // that has math in it at all.
    const moved = update.selectionSet && hasMath;
    if (update.docChanged || update.viewportChanged || moved) this.decorations = build(update.view, this.typing);
  }
  destroy(): void { window.clearTimeout(this.timer); }
}, { decorations: (value) => value.decorations });

export const mathSource = [mathSpans, mathDecorations];

export function closingMathDelimiter(state: EditorState, pos: number): number {
  return closingDelimiterEnd(state.field(mathSpans, false) ?? [], pos);
}
