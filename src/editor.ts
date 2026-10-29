import { directionsField, majorityDirection, setCodeDocument } from './direction';
import { codeLanguage, fileKind } from './fileKinds';
import { indentGuides } from './indentGuides';
import { defaultKeymap, insertNewlineAndIndent, isolateHistory, history, historyKeymap, toggleComment, undo, redo } from '@codemirror/commands';
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { closeFind, findBar, findNext, findPrevious, isFindOpen, openFind, revealThirdDown } from './findBar';
import { collectHeadings, type Heading } from './outline';
import { Annotation, Compartment, Prec, EditorSelection, EditorState, StateField, StateEffect, Transaction, RangeSetBuilder, type Extension, type Text } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, Decoration, ViewPlugin, WidgetType, GutterMarker, gutterLineClass, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { caretMotion } from './caretMotion';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { wikiLinks, wikiRuntime } from './wikiLinks';
import { indentBox, listLine, livePreview, markerGap, markerText, numberMarker, remeasured } from './livePreview';
import { markerStrip } from './markerWidth';
import { autoSpace } from './autoSpace';
import { Highlight, highlightTag } from './highlightSyntax';
import { languages } from '@codemirror/language-data';
import { inCode, inMath, mathSource } from './mathSource';
import { deleteDelimiterPair, delimiterInput, enterCodeFence, enterDisplayMath } from './delimiterInput';
import { INDENT_STEP, enterEndsPrefixLine, enterInCode } from './enterKey';
import { tightSelection } from './selection';
import { toolbarCommands } from './commands';
import { foldAllHeadings, foldedHeadingLines, headingFolding, restoreHeadingFolds, toggleHeadingFold, unfoldAllHeadings } from './headingFold';
import { foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';
import { typingTop } from './scrollSync';
import { formatDigits, formatMarker, letterItem, lineIsLettered, MARKER, nextLetter, parseMarker, orderOf, sequential, type Alphabet } from './listMarkers';
import { readsEveryNumber } from './markerParse';

const rtlLineDirection = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--note-font-size)' },
  '.cm-scroller': { overflowY: 'auto', overscrollBehaviorY: 'contain', fontFamily: "'Vazirmatn', 'Segoe UI', Tahoma, system-ui, sans-serif", lineHeight: 'var(--note-line-height)' },
  '.cm-content': { padding: 'var(--view-top-spacing-markdown) var(--file-margin-x) calc(50vh + 96px + var(--fold-slack, 0px))', minHeight: '100%', tabSize: '2' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
});

// Line numbers sit in a smaller font than the text, so on their own they
// float toward the top of each line. Tag heading and code lines in the gutter
// so CSS can give their numbers the same line box as the text beside them.
class LineGutterClass extends GutterMarker {
  constructor(readonly elementClass: string) { super(); }
}
const headingGutterClasses = [1, 2, 3, 4, 5, 6].map((level) => new LineGutterClass(`cm-ln-h${level}`));
const codeGutterClass = new LineGutterClass('cm-ln-code');
const footnoteGutterClass = new LineGutterClass('cm-ln-footnote');
// Only block containers are walked into; inline content is skipped, so this
// costs one step per block rather than one per syntax node.
const BLOCK_CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);
function buildLineGutter(state: EditorState) {
  const builder = new RangeSetBuilder<GutterMarker>();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (BLOCK_CONTAINERS.has(node.name)) return true;
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (heading) {
        builder.add(node.from, node.from, headingGutterClasses[Number(heading[1]) - 1]);
      } else if ((node.name === 'Paragraph' || node.name === 'LinkReference') && /^\[\^[^\]\s]+\]:/.test(state.sliceDoc(node.from, node.from + 64))) {
        builder.add(node.from, node.from, footnoteGutterClass);
      } else if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        const first = state.doc.lineAt(node.from).number;
        const last = state.doc.lineAt(node.to).number;
        for (let n = first; n <= last; n += 1) {
          const from = state.doc.line(n).from;
          builder.add(from, from, codeGutterClass);
        }
      }
      return false;
    },
  });
  return builder.finish();
}
// Rebuilt when the text changes or the background parser has got further —
// not on every tree object swap.
const lineGutterField = StateField.define({
  create: buildLineGutter,
  update: (markers, tr) =>
    tr.docChanged || syntaxTree(tr.startState).length !== syntaxTree(tr.state).length ? buildLineGutter(tr.state) : markers,
  provide: (field) => gutterLineClass.from(field),
});

// Heading lines carry the heading's size, as Obsidian's .HyperMD-header-N:
// font size, line height, weight and the space above live on the line, so
// the line box (and the line number beside it) is the heading's own.
const headingLineClasses = [1, 2, 3, 4, 5, 6].map((level) => Decoration.line({ class: `cm-h cm-h${level}` }));
function buildHeadingLines(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (BLOCK_CONTAINERS.has(node.name)) return true;
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (heading) builder.add(state.doc.lineAt(node.from).from, state.doc.lineAt(node.from).from, headingLineClasses[Number(heading[1]) - 1]);
      return false;
    },
  });
  return builder.finish();
}
const headingLineField = StateField.define<DecorationSet>({
  create: buildHeadingLines,
  update: (lines, tr) =>
    tr.docChanged || syntaxTree(tr.startState).length !== syntaxTree(tr.state).length ? buildHeadingLines(tr.state) : lines,
  provide: (field) => EditorView.decorations.from(field),
});

// What is in front of a marker: the line's own indent, and the quote marks of
// however many blockquotes it sits in. A marker is at the head of what it
// marks, and inside a quote that is after the `>`.
const LEAD = '[ \\t]*(?:>[ \\t]*)*';
// A letter marker — `a.`, `الف.`, `ب)` — is the one kind the parser still
// cannot read: an ASCII number can stand in for a Persian one character for
// character (src/markerParse.ts), a letter cannot, and CommonMark has no
// lettered lists to stand in at all. So these keep the dim the parser would
// have given them. Numbers are the parser's now, in both scripts.
const liveMarker = Decoration.mark({ class: 'cm-live-marker' });
/** One step of indentation, the way the live preview reads it: two columns,
 *  four, or a tab all draw one step. */
const LETTER_STEP = 2;

/** The note's own font, for measuring a marker in. */
const face = (view: EditorView): string => getComputedStyle(view.contentDOM).fontFamily || 'sans-serif';

/** The strip a lettered list's markers hang in: the widest marker in the run
 *  this line belongs to, so `الف.` and `ب.` end in one place and the text
 *  starts where the reading view starts it. A run is the neighbouring
 *  letters themselves — the same reading lineIsLettered does. */
function stripFor(lineAt: (index: number) => string | undefined, index: number, font: string): string | null {
  const here = letterItem(lineAt(index) ?? '');
  if (!here) return null;
  const delimiter = (text: string, item: { indent: number; letter: string }): string =>
    text.slice(item.indent + item.letter.length, item.indent + item.letter.length + 1);
  const tokens = [here.letter + delimiter(lineAt(index) ?? '', here)];
  for (const step of [-1, 1]) {
    let last = here;
    for (let at = index + step; ; at += step) {
      const text = lineAt(at);
      if (text === undefined) break;
      const other = letterItem(text);
      if (!other || other.indent !== here.indent || !nextLetter(last.letter, other.letter)) break;
      tokens.push(other.letter + delimiter(text, other));
      last = other;
    }
  }
  return markerStrip(tokens, font);
}

const persianListMarkerPlugin = ViewPlugin.fromClass(class {
  decorations: any;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate): void {
    // remeasured: the webfont arrived and the strip was measured in the
    // fallback (src/livePreview.ts)
    if (update.docChanged || update.viewportChanged || remeasured(update)) this.decorations = this.build(update.view);
  }
  build(view: EditorView) {
    const ranges = [];
    // A letter (`a.`, `A)`, `الف.`, `ب)`) is dimmed only where the reading
    // view reads it as a list marker — a run of neighbouring letters — so
    // `A. Smith` and `م. شاکوری` stay at full strength, as they do in the
    // preview. One rule for both scripts, shared with src/markdown.ts; the
    // neighbours are read from the document, not the viewport.
    const lineAt = (index: number): string | undefined => (index >= 1 && index <= view.state.doc.lines
      ? view.state.doc.line(index).text
      : undefined);
    for (const visible of view.visibleRanges) {
      let line = view.state.doc.lineAt(visible.from);
      while (true) {
        // Only the marker is dimmed, never the indent or the quote marks in
        // front of it: a `>` is the quote's, and is drawn by the live
        // preview as its own step.
        const item = letterItem(line.text);
        if (item && lineIsLettered(lineAt, line.number)) {
          const at = line.from + item.indent;
          const markEnd = at + item.letter.length + 1;
          // The layout a list has, for the one kind of list the parser
          // cannot read. The strip the marker hangs in, the hanging indent
          // that brings a wrapped row under the text, and one step per
          // level of indent are the live preview's own (src/livePreview.ts),
          // measured the way the reading view measures them
          // (src/markerWidth.ts) — so `الف. یک` sits in the same place in
          // both views, as `۱. یک` and `- یک` already do.
          const lead = item.indent === 0 ? '' : line.text.slice(0, item.indent);
          const quotes = (lead.match(/>/g) ?? []).length;
          const spaces = lead.slice(lead.lastIndexOf('>') + 1).replace(/\t/g, '    ').length;
          const level = 1 + Math.floor(spaces / LETTER_STEP);
          const strip = stripFor(lineAt, line.number, face(view)) ?? undefined;
          const after = /^[ \t]+/.exec(line.text.slice(markEnd - line.from))?.[0].length ?? 0;
          ranges.push(listLine(level, false, quotes, strip).range(line.from));
          if (level > 1) ranges.push(indentBox(level).range(line.from + item.indent - spaces, at));
          // Outer mark first: the strip holds the marker and the space after
          // it, and the dim sits inside it on the marker alone.
          ranges.push(numberMarker(strip).range(at, markEnd + after));
          ranges.push(liveMarker.range(at, markEnd));
          ranges.push(markerText.range(at, markEnd));
          ranges.push(markerGap.range(markEnd, markEnd + after));
        }
        if (line.to >= visible.to || line.number >= view.state.doc.lines) break;
        line = view.state.doc.line(line.number + 1);
      }
    }
    return Decoration.set(ranges, true);
  }
}, { decorations: (value) => value.decorations });

