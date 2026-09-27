// Live preview, modeled on Obsidian's editor: markdown syntax is rendered in
// place (markers hidden, bullets/checkboxes/rules drawn as widgets) and the raw
// source comes back only where the selection touches it. Inline syntax
// (bold, italic, code, strike, links) reveals per element; block syntax
// (headings, quotes, rules, fences) reveals per line / per block, like
// Obsidian. With the editor unfocused (e.g. right after double-tapping the
// preview) everything stays rendered. Tables, math and mermaid are left as
// source for now.
import { syntaxTree } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';

// Bullets and checkboxes are MARKS over the real "-" / "[ ]" text (drawn
// with CSS), not replacing widgets — the same trick as Obsidian's
// .list-bullet mark. Widgets at the start of the line being typed in confuse
// Android keyboards on Enter (they inserted an extra empty line); marks keep
// the text in the DOM, so the IME sees exactly what's there.
class RuleWidget extends WidgetType {
  eq(): boolean { return true; }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-lp-hr';
    return el;
  }
}

class FenceWidget extends WidgetType {
  constructor(readonly label: string) { super(); }
  eq(other: FenceWidget): boolean { return other.label === this.label; }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-lp-fence';
    // A zero-width space keeps the line its normal height when it has no label.
    el.textContent = this.label || '\u200b';
    return el;
  }
}

