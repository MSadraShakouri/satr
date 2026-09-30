import { sourceDirections, majorityDirection } from './direction';
import { defaultKeymap, insertNewlineAndIndent, isolateHistory, history, historyKeymap, toggleComment, undo, redo } from '@codemirror/commands';
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { closeFind, findBar, findNext, findPrevious, isFindOpen, openFind } from './findBar';
import { collectHeadings, type Heading } from './outline';
import { Annotation, Compartment, Prec, EditorSelection, EditorState, StateField, StateEffect, RangeSetBuilder, type Extension, type Text } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, Decoration, ViewPlugin, WidgetType, GutterMarker, gutterLineClass, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { caretMotion } from './caretMotion';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { wikiLinks, wikiRuntime } from './wikiLinks';
import { livePreview } from './livePreview';
import { Highlight, highlightTag } from './highlightSyntax';
import { inCode, inMath, mathSource } from './mathSource';
import { deleteDelimiterPair, delimiterInput, enterDisplayMath } from './delimiterInput';
import { tightSelection } from './selection';
import { TapTracker, wordRangeAt, type Range } from './touchSelection';
import { toolbarCommands } from './commands';
import { foldAllHeadings, foldedHeadingLines, headingFolding, restoreHeadingFolds, toggleHeadingFold, unfoldAllHeadings } from './headingFold';
import { foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';

const rtlLineDirection = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--note-font-size)' },
  '.cm-scroller': { overflowY: 'auto', overscrollBehaviorY: 'contain', fontFamily: "'Vazirmatn', 'Segoe UI', Tahoma, system-ui, sans-serif", lineHeight: 'var(--note-line-height)' },
  '.cm-content': { padding: 'var(--view-top-spacing-markdown) var(--file-margin-x) calc(50vh + 96px)', minHeight: '100%', tabSize: '2' },
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

const persianListMarkerPlugin = ViewPlugin.fromClass(class {
  decorations: any;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }): void {
    if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
  }
  build(view: EditorView) {
    const ranges = [];
    for (const visible of view.visibleRanges) {
      let line = view.state.doc.lineAt(visible.from);
      while (true) {
        const match = /^(\s*[۰-۹٠-٩]+[.)])(?=\s)/.exec(line.text);
        if (match) ranges.push(Decoration.mark({ class: 'cm-live-marker' }).range(line.from, line.from + match[1].length));
        if (line.to >= visible.to || line.number >= view.state.doc.lines) break;
        line = view.state.doc.line(line.number + 1);
      }
    }
    return Decoration.set(ranges, true);
  }
}, { decorations: (value) => value.decorations });

