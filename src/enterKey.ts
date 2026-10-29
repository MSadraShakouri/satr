import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { isCodeDocument } from './direction';
import { inMath } from './mathSource';

// What a new line starts with.
//
// Two rules, and between them they answer every line in the app. A line of
// code is repeated exactly: its indentation is the writer's own text, so a tab
// stays a tab and four spaces stay four. A line of prose repeats its markup —
// the quote it is written inside, the item it belongs to — unless the line
// holds nothing but that markup, and then one level of it comes off instead.
//
// Measured against Obsidian 1.14.4 (newlineAndIndentContinueMarkdownList and
// newlineAndIndentOnly in app.js, which route on the same question: is this
// line code?). The two rules below are where Satr used to differ from it —
// a fenced block inside a quote lost its `> ` and broke in half, a tab became
// two spaces, and indentation could only be escaped with Backspace.

/** The run a new line repeats in a note: the line's indentation and the quote
 *  markers it is written inside. */
const LEAD_IN_NOTE = /^[ \t]*(?:>[ \t]*)*/;
/** In a code file there is no markup. A line opening with `>` is the writer's
 *  own code — a shell redirect, a doctest prompt — so only space is repeated. */
const LEAD_IN_CODE = /^[ \t]*/;
/** A line that is its own opening and nothing else. */
const LEAD_ONLY = /^[ \t]*(?:>[ \t]*)*$/;
/** One step of indentation: what Tab inserts (indentMore, src/editor.ts), so
 *  that Enter on a line with nothing but indentation undoes exactly one press
 *  of it — and so that an empty sub-item leaves its list one level a press
 *  (continueOnEnter, src/editor.ts). */
export const INDENT_STEP = 2;

/** Is this position code — any line of a code file, a fenced block in a note,
 *  or a display formula? An indented (four-space) block is deliberately not
 *  code here: that indentation is markup, it is what makes the block, and it
 *  is the one indentation a writer has to be able to leave. */
export function codeLineAt(state: EditorState, pos: number): boolean {
  if (isCodeDocument()) return true;
  if (inMath(state, pos)) return true;
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'FencedCode') return true;
  }
  return false;
}

/** Enter on a line of code: the next line begins exactly where this one does.
 *  Nothing is re-indented and nothing is converted — the language's own idea
 *  of where the next line belongs is not asked, because a file indented in
 *  fours was getting CodeMirror's default two, and a file indented with tabs
 *  was getting spaces. */
export function enterInCode(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (state.readOnly || !range.empty || state.selection.ranges.length !== 1) return false;
  if (!codeLineAt(state, range.head)) return false;
  const line = state.doc.lineAt(range.head);
  const lead = (isCodeDocument() ? LEAD_IN_CODE : LEAD_IN_NOTE).exec(line.text)![0];
  // The caret is inside the run itself: that is an ordinary split, and the
  // text to its right keeps the indentation it was written with.
  if (range.head < line.from + lead.length) return false;
  // Space and nothing else before the caret: the line is left empty rather
  // than holding spaces nobody typed. A quote marker is not space — dropping
  // that would cut a quoted block in half, which is the bug this fixes.
  const blank = !line.text.slice(0, range.head - line.from).trim();
  const from = blank ? line.from : range.head;
  view.dispatch({
    changes: { from, to: range.head, insert: `\n${lead}` },
    selection: { anchor: from + 1 + lead.length },
    userEvent: 'input.enter',
    scrollIntoView: true,
  });
  return true;
}

/** Enter at the end of a line that holds nothing but its own opening — a `>`,
 *  or indentation. Repeating it is the one thing the writer cannot have meant:
 *  the line they are on is already empty. One level comes off instead,
 *  innermost first, one press at a time — the same answer an empty list item
 *  gets (continueOnEnter, src/editor.ts), now given to the other two kinds of
 *  opening a line can have. */
export function enterEndsPrefixLine(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (state.readOnly || !range.empty || state.selection.ranges.length !== 1) return false;
  if (codeLineAt(state, range.head)) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to || !line.text || !LEAD_ONLY.test(line.text)) return false;
  const { text } = line;
  // A quote: the innermost `>` goes, and the line break still happens. A
  // blockquote ends where a line outside it begins, so a marker merely deleted
  // would leave the writer on a line the quote swallows again as soon as they
  // type (CommonMark's lazy continuation) — they would have left the quote on
  // screen and not in the file.
  const quote = /(>[ \t]?)$/.exec(text);
  if (quote) {
    const keep = text.slice(0, text.length - quote[1].length);
    const at = line.from + keep.length;
    view.dispatch({
      changes: { from: at, to: line.to, insert: `\n${keep}` },
      selection: { anchor: at + 1 + keep.length },
      userEvent: 'input.enter',
      scrollIntoView: true,
    });
    return true;
  }
  // Indentation: one step off, where it stands. No new line — there is
  // nothing to step out of, only a margin to give back, and the caret walking
  // left on its own line is how Shift-Tab reads too.
  const spaces = /[ ]*$/.exec(text)![0].length;
  const unit = text.endsWith('\t') ? 1 : Math.min(INDENT_STEP, spaces);
  if (!unit) return false;
  view.dispatch({
    changes: { from: line.to - unit, to: line.to, insert: '' },
    selection: { anchor: line.to - unit },
    userEvent: 'input.enter',
    scrollIntoView: true,
  });
  return true;
}