const hidden = Decoration.replace({});
const bullet = Decoration.mark({ class: 'cm-lp-bullet' });
const taskOpen = Decoration.mark({ class: 'cm-lp-task' });
const taskDone = Decoration.mark({ class: 'cm-lp-task is-checked' });
const listHidden = Decoration.mark({ class: 'cm-lp-list-hidden' });
const rule = Decoration.replace({ widget: new RuleWidget() });
const inlineCode = Decoration.mark({ class: 'cm-lp-inline-code' });
const linkText = Decoration.mark({ class: 'cm-lp-link' });
const doneText = Decoration.mark({ class: 'cm-lp-task-done' });
const quoteLine = Decoration.line({ class: 'cm-lp-quote' });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const focused = view.hasFocus;
  const ranges = state.selection.ranges;
  // Does the selection touch [from, to]? (inclusive, so a caret right at an
  // edge reveals the syntax, as in Obsidian)
  const touches = (from: number, to: number): boolean =>
    focused && ranges.some((range) => range.from <= to && range.to >= from);
  const lineTouched = (pos: number): boolean => {
    const line = state.doc.lineAt(pos);
    return touches(line.from, line.to);
  };
  const out: Range<Decoration>[] = [];
  const hideMarkWithSpace = (from: number, to: number): void => {
    const lineEnd = state.doc.lineAt(from).to;
    const end = to < lineEnd && state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to;
    if (end > from) out.push(hidden.range(from, end));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter: (node: SyntaxNodeRef) => {
        switch (node.name) {
          case 'HeaderMark': {
            const parent = node.node.parent;
            if (parent && /^ATXHeading/.test(parent.name) && !lineTouched(node.from)) hideMarkWithSpace(node.from, node.to);
            return;
          }
          case 'Emphasis':
          case 'StrongEmphasis':
          case 'Strikethrough': {
            if (touches(node.from, node.to)) return;
            const mark = node.name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark';
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === mark) out.push(hidden.range(child.from, child.to));
            }
            return;
          }
          case 'InlineCode': {
            out.push(inlineCode.range(node.from, node.to));
            if (touches(node.from, node.to)) return false;
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === 'CodeMark') out.push(hidden.range(child.from, child.to));
            }
            return false;
          }
          case 'Link': {
            // Only inline links: [text](url). Reference links stay as source.
            const marks: { from: number; to: number; text: string }[] = [];
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === 'LinkMark') marks.push({ from: child.from, to: child.to, text: state.sliceDoc(child.from, child.to) });
            }
            const open = marks[0];
            const close = marks.find((mark) => mark.text === ']');
            const paren = marks.find((mark) => mark.text === '(');
            if (!open || open.text !== '[' || !close || !paren || close.from <= open.to) return;
            out.push(linkText.range(open.to, close.from));
            if (touches(node.from, node.to)) return;
            out.push(hidden.range(open.from, open.to));
            out.push(hidden.range(close.from, node.to));
            return false;
          }
          case 'QuoteMark': {
            const line = state.doc.lineAt(node.from);
            out.push(quoteLine.range(line.from));
            if (!touches(line.from, line.to)) hideMarkWithSpace(node.from, node.to);
            return;
          }
          case 'ListMark': {
            const item = node.node.parent;
            const list = item?.parent;
            const task = node.node.nextSibling?.name === 'Task' ? node.node.nextSibling.firstChild : null;
            if (task && task.name === 'TaskMarker') {
              const checked = /x/i.test(state.sliceDoc(task.from, task.to));
              const line = state.doc.lineAt(task.from);
              const textStart = task.to + (/^\s*/.exec(state.sliceDoc(task.to, line.to))?.[0].length ?? 0);
              if (checked && textStart < line.to) out.push(doneText.range(textStart, line.to));
              // "- [ ]" becomes a checkbox; in ordered lists the number stays.
              const start = list?.name === 'BulletList' ? node.from : task.from;
              if (touches(start, task.to)) return;
              if (start < task.from) out.push(listHidden.range(start, task.from));
              out.push((checked ? taskDone : taskOpen).range(task.from, task.to));
              return;
            }
            if (list?.name === 'BulletList' && !touches(node.from, node.to + 1)) out.push(bullet.range(node.from, node.to));
            return;
          }
          case 'HorizontalRule': {
            if (!lineTouched(node.from)) out.push(rule.range(node.from, node.to));
            return false;
          }
          case 'FencedCode': {
            const first = state.doc.lineAt(node.from);
            const last = state.doc.lineAt(node.to);
            const active = touches(node.from, node.to);
            for (let n = first.number; n <= last.number; n += 1) {
              const line = state.doc.line(n);
              const edge = n === first.number ? ' cm-lp-code-begin' : n === last.number ? ' cm-lp-code-end' : '';
              out.push(Decoration.line({ class: `cm-lp-code-line${edge}` }).range(line.from));
            }
            if (!active) {
              const info = node.node.getChild('CodeInfo');
              const label = info ? state.sliceDoc(info.from, info.to) : '';
              if (first.to > first.from) out.push(Decoration.replace({ widget: new FenceWidget(label) }).range(first.from, first.to));
              const closing = node.node.lastChild;
              if (last.number > first.number && closing?.name === 'CodeMark' && closing.from >= last.from && last.to > last.from) {
                out.push(Decoration.replace({ widget: new FenceWidget('') }).range(last.from, last.to));
              }
            }
            return false;
          }
          case 'CodeBlock': {
            const first = state.doc.lineAt(node.from).number;
            const last = state.doc.lineAt(node.to).number;
            for (let n = first; n <= last; n += 1) {
              out.push(Decoration.line({ class: 'cm-lp-code-line' }).range(state.doc.line(n).from));
            }
            return false;
          }
          case 'Table':
            return false; // tables are out of scope for now
          default:
            return;
        }
      },
    });
  }
  return Decoration.set(out, true);
}

// Tapping a rendered checkbox toggles it without moving the caret or
// opening the keyboard.
const toggleTask = EditorView.domEventHandlers({
  mousedown(event, view) {
    const box = (event.target as HTMLElement | null)?.closest?.('.cm-lp-task');
    if (!box) return false;
    event.preventDefault();
    const pos = view.posAtDOM(box);
    const line = view.state.doc.lineAt(pos);
    const match = /\[([ xX])\]/.exec(view.state.sliceDoc(pos, line.to));
    if (!match) return true;
    const at = pos + match.index + 1;
    view.dispatch({ changes: { from: at, to: at + 1, insert: match[1] === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle-task' });
    return true;
  },
});

const livePreviewPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view); }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged
      || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = build(update.view);
    }
  }
}, { decorations: (value) => value.decorations });

export const livePreview = [livePreviewPlugin, toggleTask];