// Cache whole-document context; viewport changes only rebuild decorations.
const directionsField = StateField.define({
  create: (state) => sourceDirections(state.doc.toString()),
  update: (value, tr) => tr.docChanged ? sourceDirections(tr.newDoc.toString()) : value,
});
const dirDecorations = {
  rtl: Decoration.line({ attributes: { dir: 'rtl' } }),
  ltr: Decoration.line({ attributes: { dir: 'ltr' } }),
};
function buildDirections(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  const directions = view.state.field(directionsField);
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

const digitMaps = {
  latin: '0123456789',
  persian: '۰۱۲۳۴۵۶۷۸۹',
  arabic: '٠١٢٣٤٥٦٧٨٩',
} as const;
function parseListNumber(value: string): { number: number; alphabet: keyof typeof digitMaps } {
  const alphabet = /[۰-۹]/.test(value) ? 'persian' : /[٠-٩]/.test(value) ? 'arabic' : 'latin';
  const number = [...value].reduce((total, digit) => total * 10 + digitMaps[alphabet].indexOf(digit), 0);
  return { number, alphabet };
}
function formatListNumber(number: number, alphabet: keyof typeof digitMaps): string {
  return String(number).split('').map((digit) => digitMaps[alphabet][Number(digit)]).join('');
}

// Automatic numbering for ordered lists (the writer's request). Two moments
// touch the writer's numbers, and only those two:
//
// * Enter on an item writes the new item after the item above it (that is
//   continueOnEnter), and then lifts the items *below* only as far as they
//   need to go: each one has to be bigger than the one above it, so `6.` then
//   Enter gives `7.` and an `8.` under it stays `8.` — it already fits — while
//   `1. 2. 3.` becomes `1. 2. 3. 4.`
//
// * A line that leaves the list — deleted whole, joined to the line above,
//   or emptied — brings the items below it down by the number of items that
//   went. Editing an item's text, or its marker, without the line going, moves
//   nothing.
//
// Everything else keeps its numbers: typing, pasting and opening a note never
// renumber anything, and a blank line, prose or another marker ends the run
// (two lists separated by a blank line are two lists). A nested list numbers
// itself and is stepped over; the digits keep the set they were written in, so
// a Persian list stays Persian.
const listRenumber = Annotation.define<boolean>();
const ITEM_LINE = /^([ \t]*)([0-9۰-۹٠-٩]+)([.)])([ \t])/;
// A line the writer is taking apart: the whole item, "2." with its text gone,
// or "2" with the marker half-deleted. Only a line that holds nothing else.
const STRUCK_ITEM = /^([ \t]*)([0-9۰-۹٠-٩]+)([.)])?([ \t]*)$/;

interface Marker { indent: string; delimiter: string }

function itemMarker(line: string): Marker | null {
  const match = ITEM_LINE.exec(line);
  return match ? { indent: match[1], delimiter: match[3] } : null;
}

/** The item one Enter made: a new item's marker on a line of its own, and the
 *  number it was given. A marker written by hand, a pasted list or a note
 *  being loaded are not Enter, and none of them renumber anything. */
function insertedItem(text: string): { marker: Marker | null; number: number } {
  const lines = text.split('\n');
  if (lines.length > 2 || !text.includes('\n')) return { marker: null, number: 0 };
  const line = lines.find((one) => ITEM_LINE.test(one));
  if (!line) return { marker: null, number: 0 };
  const match = ITEM_LINE.exec(line)!;
  return { marker: { indent: match[1], delimiter: match[3] }, number: parseListNumber(match[2]).number };
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

/** The first line starting at or after `pos`: the line a deletion left
 *  behind. A deletion can end on the break before the next line — the app's
 *  own delete-line takes the break *above* the line it removes — so the line
 *  holding `pos` is not always the line to start at. */
function lineAtOrAfter(doc: EditorState['doc'], pos: number): number {
  const line = doc.lineAt(pos);
  return line.from >= pos ? line.number : line.number + 1;
}

const listNumbering = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(listRenumber)) return tr;
  // A paste or a drop is the writer's own material: whatever numbers came with
  // it are kept (insertedItem would otherwise read a pasted newline plus item
  // as an Enter).
  if (tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop')) return tr;
  // What the edit did to the list: the first change that added or removed an
  // item decides, and the run after it is the one to renumber.
  const plan: { kind: 'add' | 'remove' | null; marker: Marker | null; number: number; count: number; from: number } =
    { kind: null, marker: null, number: 0, count: 0, from: -1 };
  tr.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
    if (plan.kind) return;
    if (inCode(tr.startState, fromA) || inMath(tr.startState, fromA)) return;
    const added = insertedItem(inserted.toString());
    if (added.marker) {
      plan.kind = 'add';
      plan.marker = added.marker;
      plan.number = added.number;
      // The run begins after the item that was just made.
      plan.from = tr.newDoc.lineAt(toB).number + 1;
      return;
    }
    const gone = removedItems(tr, fromA, toA);
    if (!gone.count || !gone.marker) return;
    plan.kind = 'remove';
    plan.marker = gone.marker;
    plan.count = gone.count;
    // …or at the line the deletion left behind. A line the writer emptied is
    // still standing, and holds nothing: the run begins under it.
    plan.from = lineAtOrAfter(tr.newDoc, toB);
    if (gone.emptied && plan.from <= tr.newDoc.lines && !tr.newDoc.line(plan.from).text.trim()) plan.from += 1;
  });
  if (!plan.kind || !plan.marker || plan.from < 1) return tr;
  const kind = plan.kind;
  const marker = plan.marker as Marker;
  const count = plan.count;
  const from = plan.from;
  const doc = tr.newDoc;
  const changes: { from: number; to: number; insert: string }[] = [];
  // The number of the last item seen at the list's own level: the next one has
  // to be bigger than it (an insertion lifts the run), or is moved down with
  // it (a removal shifts the run).
  let previous = plan.number;
  for (let n = from; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    // A blank line ends the list, and so does a formula: two lists with air
    // between them, or a formula holding numbered lines, are left alone.
    if (!line.text.trim() || inMath(tr.state, line.from)) break;
    const match = ITEM_LINE.exec(line.text);
    if (!match) {
      // Indented text belongs to the item above it; anything else at the
      // list's own level ends the run.
      if (/^[ \t]/.test(line.text)) continue;
      break;
    }
    const depth = match[1].length;
    // A nested list numbers itself; it does not stand between the items of
    // the list it hangs under.
    if (depth > marker.indent.length) continue;
    if (depth < marker.indent.length || match[3] !== marker.delimiter) break;
    const parsed = parseListNumber(match[2]);
    let wanted = kind === 'add' ? Math.max(parsed.number, previous + 1) : parsed.number - count;
    if (wanted < 1) break;
    if (wanted !== parsed.number) {
      changes.push({
        from: line.from + match[1].length,
        to: line.from + match[1].length + match[2].length,
        insert: formatListNumber(wanted, parsed.alphabet),
      });
    }
    previous = wanted;
  }
  if (!changes.length) return tr;
  return [tr, { changes, sequential: true, annotations: listRenumber.of(true) }];
});