// Cache whole-document context; viewport changes only rebuild decorations.
// A keystroke that cannot move a line's decision reuses the last answer
// (src/direction.ts, directionsAfter) instead of walking the whole note.
const dirDecorations = {
  rtl: Decoration.line({ attributes: { dir: 'rtl' } }),
  ltr: Decoration.line({ attributes: { dir: 'ltr' } }),
};
function buildDirections(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  const directions = view.state.field(directionsField).dirs;
  for (const block of view.viewportLineBlocks) {
    const line = view.state.doc.lineAt(block.from);
    builder.add(line.from, line.from, dirDecorations[directions[line.number - 1]]);
  }
  return builder.finish();
}
const directionPlugin = ViewPlugin.fromClass(class {
  decorations;
  constructor(view: EditorView) { this.decorations = buildDirections(view); }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.decorations = buildDirections(update.view);
  }
}, { decorations: (value) => value.decorations });

// The line numbers keep the left edge, always: a gutter that changed sides
// with the note's language was more to explain than it was worth, and it
// moved under the reader's eyes while a note drifted towards another
// language. (The right sidebar's outline still reads the note's majority.)


// Automatic numbering for ordered lists (the writer's request): a list is
// numbered from its head, one after another, and every change in it is
// numbered again — not only Enter, not only a deletion, but any edit at all,
// whatever key or button made it. The counting starts at the head's own
// number, never at 1, so a list that begins at ۵. runs ۵, ۶, ۷; and the head
// is written exactly as the writer wrote it, because it is what the rest of
// the list answers to.
//
// A list is one language. The head decides the digits — English, Persian or
// Arabic-Indic — or the letters, and a marker typed in another script is
// written over at once, so the writer can type on whatever keyboard is at
// hand and the list stays itself.
//
// A blank line, prose or another kind of marker ends the run (two lists
// separated by a blank line are two lists). A nested list numbers itself and
// is stepped over, though a change inside one still belongs to the list it
// hangs under, which is renumbered with it. Two things are not edits and are
// left exactly as they came: a note arriving whole (a file opened, a session
// coming back, a reload) and a paste or a drop, which is the writer's own
// material.
const listRenumber = Annotation.define<boolean>();
const ITEM_LINE = new RegExp(`^(${LEAD})(${MARKER})([.)])([ \\t])`);
// A line the writer is taking apart: the whole item, "2." with its text gone,
// or "2" with the marker half-deleted. Only a line that holds nothing else.
const STRUCK_ITEM = new RegExp(`^(${LEAD})(${MARKER})([.)])?([ \\t]*)$`);

interface Marker { indent: string; delimiter: string }

/** Deeper than any indent a writer would type, so one more quote always wins
 *  over any number of spaces. */
const QUOTE_DEEPER = 1000;
/** How deep an item sits: the quotes it is inside first, then how far it is
 *  indented within them. Two items are of one list only where both agree, so
 *  a quoted item is never read as a sibling of an indented one that happens
 *  to be as many characters along. */
function leadWidth(lead: string): number {
  const last = lead.lastIndexOf('>');
  if (last < 0) return lead.length;
  const quotes = (lead.match(/>/g) as string[]).length;
  // The space after a `>` belongs to the quote mark, not to the indent.
  return quotes * QUOTE_DEEPER + lead.slice(last + 1).replace(/^[ \t]/, '').length;
}

/** The item lines one change took out of the list, and the marker to match the
 *  run after them against. A line goes when the whole line went, when the
 *  writer emptied it, or when its break was deleted and the line above had
 *  text to absorb it (Backspace at the line's start). */
function removedItems(tr: { changes: { mapPos: (pos: number, assoc: number) => number }; startState: EditorState; newDoc: { lineAt: (pos: number) => { text: string } } }, fromA: number, toA: number): { count: number; marker: Marker | null; emptied: boolean } {
  const before = tr.startState.doc;
  const after = tr.newDoc as unknown as EditorState['doc'];
  let count = 0;
  let marker: Marker | null = null;
  let emptied = false;
  const first = before.lineAt(fromA);
  const last = before.lineAt(toA);
  const leftBehind = after.lineAt(Math.min(tr.changes.mapPos(toA, -1), after.length));
  for (let n = first.number; n <= last.number; n += 1) {
    const line = before.line(n);
    if (fromA > line.from || toA < line.to) continue;
    // A line that went takes its item with it, text and all. A line still
    // standing counts only when the writer emptied it — a replacement (a
    // selection typed over) leaves text behind and moves nothing.
    const gone = toA > line.to || fromA < line.from;
    const match = leftBehind.text.trim() && !gone
      ? null
      : ITEM_LINE.exec(line.text) ?? STRUCK_ITEM.exec(line.text);
    if (!match) continue;
    count += 1;
    if (!gone) emptied = true;
    marker = marker ?? { indent: match[1], delimiter: match[3] ?? '.' };
  }
  // One break deleted: the line below moved up into the line above. The item
  // is gone only if that line had text of its own — a line joining an empty
  // line is the same item one line higher.
  if (toA - fromA === 1 && before.sliceString(fromA, toA) === '\n') {
    const above = before.lineAt(fromA);
    const below = above.number < before.lines ? before.line(above.number + 1) : null;
    if (below && above.text.trim() && ITEM_LINE.test(below.text)) {
      const match = ITEM_LINE.exec(below.text)!;
      if (!marker) marker = { indent: match[1], delimiter: match[3] };
      count += 1;
    }
  }
  return { count, marker, emptied };
}

/** The run an item belongs to: the item lines at its own indent and with its
 *  own delimiter, up to a blank line, a formula, or a line that is not one of
 *  them. A nested list is stepped over — it numbers itself. */
function runAround(doc: EditorState['doc'], number: number, inMathAt: (pos: number) => boolean): { first: number; last: number } {
  const marker = ITEM_LINE.exec(doc.line(number).text);
  if (!marker) return { first: number, last: number };
  const indent = leadWidth(marker[1]);
  const delimiter = marker[3];
  const same = (n: number): boolean => {
    const match = ITEM_LINE.exec(doc.line(n).text);
    return Boolean(match) && leadWidth(match![1]) === indent && match![3] === delimiter;
  };
  /** A line the run cannot cross: air, a formula, prose, or another list. An
   *  indented line belongs to the item above it; a deeper item is nested. */
  const ends = (n: number): boolean => {
    const line = doc.line(n);
    if (!line.text.trim() || inMathAt(line.from)) return true;
    const match = ITEM_LINE.exec(line.text);
    // A line that is not an item ends the run unless it hangs under the item
    // above — and inside a quote that is judged after the quote marks.
    if (!match) return !/^[ \t]/.test(line.text.replace(/^[ \t]*(?:>[ \t]?)*/, ''));
    return leadWidth(match[1]) < indent || (leadWidth(match[1]) === indent && match[3] !== delimiter);
  };
  let first = number;
  while (first > 1 && !ends(first - 1)) first -= 1;
  while (first < number && !same(first)) first += 1;
  let last = number;
  while (last < doc.lines && !ends(last + 1)) last += 1;
  while (last > number && !same(last)) last -= 1;
  return { first, last };
}

/** One number for every item of the run, counted from the head's own number,
 *  and every marker written in the head's alphabet: a list is one language,
 *  and its numbers run 5, 6, 7 however the items below were typed. */
function normalizeRun(doc: EditorState['doc'], number: number, inMathAt: (pos: number) => boolean): { from: number; to: number; insert: string }[] {
  const { first, last } = runAround(doc, number, inMathAt);
  if (first === last) return [];
  const head = ITEM_LINE.exec(doc.line(first).text)!;
  const start = parseMarker(head[2]);
  if (!start) return [];
  const markers: Array<{ line: number; token: string; at: number }> = [];
  for (let n = first; n <= last; n += 1) {
    const match = ITEM_LINE.exec(doc.line(n).text);
    if (!match || leadWidth(match[1]) !== leadWidth(head[1]) || match[3] !== head[3]) continue;
    markers.push({ line: n, token: match[2], at: match[1].length });
  }
  // Which of the two letter orders: whatever the letters typed in the run say.
  const letters = start.alphabet === 'abjad' || start.alphabet === 'abpats'
    ? orderOf(markers.map((marker, index) => ({ index, token: marker.token })))
    : null;
  const alphabet: Alphabet = letters ?? start.alphabet;
  // An English letter is a list only where it already reads as one.
  if (!sequential(markers.map((marker) => marker.token), alphabet)) return [];
  const changes: { from: number; to: number; insert: string }[] = [];
  markers.forEach((marker, index) => {
    // The head is the writer's own, exactly as they wrote it: it is what the
    // rest of the run answers to.
    if (index === 0) return;
    const wanted = formatMarker(start.number + index, alphabet);
    if (wanted === marker.token) return;
    // Where that line's own marker starts — its lead is its own: `>1.` and
    // `> 1.` are the same item of the same list, written two ways.
    changes.push({ from: doc.line(marker.line).from + marker.at, to: doc.line(marker.line).from + marker.at + marker.token.length, insert: wanted });
  });
  return changes;
}

/** The items a line that stopped being one took out of the list: the run below
 *  comes down by that many, never past 1. */
