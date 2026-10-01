// Line-level formatting commands for the keyboard toolbar. Each works on every
// line touched by the selection and keeps the caret after the inserted
// prefix, so tapping "-" on an empty line leaves you typing the item.
import { deleteLine, moveLineDown, moveLineUp, redo, undo } from '@codemirror/commands';
import { EditorSelection, type ChangeSpec, type Line } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { insertDelimiter } from './delimiterInput';
import { editFootnote } from './footnoteDialog';

const PERSIAN_TEXT = /[\u0600-\u06FF]/;
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
// indent, marker (bullet or number+punct), optional task box
const LIST = /^(\s*)(?:([-*+])|([0-9۰-۹٠-٩]+)([.)]))(\s+)(\[[ xX]\]\s+)?/;
const HEADING = /^(#{1,6})(\s+|$)/;

function touchedLines(view: EditorView): Line[] {
  const { doc } = view.state;
  const seen = new Set<number>();
  const lines: Line[] = [];
  for (const range of view.state.selection.ranges) {
    const first = doc.lineAt(range.from).number;
    // A selection ending at column 0 doesn't include that line.
    const endLine = doc.lineAt(range.to);
    const last = range.to > range.from && range.to === endLine.from ? endLine.number - 1 : endLine.number;
    for (let n = first; n <= Math.max(first, last); n += 1) {
      if (!seen.has(n)) { seen.add(n); lines.push(doc.line(n)); }
    }
  }
  return lines.sort((a, b) => a.from - b.from);
}

function apply(view: EditorView, changes: ChangeSpec[], userEvent: string): boolean {
  const set = view.state.changes(changes);
  // assoc 1: a caret sitting where a prefix is inserted ends up after it.
  view.dispatch({ changes: set, selection: view.state.selection.map(set, 1), userEvent, scrollIntoView: true });
  return true;
}

// Replace the line's list prefix (after indentation) with `prefix`.
function setPrefix(line: Line, prefix: string): ChangeSpec {
  const match = LIST.exec(line.text);
  const indent = /^\s*/.exec(line.text)![0].length;
  const end = match ? match[0].length : indent;
  return { from: line.from + indent, to: line.from + end, insert: prefix };
}

function toPersian(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}
function fromDigits(value: string): number {
  return Number([...value].map((c) => {
    const p = '۰۱۲۳۴۵۶۷۸۹'.indexOf(c);
    const a = '٠١٢٣٤٥٦٧٨٩'.indexOf(c);
    return p >= 0 ? p : a >= 0 ? a : c;
  }).join(''));
}

export function cycleHeading(view: EditorView): boolean {
  return apply(view, touchedLines(view).map((line) => {
    const match = HEADING.exec(line.text);
    if (!match) return { from: line.from, insert: '# ' };
    const level = match[1].length;
    return { from: line.from, to: line.from + match[0].length, insert: level >= 6 ? '' : `${'#'.repeat(level + 1)} ` };
  }), 'input.heading');
}

export function toggleBullet(view: EditorView): boolean {
  const lines = touchedLines(view);
  const isBullet = (line: Line): boolean => { const m = LIST.exec(line.text); return Boolean(m && m[2] && !m[6]); };
  const remove = lines.every(isBullet);
  return apply(view, lines.map((line) => setPrefix(line, remove ? '' : '- ')), 'input.list');
}

export function toggleOrdered(view: EditorView): boolean {
  const lines = touchedLines(view);
  const isOrdered = (line: Line): boolean => { const m = LIST.exec(line.text); return Boolean(m && m[3] && !m[6]); };
  if (lines.every(isOrdered)) return apply(view, lines.map((line) => setPrefix(line, '')), 'input.list');
  // Continue the numbering of an ordered item right above, if there is one.
  let start = 1;
  let persian = PERSIAN_TEXT.test(lines[0].text);
  let punct = '.';
  if (lines[0].number > 1) {
    const above = LIST.exec(view.state.doc.line(lines[0].number - 1).text);
    if (above && above[3]) {
      start = fromDigits(above[3]) + 1;
      persian = /[۰-۹٠-٩]/.test(above[3]);
      punct = above[4];
    }
  }
  return apply(view, lines.map((line, index) => {
    const n = start + index;
    return setPrefix(line, `${persian ? toPersian(n) : n}${punct} `);
  }), 'input.list');
}

// To-do cycles through three states, decided by the first touched line:
// plain → "- [ ] " → "- [x] " → plain. Numbered items keep their number
// ("1. [ ] ", "1. [x] ", "1. ").
export function cycleTask(view: EditorView): boolean {
  const lines = touchedLines(view);
  const state = (line: Line): 'none' | 'open' | 'done' => {
    const box = LIST.exec(line.text)?.[6];
    return !box ? 'none' : /x/i.test(box) ? 'done' : 'open';
  };
  const next = { none: 'open', open: 'done', done: 'none' }[state(lines[0])];
  return apply(view, lines.map((line) => {
    const match = LIST.exec(line.text);
    const number = match && match[3] ? `${match[3]}${match[4]} ` : null;
    if (next === 'none') return setPrefix(line, number ?? '');
    const box = next === 'open' ? '[ ] ' : '[x] ';
    return setPrefix(line, `${number ?? '- '}${box}`);
  }), 'input.list');
}

// Insert footnote, after Obsidian's editor:insert-footnote: "[^n]" at the
// caret (n = highest numeric footnote id + 1) and "[^n]: " appended at the
// end of the note after a blank line. The caret stays after the reference —
// no jump to the end of the file — and a popover opens at the reference to
// write the note (src/footnoteDialog.ts).
export function insertFootnote(view: EditorView): boolean {
  const { state } = view;
  const text = state.doc.toString();
  let highest = 0;
  for (const match of text.matchAll(/\[\^(\d+)\]/g)) highest = Math.max(highest, Number(match[1]));
  const id = String(highest + 1);
  const label = `[^${id}]`;
  const { to } = state.selection.main;
  const trailing = /\n*$/.exec(text)![0].length;
  const definition = `${'\n'.repeat(2 - Math.min(trailing, 2))}${label}: `;
  const end = state.doc.length;
  view.dispatch({
    changes: [{ from: to, insert: label }, { from: end, insert: definition }],
    selection: { anchor: to + label.length },
    userEvent: 'input.footnote',
    scrollIntoView: true,
  });
  editFootnote(view, id, { isNew: true, at: to });
  return true;
}

export function insertMath(view: EditorView): boolean {
  return insertDelimiter(view, '$');
}

/** Markor's "expand selection of cursor to whole line", as one action: every
 *  line the selection (or the caret) touches becomes selected whole, so a line
 *  can be copied, cut or replaced without dragging handles to its ends. It
 *  lives in the keyboard toolbar, and Android's own selection bar gets the same
 *  item as "Line" (android/…/SatrWebView.java) — which is where Markor's bar
 *  carries it too. */
export function selectWholeLines(view: EditorView): boolean {
  const lines = touchedLines(view);
  if (!lines.length) return false;
  const ranges = lines.map((line) => EditorSelection.range(line.from, line.to));
  view.dispatch({ selection: EditorSelection.create(ranges, 0), userEvent: 'select.pointer', scrollIntoView: false });
  return true;
}

export const toolbarCommands: Record<string, (view: EditorView) => boolean> = {
  undo, redo,
  heading: cycleHeading,
  bullet: toggleBullet,
  ordered: toggleOrdered,
  task: cycleTask,
  footnote: insertFootnote,
  deleteLine,
  line: selectWholeLines,
  math: insertMath,
  lineUp: moveLineUp,
  lineDown: moveLineDown,
};