/** An item with nothing written on it yet: its marker (a to-do box counts)
 *  and nothing else. */
const EMPTY_ITEM_LINE = /^([ \t]*)([-*+]|[0-9۰-۹٠-٩]+[.)])([ \t]+(\[[ xX]\])?)?[ \t]*$/;

/** Are these two markers the same list continuing? Numbers may differ — the
 *  writer's own spacing is theirs — but the kind and the delimiter must hold. */
function sameKind(one: string, other: string): boolean {
  const first = /^([0-9۰-۹٠-٩]+)([.)])$/.exec(one);
  const second = /^([0-9۰-۹٠-٩]+)([.)])$/.exec(other);
  if (first && second) return first[2] === second[2];
  if (first || second) return false;
  return one === other;
}

function continueOnEnter(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) return false;
  const line = state.doc.lineAt(selection.head);
  const before = state.sliceDoc(line.from, selection.head);
  const match = /^(\s*)([-*+]|[0-9۰-۹٠-٩]+[.)])\s+(\[[ xX]\]\s+)?/.exec(before);
  if (!match) return false;
  const [whole, indent, marker, task] = match;
  if (!before.slice(whole.length).trim()) {
    view.dispatch({ changes: { from: line.from, to: selection.head, insert: '' }, selection: { anchor: line.from }, userEvent: 'input.enter' });
    return true;
  }
  const ordered = /^([0-9۰-۹٠-٩]+)([.)])$/.exec(marker);
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
  const parsed = ordered ? parseListNumber(ordered[1]) : null;
  const next = parsed ? `${formatListNumber(parsed.number + 1, parsed.alphabet)}${ordered?.[2] ?? '.'}` : marker;
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
  return enterDisplayMath(view) || continueOnEnter(view) || insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view);
}

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
  if (selection.empty) return false;
  const changes = selectedLines(view).flatMap((line) => {
    const spaces = /^ {1,2}/.exec(line.text);
    return spaces ? [{ from: line.from, to: line.from + spaces[0].length, insert: '' }] : [];
  });
  if (changes.length) view.dispatch({ changes });
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