function shiftBelow(doc: EditorState['doc'], from: number, gone: { count: number; marker: Marker }): { from: number; to: number; insert: string }[] {
  const changes: { from: number; to: number; insert: string }[] = [];
  const indent = leadWidth(gone.marker.indent);
  const delimiter = gone.marker.delimiter;
  // The run below is read before it is moved: English letters are shifted only
  // when they already read as a list, so no sentence is rewritten.
  const tokens: string[] = [];
  for (let n = from; n <= doc.lines; n += 1) {
    const text = doc.line(n).text;
    if (!text.trim()) continue;
    const match = ITEM_LINE.exec(text);
    if (!match || leadWidth(match[1]) !== indent || match[3] !== delimiter) {
      if (match || /^[ \t]/.test(text)) continue;
      break;
    }
    tokens.push(match[2]);
  }
  const first = tokens[0] ? parseMarker(tokens[0]) : null;
  if (first && !sequential(tokens, first.alphabet)) return [];
  let previous = 0;
  for (let n = from; n <= doc.lines; n += 1) {
    const text = doc.line(n).text;
    if (!text.trim()) continue;
    const match = ITEM_LINE.exec(text);
    if (!match || leadWidth(match[1]) !== indent || match[3] !== delimiter) {
      if (match || /^[ \t]/.test(text)) continue; // nested or hanging: stepped over
      break;
    }
    const parsed = parseMarker(match[2]);
    if (!parsed) continue;
    const wanted = previous ? Math.min(parsed.number - gone.count, previous + 1) : parsed.number - gone.count;
    if (wanted < 1) break;
    previous = wanted;
    if (wanted !== parsed.number) {
      const at = match[1].length;
      changes.push({ from: doc.line(n).from + at, to: doc.line(n).from + at + match[2].length, insert: formatMarker(wanted, parsed.alphabet) });
    }
  }
  return changes;
}

const listNumbering = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(listRenumber)) return tr;
  // A paste or a drop is the writer's own material: whatever numbers came with
  // it are kept.
  if (tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop')) return tr;
  // A note being loaded, a session coming back, an external reload: one change
  // that replaces the whole document. Nobody typed it, so nothing is
  // renumbered — an edit always leaves the document it edited in place.
  const start = tr.startState.doc.length;
  let whole = true;
  tr.changes.iterChangedRanges((fromA, toA) => { if (fromA > 0 || toA < start) whole = false; });
  if (whole) return tr;
  const doc = tr.newDoc;
  const inMathAt = (pos: number): boolean => inMath(tr.state, pos);
  // An item the change made or edited: its run is made sequential, in the
  // head's alphabet. This is what Enter relies on — the new item is an item,
  // so the run it lands in answers for it, wherever its own marker came from.
  const renumber: number[] = [];
  const left: Array<{ from: number; gone: { count: number; marker: Marker } }> = [];
  tr.changes.iterChanges((fromA, toA, _fromB, toB) => {
    if (inCode(tr.startState, fromA) || inMath(tr.startState, fromA)) return;
    const line = doc.lineAt(Math.min(toB, doc.length)).number;
    if (ITEM_LINE.test(doc.line(line).text)) { renumber.push(line); return; }
    // The line just stopped being an item (emptied, its marker deleted, or
    // joined to the line above): the run below it comes down by what left.
    const gone = removedItems(tr, fromA, toA);
    if (gone.count && gone.marker) left.push({ from: line, gone: gone as { count: number; marker: Marker } });
  });
  // A nested item's numbers are its own list's business, but a change inside
  // one still belongs to the list above it: the run that item hangs under is
  // renumbered too, all the way up.
  const enclosing = (number: number): number[] => {
    const out: number[] = [];
    let indent = leadWidth(ITEM_LINE.exec(doc.line(number).text)?.[1] ?? '');
    for (let n = number - 1; n >= 1 && indent > 0; n -= 1) {
      if (!doc.line(n).text.trim()) break;
      const match = ITEM_LINE.exec(doc.line(n).text);
      if (!match || leadWidth(match[1]) >= indent) continue;
      indent = leadWidth(match[1]);
      out.push(n);
    }
    return out;
  };
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const line of new Set([...renumber, ...renumber.flatMap(enclosing)])) changes.push(...normalizeRun(doc, line, inMathAt));
  for (const { from, gone } of left) changes.push(...shiftBelow(doc, from, gone));
  if (!changes.length) return tr;
  const unique = new Map(changes.map((change) => [`${change.from}:${change.to}`, change]));
  return [tr, { changes: [...unique.values()], sequential: true, annotations: listRenumber.of(true) }];
});

/** An item with nothing written on it yet: its marker (a to-do box counts)
 *  and nothing else. */
const EMPTY_ITEM_LINE = new RegExp(`^(${LEAD})([-*+]|${MARKER}[.)])([ \\t]+(\\[[ xX]\\])?)?[ \\t]*$`);

/** Are these two markers the same list continuing? Numbers may differ — the
 *  writer's own spacing is theirs — but the kind and the delimiter must hold. */
function sameKind(one: string, other: string): boolean {
  const first = /^(.+?)([.)])$/.exec(one);
  const second = /^(.+?)([.)])$/.exec(other);
  const ordered = Boolean(first && parseMarker(first[1]) && second && parseMarker(second[1]));
  if (ordered) return first![2] === second![2];
  return one === other;
}

function continueOnEnter(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) return false;
  const line = state.doc.lineAt(selection.head);
  const before = state.sliceDoc(line.from, selection.head);
  const match = new RegExp(`^(${LEAD})([-*+]|${MARKER}[.)])[ \\t]+(\\[[ xX]\\][ \\t]+)?`).exec(before);
  if (!match) return false;
  const [whole, indent, marker, task] = match;
  if (!before.slice(whole.length).trim()) {
    // The item goes; the quote it was written in stays, as the reading view
    // and Obsidian both keep it. `> - ` comes back to `> `, not to nothing.
    const quoted = /^[ \t]*(?:>[ \t]*)*>[ \t]?/.exec(indent)?.[0] ?? '';
    // A sub-item leaves its own list before it ends the list it hangs under:
    // one level a press, keeping the marker, so the outer list carries on
    // where it left off (Obsidian does the same). The whole run then
    // renumbers around the item that moved, as any other edit would.
    const nested = indent.slice(quoted.length);
    const step = nested.endsWith('\t') ? 1 : Math.min(INDENT_STEP, /[ ]*$/.exec(nested)![0].length);
    if (step) {
      const at = line.from + indent.length - step;
      view.dispatch({ changes: { from: at, to: at + step, insert: '' }, selection: { anchor: selection.head - step }, userEvent: 'input.enter' });
      return true;
    }
    const start = line.from + quoted.length;
    view.dispatch({ changes: { from: start, to: selection.head, insert: '' }, selection: { anchor: start }, userEvent: 'input.enter' });
    return true;
  }
  const ordered = new RegExp(`^(${MARKER})([.)])$`).exec(marker);
  // An item already sits empty on the next line, waiting for its text: Enter
  // moves into it rather than making a second empty one and pushing every
  // number below it. Only a line of the same kind — same indent, same marker,
  // same delimiter — is the list continuing, and only from the line's end.
  const nextLine = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
  const waiting = nextLine ? EMPTY_ITEM_LINE.exec(nextLine.text) : null;
  if (waiting && selection.head === line.to && waiting[1] === indent && sameKind(waiting[2], marker)) {
    view.dispatch({ selection: { anchor: nextLine!.from + nextLine!.text.length } });
    return true;
  }
  const parsed = ordered ? parseMarker(ordered[1]) : null;
  const next = parsed ? `${formatMarker(parsed.number + 1, parsed.alphabet)}${ordered?.[2] ?? '.'}` : marker;
  // A to-do line continues with a to-do line, and the box is always empty:
  // the item below a finished one is a new thing to do, whatever the line
  // above it says (the writer's request).
  const insertion = `\n${indent}${next} ${task ? '[ ] ' : ''}`;
  const cursor = selection.head + insertion.length;
  view.dispatch({ changes: { from: selection.head, insert: insertion }, selection: { anchor: cursor }, userEvent: 'input.enter' });
  return true;
}

// The Enter chain, in the keymap's own order (see the keymap below). The
// toolbar's "new line below" runs exactly this at the line's end, so the
// button and the key can never drift apart.
function enterAtCaret(view: EditorView): boolean {
  return enterDisplayMath(view) || enterCodeFence(view) || enterInCode(view)
    || continueOnEnter(view) || enterEndsPrefixLine(view)
    || insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view);
}

/** A space a keyboard or another app may send in place of the one we type: a
 *  no-break space in the line the item lands on, or inside the item itself,
 *  is not the writer's point — it is the keyboard's, and a `- [ ]` box with
 *  anything else between its brackets is not a to-do at all. So these read as
 *  spaces both when a line is checked and when the pasted text is written
 *  out. Every other character of what was pasted is kept as it came. */
function spaced(text: string): string {
  return text.replace(/[\u00A0\u2007\u202F\u2009]/g, ' ');
}

/** An item line holding nothing but its box: the line a pasted to-do item is
 *  about to land on. */
const EMPTY_TASK_LINE = new RegExp(`^(${LEAD})([-*+]|${MARKER}[.)])[ \\t]+\\[[ xX]\\][ \\t]*$`);
/** A line that is a to-do item: a marker, a box, and whatever the writer wrote
 *  — `[ ]` or `[x]`, the space after the box optional (they type what they
 *  type; the clip is theirs either way). */
const TASK_ITEM_LINE = new RegExp(`^${LEAD}([-*+]|${MARKER}[.)])[ \\t]+\\[[ xX]\\]([ \\t]|$)`);

/**
 * Copying a to-do item onto an empty to-do line: the item goes where the
 * writer is looking, so the empty box standing on that line steps aside
 * instead of being left beside the pasted one — the paste used to leave two
 * to-dos on the line (`- [ ] - [ ] milk`, or the copied item pushed in at the
 * line's start), two of them where the writer meant one.
 *
 * The line that replaces the empty one, or `null` for a paste the app leaves
 * alone. The pasted item keeps its own text and its own box (`[x]` comes over
 * done), the line keeps its own indent, and the lines after the first follow
 * under it at that indent, blank ones left blank. Everything else — an empty
 * plain item, a line with text on it, a clip that is not a to-do item, a clip
 * that does not begin with one — is the platform's own paste, and pastes
 * exactly as the platform pastes it.
 */
