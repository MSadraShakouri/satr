import { defaultKeymap, history, historyKeymap, toggleComment, undo, redo } from '@codemirror/commands';
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { closeFind, findBar, findNext, findPrevious, isFindOpen, openFind } from './findBar';
import { collectHeadings, type Heading } from './outline';
import { Compartment, EditorState, StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, Decoration, ViewPlugin, WidgetType, GutterMarker, gutterLineClass, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { wikiLinks, wikiRuntime } from './wikiLinks';
import { livePreview } from './livePreview';
import { deleteDollarPair, inCode, inMath, mathSource } from './mathSource';
import { tightSelection } from './selection';
import { toolbarCommands } from './commands';
import { foldAllHeadings, foldedHeadingLines, headingFolding, restoreHeadingFolds, toggleHeadingFold, unfoldAllHeadings } from './headingFold';
import { foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';

const rtlLineDirection = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--note-font-size)' },
  '.cm-scroller': { overflowY: 'auto', overscrollBehaviorY: 'contain', fontFamily: "'Vazirmatn', 'Segoe UI', Tahoma, system-ui, sans-serif", lineHeight: 'var(--note-line-height)' },
  '.cm-content': { padding: 'var(--view-top-spacing-markdown) var(--file-margin-x) 50vh', minHeight: '100%', tabSize: '2' },
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

// Line direction, as Obsidian's editor does it: each line gets an explicit
// dir from its first strong letter (list, quote and task markers skipped), and
// a line with no letters — an empty line, a line of digits — keeps the
// direction of the line above. So the caret on a fresh line after Persian
// text sits on the right, ready to continue in Persian.
const RTL_OR_LTR = /([\u200F\p{sc=Arabic}\p{sc=Hebrew}\p{sc=Syriac}\p{sc=Thaana}])|([\u200E\p{L}])/u;
const LINE_PREFIX = /^([>\s]*)(([*+-] |(\d+|[۰-۹٠-٩]+)([.)] ))(?:\[(.)\] )?)?/;
type Dir = 'rtl' | 'ltr' | 'auto';
function lineDirection(text: string): Dir {
  const prefix = LINE_PREFIX.exec(text);
  const match = RTL_OR_LTR.exec(prefix?.[0] ? text.slice(prefix[0].length) : text);
  return match ? (match[1] ? 'rtl' : 'ltr') : 'auto';
}
const dirDecorations = {
  rtl: Decoration.line({ attributes: { dir: 'rtl' } }),
  ltr: Decoration.line({ attributes: { dir: 'ltr' } }),
  auto: Decoration.line({ attributes: { dir: 'auto' } }),
};
function buildDirections(view: EditorView) {
  const { doc } = view.state;
  const builder = new RangeSetBuilder<Decoration>();
  let inherited: Dir = 'auto';
  const blocks = view.viewportLineBlocks;
  // Seed from the nearest line with letters above the viewport.
  if (blocks.length) {
    for (let n = doc.lineAt(blocks[0].from).number - 1, steps = 0; n >= 1 && steps < 200; n -= 1, steps += 1) {
      const dir = lineDirection(doc.line(n).text);
      if (dir !== 'auto') { inherited = dir; break; }
    }
  }
  for (const block of blocks) {
    const line = doc.lineAt(block.from);
    let dir = lineDirection(line.text);
    if (dir === 'auto') dir = inherited;
    builder.add(line.from, line.from, dirDecorations[dir]);
    inherited = dir;
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
  const parsed = ordered ? parseListNumber(ordered[1]) : null;
  const next = parsed ? `${formatListNumber(parsed.number + 1, parsed.alphabet)}${ordered?.[2] ?? '.'}` : marker;
    const insertion = `\n${indent}${next} ${(task ?? '')}`;
    const cursor = selection.head + insertion.length;
    view.dispatch({ changes: { from: selection.head, insert: insertion }, selection: { anchor: cursor }, userEvent: 'input.enter' });
    return true;
}

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

// Code and math want a keyboard without word suggestions or autocorrect, like
// Termux. Chromium on Android turns the suggestion strip off only for
// autocomplete="off" (TYPE_TEXT_FLAG_NO_SUGGESTIONS; spellcheck feeds no IME
// flag) and drops auto-correct for autocorrect="off". Prose keeps both. The
// number row is Gboard's own choice and can't be requested from a web page.
const technicalContext = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    const { head } = tr.state.selection.main;
    return inCode(tr.state, head) || inMath(tr.state, head);
  },
});
const keyboardAttributes = EditorView.contentAttributes.compute([technicalContext], (state): Record<string, string> => (state.field(technicalContext)
  ? { spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', autocomplete: 'off' }
  : { spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }));

// Brackets and quotes pair up as you type (Obsidian's "Auto pair brackets");
// "$" has its own rules in mathSource.ts. No "'" — it's an apostrophe in prose.
const pairs = EditorState.languageData.of(() => [{
  closeBrackets: { brackets: ['(', '[', '{', '"', '`', '«'], before: ')]}:;>.,!?»،؛$`"' },
}]);

// A finger is on the note text (see scrollMargins and revealCaret below).
let touching = false;

const lineNumberSlot = new Compartment();
// Undo history, reset whenever another note is loaded: undoing right after
// opening a note must never bring back the previous note's text.
const historySlot = new Compartment();

export class SatrEditor {
  readonly view: EditorView;
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
      lineNumberSlot.of(lineNumbers({ formatNumber: (n) => String(n) })), drawSelection({ cursorBlinkRate: 1200 }), tightSelection, historySlot.of(history()), findBar,
      // GFM base: strikethrough, task lists and tables get parsed.
      // No markdown keymap: its Backspace deletes a whole "- " / "- [ ] " at
      // once. Obsidian deletes character by character, revealing the raw
      // marker as the caret reaches it (see livePreview.ts).
      markdown({ base: markdownLanguage, addKeymap: false }),
      syntaxHighlighting(HighlightStyle.define([
        { tag: tags.processingInstruction, opacity: '0.42' },
        { tag: tags.strong, fontWeight: '700' },
        { tag: tags.emphasis, fontStyle: 'italic' },
        { tag: tags.strikethrough, textDecoration: 'line-through' },
        { tag: tags.link, color: 'var(--accent)' },
        { tag: tags.url, opacity: '0.62' },
        { tag: tags.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
      ])),
      titleField,
      rtlLineDirection, directionPlugin, persianListMarkerPlugin, lineGutterField, headingLineField, livePreview, mathSource,
      technicalContext, keyboardAttributes, closeBrackets(), pairs,
      // Keep the caret clear of the on-screen keyboard and the toolbar when
      // typing and running commands. Not while a finger is on the text:
      // selecting near the bottom then made CodeMirror jump the page at once,
      // because it counted the space the keyboard was about to cover as
      // hidden. The caret is brought up gently afterwards instead (below).
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
        { key: 'Enter', run: continueOnEnter },
        { key: 'Enter', run: insertNewlineContinueMarkup }, // quotes etc.
        { key: 'Tab', run: indentMore, shift: outdentLess },
        { key: 'Backspace', run: deleteDollarPair },
        ...closeBracketsKeymap,
        ...defaultKeymap, ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(); // the text is read lazily (getValue)
        if (update.selectionSet) options?.onSelection?.(update.state.selection.main.head);
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
    this.view.contentDOM.addEventListener('touchstart', (event) => {
      window.clearTimeout(touchTimer);
      touching = true;
      touchMoved = false;
      touchStartY = event.touches[0]?.clientY ?? 0;
      const { anchor, head } = this.view.state.selection.main;
      touchSelection = [anchor, head];
    }, { passive: true });
    this.view.contentDOM.addEventListener('touchmove', (event) => {
      if (Math.abs((event.touches[0]?.clientY ?? touchStartY) - touchStartY) > 10) touchMoved = true;
    }, { passive: true });
    const release = (): void => {
      window.clearTimeout(touchTimer);
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
    this.view.contentDOM.addEventListener('touchcancel', release, { passive: true });
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
  openFind(replace = false): void { openFind(this.view, replace); }
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
    const fn = toolbarCommands[command];
    return fn ? fn(this.view) : false;
  }
  findNext(): void { findNext(this.view); }
  findPrevious(): void { findPrevious(this.view); }
  undo(): void { undo(this.view); }
  redo(): void { redo(this.view); }
  destroy(): void { this.view.destroy(); }
}
