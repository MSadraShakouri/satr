// Markdown delimiters share one policy for typing and the math toolbar.
// Remember pairs per editor, not in a timer/global: only an empty pair we
// actually inserted may be deleted together. Existing $$ delimiters are text.
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, StateEffect, StateField, type EditorState, type SelectionRange } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { closingMathDelimiter, inCode, inMath } from './mathSource';

type Pair = { from: number; to: number; mark: string };
const addPair = StateEffect.define<Pair>({ map: (p, changes) => ({ ...p, from: changes.mapPos(p.from, 1), to: changes.mapPos(p.to, -1) }) });
const pairs = StateField.define<Pair[]>({
  create: () => [],
  update(value, tr) {
    const mapped = value.map((p) => ({ ...p, from: tr.changes.mapPos(p.from, 1), to: tr.changes.mapPos(p.to, -1) }))
      .filter((p) => p.to - p.from >= p.mark.length * 2
        && tr.newDoc.sliceString(p.from, p.from + p.mark.length) === p.mark
        && tr.newDoc.sliceString(p.to - p.mark.length, p.to) === p.mark);
    for (const effect of tr.effects) if (effect.is(addPair)) mapped.push(effect.value);
    return mapped;
  },
});

function escaped(state: EditorState, pos: number): boolean {
  let n = 0;
  while (pos > 0 && state.sliceDoc(--pos, pos + 1) === '\\') n += 1;
  return n % 2 === 1;
}

function closingAt(state: EditorState, pos: number, mark: string): number {
  const tracked = state.field(pairs, false)?.find((p) => p.mark[0] === mark && pos >= p.to - p.mark.length && pos < p.to);
  if (tracked) return tracked.to;
  if (mark === '$') return closingMathDelimiter(state, pos);
  // Recognise closing marks even in a file just opened, not only auto-pairs.
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent!) {
    if (!/^(Emphasis|StrongEmphasis|Strikethrough|Highlight)$/.test(node.name)) continue;
    const last = node.lastChild;
    if (last && /Mark$/.test(last.name) && pos >= last.from && pos < last.to && state.sliceDoc(pos, pos + 1) === mark) return last.to;
  }
  return -1;
}

function displayBlock(state: EditorState, from: number, to: number) {
  const line = state.doc.lineAt(from);
  const indent = state.sliceDoc(line.from, from);
  if (state.doc.lineAt(to).number !== line.number || !/^[ \t]*$/.test(indent) || state.sliceDoc(to, line.to).trim()) return null;
  return {
    changes: { from, to: line.to, insert: `$$\n${indent}\n${indent}$$` },
    range: EditorSelection.cursor(from + 3 + indent.length),
    effects: addPair.of({ from, to: from + 6 + indent.length * 2, mark: '$$' }),
  };
}