export function pastedOverEmptyTask(lineText: string, clip: string): string | null {
  if (!EMPTY_TASK_LINE.test(spaced(lineText))) return null;
  const lines = clip.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (!TASK_ITEM_LINE.test(spaced(lines[0]))) return null;
  const indent = /^[ \t\u00A0\u202F]*/.exec(lineText)![0];
  // The first line takes the empty item's place (its indent is the line's
  // own), the lines after it follow under it, blank ones left blank. A
  // no-break space a keyboard or another app sent in place of a space is
  // written as a space, wherever it falls: the text is the writer's, but a
  // `- [ ]` box with anything else inside its brackets is not a to-do at all.
  return indent + spaced(lines[0]).trimStart()
    + lines.slice(1).map((rest) => (spaced(rest).trim() ? `\n${indent}${spaced(rest)}` : '\n')).join('');
}

/** Two to-dos on one line: the box that was standing there, and the item the
 *  paste brought in beside it. What the writer sees when a paste lands and
 *  nothing steps aside — the shape to put right, whatever the change looked
 *  like on the way in. The item's own box and text are kept as they came. */
const TWO_TASKS_ON_A_LINE = new RegExp(`^(${LEAD})([-*+]|${MARKER}[.)])[ \\t]+\\[[ xX]\\][ \\t]*([-*+]|${MARKER}[.)])[ \\t]+(\\[[ xX]\\])([ \\t]*)(.*)$`);

/**
 * The same rule, run on the transaction rather than on the paste event, and
 * there is a reason it has to be that way round: a paste reaches the editor by
 * more than one road. On a desktop the platform's own `paste` event arrives
 * with the clipboard on it, but on a phone the keyboard's own clipboard
 * (Gboard's, for one) hands the text to the WebView as an ordinary input
 * change, with no `paste` event at all — which is why a fix written into a
 * paste listener helped only the desktop-shaped case. Every road ends as the
 * same change to the same line, so the rule is written against the change.
 *
 * Only `input.*` events are looked at: a note being loaded, a session coming
 * back, an external reload and the app's own rewrites carry no user event and
 * are left exactly as they are. One change, inside one line, at a time — a
 * paste over a selection that spans lines is the writer's own business.
 */
const taskPastedOnEmptyLine = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(listRenumber)) return tr;
  const event = tr.annotation(Transaction.userEvent);
  if (!event || !event.startsWith('input.')) return tr;
  const inserts: { fromA: number; toA: number; text: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    inserts.push({ fromA, toA, text: inserted.toString() });
  });
  // The paste is the change that brought a to-do item: whichever road it came
  // by, its first line is one, box and all.
  const pasted = inserts.find((one) => TASK_ITEM_LINE.test(spaced(one.text.split('\n')[0])));
  if (!pasted) return tr;
  // Every change it made has to sit inside the one line it landed on: a paste
  // that carries on across lines is the writer's own business.
  const line = tr.startState.doc.lineAt(pasted.fromA);
  if (inserts.some((one) => one.fromA < line.from || one.toA > line.to)) return tr;
  const replace = (insert: string) => ({
    changes: { from: line.from, to: line.to, insert },
    selection: { anchor: line.from + insert.length },
    userEvent: event,
    scrollIntoView: tr.scrollIntoView,
  });
  const replaced = pastedOverEmptyTask(line.text, pasted.text);
  if (replaced !== null) return replace(replaced);
  // The line the empty one became, when the item went in beside the box: a
  // change the DOM reader described in more than one piece can leave exactly
  // that, and it is still one to-do the writer meant, not two.
  const made = TWO_TASKS_ON_A_LINE.exec(tr.newDoc.lineAt(tr.changes.mapPos(line.from, 1)).text);
  return made ? replace(`${made[1]}${made[3]} ${made[4]}${made[5]}${made[6]}`) : tr;
});

/** The toolbar's "new line below": Enter at the end of the line. The caret
 *  moves there first, so a list continues — the writer's own number, or a
 *  to-do line's checkbox — and no empty line appears under the text. */
function lineBelow(view: EditorView): boolean {
  const { state } = view;
  const end = state.doc.lineAt(state.selection.main.head).to;
  if (state.selection.main.head !== end) view.dispatch({ selection: { anchor: end } });
  return enterAtCaret(view);
}

const toolbarOverrides: Record<string, (view: EditorView) => boolean> = { lineBelow };

function selectedLines(view: EditorView) {
  const selection = view.state.selection.main;
  const first = view.state.doc.lineAt(selection.from);
  const last = view.state.doc.lineAt(selection.to);
  const lines = [];
  for (let n = first.number; n <= last.number; n += 1) lines.push(view.state.doc.line(n));
  return lines;
}

function indentMore(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (selection.empty) {
    view.dispatch({ changes: { from: selection.from, insert: '  ' }, selection: { anchor: selection.from + 2 } });
    return true;
  }
  view.dispatch({ changes: selectedLines(view).map((line) => ({ from: line.from, insert: '  ' })) });
  return true;
}

function outdentLess(view: EditorView): boolean {
  const selection = view.state.selection.main;
  // Nothing selected: the line the caret is on steps back, the way Shift-Tab
  // reads in any editor. It used to do nothing at all there, which left
  // Backspace as the only way out of an indent — and in a code file, where
  // the indentation is the structure, that is the one thing a writer needs.
  const lines = selection.empty ? [view.state.doc.lineAt(selection.head)] : selectedLines(view);
  const changes = lines.flatMap((line) => {
    const lead = /^(?:\t| {1,2})/.exec(line.text);
    return lead ? [{ from: line.from, to: line.from + lead[0].length, insert: '' }] : [];
  });
  if (changes.length) view.dispatch({ changes });
  // The key is answered either way: Tab is held by the editor (indentMore
  // above always answers), so Shift-Tab cannot be the one that throws the
  // focus out of the note.
  return true;
}

// Inline file title, modeled on Obsidian's editor.inline-title: a
// contenteditable, plain-text-only field sitting at the top of the note that
// renames the file on commit (Enter / Tab / blur), reverts on failure or
// Escape, and hands focus off to the note body like a caret would.
const INVALID_NAME = /[\\/:*?"<>|]/;
const UNSAFE_NAME = /[#^[\]|]/;
const RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const setTitleEffect = StateEffect.define<string>();
let initialTitle = 'untitled';
const titleRuntime: {
  onRename: (base: string) => string | null;
  checkName: (base: string) => string | null;
} = { onRename: () => null, checkName: () => null };

function validateTitle(name: string, forSave: boolean, original: string): string | null {
  if (INVALID_NAME.test(name)) return 'File name cannot contain any of these characters: \\ / : * ? " < > |';
  if (name.startsWith('.')) return 'File name cannot start with a dot';
  if (UNSAFE_NAME.test(name)) return 'Links will not work with names that contain: # ^ [ ] |';
  if (RESERVED_NAME.test(name)) return 'That file name is reserved';
  if (forSave && name === '') return 'File name cannot be empty';
  if (name !== original) return titleRuntime.checkName(name);
  return null;
}

// Flatten whatever the IME/paste built back into ONE text node (like
// Obsidian's ky()), preserving the caret offset across the rebuild.
function flattenTitleDom(el: HTMLElement): void {
  if (el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE) return;
  const selection = window.getSelection();
  let caret: number | null = null;
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (el.contains(range.startContainer) && range.startContainer.nodeType === Node.TEXT_NODE) {
      caret = 0;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null = walker.nextNode();
      while (node) {
        if (node === range.startContainer) { caret += range.startOffset; break; }
        caret += node.textContent?.length ?? 0;
        node = walker.nextNode();
      }
    }
  }
  const text = (el.textContent ?? '').replace(/[\r\n\t]+/g, ' ');
  el.textContent = text;
  if (caret !== null && el.firstChild && selection) {
    selection.removeAllRanges();
    const range = document.createRange();
    range.setStart(el.firstChild, Math.min(caret, text.length));
    range.collapse(true);
    selection.addRange(range);
  }
}

/** The live title element's own state, kept with the element: a title change
 *  CodeMirror brings to the same widget updates the element it already has
 *  (TitleWidget.updateDOM), and the closures below read and write this. */
interface TitleFieldState {
  original: string;
  field: HTMLElement;
  setError(message: string | null): void;
  refresh(value: string): void;
}
const titleFields = new WeakMap<HTMLElement, TitleFieldState>();

// The title is a widget, and it keeps its element. A title change — the rename
// a ✓ commits, a file switch — used to build a new element and drop the old
// one; on the phone, a focused element leaving the document is what closes the
// keyboard, so the ✓ closed it and the focus that followed could only bring it
// back (the writer saw exactly that blink, and asked why it closes at all).
// CodeMirror redraws a widget whose `eq` says it changed — unless `updateDOM`
// takes the element it is given and brings it up to date, which this one does:
// the field keeps the same node for the whole note, focus and all.
class TitleWidget extends WidgetType {
  constructor(readonly value: string) {
    super();
  }

  eq(other: TitleWidget): boolean {
    return other.value === this.value;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const state = titleFields.get(dom);
    if (!state) return false; // not ours to update: let CodeMirror build one
    state.refresh(this.value);
    view.requestMeasure();
    return true;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-file-title';
    const el = document.createElement('div');
    el.className = 'cm-file-name';
    el.contentEditable = 'true';
    el.tabIndex = -1;
    el.spellcheck = false;
    el.dir = 'auto';
    el.setAttribute('autocapitalize', 'on');
    el.setAttribute('enterkeyhint', 'done');
    el.setAttribute('aria-label', 'File title');
    el.textContent = this.value;
    const errorEl = document.createElement('div');
    errorEl.className = 'cm-file-name-error';
    wrap.append(el, errorEl);
    let original = this.value;
    const state: TitleFieldState = {
      original,
      field: el,
      setError: (message) => showError(message),
      refresh: (value) => {
        original = value;
        state.original = value;
        if (el.textContent !== value) el.textContent = value;
        showError(null);
      },
    };
    titleFields.set(wrap, state);
    const titleText = (): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const showError = (message: string | null): void => {
      if (errorEl.textContent === (message ?? '')) return;
      errorEl.textContent = message ?? '';
      view.requestMeasure(); // the widget changed height; keep the gutter in step
    };
    const commit = (): boolean => {
      const name = titleText();
      const error = validateTitle(name, true, original);
      if (error) { showError(error); return false; }
      if (name !== original) {
        const renameError = titleRuntime.onRename(name);
        if (renameError) { showError(renameError); return false; }
        original = name;
      }
      showError(null);
      return true;
    };
    const enterNote = (): void => {
      el.blur();
      view.dispatch({ selection: { anchor: 0 } });
      window.requestAnimationFrame(() => view.focus());
    };
    // The title's ✓ (Enter) hands the caret to the note in the same key event,
    // without blurring the title, so the keyboard stays up.
    // An empty body (a new file) has no line for the caret to land on. Focus
    // now, and once more after the keypress: the phone's Enter action can drop
    // the focus that was just moved, and the keyboard goes with it.
    const intoNote = (): void => {
      view.focus();
      if (view.state.doc.length === 0) window.setTimeout(() => { if (!view.hasFocus) view.focus(); }, 60);
    };
    el.addEventListener('focus', () => { original = titleText() || original; showError(null); });
    el.addEventListener('input', () => {
      flattenTitleDom(el);
      const name = (el.textContent ?? '').trim();
      showError(!name || name === original ? null : validateTitle(name, false, original));
    });
    el.addEventListener('paste', (event: ClipboardEvent) => {
      event.preventDefault();
      const clip = (event.clipboardData?.getData('text/plain') ?? '').replace(/[\r\n\t]+/g, ' ');
      if (!clip) return;
      if (document.queryCommandSupported?.('insertText') && document.execCommand('insertText', false, clip)) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !el.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(clip);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    });
    el.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        showError(null);
        el.textContent = original;
        enterNote();
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        // Commit, then go to the note's first line. The caret moves straight
        // there, without blurring the title, so the keyboard stays up.
        if (commit()) intoNote();
      } else if (event.key === 'ArrowDown') {
        // Leaving through the bottom edge of the title hands the caret to the note.
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const caret = selection.getRangeAt(0).getBoundingClientRect();
        if (caret.bottom + caret.height / 2 < el.getBoundingClientRect().bottom - 2) return;
        event.preventDefault();
        enterNote(); // blur commits (and reverts on failure)
      }
    });
    el.addEventListener('blur', () => {
      if (!commit()) el.textContent = original;
      showError(null);
    });
    return wrap;
  }

  ignoreEvent() {
    return false;
  }
}