class TitleWidget extends WidgetType {
  constructor(readonly value: string) {
    super();
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
        if (commit()) enterNote();
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

  eq(other: TitleWidget) {
    return other.value === this.value;
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

// Markor's keyboard: word auto-correct and the suggestion strip stay on,
// but there are no spell-check underlines in the note. Chromium on Android
// turns the suggestion strip off for autocomplete="off"
// (TYPE_TEXT_FLAG_NO_SUGGESTIONS) and drops auto-correct for
// autocorrect="off", so both are on here; only spellcheck (red squiggles)
// and the browser's own writing-suggestions underlines are off. Trade-off:
// with suggestions the keyboard holds the current word in composition, so
// "(", "`" and "$" may pair up only once the word commits. (The number row
// is Gboard's own choice and can't be requested from a web page.)
const keyboardAttributes = EditorView.contentAttributes.of({
  spellcheck: 'false', autocorrect: 'on', autocapitalize: 'off', autocomplete: 'on', writingsuggestions: 'false',
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

// A finger is on the note text (see scrollMargins and revealCaret below).
let touching = false;

const lineNumberSlot = new Compartment();
const readOnlySlot = new Compartment();
// New tabs start clean; living tabs reattach their complete EditorState.
// Histories never cross files and are never serialized to disk.
const historySlot = new Compartment();

export class SatrEditor {
  readonly view: EditorView;
  private isReadOnly = false;
  constructor(parent: HTMLElement, onChange: () => void, options?: {
    title?: string;
    onRename?: (base: string) => string | null;
    checkName?: (base: string) => string | null;
    onSelection?: (position: number) => void;
    /** Height in px hidden at the bottom of the viewport (e.g. the keyboard toolbar). */
    obscuredBottom?: () => number;
    /** A heading was folded or unfolded. */
    onFold?: () => void;
    /** Wiki links: note names for the [[ popup, and opening a link. */
    linkNames?: () => string[];
    openLink?: (target: string, heading: string) => void;
  }) {
    if (options?.linkNames) wikiRuntime.names = options.linkNames;
    if (options?.openLink) wikiRuntime.open = options.openLink;
    initialTitle = options?.title ?? 'untitled';
    titleRuntime.onRename = options?.onRename ?? (() => null);
    titleRuntime.checkName = options?.checkName ?? (() => null);
    const extensions: Extension[] = [
      lineNumberSlot.of(lineNumbers({ formatNumber: (n) => String(n) })), drawSelection({ cursorBlinkRate: 1200 }), tightSelection, caretMotion, listNumbering, historySlot.of(history()), readOnlySlot.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]), findBar,
      // GFM base: strikethrough, task lists and tables get parsed.
      // No markdown keymap: its Backspace deletes a whole "- " / "- [ ] " at
      // once. Obsidian deletes character by character, revealing the raw
      // marker as the caret reaches it (see livePreview.ts).
      markdown({ base: markdownLanguage, addKeymap: false, extensions: [Highlight] }),
      syntaxHighlighting(HighlightStyle.define([
        { tag: tags.processingInstruction, opacity: '0.42' },
        { tag: tags.strong, fontWeight: '700' },
        { tag: tags.emphasis, fontStyle: 'italic' },
        { tag: tags.strikethrough, textDecoration: 'line-through' },
        { tag: highlightTag, backgroundColor: 'var(--text-highlight-bg)', color: 'var(--text-normal)' },
        { tag: tags.link, color: 'var(--accent)' },
        { tag: tags.url, opacity: '0.62' },
        { tag: tags.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
      ])),
      titleField,
      rtlLineDirection, directionsField, directionPlugin, persianListMarkerPlugin, lineGutterField, headingLineField, livePreview, mathSource,
      keyboardAttributes, closeBrackets(), pairs, Prec.high(delimiterInput),
      // Keep the caret clear of the on-screen keyboard and the toolbar when
      // typing and running commands. Not while a finger is on the text:
      // selecting near the bottom then made CodeMirror jump the page at once,
      // because it counted the space the keyboard was about to cover as
      // hidden. The caret is brought up gently afterwards instead (below).
      // Room under the last line: enough to bring it up past the middle of the
      // screen and keep writing at the bottom.
      EditorView.scrollMargins.of(() => (touching ? null : { bottom: 24 + (options?.obscuredBottom?.() ?? 0) })),
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
        { key: 'Enter', run: continueOnEnter },
        { key: 'Enter', run: insertNewlineContinueMarkup }, // quotes etc.
        { key: 'Tab', run: indentMore, shift: outdentLess },
        { key: 'Backspace', run: deleteDelimiterPair },
        ...closeBracketsKeymap,
        ...defaultKeymap, ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(); // the text is read lazily (getValue)
        if (update.selectionSet) options?.onSelection?.(update.state.selection.main.head);
        // A line made with Enter puts the caret on the line below the one on
        // screen; bring it in, exactly as typing a character does.
        if (update.transactions.some((tr) => tr.isUserEvent('input.enter'))) revealSoon(0);
        if (update.transactions.some((tr) => tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)))) options?.onFold?.();
      }),
    ];
    this.view = new EditorView({ state: EditorState.create({ extensions }), parent });
    // When the keyboard opens, or the caret is placed by touch, glide the
    // caret into the part of the screen the keyboard and toolbar leave
    // visible — a short smooth scroll, only if it is actually hidden, and
    // only once the keyboard has finished resizing the page.
    const revealCaret = (): void => {
      if (!this.view.hasFocus || touching) return;
      const coords = this.view.coordsAtPos(this.view.state.selection.main.head);
      if (!coords) return;
      const box = this.view.scrollDOM.getBoundingClientRect();
      const bottom = box.bottom - (options?.obscuredBottom?.() ?? 0) - 24;
      const top = box.top + 8;
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
    // Only after something that moved the caret or opened the keyboard —
    // never after a scroll. (Revealing on every finger lift, and on every
    // viewport resize, pulled the view back to the caret each time you tried
    // to scroll away from it; Chrome's address bar resizes the viewport as
    // you scroll.)
    this.view.contentDOM.addEventListener('focus', () => revealSoon(160));
    let touchTimer: number | undefined;
    let touchSelection: [number, number] = [0, 0];
    let touchMoved = false;
    let touchStartY = 0;
    // Double tap selects the word under the finger, and a drag after it (the
    // finger never lifted) selects more. The WebView does both itself when the
    // caret lives in the DOM selection, so this only fills the gap for the
    // browsers that don't: the fallback runs only while the selection is
    // exactly what it was when the second finger went down, so whatever the
    // browser selected itself always wins. The word itself is chosen by
    // src/touchSelection.ts, the same rule a phone keyboard uses.
    const taps = new TapTracker();
    let dragWord: { word: Range; anchor: number; head: number } | null = null;
    const wordAt = (x: number, y: number): Range | null => {
      const pos = this.view.posAtCoords({ x, y });
      return pos === null ? null : wordRangeAt(this.view.state.doc.toString(), pos);
    };
    const selectRange = (from: number, to: number): void => {
      this.view.dispatch({ selection: EditorSelection.range(from, to), userEvent: 'select.pointer', scrollIntoView: false });
    };
    // The browser's own word selection can land a frame or two after the lift,
    // so the fallback waits for it before deciding the browser did nothing.
    const selectWordIfUntouched = (pending: NonNullable<typeof dragWord>): void => {
      const check = (): void => {
        const { anchor, head } = this.view.state.selection.main;
        if (anchor === pending.anchor && head === pending.head) selectRange(pending.word.from, pending.word.to);
      };
      window.requestAnimationFrame(check);
      window.setTimeout(check, 120);
    };
    this.view.contentDOM.addEventListener('touchstart', (event) => {
      window.clearTimeout(touchTimer);
      touching = true;
      touchMoved = false;
      const touch = event.touches[0];
      touchStartY = touch?.clientY ?? 0;
      const { anchor, head } = this.view.state.selection.main;
      touchSelection = [anchor, head];
      // A widget (the file name, a list bullet, a link) has no word of the
      // note under it and brings its own editing; a second finger is not a tap.
      const onWidget = (event.target as HTMLElement | null)?.closest('.cm-widget, .cm-file-title, .cm-gutters, .cm-tooltip');
      const count = onWidget || !touch ? taps.cancel() : taps.start(event.timeStamp, touch.clientX, touchStartY, event.touches.length);
      const word = count >= 2 ? wordAt(touch!.clientX, touchStartY) : null;
      dragWord = word ? { word, anchor, head } : null;
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
    this.view.contentDOM.addEventListener('touchmove', (event) => {
      const touch = event.touches[0];
      if (Math.abs((touch?.clientY ?? touchStartY) - touchStartY) > 10) touchMoved = true;
      // Dragging after a double tap takes the selection with the finger, from
      // the word the tap found to the word under the finger now.
      if (!dragWord || !touch) return;
      const to = wordAt(touch.clientX, touch.clientY);
      if (!to) return;
      selectRange(Math.min(dragWord.word.from, to.from), Math.max(dragWord.word.to, to.to));
    }, { passive: true });
    const release = (): void => {
      window.clearTimeout(touchTimer);
      const word = dragWord;
      dragWord = null;
      if (word) selectWordIfUntouched(word);
      // Native selection handles keep adjusting for a moment after the lift.
      touchTimer = window.setTimeout(() => {
        touching = false;
        const { anchor, head } = this.view.state.selection.main;
        const selectionChanged = anchor !== touchSelection[0] || head !== touchSelection[1];
        // A scroll gesture leaves the caret alone; a tap or a handle drag
        // that moved the selection gets it revealed.
        if (selectionChanged && (!touchMoved || anchor !== head)) revealSoon(0);
      }, 350);
    };
    this.view.contentDOM.addEventListener('touchend', release, { passive: true });
    this.view.contentDOM.addEventListener('touchcancel', () => { taps.cancel(); dragWord = null; release(); }, { passive: true });
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
    this.view.dispatch({ selection: { anchor: 0, head: this.view.state.doc.length } });
  }
  focusTitle(): void {
    const el = this.view.dom.querySelector<HTMLElement>('.cm-file-name');
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    selection?.selectAllChildren(el);
  }
  /** Settings: line numbers on or off. */
  setLineNumbers(on: boolean): void {
    this.view.dispatch({ effects: lineNumberSlot.reconfigure(on ? lineNumbers({ formatNumber: (n) => String(n) }) : []) });
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
  /** Caret / selection as [anchor, head], for remembering between sessions. */
  getSelection(): [number, number] {
    const { anchor, head } = this.view.state.selection.main;
    return [anchor, head];
  }
  /** Put the caret back without focusing (no keyboard) and without scrolling. */
  setSelection(anchor: number, head = anchor): void {
    const max = this.view.state.doc.length;
    this.view.dispatch({ selection: { anchor: Math.min(anchor, max), head: Math.min(head, max) } });
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
  /** Select a range and centre it (search results); no focus, so no keyboard. */
  revealRange(from: number, to: number): void {
    const max = this.view.state.doc.length;
    from = Math.min(from, max); to = Math.min(to, max);
    this.unfoldAround(from);
    this.view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
  }
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
  destroy(): void { this.view.destroy(); }
}
