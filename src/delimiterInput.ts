// Markdown delimiters share one policy for typing and the math toolbar.
// Remember pairs per editor, not in a timer/global: only an empty pair we
// actually inserted may be deleted together. Existing $$ delimiters are text.
//
// One delimiter is its own case: a single `=` is a setext underline, a table
// rule, an arithmetic sign — far more often than the start of a
// `==highlight==`. Pairing `=` on the first press made every one of those
// impossible (and put the caret between two `=` the writer never typed), so
// `=` types one `=`; the *second* `=`, with the first still the last thing
// written, is what opens the pair, in the form the editor has always produced
// for two presses: `==|==`, whose closing two are the inserted ones and go
// away on a space, like every other empty pair's closing half.
//
// `~` follows the same rule for the same reason: a lone `~` is a range
// ("10~20") or a subscript in some flavours, and `~~strikethrough~~` costs no
// more than two presses. Backticks are the other way round — one backtick is
// almost always the start of `code` — so the first press opens the pair and
// each press inside it grows the run, up to three (`` ``` ``); Enter inside an
// empty run of three opens a fenced block, exactly as Enter inside `$$|$$`
// opens a display-math block. A `"` is a quotation mark, not a markdown
// delimiter, and pairs only where a pair means something: inside a bracket,
// where the writer is quoting something into it — `(""`.
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
    for (const effect of tr.effects) if (effect.is(addPair)) {
      // The pair that was there is what grew into this one (`` `|` `` into
      // `` ``|`` ``): only the longest run is a pair to skip over later.
      for (let i = mapped.length - 1; i >= 0; i -= 1) {
        if (mapped[i].from === effect.value.from && mapped[i].to === effect.value.to) mapped.splice(i, 1);
      }
      mapped.push(effect.value);
    }
    return mapped;
  },
});

// The one `=` (or `~`) of the pair rule above: the mark the writer last typed
// on its own, and where it ended. Anything else the writer does ends the
// chance to pair — the field only survives transactions that change no
// document (a caret move can't turn a typed `=` into the start of a highlight
// on its own).
const setLoneMark = StateEffect.define<{ mark: string; at: number } | null>();
const loneMark = StateField.define<{ mark: string; at: number } | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setLoneMark)) return effect.value;
    return tr.docChanged ? null : value;
  },
});
/** A word right after the caret (or a closing quote): a quotation mark typed
 *  there is closing something, not opening it. A *bracket* after the caret is
 *  not that — `(` leaves its own `)` there, and a quote between the two is
 *  exactly the opening the pair is for. */