function titleDecoration(value: string) {
  return Decoration.set([
    Decoration.widget({
      widget: new TitleWidget(value),
      block: true,
      side: -1,
    }).range(0),
  ]);
}

const titleField = StateField.define({
  create() {
    return titleDecoration(initialTitle);
  },
  update(deco, tr) {
    for (const effect of tr.effects) if (effect.is(setTitleEffect)) return titleDecoration(effect.value);
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// The keyboard's own attributes. Obsidian's editor sets
// `spellcheck: String(getConfig("spellcheck"))` — its own setting, on by
// default — with autocorrect and autocapitalize on; Satr keeps the two that
// the IME reads for its suggestion strip and auto-correct, and drops the one
// that paints: **no spell checking, so no squiggly underline under a word,
// ever** (asked for directly). `writingsuggestions` is off for the same
// reason: Chromium's newer writing-suggestions layer is the other thing that
// can underline, and neither it nor the spell checker is what makes the
// suggestion strip work — that follows autocorrect / autocapitalize, which
// stay on. The IME is where the strip, auto-correct and the weak space live,
// none of which the page can see or imitate (see
// /home/user/phantom-space-research.md).
const keyboardAttributes = EditorView.contentAttributes.of({
  spellcheck: 'false', autocorrect: 'on', autocapitalize: 'on', writingsuggestions: 'false',
});

// How the keyboard talks to the editor.
//
// CodeMirror 6.28+ hands text input to Chrome's EditContext API whenever the
// browser has it, which on Android means every WebView from Chrome 121 on
// (older ones don't have it at all, which is why the same phone could do one
// thing and another phone another). EditContext takes the caret away from the
// DOM selection and hands the keyboard its own window of text instead. That
// window is fine while the keyboard is composing a word, and wrong the moment
// the finger is involved: the keyboard is not told where a tap put the caret,
// so the suggestion strip and the auto-correct bar never come back; a double
// tap never reaches the editor as a selection, so there is no word to drag the
// handles of; and "Select all" from the selection bar has nothing to act on.
// The symptoms were all intermittent because they followed the WebView's
// version, not the phone.
//
// The contenteditable path CodeMirror uses without EditContext is the one
// Android has supported since forever: the keyboard, the selection handles,
// the double tap and the selection bar all work on the DOM selection, which
// is what drawSelection and the tight selection layer already keep in step.
// So the app opts out. (Nothing else changes: the editor is a contenteditable
// either way, and only Android ever took this branch.)
(EditorView as unknown as { EDIT_CONTEXT?: boolean }).EDIT_CONTEXT = false;

/** Whether the editor is asking the browser for the EditContext input path.
 *  False on every platform, and the reason is in the note above. */
export const usesEditContext = (EditorView as unknown as { EDIT_CONTEXT?: boolean }).EDIT_CONTEXT !== false;

// Brackets and quotes use CodeMirror's tracker. Markdown punctuation uses
// delimiterInput, which also understands existing math, code and escapes.
const pairs = EditorState.languageData.of((state, pos) => [{
  closeBrackets: {
    brackets: inMath(state, pos) ? ['(', '[', '{']
      : inCode(state, pos) ? ['(', '[', '{', '`', '```'] : ['(', '[', '{', "'", '"', '`', '```', '«'],
    before: ')]}:;>.,!?»،؛$`"\'*_',
  },
}]);

// A search hit the reader just landed on: shown with the ring the find bar puts
// on its match, not selected (see flashRange). It goes away on its own, or as
// soon as the reader does something that means they have moved on — a
// keystroke, a tap, a selection.
const searchFlash = StateEffect.define<{ from: number; to: number } | null>();
const searchFlashMark = Decoration.mark({ class: 'obsidian-search-match-highlight cm-search-flash' });
const searchFlashField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(searchFlash)) return effect.value;
    if (!value) return null;
    if (tr.docChanged) return null;
    if (tr.selection && (tr.isUserEvent('input') || tr.isUserEvent('select'))) return null;
    return { from: tr.changes.mapPos(value.from), to: tr.changes.mapPos(value.to, -1) };
  },
});
const searchFlashDecorations = EditorView.decorations.compute([searchFlashField], (state) => {
  const flash = state.field(searchFlashField);
  return flash && flash.to > flash.from ? Decoration.set([searchFlashMark.range(flash.from, flash.to)]) : Decoration.none;
});

// A finger is on the note text (see scrollMargins and revealCaret below).
let touching = false;

const lineNumberSlot = new Compartment();
// The line numbers read the caret's line: a Persian line gets Persian digits,
// an English one English digits (a line with no letters of its own carries the
// one above it, as its direction does). One formatter draws the whole column,
// so the numbers turn together — the gutter only has to be told when the
// caret crosses from one script to the other.
const gutterScript: { script: 'latin' | 'persian'; on: boolean } = { script: 'latin', on: false };
const lineNumberConfig = (): Extension => [lineNumbers({ formatNumber: (n) => formatDigits(n, gutterScript.script) })];

/** The script the caret's line is written in — RTL lines Persian, LTR lines
 *  English. The line's direction is already decided (src/direction.ts). */
function gutterScriptFor(view: EditorView): 'latin' | 'persian' {
  const dirs = view.state.field(directionsField, false)?.dirs;
  const line = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  return dirs?.[line] === 'rtl' ? 'persian' : 'latin';
}

/** Follow the caret: when it crosses into a line of the other script, the
 *  whole column is drawn again in that script's digits. */
const followCaretScript = EditorView.updateListener.of((update) => {
  if (!gutterScript.on) return;
  const next = gutterScriptFor(update.view);
  if (next === gutterScript.script) return;
  gutterScript.script = next;
  update.view.dispatch({ effects: lineNumberSlot.reconfigure(lineNumberConfig()) });
});
/** The parser, and the behaviour that only makes sense over one. Markdown is
 *  the default; a code file swaps the grammar in and parks the rest, because
 *  a `# ` in Python is a comment and a `*` in C is a pointer — read as
 *  Markdown they become a heading and an italic, which is exactly the kind of
 *  cleverness a code file must not get. */
const languageSlot = new Compartment();
const markdownOnlySlot = new Compartment();
const markdownLateSlot = new Compartment();
const readOnlySlot = new Compartment();
// New tabs start clean; living tabs reattach their complete EditorState.
// Histories never cross files and are never serialized to disk.
const historySlot = new Compartment();
const autoSpaceSlot = new Compartment();

