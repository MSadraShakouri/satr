import { defaultKeymap, history, historyKeymap, toggleComment, undo, redo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { search, SearchQuery, setSearchQuery, findNext, findPrevious, replaceAll, replaceNext } from '@codemirror/search';
import { EditorState, StateField, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';

const rtlLineDirection = EditorView.theme({
  '&': { height: '100%', fontSize: '16px' },
  '.cm-scroller': { overflowY: 'auto', overscrollBehaviorY: 'contain', fontFamily: "'Vazirmatn', 'Segoe UI', Tahoma, system-ui, sans-serif", lineHeight: '1.85' },
  '.cm-content': { padding: '5.5rem max(1.25rem, calc((100% - 72ch) / 2)) 50vh', minHeight: '100%', tabSize: '2' },
  '.cm-line': { padding: '0', unicodeBidi: 'plaintext' },
  '&.cm-focused': { outline: 'none' },
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

class TitleWidget extends WidgetType {
  constructor(readonly value: string) {
    super();
  }

  toDOM() {
    const input = document.createElement('input');
    input.className = 'cm-file-name';
    input.type = 'text';
    input.value = this.value;
    input.setAttribute('aria-label', 'File title');
    input.spellcheck = false;
    return input;
  }

  eq(other: TitleWidget) {
    return other.value === this.value;
  }

  ignoreEvent() {
    return false;
  }
}

const titleField = StateField.define({
  create() {
    return Decoration.set([
      Decoration.widget({
        widget: new TitleWidget('Main'),
        block: true,
        side: -1,
      }).range(0),
    ]);
  },
  update(deco) {
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export class SatrEditor {
  readonly view: EditorView;
  constructor(parent: HTMLElement, onChange: (text: string) => void, onSelection?: (position: number) => void) {
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
      rtlLineDirection, directionPlugin, persianListMarkerPlugin,
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
        if (update.selectionSet) onSelection?.(update.state.selection.main.head);
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
