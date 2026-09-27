// Line-level formatting commands for the keyboard toolbar. Each works on every
// line touched by the selection and keeps the caret after the inserted
// prefix, so tapping "-" on an empty line leaves you typing the item.
import { deleteLine, moveLineDown, moveLineUp, redo, undo } from '@codemirror/commands';
import { EditorSelection, type ChangeSpec, type Line } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

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

export function toggleTask(view: EditorView): boolean {
  const lines = touchedLines(view);
  const isTask = (line: Line): boolean => Boolean(LIST.exec(line.text)?.[6]);
  if (lines.every(isTask)) {
    // Numbered items keep their number; bulleted to-dos become plain text.
    return apply(view, lines.map((line) => {
      const match = LIST.exec(line.text)!;
      return setPrefix(line, match[3] ? `${match[3]}${match[4]} ` : '');
    }), 'input.list');
  }
  return apply(view, lines.map((line) => {
    const match = LIST.exec(line.text);
    // Numbered items keep their number: "1. [ ] ..."
    if (match && match[3]) return setPrefix(line, `${match[3]}${match[4]} [ ] `);
    return setPrefix(line, '- [ ] ');
  }), 'input.list');
}

export function insertMath(view: EditorView): boolean {
  view.dispatch(view.state.changeByRange((range) => ({
    changes: [{ from: range.from, insert: '$' }, { from: range.to, insert: '$' }],
    range: range.empty ? EditorSelection.cursor(range.from + 1) : EditorSelection.range(range.from + 1, range.to + 1),
  })), { userEvent: 'input.math', scrollIntoView: true });
  return true;
}

export const toolbarCommands: Record<string, (view: EditorView) => boolean> = {
  undo, redo,
  heading: cycleHeading,
  bullet: toggleBullet,
  ordered: toggleOrdered,
  task: toggleTask,
  deleteLine,
  math: insertMath,
  lineUp: moveLineUp,
  lineDown: moveLineDown,
};
