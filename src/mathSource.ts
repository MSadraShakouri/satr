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
import { stex } from '@codemirror/legacy-modes/mode/stex';
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
// Obsidian runs the same `stex` mode over the text between its dollars
// (getMode(e, {name:"stex"}) in its bundle) and colours the tokens from its
// --code-* palette; this is that, in Satr's own palette — the one the
// reading view already gives code (src/style.css, .preview-pane .hljs-*).
// The monospace italic the formula already had stays underneath.
const TOKEN_CLASS: Record<string, string> = {
  tag: 'cm-math-command',       // \frac, \alpha, \text
  keyword: 'cm-math-command',
  builtin: 'cm-math-command',
  bracket: 'cm-math-brace',     // { } [ ]
  atom: 'cm-math-number',
  number: 'cm-math-number',
  string: 'cm-math-string',
  comment: 'cm-math-comment',   // % to the end of the line
  'variable-2': 'cm-math-name',
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
    const state = stex.startState?.(2) ?? {};
    let at = 0;
    for (const line of text.split('\n')) {
      if (line) {
        const stream = new StringStream(line, 4, 2);
        // A mode that returns without consuming would spin: every turn of
        // this loop must move, and the line's own length bounds it.
        for (let guard = 0; !stream.eol() && guard <= line.length; guard += 1) {
          const type = stex.token(stream, state) ?? '';
          if (stream.pos === stream.start) stream.pos += 1;
          const cls = TOKEN_CLASS[type.split(' ')[0]];
          if (cls) out.push([at + stream.start, at + stream.pos, cls]);
          stream.start = stream.pos;
        }
      } else {
        stex.blankLine?.(state, 2);
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
    deco = Decoration.mark({ class: 'cm-math-error', attributes: { title: message } });
    errorMarks.set(message, deco);
  }
  return deco;
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
      out.push(mathDelim.range(span.from, open));
      const text = open < close ? state.sliceDoc(open, close) : '';
      // Only the things between the dollars are monospace; an empty pair (the
      // writing line of a block being opened) has nothing between them.
      if (text.trim()) {
        // A formula the caret is inside is being written, and half of what is
        // written is briefly wrong: it is never marked. Everything else that
        // KaTeX cannot read is.
        const writing = state.selection.ranges.some((range) => range.to >= span.from && range.from <= span.to);
        const message = writing ? null : verdict(text, span.delim > 1);
        // Outermost, so the squiggle is drawn over the whole formula and the
        // marks inside it cannot turn the underline off.
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
  constructor(view: EditorView) { this.decorations = build(view); }
  update(update: ViewUpdate): void {
    // The caret moving into a formula takes its error mark off and moving out
    // puts it back, so a selection change counts too — but only in a note
    // that has math in it at all.
    const moved = update.selectionSet && update.state.field(mathSpans).length > 0;
    if (update.docChanged || update.viewportChanged || moved) this.decorations = build(update.view);
  }
}, { decorations: (value) => value.decorations });

export const mathSource = [mathSpans, mathDecorations];

export function closingMathDelimiter(state: EditorState, pos: number): number {
  return closingDelimiterEnd(state.field(mathSpans, false) ?? [], pos);
}
