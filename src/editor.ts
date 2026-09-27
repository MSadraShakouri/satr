import { defaultKeymap, history, historyKeymap, toggleComment, undo, redo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { search, SearchQuery, setSearchQuery, findNext, findPrevious, replaceAll, replaceNext } from '@codemirror/search';
import { EditorState, StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, Decoration, ViewPlugin, WidgetType, GutterMarker, gutterLineClass } from '@codemirror/view';

const rtlLineDirection = EditorView.theme({
  '&': { height: '100%', fontSize: '16px' },
  '.cm-scroller': { overflowY: 'auto', overscrollBehaviorY: 'contain', fontFamily: "'Vazirmatn', 'Segoe UI', Tahoma, system-ui, sans-serif", lineHeight: '1.85' },
  '.cm-content': { padding: '5.5rem max(1.25rem, calc((100% - 72ch) / 2)) 50vh', minHeight: '100%', tabSize: '2' },
  '.cm-line': { padding: '0', unicodeBidi: 'plaintext' },
  '&.cm-focused': { outline: 'none' },
});

// Line numbers sit in a smaller font than the text, so on their own they
// float toward the top of each line. Tag heading lines in the gutter so CSS
// can give their numbers the heading's line box and centre them on it.
class HeadingGutterClass extends GutterMarker {
  constructor(readonly elementClass: string) { super(); }
}
const headingGutterClasses = [1, 2, 3].map((level) => new HeadingGutterClass(`cm-ln-h${level}`));
function buildHeadingGutter(state: EditorState) {
  const builder = new RangeSetBuilder<GutterMarker>();
  syntaxTree(state).iterate({
    enter: (node) => {
      const match = /^(?:ATX|Setext)Heading([1-3])$/.exec(node.name);
      if (!match) return;
      builder.add(node.from, node.from, headingGutterClasses[Number(match[1]) - 1]);
      return false;
    },
  });
  return builder.finish();
}
const headingGutterField = StateField.define({
  create: buildHeadingGutter,
  update: (markers, tr) =>
    tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? buildHeadingGutter(tr.state) : markers,
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

const directionPlugin = ViewPlugin.fromClass(class {
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
        ranges.push(Decoration.line({ attributes: { dir: 'auto' } }).range(line.from));
        if (line.to >= visible.to || line.number >= view.state.doc.lines) break;
        line = view.state.doc.line(line.number + 1);
      }
    }
    return Decoration.set(ranges, true);
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

export class SatrEditor {
  readonly view: EditorView;
  constructor(parent: HTMLElement, onChange: (text: string) => void, options?: {
    title?: string;
    onRename?: (base: string) => string | null;
    checkName?: (base: string) => string | null;
    onSelection?: (position: number) => void;
  }) {
    initialTitle = options?.title ?? 'untitled';
    titleRuntime.onRename = options?.onRename ?? (() => null);
    titleRuntime.checkName = options?.checkName ?? (() => null);
    const extensions: Extension[] = [
      lineNumbers({ formatNumber: (n) => String(n) }), drawSelection(), history(), search(), markdown(),
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
        { tag: tags.quote, color: 'var(--muted)' },
        { tag: tags.list, opacity: '0.72' },
      ])),
      titleField,
      rtlLineDirection, directionPlugin, persianListMarkerPlugin, headingGutterField,
      EditorView.lineWrapping,
      EditorView.perLineTextDirection.of(true),
      EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences', dir: 'auto' }),
      keymap.of([
        { key: 'Mod-s', run: () => { onChange(this.getValue()); return true; } },
        { key: 'Mod-f', run: (target) => { target.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) }); return true; } },
        { key: 'Mod-/', run: toggleComment },
        { key: 'Enter', run: continueOnEnter },
        { key: 'Tab', run: indentMore, shift: outdentLess },
        ...defaultKeymap, ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
        if (update.selectionSet) options?.onSelection?.(update.state.selection.main.head);
      }),
    ];
    this.view = new EditorView({ state: EditorState.create({ extensions }), parent });
    const focusCaret = (): void => {
      window.requestAnimationFrame(() => {
        const head = this.view.state.selection.main.head;
        const caret = this.view.coordsAtPos(head);
        const scroller = this.view.scrollDOM;
        if (!caret) return;
        const viewport = window.visualViewport;
        const keyboardTop = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
        const safeBottom = Math.min(keyboardTop, window.innerHeight) - 28;
        if (caret.bottom > safeBottom) scroller.scrollBy({ top: caret.bottom - safeBottom, behavior: 'smooth' });
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
  findNext(): void { findNext(this.view); }
  findPrevious(): void { findPrevious(this.view); }
  replaceNext(): void { replaceNext(this.view); }
  replaceAll(): void { replaceAll(this.view); }
  undo(): void { undo(this.view); }
  redo(): void { redo(this.view); }
  destroy(): void { this.view.destroy(); }
}
