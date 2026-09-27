import { defaultKeymap, history, historyKeymap, toggleComment, undo, redo } from '@codemirror/commands';
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { search, SearchQuery, setSearchQuery, findNext, findPrevious, replaceAll, replaceNext } from '@codemirror/search';
import { EditorState, StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, Decoration, ViewPlugin, WidgetType, GutterMarker, gutterLineClass, type ViewUpdate } from '@codemirror/view';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { livePreview } from './livePreview';
import { deleteDollarPair, inCode, inMath, mathSource } from './mathSource';
import { tightSelection } from './selection';
import { toolbarCommands } from './commands';

const rtlLineDirection = EditorView.theme({
  '&': { height: '100%', fontSize: '16px' },
  '.cm-scroller': { overflowY: 'auto', overscrollBehaviorY: 'contain', fontFamily: "'Vazirmatn', 'Segoe UI', Tahoma, system-ui, sans-serif", lineHeight: '1.85' },
  '.cm-content': { padding: '5.5rem max(1.25rem, calc((100% - 72ch) / 2)) 50vh', minHeight: '100%', tabSize: '2' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
});

// Line numbers sit in a smaller font than the text, so on their own they
// float toward the top of each line. Tag heading and code lines in the gutter
// so CSS can give their numbers the same line box as the text beside them.
class LineGutterClass extends GutterMarker {
  constructor(readonly elementClass: string) { super(); }
}
const headingGutterClasses = [1, 2, 3].map((level) => new LineGutterClass(`cm-ln-h${level}`));
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
      const heading = /^(?:ATX|Setext)Heading([1-3])$/.exec(node.name);
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

export class SatrEditor {
  readonly view: EditorView;
  constructor(parent: HTMLElement, onChange: () => void, options?: {
    title?: string;
    onRename?: (base: string) => string | null;
    checkName?: (base: string) => string | null;
    onSelection?: (position: number) => void;
    /** Height in px hidden at the bottom of the viewport (e.g. the keyboard toolbar). */
    obscuredBottom?: () => number;
  }) {
    initialTitle = options?.title ?? 'untitled';
    titleRuntime.onRename = options?.onRename ?? (() => null);
    titleRuntime.checkName = options?.checkName ?? (() => null);
    const extensions: Extension[] = [
      lineNumbers({ formatNumber: (n) => String(n) }), drawSelection({ cursorBlinkRate: 1200 }), tightSelection, history(), search(),
      // GFM base: strikethrough, task lists and tables get parsed.
      // No markdown keymap: its Backspace deletes a whole "- " / "- [ ] " at
      // once. Obsidian deletes character by character, revealing the raw
      // marker as the caret reaches it (see livePreview.ts).
      markdown({ base: markdownLanguage, addKeymap: false }),
      syntaxHighlighting(HighlightStyle.define([
        { tag: tags.processingInstruction, opacity: '0.42' },
        { tag: tags.heading1, fontWeight: '700', fontSize: '1.45em' },
        { tag: tags.heading2, fontWeight: '700', fontSize: '1.25em' },
        { tag: tags.heading3, fontWeight: '700', fontSize: '1.1em' },
        { tag: tags.strong, fontWeight: '700' },
        { tag: tags.emphasis, fontStyle: 'italic' },
        { tag: tags.strikethrough, textDecoration: 'line-through' },
        { tag: tags.link, color: 'var(--accent)' },
        { tag: tags.url, opacity: '0.62' },
        { tag: tags.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
      ])),
      titleField,
      rtlLineDirection, directionPlugin, persianListMarkerPlugin, lineGutterField, livePreview, mathSource,
      technicalContext, keyboardAttributes, closeBrackets(), pairs,
      // Keep the caret clear of the on-screen keyboard and the toolbar on
      // every scroll-into-view (typing, commands, selecting low on the screen).
      EditorView.scrollMargins.of(() => ({ bottom: 24 + (options?.obscuredBottom?.() ?? 0) })),
      EditorView.lineWrapping,
      EditorView.perLineTextDirection.of(true),
      EditorView.contentAttributes.of({ dir: 'auto' }),
      keymap.of([
        { key: 'Mod-s', run: () => { onChange(); return true; } },
        { key: 'Mod-f', run: (target) => { target.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) }); return true; } },
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
      }),
    ];
    this.view = new EditorView({ state: EditorState.create({ extensions }), parent });
    // When the keyboard opens (or the caret is placed by touch), bring the
    // caret above it. scrollIntoView honours the scrollMargins above, which
    // include the keyboard overlap and the toolbar.
    const focusCaret = (): void => {
      window.requestAnimationFrame(() => {
        if (!this.view.hasFocus) return;
        this.view.dispatch({ effects: EditorView.scrollIntoView(this.view.state.selection.main.head, { y: 'nearest' }) });
      });
    };
    this.view.contentDOM.addEventListener('focus', focusCaret);
    this.view.contentDOM.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.setTimeout(focusCaret, 40)));
      }
    });
    window.visualViewport?.addEventListener('resize', focusCaret);
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
  setValue(value: string): void { this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } }); }
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
  /** Run a keyboard-toolbar command by name. */
  run(command: string): boolean {
    const fn = toolbarCommands[command];
    return fn ? fn(this.view) : false;
  }
  findNext(): void { findNext(this.view); }
  findPrevious(): void { findPrevious(this.view); }
  replaceNext(): void { replaceNext(this.view); }
  replaceAll(): void { replaceAll(this.view); }
  undo(): void { undo(this.view); }
  redo(): void { redo(this.view); }
  destroy(): void { this.view.destroy(); }
}
