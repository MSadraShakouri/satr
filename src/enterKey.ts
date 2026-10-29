import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { isCodeDocument } from './direction';
import { inMath } from './mathSource';

// What a new line starts with.
//
// A line of code is repeated exactly: its indentation is the writer's own
// text, so a tab stays a tab and four spaces stay four, and a fenced block
// written inside a quote keeps the quote it is written in.
//
// Measured against Obsidian 1.14.4, which routes Enter on the same question —
// is this line code? — and answers it with newlineAndIndentOnly in app.js:
// copy the line's leading run, and consult no grammar.

/** The run a new line repeats in a note: the line's indentation and the quote
 *  markers it is written inside. */
const LEAD_IN_NOTE = /^[ \t]*(?:>[ \t]*)*/;
/** In a code file there is no markup. A line opening with `>` is the writer's
 *  own code — a shell redirect, a doctest prompt — so only space is repeated. */
const LEAD_IN_CODE = /^[ \t]*/;

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
