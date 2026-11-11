// Wiki links in the editor, as in Obsidian's live preview:
// - [[Note]], [[Note|text]], [[Note#Heading]] and ![[embeds]] are styled as
//   links, except inside code. Unselected ordinary links also have a
//   Markdown-only live-preview extension below.
// - A tap on a link opens it, unless the caret is already inside it (then
//   the tap just moves the caret, so the link can be edited).
// - Typing [[ pops up the notes of the space, filtered as you type; picking
//   one completes the name and closes the brackets.
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, MatchDecorator, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { inMath, overlapsMath } from './mathSource';

export interface WikiLinkRuntime {
  names(): string[];
  open(target: string, heading: string): void;
}
export const wikiRuntime: WikiLinkRuntime = { names: () => [], open: () => {} };

const LINK = /(!?)\[\[([^[\]|#\n]*)(?:#([^[\]|\n]*))?(?:\|([^[\]\n]*))?\]\]/g;
const bracketMark = Decoration.mark({ class: 'cm-wikilink-bracket' });
const textMark = Decoration.mark({ class: 'cm-wikilink' });

function inCode(view: EditorView, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent) {
    if (/Code|HTML|URL/.test(node.name)) return true;
  }
  return false;
}

const decorator = new MatchDecorator({
  regexp: LINK,
  decorate(add, from, to, match, view) {
    if (inCode(view, from)) return;
    // Inside `$…$` brackets are formula characters, never a link (11).
    if (inMath(view.state, from) || overlapsMath(view.state, from, to)) return;
    const open = from + match[1].length + 2;
    add(from, open, bracketMark);
    if (to - 2 > open) add(open, to - 2, textMark);
    add(to - 2, to, bracketMark);
  },
});
const linkPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = decorator.createDeco(view); }
  update(update: ViewUpdate) { this.decorations = decorator.updateDeco(update, this.decorations); }
}, { decorations: (plugin) => plugin.decorations });


/** A complete, nonempty ordinary link in Markdown, not an embed or escaped
 * literal. Shared by the drawing and the end-of-line Enter guard. */
function canRenderWiki(view: EditorView, from: number, to: number, match: RegExpMatchArray): boolean {
  if (match[1] || inCode(view, from) || inMath(view.state, from) || overlapsMath(view.state, from, to)) return false;
  const before = view.state.sliceDoc(view.state.doc.lineAt(from).from, from);
  if (((/\\*$/.exec(before)?.[0].length ?? 0) % 2) === 1) return false;
  return Boolean((match[2].trim() || match[3]?.trim()) && (match[4] === undefined || match[4].trim()));
}

/** Ordinary wiki-link syntax in live preview. Replacements hide characters in
 * the DOM, not the document. A selection touching any part reveals the whole
 * link, as for the other inline marks. Embeds are deliberately left alone:
 * ![[...]] is an embed, not an ordinary link, and has its own rendering rules. */
const hiddenWiki = Decoration.replace({});
const wikiPreviewDecorator = new MatchDecorator({
  regexp: /(!?)\[\[([^[\]|#\n]*)(?:#([^[\]|\n]*))?(?:\|([^[\]\n]*))?\]\]/g,
  decorate(add, from, to, match, view) {
    if (!canRenderWiki(view, from, to, match)) return;
    const target = match[2];
    const heading = match[3];
    const alias = match[4];
    if (view.hasFocus && view.state.selection.ranges.some((range) => range.from <= to && range.to >= from)) return;
    let visibleFrom = from + 2;
    if (alias !== undefined) visibleFrom = to - 2 - alias.length;
    else if (!target && heading) visibleFrom += 1; // [[#Heading]] → Heading
    add(from, visibleFrom, hiddenWiki);
    add(to - 2, to, hiddenWiki);
  },
});

/** Separate from the clickable-link plugin so code files keep their source. */
export const wikiLinkPreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  // Most notes have no wiki links in the viewport. Avoid rescanning them on
  // every caret move; cover whole visible lines like MatchDecorator does.
  hasCandidates: boolean;
  constructor(view: EditorView) {
    this.hasCandidates = this.mightContainLinks(view);
    this.decorations = wikiPreviewDecorator.createDeco(view);
  }
  mightContainLinks(view: EditorView): boolean {
    return view.visibleRanges.some(({ from, to }) => view.state.sliceDoc(
      view.state.doc.lineAt(from).from, view.state.doc.lineAt(to).to,
    ).includes('[['));
  }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.hasCandidates = this.mightContainLinks(update.view);
    if (this.hasCandidates && (update.selectionSet || update.focusChanged || syntaxTree(update.startState) !== syntaxTree(update.state))) {
      this.decorations = wikiPreviewDecorator.createDeco(update.view);
    } else this.decorations = wikiPreviewDecorator.updateDeco(update, this.decorations);
  }
}, { decorations: (plugin) => plugin.decorations });

/** Is the caret immediately before the hidden closing brackets of a link?
 * The Enter-at-drawn-end guard needs this because Lezer does not classify the
 * wiki closer as a LinkMark. Never claim source in code files. */
export function wikiClosingAt(view: EditorView, at: number): boolean {
  if (!view.plugin(wikiLinkPreview)) return false;
  const line = view.state.doc.lineAt(at);
  LINK.lastIndex = 0;
  for (let match = LINK.exec(line.text); match; match = LINK.exec(line.text)) {
    const from = line.from + match.index, to = from + match[0].length;
    if (to - 2 === at && canRenderWiki(view, from, to, match)) return true;
    if (from > at) break;
  }
  return false;
}

/** The link at `pos`, if any. */
function linkAt(view: EditorView, pos: number): { from: number; to: number; target: string; heading: string } | null {
  const line = view.state.doc.lineAt(pos);
  LINK.lastIndex = 0;
  for (let m = LINK.exec(line.text); m; m = LINK.exec(line.text)) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (pos >= from && pos <= to) return inCode(view, from) ? null : { from, to, target: m[2].trim(), heading: (m[3] ?? '').trim() };
  }
  return null;
}

const tapToOpen = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.shiftKey) return false;
    const target = event.target as HTMLElement;
    if (!target.closest('.cm-wikilink')) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const link = linkAt(view, pos);
    if (!link) return false;
    const { head } = view.state.selection.main;
    if (view.hasFocus && head >= link.from && head <= link.to) return false; // editing it
    event.preventDefault();
    wikiRuntime.open(link.target, link.heading);
    return true;
  },
});

function suggest(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/!?\[\[[^[\]|#\n]*$/);
  if (!before) return null;
  const start = before.from + before.text.indexOf('[[') + 2;
  const options: Completion[] = wikiRuntime.names().map((name) => ({
    label: name,
    type: 'text',
    apply: (view, _completion, from, to) => {
      const after = view.state.sliceDoc(to, to + 2);
      const closing = after === ']]' ? '' : after.startsWith(']') ? ']' : ']]';
      const insert = name + closing;
      const end = from + insert.length + (closing === ']]' ? 0 : 2 - closing.length);
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: Math.min(end, view.state.doc.length + insert.length - (to - from)) }, userEvent: 'input.complete' });
    },
  }));
  return { from: start, options, validFor: /^[^[\]|#\n]*$/ };
}

export const wikiLinks: Extension = [
  linkPlugin,
  tapToOpen,
  autocompletion({ override: [suggest], icons: false, activateOnTyping: true, maxRenderedOptions: 50 }),
];