export class SatrEditor {
  readonly view: EditorView;
  private isReadOnly = false;
  /** The space after a sign, as the settings have it (src/autoSpace.ts). */
  private autoSpaceOn = false;
  /** This file is code, not prose (src/fileKinds.ts). */
  private codeMode = false;
  private codeName = '';
  isCodeFile(): boolean { return this.codeMode; }
  /** Bring the caret's line back into view after a beat — the keyboard has
   *  taken the bottom of the screen and the caret must step clear of it. Set
   *  by the constructor; src/main.ts calls it, because a browser that reports
   *  the keyboard's own rectangle never resizes the viewport to react to. */
  revealCaretSoon: (delay: number) => void = () => undefined;
  constructor(parent: HTMLElement, onChange: () => void, options?: {
    title?: string;
    onRename?: (base: string) => string | null;
    checkName?: (base: string) => string | null;
    onSelection?: (position: number, from: number, to: number) => void;
    /** Height in px hidden at the bottom of the viewport (e.g. the keyboard toolbar). */
    obscuredBottom?: () => number;
    /** A heading was folded or unfolded. */
    onFold?: () => void;
    /** Space after a sign, from the settings (src/autoSpace.ts). */
    autoSpace?: boolean;
    /** Wiki links: note names for the [[ popup, and opening a link. */
    linkNames?: () => string[];
    openLink?: (target: string, heading: string) => void;
  }) {
    if (options?.linkNames) wikiRuntime.names = options.linkNames;
    if (options?.openLink) wikiRuntime.open = options.openLink;
    initialTitle = options?.title ?? 'untitled';
    this.autoSpaceOn = options?.autoSpace ?? false;
    titleRuntime.onRename = options?.onRename ?? (() => null);
    titleRuntime.checkName = options?.checkName ?? (() => null);
    const extensions: Extension[] = [
      followCaretScript, lineNumberSlot.of(gutterScript.on ? lineNumberConfig() : []), drawSelection({ cursorBlinkRate: 1200 }), tightSelection, caretMotion, listNumbering, taskPastedOnEmptyLine, autoSpaceSlot.of(autoSpace(() => this.autoSpaceOn)), historySlot.of(history()), readOnlySlot.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]), findBar,
      // GFM base: strikethrough, task lists and tables get parsed.
      // No markdown keymap: its Backspace deletes a whole "- " / "- [ ] " at
      // once. Obsidian deletes character by character, revealing the raw
      // marker as the caret reaches it (see livePreview.ts).
      // Fenced code is parsed in its own language, so the editor colours it
      // the way the reading view does. @codemirror/language-data imports each
      // grammar only when a fence asks for it (Vite gives each its own
      // chunk), which is how Obsidian does it too: its editor loads modes out
      // of lib/codemirror/modes.min.js on demand, while its reading view runs
      // Prism. Two highlighters, one set of colours — ours are hljs in the
      // reading view and Lezer here, both painted from the --code-* palette.
      languageSlot.of(readsEveryNumber(markdown({ base: markdownLanguage, addKeymap: false, extensions: [Highlight], codeLanguages: languages }))),
      syntaxHighlighting(HighlightStyle.define([
        { tag: tags.processingInstruction, opacity: '0.42' },
        { tag: tags.strong, fontWeight: '700' },
        { tag: tags.emphasis, fontStyle: 'italic' },
        { tag: tags.strikethrough, textDecoration: 'line-through' },
        { tag: highlightTag, backgroundColor: 'var(--text-highlight-bg)', color: 'var(--text-normal)' },
        { tag: tags.link, color: 'var(--accent)' },
        { tag: tags.url, opacity: '0.62' },
        { tag: tags.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
        // Code inside a fence, in the colours the reading view gives the same
        // tokens (src/style.css, .preview-pane .hljs-*). Only tags a code
        // grammar emits are listed: a markdown marker is a
        // processingInstruction and a heading is a heading, and neither may
        // be recoloured by this block.
        //
        // The reading view is the reference, because the same fence must not
        // be two different pictures. highlight.js paints the kinds it knows —
        // keywords, strings, numbers, function and class names, properties,
        // comments, meta — and leaves the rest as text, so punctuation,
        // brackets, operators and bare identifiers are left alone here too.
        // Lezer would happily name all of them, and naming them is what made
        // `const greeting = "hello";` read as five colours in the editor and
        // two in the page. Fewer spans per line, so this is also the cheaper
        // of the two; nothing about the parse changes.
        { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--code-comment)' },
        { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.modifier, tags.self, tags.null, tags.typeName, tags.namespace], color: 'var(--code-keyword)' },
        { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character, tags.inserted], color: 'var(--code-string)' },
        { tag: [tags.number, tags.bool, tags.atom, tags.literal, tags.unit], color: 'var(--code-value)' },
        { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.function(tags.definition(tags.variableName)), tags.className, tags.macroName], color: 'var(--code-function)' },
        { tag: [tags.propertyName, tags.attributeName, tags.labelName, tags.self], color: 'var(--code-property)' },
        { tag: [tags.tagName, tags.deleted], color: 'var(--code-tag)' },
        { tag: [tags.meta, tags.annotation, tags.standard(tags.variableName)], color: 'var(--code-important)' },
      ])),
      titleField,
      rtlLineDirection, directionsField, directionPlugin, lineGutterField,
      markdownOnlySlot.of([headingLineField, livePreview]),
      // After the live preview: a lettered line is given a list's indent
      // here, and a quoted line is given the quote's by the live preview —
      // the one that comes last writes the line's style, and the lettered
      // list's has the quote's step already in it.
      markdownLateSlot.of([persianListMarkerPlugin, mathSource]),
      indentGuides(() => this.codeMode),
      searchFlashField, searchFlashDecorations,
      keyboardAttributes, closeBrackets(), pairs, Prec.high(delimiterInput),
      // Keep the caret clear of the on-screen keyboard and the toolbar when
      // typing and running commands. Not while a finger is on the text:
      // selecting near the bottom then made CodeMirror jump the page at once,
      // because it counted the space the keyboard was about to cover as
      // hidden. The caret is brought up gently afterwards instead (below).
      // Room under the last line: enough to bring it up past the middle of the
      // screen and keep writing at the bottom.
      // Top: three body lines, so the line being written cannot sit against
      // the glass the way the bottom rule keeps it off the keys. Measured
      // from the editor's own line height, not a fixed pixel gap.
      EditorView.scrollMargins.of(() => (touching ? null : {
        top: this.view ? typingTop(this.view) : 0,
        bottom: 24 + (options?.obscuredBottom?.() ?? 0),
      })),
      headingFolding,
      wikiLinks,
      EditorView.lineWrapping,
      EditorView.perLineTextDirection.of(true),
      EditorView.contentAttributes.of({ dir: 'auto' }),
      keymap.of([
        { key: 'Mod-s', run: () => { onChange(); return true; } },
        { key: 'Mod-f', run: (target) => { openFind(target); return true; } },
        { key: 'Mod-h', run: (target) => { openFind(target, true); return true; } },
        { key: 'Escape', run: (target) => { if (!isFindOpen(target.state)) return false; closeFind(target); return true; } },
        { key: 'F3', run: (target) => { findNext(target); return true; }, shift: (target) => { findPrevious(target); return true; } },
        { key: 'Mod-/', run: toggleComment },
        { key: 'Mod-a', run: (target) => { target.dispatch({ selection: { anchor: 0, head: target.state.doc.length } }); return true; } },
        { key: 'Enter', run: enterDisplayMath },
        { key: 'Enter', run: enterCodeFence },
        { key: 'Enter', run: enterInCode }, // code: the line's own indentation
        { key: 'Enter', run: continueOnEnter },
        { key: 'Enter', run: enterEndsPrefixLine }, // a line that is only its own opening
        { key: 'Enter', run: insertNewlineContinueMarkup }, // quotes etc.
        { key: 'Tab', run: indentMore, shift: outdentLess },
        { key: 'Backspace', run: deleteDelimiterPair },
        ...closeBracketsKeymap,
        ...defaultKeymap, ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(); // the text is read lazily (getValue)
        if (update.selectionSet) {
          // (The selection is the platform's: the app neither makes one nor
          // marks one as its own any more — and nothing here brings a
          // caret into view on its own; see the reveal below.)
          options?.onSelection?.(update.state.selection.main.head, update.state.selection.main.from, update.state.selection.main.to);
        }
        // A line made with Enter puts the caret on the line below the one on
        // screen; bring it in, exactly as typing a character does.
        if (update.transactions.some((tr) => tr.isUserEvent('input.enter'))) revealSoon(0);
        if (update.transactions.some((tr) => tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)))) options?.onFold?.();
      }),
    ];
    this.view = new EditorView({ state: EditorState.create({ extensions }), parent });
    // Bringing the caret into view, and when the note is allowed to do it.
    //
    // The rule is the writer's own: **the note moves to a caret only when a
    // character is about to go there.** Two things that means — Enter (the
    // next line's caret, being written on), and the keyboard opening (a shrink
    // of far more than an address bar's, so the writer is about to type and
    // whatever the keyboard now covers has to come out from under it). That is
    // all that calls the reveal below.
    //
    // Everything that used to call it, and why it does not any more:
    //
    //   * **A focus.** The WebView focuses the editable by itself — a checkbox
    //     tap, a link, a keyboard restart, the app coming back — and a glide
    //     from there pulled the note to a caret the writer had scrolled away
    //     from (measured: up to 1688px), on a gesture that had nothing to do
    //     with the caret. The same trigger ran on app open and on a refresh,
    //     where the note has a *saved* position and the caret is not it.
    //   * **A finger lifting.** A caret a tap placed is under the finger that
    //     placed it, so it is already in sight; if a keyboard rises over it,
    //     the keyboard's own shrink (above) brings it back. What the lift's
    //     glide did in practice was move the note 350ms after a double tap the
    //     reader had already scrolled away from.
    //
    // CodeMirror's own scrolling is unaffected and is the good half of it: it
    // asks for a scroll only when a transaction asks (`scrollIntoView` is
    // opt-in — `@codemirror/state`'s `!!spec.scrollIntoView` — and its
    // DOM-change path, the one that adopts a caret the platform placed,
    // dispatches with `scrollIntoView: false`). Jumps the reader asks for (an
    // outline line, a search hit) request their own scroll explicitly and do
    // not go through the reveal at all.
    const revealCaret = (): void => {
      if (!this.view.hasFocus || touching) return;
      const coords = this.view.coordsAtPos(this.view.state.selection.main.head);
      if (!coords) return;
      const box = this.view.scrollDOM.getBoundingClientRect();
      const bottom = box.bottom - (options?.obscuredBottom?.() ?? 0) - 24;
      const top = box.top + typingTop(this.view);
      const delta = coords.bottom > bottom ? coords.bottom - bottom : coords.top < top ? coords.top - top : 0;
      if (Math.abs(delta) < 1) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.view.scrollDOM.scrollBy({ top: delta, behavior: reduce ? 'instant' as ScrollBehavior : 'smooth' });
    };
    let revealTimer: number | undefined;
    const revealSoon = (delay: number): void => {
      window.clearTimeout(revealTimer);
      revealTimer = window.setTimeout(() => window.requestAnimationFrame(revealCaret), delay);
    };
    this.revealCaretSoon = revealSoon;
    let touchTimer: number | undefined;
    // The selection is the platform's. There is no word-finding, no tap
    // counting, no drag of our own and nothing prevented here at all: double
    // tap, long press, the handles, the action mode and dragging a selection
    // are the WebView's, exactly as they are in Obsidian — whose editor has no
    // touch handling of its own either (its only long-press helper belongs to
    // the file list, not the note), and whose viewport forbids the zoom that
    // used to make the same gestures ambiguous here. What this block still
    // does is say when a finger is on the note, so the one reveal above never
    // runs under a hand that is still on the glass.
    this.view.contentDOM.addEventListener('touchstart', () => {
      window.clearTimeout(touchTimer);
      touching = true;
    }, { passive: true });
    // A tap below the last line means "the end of the note", not the nearest
    // character under the finger: the empty room under the text is where the
    // caret goes to the end and writing continues. Only while that room is
    // really there: a last line that is off screen has no room under it, and
    // swallowing the tap there would take the browser's own selection — and
    // with it the keyboard's — away from a tap on real text.
    this.view.scrollDOM.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('.cm-gutters, .cm-widget, .cm-file-title, .cm-tooltip')) return;
      const end = this.view.coordsAtPos(this.view.state.doc.length, 1);
      if (!end) return;
      const box = this.view.scrollDOM.getBoundingClientRect();
      if (end.bottom < box.top || event.clientY <= end.bottom) return;
      event.preventDefault();
      this.view.dispatch({ selection: { anchor: this.view.state.doc.length }, scrollIntoView: false });
      this.view.focus();
    }, true);
    // A finger that travelled is a scroll or a selection drag, and either way
    // the note is the reader's — the reveal above is not for gestures, so
    // there is nothing here to call off.
    const release = (): void => {
      window.clearTimeout(touchTimer);
      // Native selection handles keep adjusting for a moment after the lift;
      // the note is free again once the platform has settled.
      touchTimer = window.setTimeout(() => { touching = false; }, 350);
    };
    this.view.contentDOM.addEventListener('touchend', release, { passive: true });
    this.view.contentDOM.addEventListener('touchcancel', () => { window.clearTimeout(touchTimer); touching = false; }, { passive: true });

    // "Select all" from Android's own selection bar is the one command that
    // rides on the DOM selection instead of the keyboard: it dispatches no
    // keydown (so no keymap sees it) and the WebView sets that selection
    // before, after or without telling the editable region it happened.
    // Whether the editor ended up with the whole note was a race between that
    // and CodeMirror's own reading of the DOM selection — the intermittent
    // "Select all". Three ways in, so that whatever the platform does, the
    // editor's own selection is the one that ends up standing.
    //
    //  1. `selectstart`. Blink's own SelectAll — the selection bar's command,
    //     a key binding, a WebView's `selectAll()` — announces itself by
    //     dispatching a cancelable `selectstart` on the *editable root*,
    //     before it touches the selection. A tap, a drag or a keyboard
    //     extension, when they dispatch one at all, aim it at the node under
    //     the finger or the caret instead, so the root itself is the signature
    //     of the command and of nothing else. This is the one signal that
    //     arrives *before* the platform has a chance to turn "the whole
    //     editable element" into a caret at its end — which is exactly what it
    //     does, and exactly why this worked only sometimes. A finger or a key
    //     that was busy in the editor a breath ago is exempt, so a selection
    //     made by hand is never taken for a command.
    //  2. The input event Chrome fires for it (`inputType: 'selectAll'`), when
    //     it fires one at all: taken over and answered from the state.
    //  3. `selectionchange`, for the WebView that only moves the DOM
    //     selection: a selection that covers the whole editable region *is*
    //     the whole note, so the editor adopts it. The content region must be
    //     on screen and either hold the selection's own anchor or have the
    //     focus, so a selection somewhere else on the page (the reading view,
    //     a drawer) is never mistaken for this one.
    //
    // The last two listen on `window` in the capture phase, and that is the
    // point: CodeMirror listens on the document, so capture runs first, while
    // the platform's selection is still the platform's to read.
    const wholeNote = (): { anchor: number; head: number } => ({ anchor: 0, head: this.view.state.doc.length });
    const selectWholeNote = (): void => {
      const main = this.view.state.selection.main;
      if (main.from === 0 && main.to === this.view.state.doc.length) return;
      this.view.dispatch({ selection: wholeNote(), userEvent: 'select.pointer' });
    };
    // Where fingers and keys were last busy. A touch selection belongs to the
    // finger that made it, a keyboard extension to the key that made it; a
    // Select all command belongs to neither, and that is how the two are told
    // apart. A finger that never lifted (its stream was cut off) stops
    // counting after a second and a half.
    let alive = true;
    let lastFingerDown = 0;
    let lastFingerUp = 0;
    let lastKeyDown = 0;
    const fingerBusy = (): boolean =>
      (lastFingerDown > lastFingerUp && Date.now() - lastFingerDown < 1500)
      || Date.now() - lastFingerUp < 120;
    const noteFingerDown = (): void => { lastFingerDown = Date.now(); };
    const noteFingerUp = (): void => { lastFingerUp = Date.now(); };
    const noteKeyDown = (): void => { lastKeyDown = Date.now(); };
    const selectAllCommand = (event: Event): void => {
      if (event.target !== this.view.contentDOM) return;
      if (fingerBusy() || Date.now() - lastKeyDown < 120) return;
      if (!this.view.contentDOM.getClientRects().length) return; // the editor is not the visible pane
      // Answered here rather than witnessed afterwards: Blink skips its own
      // selection step for a canceled selectstart, so the editor's whole-note
      // selection is the only one that ever lands, and it lands in the same
      // task as the command.
      event.preventDefault();
      this.view.focus();
      selectWholeNote();
      // And if an embedder goes ahead anyway, the editor still has the last
      // word — one frame later, after the platform has had its say.
      requestAnimationFrame(() => { if (alive) selectWholeNote(); });
    };
    const selectAllInput = (event: Event): void => {
      if ((event as InputEvent).inputType !== 'selectAll') return;
      event.preventDefault();
      this.view.focus();
      this.view.dispatch({ selection: wholeNote(), userEvent: 'select.pointer' });
    };
    // The third shape of the same command: a WebView (or an Android build)
    // that answers "Select all" for the *page* when the note itself is not what
    // it thinks is focused — Blink's own case, where the selection resolves
    // against `body`. The note is on screen anyway, so the whole page meaning
    // the whole note is exactly what the writer asked for. A field's own
    // select-all is anchored in the field, never at the body, and a selection
    // made in the reading view belongs to a pane the editor is not showing.
    const adoptWholePageSelection = (): boolean => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
      const content = this.view.contentDOM;
      if (!content.getClientRects().length) return false; // the editor is not the visible pane
      const range = selection.getRangeAt(0);
      const document_ = document.documentElement;
      if (range.startContainer !== document_.parentNode && range.startContainer !== document_ && range.startContainer !== document.body) return false;
      if (range.endContainer !== document_.parentNode && range.endContainer !== document_ && range.endContainer !== document.body) return false;
      return true;
    };
    const adoptWholeDocumentSelection = (): void => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const content = this.view.contentDOM;
      if (!content.getClientRects().length) return; // the editor is not the visible pane
      if (adoptWholePageSelection()) {
        // The page selection means the note: make it one, text-anchored, so
        // the editor reads back the selection the writer can see.
        const lines = content.querySelectorAll('.cm-line');
        const first = lines[0]?.firstChild;
        const lastLine = lines[lines.length - 1];
        const last = lastLine?.lastChild;
        if (first?.nodeType === Node.TEXT_NODE && last?.nodeType === Node.TEXT_NODE) {
          const restored = document.createRange();
          restored.setStart(first, 0);
          restored.setEnd(last, last.textContent?.length ?? 0);
          const dom = window.getSelection()!;
          dom.removeAllRanges();
          dom.addRange(restored);
        }
        this.view.focus();
        selectWholeNote();
        return;
      }
      const range = selection.getRangeAt(0);
      const whole = document.createRange();
      whole.selectNodeContents(content);
      if (range.compareBoundaryPoints(Range.START_TO_START, whole) > 0
        || range.compareBoundaryPoints(Range.END_TO_END, whole) < 0) return;
      const anchor = selection.anchorNode;
      if (!(anchor && content.contains(anchor)) && !this.view.hasFocus) return;
      // Anchor the platform's range on the note's own text — the first line's
      // first character to the last line's last — so the selection the editor
      // saves is the one CodeMirror can read back, whatever it does with the
      // element-level range the platform left behind.
      const lines = content.querySelectorAll('.cm-line');
      const first = lines[0]?.firstChild;
      const lastLine = lines[lines.length - 1];
      const last = lastLine?.lastChild;
      if (first?.nodeType === Node.TEXT_NODE && last?.nodeType === Node.TEXT_NODE) {
        const restored = document.createRange();
        restored.setStart(first, 0);
        restored.setEnd(last, last.textContent?.length ?? 0);
        selection.removeAllRanges();
        selection.addRange(restored);
      }
      selectWholeNote();
    };
    this.view.contentDOM.addEventListener('beforeinput', selectAllInput);
    for (const type of ['pointerdown', 'touchstart'] as const) {
      this.view.contentDOM.addEventListener(type, noteFingerDown, { capture: true, passive: true });
    }
    for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const) {
      this.view.contentDOM.addEventListener(type, noteFingerUp, { capture: true, passive: true });
    }
    // Capture, on the window: before the document's own listeners (CodeMirror's
    // included), while the platform's selection is still the platform's.
    window.addEventListener('selectstart', selectAllCommand, true);
    window.addEventListener('selectionchange', adoptWholeDocumentSelection, true);
    window.addEventListener('keydown', noteKeyDown, true);
    this.cleanupSelectionAdoption = () => {
      alive = false;
      this.view.contentDOM.removeEventListener('beforeinput', selectAllInput);
      for (const type of ['pointerdown', 'touchstart'] as const) {
        this.view.contentDOM.removeEventListener(type, noteFingerDown, true);
      }
      for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const) {
        this.view.contentDOM.removeEventListener(type, noteFingerUp, true);
      }
      window.removeEventListener('selectstart', selectAllCommand, true);
      window.removeEventListener('selectionchange', adoptWholeDocumentSelection, true);
      window.removeEventListener('keydown', noteKeyDown, true);
    };
    // The keyboard opening shrinks the viewport by far more than an address
    // bar does; only that counts.
    let viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    window.visualViewport?.addEventListener('resize', () => {
      const height = window.visualViewport!.height;
      const shrunk = viewportHeight - height;
      viewportHeight = height;
      if (shrunk > 120) revealSoon(160);
    });
  }
  getValue(): string { return this.view.state.doc.toString(); }
  setTitle(base: string): void { this.view.dispatch({ effects: setTitleEffect.of(base) }); }
  setReadOnly(on: boolean): void {
    if (on) this.closeFind();
    this.isReadOnly = on;
    this.view.dispatch({ effects: readOnlySlot.reconfigure(on
      ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
      : [EditorState.readOnly.of(false), EditorView.editable.of(true)]) });
  }
  /** Drop the caret (and keep it dropped) so a parent transform cannot be
   *  fought by the browser keeping the insertion point on screen. */
  setCaretOff(on: boolean): void {
    this.view.contentDOM.blur();
    this.view.dispatch({ effects: readOnlySlot.reconfigure(this.isReadOnly || on
      ? [EditorState.readOnly.of(this.isReadOnly), EditorView.editable.of(false)]
      : [EditorState.readOnly.of(false), EditorView.editable.of(true)]) });
  }
  setTitleEditable(on: boolean): void {
    const title = this.view.dom.querySelector<HTMLElement>('.cm-file-name');
    if (!title) return;
    title.contentEditable = String(on);
    title.setAttribute('aria-readonly', String(!on));
    if (!on) title.blur();
  }
  /** Select the whole note, giving the editor the focus so copy works too. */
  selectAll(): void {
    this.view.focus();
    // Nothing to bring into view: the whole note is selected, and its head is
    // at the note's end — a scroll for it would take the reader to the bottom.
    this.view.dispatch({ selection: { anchor: 0, head: this.view.state.doc.length }, scrollIntoView: false });
  }
  focusTitle(): void {
    const el = this.view.dom.querySelector<HTMLElement>('.cm-file-name');
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    selection?.selectAllChildren(el);
  }
  /** Settings: line numbers on or off. */
  /** The space after a sign (src/autoSpace.ts), on or off as the settings say.
   *  The rule reads the field each time, so reconfiguring is a no-op change of
   *  the value alone. */
  setAutoSpace(on: boolean): void {
    if (on === this.autoSpaceOn) return;
    this.autoSpaceOn = on;
    this.view.dispatch({ effects: autoSpaceSlot.reconfigure(autoSpace(() => this.autoSpaceOn)) });
  }
  /** Open this file as what it is. A note, a page and plain text are read by
   *  the Markdown parser as they always were; a file with a language behind
   *  it — .js, .json, .css, .py, .yaml — is parsed by that language instead,
   *  and everything Markdown brings with it steps aside: no live preview
   *  turning a `#` comment into a heading, no list continuation, no marker
   *  widths, no math scan, and every line left to right, as a fenced block
   *  has always been here. Simple editing, in the file's own colours.
   *
   *  The grammar is fetched on demand (each is its own chunk), so the editor
   *  shows the file at once and colours it a moment later. */
  async setFileLanguage(name: string): Promise<void> {
    const description = codeLanguage(name);
    const asCode = Boolean(description) && fileKind(name) === 'code';
    if (asCode === this.codeMode && (!asCode || this.codeName === name)) return;
    this.codeMode = asCode;
    this.codeName = asCode ? name : '';
    setCodeDocument(asCode);
    this.view.contentDOM.classList.toggle('is-code-file', asCode);
    if (!asCode) {
      this.view.dispatch({ effects: [
        languageSlot.reconfigure(readsEveryNumber(markdown({ base: markdownLanguage, addKeymap: false, extensions: [Highlight], codeLanguages: languages }))),
        markdownOnlySlot.reconfigure([headingLineField, livePreview]),
        markdownLateSlot.reconfigure([persianListMarkerPlugin, mathSource]),
      ] });
      return;
    }
    this.view.dispatch({ effects: [
      markdownOnlySlot.reconfigure([]),
      markdownLateSlot.reconfigure([]),
    ] });
    const support = await description!.load();
    if (this.codeName !== name) return; // another file arrived while the grammar loaded
    this.view.dispatch({ effects: languageSlot.reconfigure(support) });
  }
  setLineNumbers(on: boolean): void {
    gutterScript.on = on;
    // The caret line's own script, before the gutter first draws.
    gutterScript.script = gutterScriptFor(this.view);
    this.view.dispatch({ effects: lineNumberSlot.reconfigure(on ? lineNumberConfig() : []) });
  }
  /** Settings: the note's font size or line height changed (CSS variables). */
  remeasure(): void { this.view.requestMeasure(); }
  /** Load another note's text, with a fresh undo history. */
  setValue(value: string): void {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value }, effects: historySlot.reconfigure([]) });
    this.view.dispatch({ effects: historySlot.reconfigure(history()) });
  }
  /** Reattach a living tab, including both undo AND redo branches. */
  restoreSession(state: EditorState): void { this.view.setState(state); }
  /** External reloads remain undoable within the same tab session. */
  replaceValue(value: string): void {
    if (value === this.getValue()) return;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value }, annotations: isolateHistory.of('full') });
  }
  focus(): void { this.view.focus(); }
  /** Let the note go. The bar's own taps must not leave the WebView with an
   *  editable still focused: Android re-opens the keyboard for the editable
   *  that still has it when a button in the page is tapped ("the bottom
   *  hamburger sometimes triggers the keyboard"). The note itself is
   *  untouched — same document, same selection, same scroll. */
  blur(): void { if (this.view.hasFocus) this.view.contentDOM.blur(); }
  /** Caret / selection as [anchor, head], for remembering between sessions. */
  getSelection(): [number, number] {
    const { anchor, head } = this.view.state.selection.main;
    return [anchor, head];
  }
  /** Replace the selection (or insert at the caret) — paste, and the cut that
   *  follows the copy. One transaction, so undo takes it back in one step. */
  insertText(text: string): void {
    if (this.isReadOnly) return;
    this.view.dispatch(this.view.state.replaceSelection(text), { userEvent: 'input.paste' });
  }
  /** Put the caret (or a selection) somewhere. `keepStill` places it without
   *  scrolling — the note must not move for a position the reader did not ask
   *  to see. */
  setSelection(anchor: number, head = anchor, keepStill = false): void {
    const max = this.view.state.doc.length;
    // Never a scroll request: a position the app places (a restored caret, a
    // saved session, a tab that comes back) is not a reason to move the note —
    // the note is already where the reader left it, and the jumps they ask for
    // (an outline line, a search hit) request their own scroll.
    this.view.dispatch({
      selection: { anchor: Math.min(anchor, max), head: Math.min(head, max) },
      scrollIntoView: keepStill ? false : false,
    });
  }
  get hasFocus(): boolean { return this.view.hasFocus; }
  openFind(replace = false): void { openFind(this.view, replace && !this.isReadOnly); }
  closeFind(): void { closeFind(this.view); }
  get findOpen(): boolean { return isFindOpen(this.view.state); }
  headings(): Heading[] { return collectHeadings(this.view.state); }
  /** Unfold whatever hides this position, so it can be shown. */
  private unfoldAround(pos: number): void {
    const effects: ReturnType<typeof unfoldEffect.of>[] = [];
    foldedRanges(this.view.state).between(pos, pos, (from, to) => { if (from < pos && to >= pos) effects.push(unfoldEffect.of({ from, to })); });
    if (effects.length) this.view.dispatch({ effects });
  }
  /** Scroll a 0-based line to the top of the note area, without a caret. */
  revealLine(line: number, topOffset: number): void {
    const { doc } = this.view.state;
    const pos = doc.line(Math.min(doc.lines, Math.max(1, line + 1))).from;
    this.unfoldAround(pos);
    this.view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: topOffset }) });
  }
  /** Land on a range without selecting it — a search result. The caret goes
   *  *after* the hit: a real selection is what raises the phone's own selection
   *  bar and puts handles over the line, and the reader tapped a result to see
   *  where the word is, not to have it half-selected. The ring (the find bar's own
   *  match highlight) says where the hit is, for a few seconds or until the
   *  reader types, taps or selects anything. No focus, so no keyboard. */
  flashRange(from: number, to: number, ms = 4000): void {
    const max = this.view.state.doc.length;
    from = Math.max(0, Math.min(from, max));
    to = Math.max(from, Math.min(to, max));
    this.unfoldAround(from);
    this.view.dispatch({
      selection: EditorSelection.cursor(to),
      effects: [searchFlash.of({ from, to }), revealThirdDown(this.view, from)],
    });
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      if (this.view.state.field(searchFlashField, false)) this.view.dispatch({ effects: searchFlash.of(null) });
    }, ms);
  }
  private flashTimer: number | undefined;
  /** Fold / unfold the heading on this 0-based line. */
  toggleFold(line: number): boolean { return toggleHeadingFold(this.view, line); }
  foldAll(): void { foldAllHeadings(this.view); }
  unfoldAll(): void { unfoldAllHeadings(this.view); }
  /** 0-based lines of folded headings. */
  foldedLines(): number[] { return foldedHeadingLines(this.view.state); }
  restoreFolds(lines: number[]): void { restoreHeadingFolds(this.view, lines); }
  /** Run a keyboard-toolbar command by name. */
  run(command: string): boolean {
    if (this.isReadOnly) return false;
    const fn = toolbarOverrides[command] ?? toolbarCommands[command];
    return fn ? fn(this.view) : false;
  }
  findNext(): void { findNext(this.view); }
  findPrevious(): void { findPrevious(this.view); }
  undo(): void { if (!this.isReadOnly) undo(this.view); }
  redo(): void { if (!this.isReadOnly) redo(this.view); }
  destroy(): void {
    this.cleanupSelectionAdoption?.();
    this.view.destroy();
  }
  private cleanupSelectionAdoption?: () => void;
}