const WORD_AFTER = /[\p{L}\p{N}"”]/u;
/** The marks that type one first, and pair on the second press. */
const ONE_THEN_PAIR = new Set(['=', '~']);
/** How long a run of one mark may grow (the inside of an empty pair). */
const runCap = (mark: string): number => (mark === '*' || mark === '_' || mark === '`' ? 3 : 2);

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
  if (escaped(state, from) || (mark !== '$' && inMath(state, from))) return literal();
  const pair = state.field(pairs, false)?.find((p) => p.mark[0] === mark && from === p.from + p.mark.length && from === p.to - p.mark.length);
  // Code is out of bounds for delimiters — except our own empty pair, which is
  // where the run grows (`` `|` ``, `` ``|`` ``, ``` ```|``` ```).
  if (!pair && inCode(state, from)) return literal();

  if (!range.empty) {
    // Keep the selection and its direction, allowing * then * to make bold.
    return {
      changes: [{ from, insert: text }, { from: to, insert: text }],
      range: EditorSelection.range(range.anchor + text.length, range.head + text.length),
      effects: addPair.of({ from, to: to + text.length * 2, mark: text }),
    };
  }

  if (pair && pair.mark.length < runCap(mark)) {
    const next = mark.repeat(Math.min(runCap(mark), pair.mark.length + text.length));
    // The third backtick is a fence, not a longer span: the run ends there and
    // the closing half goes away — the writer is opening a block, and Enter
    // after it opens the writing line (enterCodeFence). (Left in, ` ``` ` +
    // Enter used to leave six backticks that the markdown parser then quietly
    // cut back to a three-backtick fence.)
    if (mark === '`' && next === '```') {
      return { changes: { from: pair.from, to: pair.to, insert: '```' }, range: EditorSelection.cursor(pair.from + 3) };
    }
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

  // A mark past the run's cap grows the run rather than skipping the closing
  // half: `==|==` and another `=` is `===|==`, which is what a setext
  // underline is made of (and a space still takes the closing two away).
  if (pair && pair.mark === mark.repeat(runCap(mark))) {
    return { changes: { from, to: from, insert: mark }, range: EditorSelection.cursor(from + 1) };
  }

  const closing = closingAt(state, from, mark);
  if (closing >= 0) return { range: EditorSelection.cursor(Math.min(closing, from + text.length)) };
  if (inMath(state, from)) return literal();

  const before = state.sliceDoc(Math.max(0, from - 1), from);
  const after = state.sliceDoc(to, to + 1);
  // No accidental formatting in snake_case, prices, escapes, or mid-word.
  if (/[\p{L}\p{N}_]/u.test(before) || (after && !/[\s)\]}.,;:!?،؛»]/.test(after))) return literal();
  // The second `=` (or `~`): the writer has just typed one, so this one opens
  // the pair — `==|==`, `~~|~~` — and the pair is tracked like any other.
  const lone = state.field(loneMark, false);
  if (lone && ONE_THEN_PAIR.has(mark) && lone.mark === mark && lone.at === from) {
    return {
      changes: { from, to: from, insert: mark.repeat(3) },
      range: EditorSelection.cursor(from + 1),
      effects: addPair.of({ from: from - 1, to: from + 3, mark: mark.repeat(2) }),
    };
  }
  // A neighbouring opening delimiter isn't a closing one to skip over.
  if (before === mark || after === mark) return literal();
  if (text === '$$') {
    const block = displayBlock(state, from, to);
    if (block) return block;
  }
  // Three backticks in one input event are the same fence the third press
  // makes: the run ends there, no closing half is inserted, and Enter opens
  // the writing line inside it. (The generic rule below would have made six —
  // ``` ```|``` ``` — which the markdown parser then quietly cuts back to
  // three, leaving Enter with nothing that looks like an opening fence: "triple
  // backticks newline does not automatically insert". A keyboard that delivers
  // the three at once — a fast typist, a swipe, a clipboard-like IME commit —
  // takes this path where a press at a time took the pair-growing one.)
  if (mark === '`' && text.length === 3 && !pair) {
    return { changes: { from, to, insert: '```' }, range: EditorSelection.cursor(from + 3) };
  }
  // A run that arrives in one input event (a fast keyboard, a swiped word):
  // the same result as a press at a time — `==|==`, `~~|~~`, `` ``|`` ``.
  if (mark !== '$' && text.length > 1 && text === mark.repeat(text.length) && text.length <= runCap(mark)) {
    return {
      changes: { from, to: from, insert: text + text },
      range: EditorSelection.cursor(from + text.length),
      effects: addPair.of({ from, to: from + text.length * 2, mark: text }),
    };
  }
  // A `"` gets the same treatment as every other delimiter: a pair where it
  // *opens* something, one character where it closes it.
  //
  //   * It opens after nothing, after a space, and after an opening mark
  //     (`(`, `[`, `{`, `<`, `«`, a dash, a quote) — the places a quotation
  //     starts. (It used to pair only when it sat *directly* after a bracket,
  //     so `( "` — one space into the parenthesis — came out as a single
  //     quote: "The () " inserts one, but I asked for normal treatment".)
  //   * It is one character after a word: there the writer is closing the
  //     quotation they opened, or writing a unit (“20”, a prime, an inch mark).
  //   * And it is one character when a word follows it at once: the closing
  //     quote of selected text, or a quotation typed backwards over a word.
  //
  // The pair is tracked like every other one, so the closing `"` is skipped
  // over rather than typed twice (the `closingAt` step above) and a space
  // inside the empty pair takes it away.
  if (mark === '"') {
    const prev = state.sliceDoc(Math.max(0, from - 1), from);
    const opens = prev === '' || /[\s([{<«—–\-'‘“]$/.test(prev);
    if (!opens || WORD_AFTER.test(state.sliceDoc(from, from + 1))) return literal();
    return {
      changes: { from, to, insert: '""' },
      range: EditorSelection.cursor(from + 1),
      effects: addPair.of({ from, to: from + 2, mark: '"' }),
    };
  }
  // One `=` (or `~`) is one mark, and it is remembered as the possible start of
  // a pair (see the second mark above): setext underlines, tables, arithmetic
  // and ranges get theirs, and a `==highlight==`/`~~strike~~` still costs no
  // more than two presses.
  if (ONE_THEN_PAIR.has(mark)) {
    return {
      changes: { from, to, insert: mark },
      range: EditorSelection.cursor(from + 1),
      effects: setLoneMark.of({ mark, at: from + 1 }),
    };
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

/** Enter in a lone ``` line (or inside an empty ```|``` run) opens a fenced
 *  block, the way enterDisplayMath opens a display-math one. */
export function enterCodeFence(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (state.readOnly || !range.empty || state.selection.ranges.length !== 1) return false;
  const line = state.doc.lineAt(range.head);
  const match = /^([ \t]*)(`{3,})([^\n`]*?)[ \t]*((?:`{3,})[ \t]*)?$/.exec(line.text);
  if (!match) return false;
  const indent = match[1];
  const fence = match[2];
  const info = match[3];
  const start = line.from + indent.length;
  const closing = match[4];
  const end = closing ? line.from + line.text.lastIndexOf(closing) : line.to;
  if (range.head < start + fence.length + info.length || range.head > end) return false;
  // A fence line that is already inside a block closes it: Enter there is an
  // ordinary newline after it, never a new block. (The opening line of a
  // block, and a lone fence, are *not* inside one.)
  if (inCode(state, line.from)) return false;
  // The closing fence is bare: the info string belongs to the opening line
  // only (a `py` on the closing fence is not a language, it is text the writer
  // never typed — "Inserts another ```py at the bottom, it shouldn't repeat
  // the py part of it"). The fence itself repeats, indent and all, so a block
  // inside a list stays inside it.
  const open = `${indent}${fence}${info}`;
  const close = `${indent}${fence}`;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: `${open}\n${indent}\n${close}` },
    selection: EditorSelection.cursor(line.from + open.length + 1 + indent.length),
    effects: addPair.of({ from: line.from, to: line.from + open.length + 1 + indent.length + close.length, mark: fence }),
    userEvent: 'input.enter', scrollIntoView: true,
  });
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

// Spaces are never second-guessed: whatever the writer or the keyboard sends
// goes in as typed, before a `)` or anywhere else. (A rule that ate the space
// in front of a closing bracket lived here; it was more trouble than it was
// worth — a space before `)` is usually wanted, and never surprising.)
const input = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.composing || view.state.readOnly || from !== view.state.selection.main.from || to !== view.state.selection.main.to) return false;
  if (/^(\${1,2}|\*{1,3}|_{1,3}|~{1,2}|={1,2}|%{1,2}|`{1,3}|")$/.test(text)) return insertDelimiter(view, text);
  if (text === ' ' && from === to) {
    // An empty pair's closing half goes away, whatever its length: `= ` out of
    // `==|==` (the pair the second `=` opened) as much as `* ` out of `*|*`.
    const pair = view.state.field(pairs).find((p) => p.mark.length <= 2 && p.mark !== '$$'
      && p.from + p.mark.length === from && p.to - p.mark.length === to);
    if (pair) {
      view.dispatch({ changes: { from, to: from + pair.mark.length, insert: ' ' }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
      return true;
    }
  }
  return false;
});

export const delimiterInput = [pairs, loneMark, input];