function insertForRange(state: EditorState, range: SelectionRange, text: string) {
  const { from, to } = range;
  const literal = () => ({ changes: { from, to, insert: text }, range: EditorSelection.cursor(from + text.length) });
  const mark = text[0];
  if (inCode(state, from) || escaped(state, from) || (mark !== '$' && inMath(state, from))) return literal();

  if (!range.empty) {
    // Keep the selection and its direction, allowing * then * to make bold.
    return {
      changes: [{ from, insert: text }, { from: to, insert: text }],
      range: EditorSelection.range(range.anchor + text.length, range.head + text.length),
      effects: addPair.of({ from, to: to + text.length * 2, mark: text }),
    };
  }

  const pair = state.field(pairs, false)?.find((p) => p.mark[0] === mark && from === p.from + p.mark.length && from === p.to - p.mark.length);
  if (pair && pair.mark.length < (mark === '*' || mark === '_' ? 3 : 2)) {
    const next = mark.repeat(Math.min(mark === '*' || mark === '_' ? 3 : 2, pair.mark.length + text.length));
    if (mark === '$') {
      const block = displayBlock(state, pair.from, pair.to);
      if (block) return block;
    }
    return {
      changes: { from: pair.from, to: pair.to, insert: next + next },
      range: EditorSelection.cursor(pair.from + next.length),
      effects: addPair.of({ from: pair.from, to: pair.from + next.length * 2, mark: next }),
    };
  }

  const closing = closingAt(state, from, mark);
  if (closing >= 0) return { range: EditorSelection.cursor(Math.min(closing, from + text.length)) };
  if (inMath(state, from)) return literal();

  const before = state.sliceDoc(Math.max(0, from - 1), from);
  const after = state.sliceDoc(to, to + 1);
  // No accidental formatting in snake_case, prices, escapes, or mid-word.
  if (/[\p{L}\p{N}_]/u.test(before) || (after && !/[\s)\]}.,;:!?،؛»]/.test(after))) return literal();
  // A neighbouring opening delimiter isn't a closing one to skip over.
  if (before === mark || after === mark) return literal();
  if (text === '$$') {
    const block = displayBlock(state, from, to);
    if (block) return block;
  }
  return {
    changes: { from, to, insert: text + text },
    range: EditorSelection.cursor(from + text.length),
    effects: addPair.of({ from, to: from + text.length * 2, mark: text }),
  };
}

export function insertDelimiter(view: EditorView, text: string): boolean {
  if (view.state.readOnly) return false;
  view.dispatch(view.state.changeByRange((range) => insertForRange(view.state, range, text)), {
    userEvent: 'input.type', scrollIntoView: true,
  });
  return true;
}

/** Enter in a literal $$ | $$ (or after a lone $$) opens the writing line. */
export function enterDisplayMath(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (state.readOnly || !range.empty || state.selection.ranges.length !== 1 || inCode(state, range.head)) return false;
  const line = state.doc.lineAt(range.head);
  const match = /^([ \t]*)\$\$([ \t]*)(\$\$)?[ \t]*$/.exec(line.text);
  if (!match) return false;
  const start = line.from + match[1].length;
  const end = match[3] ? line.from + line.text.lastIndexOf('$$') : line.to;
  if (closingMathDelimiter(state, start) >= 0) return false;
  if (range.head < start + 2 || range.head > end) return false;
  const result = displayBlock(state, start, line.to)!;
  view.dispatch({ changes: result.changes, selection: result.range, effects: result.effects, userEvent: 'input.enter', scrollIntoView: true });
  return true;
}

export function deleteDelimiterPair(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.some((r) => !r.empty)) return false;
  const emptyPairs = state.selection.ranges.map((r) => state.field(pairs, false)?.find((p) =>
    r.head === p.from + p.mark.length && r.head === p.to - p.mark.length));
  if (emptyPairs.some((p) => !p)) return false;
  view.dispatch(state.changeByRange((range) => {
    const pair = emptyPairs.find((p) => p!.from + p!.mark.length === range.head)!;
    return { changes: { from: pair.from, to: pair.to }, range: EditorSelection.cursor(pair.from) };
  }), { userEvent: 'delete.backward' });
  return true;
}

const input = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.composing || view.state.readOnly || from !== view.state.selection.main.from || to !== view.state.selection.main.to) return false;
  if (/^(\${1,2}|\*{1,3}|_{1,3}|~{1,2}|={1,2}|%{1,2})$/.test(text)) return insertDelimiter(view, text);
  // A space in *|* means a bullet, not an empty emphasis. Only remove our
  // own one-character closer, never an existing ** opening/closing mark.
  if (text === ' ' && from === to) {
    const pair = view.state.field(pairs).find((p) => p.mark.length === 1 && p.mark !== '$' && p.from + 1 === from && p.to - 1 === to);
    if (pair) {
      view.dispatch({ changes: { from, to: from + 1, insert: ' ' }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
      return true;
    }
  }
  return false;
});

export const delimiterInput = [pairs, input];
