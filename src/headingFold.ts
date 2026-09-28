// Heading folding, after Obsidian's "Fold heading": a heading hides
// everything under it down to the next heading of the same or a higher
// level. The fold control is a chevron at the end of the heading line (the
// left edge for a Persian heading, the right edge for an English one), so it
// never sits on top of the "#" or the first word the way a gutter arrow does.
// Tapping it folds without placing the caret, so the keyboard stays down.
// Folds are CodeMirror folds (@codemirror/language), so they move with edits;
// the preview mirrors them (src/main.ts) and they are remembered per note.
import { codeFolding, ensureSyntaxTree, foldable, foldEffect, foldedRanges, syntaxTree, unfoldEffect } from '@codemirror/language';
import { RangeSetBuilder, type EditorState, type StateEffect } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

const HEADING = /^(?:ATX|Setext)Heading([1-6])$/;
const lineClass = (level: number, folded: boolean) =>
  Decoration.line({ class: `cm-heading-fold cm-heading-fold-h${level}${folded ? ' is-folded' : ''}` });
const lineClasses = [1, 2, 3, 4, 5, 6].map((level) => [lineClass(level, false), lineClass(level, true)]);

/** Start positions of the lines whose section is folded. */
function foldedLineStarts(state: EditorState): Set<number> {
  const starts = new Set<number>();
  foldedRanges(state).between(0, state.doc.length, (from) => { starts.add(state.doc.lineAt(from).from); });
  return starts;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const folded = foldedLineStarts(state);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter: (node) => {
        const match = HEADING.exec(node.name);
        if (!match) return !/^(Paragraph|FencedCode|CodeBlock|Table|HTMLBlock)$/.test(node.name);
        const line = state.doc.lineAt(node.from);
        const isFolded = folded.has(line.from);
        // Only headings with something under them get a chevron.
        if (isFolded || foldable(state, line.from, line.to)) builder.add(line.from, line.from, lineClasses[Number(match[1]) - 1][isFolded ? 1 : 0]);
        return false;
      },
    });
  }
  return builder.finish();
}

const foldMarkers = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view); }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)
      || update.transactions.some((tr) => tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)))) {
      this.decorations = build(update.view);
    }
  }
}, { decorations: (value) => value.decorations });

/** Is this pointer position on the chevron of a heading line? */
function chevronLine(view: EditorView, event: MouseEvent): HTMLElement | null {
  const line = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('.cm-heading-fold');
  if (!line || !view.contentDOM.contains(line)) return null;
  const box = line.getBoundingClientRect();
  const rtl = getComputedStyle(line).direction === 'rtl';
  const zone = 36; // the 24px chevron plus a forgiving margin
  return (rtl ? event.clientX <= box.left + zone : event.clientX >= box.right - zone) ? line : null;
}

/** Fold or unfold the section under the heading on this (0-based) line. */
export function toggleHeadingFold(view: EditorView, lineIndex: number): boolean {
  const { state } = view;
  if (lineIndex < 0 || lineIndex >= state.doc.lines) return false;
  const line = state.doc.line(lineIndex + 1);
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(state).between(line.from, line.to + 1, (from, to) => {
    if (state.doc.lineAt(from).from === line.from) effects.push(unfoldEffect.of({ from, to }));
  });
  if (!effects.length) {
    const range = foldable(state, line.from, line.to);
    if (!range) return false;
    effects.push(foldEffect.of(range));
  }
  view.dispatch({ effects });
  return true;
}

/** 0-based lines of all folded headings (for the preview and view memory). */
export function foldedHeadingLines(state: EditorState): number[] {
  return [...foldedLineStarts(state)].map((from) => state.doc.lineAt(from).number - 1).sort((a, b) => a - b);
}

/** Fold every heading that has content under it (Obsidian's "Fold all"). */
export function foldAllHeadings(view: EditorView): void {
  const state = view.state;
  const tree = ensureSyntaxTree(state, state.doc.length, 500) ?? syntaxTree(state);
  const folded = foldedLineStarts(state);
  const effects: StateEffect<unknown>[] = [];
  tree.iterate({
    enter: (node) => {
      if (!HEADING.test(node.name)) return !/^(Paragraph|FencedCode|CodeBlock|Table|HTMLBlock)$/.test(node.name);
      const line = state.doc.lineAt(node.from);
      if (folded.has(line.from)) return false;
      const range = foldable(state, line.from, line.to);
      if (range) effects.push(foldEffect.of(range));
      return false;
    },
  });
  if (effects.length) view.dispatch({ effects });
}

export function unfoldAllHeadings(view: EditorView): void {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => { effects.push(unfoldEffect.of({ from, to })); });
  if (effects.length) view.dispatch({ effects });
}

/** Re-apply remembered folds, given as 0-based heading lines. */
export function restoreHeadingFolds(view: EditorView, lines: number[]): void {
  const state = view.state;
  if (!lines.length) return;
  ensureSyntaxTree(state, state.doc.length, 500);
  const effects: StateEffect<unknown>[] = [];
  for (const index of lines) {
    if (index < 0 || index >= state.doc.lines) continue;
    const line = state.doc.line(index + 1);
    const range = foldable(state, line.from, line.to);
    if (range) effects.push(foldEffect.of(range));
  }
  if (effects.length) view.dispatch({ effects });
}

export const headingFolding = [
  codeFolding({
    placeholderDOM(view, onclick) {
      // Obsidian's folded-section badge: a faint "…" after the heading.
      const el = document.createElement('span');
      el.className = 'cm-foldPlaceholder';
      el.textContent = '…';
      el.setAttribute('aria-label', 'Folded section');
      el.onclick = onclick;
      return el;
    },
  }),
  foldMarkers,
  EditorView.domEventHandlers({
    mousedown(event, view) {
      const line = chevronLine(view, event);
      if (!line) return false;
      event.preventDefault(); // no caret, no keyboard
      toggleHeadingFold(view, view.state.doc.lineAt(view.posAtDOM(line)).number - 1);
      return true;
    },
  }),
];
