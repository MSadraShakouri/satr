// Wiki links in the editor, as in Obsidian's live preview:
// - [[Note]], [[Note|text]], [[Note#Heading]] and ![[embeds]] are styled as
//   links (the brackets faint), except inside code.
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
