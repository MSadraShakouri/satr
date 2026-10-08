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
import { inMath, mathSpans, overlapsMath } from './mathSource';
import { spansHold } from './mathScan';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';
import { formatTimestamp, fullTimestamp, TIMESTAMP_START, type TimestampFormat } from './timestamps';
import { editFootnote, findDefinition } from './footnoteDialog';

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

// <t:UNIX:F>: the time it names, in place of the code (src/timestamps.ts). The
// relative ones keep themselves current (refreshTimestamps).
class TimestampWidget extends WidgetType {
  constructor(readonly seconds: number, readonly format: TimestampFormat) { super(); }
  eq(other: TimestampWidget): boolean { return other.seconds === this.seconds && other.format === this.format; }
  toDOM(): HTMLElement {
    const el = document.createElement('time');
    el.className = 'discord-timestamp cm-lp-timestamp';
    el.dataset.ts = String(this.seconds);
    el.dataset.format = this.format;
    el.title = fullTimestamp(this.seconds);
    el.textContent = formatTimestamp(this.seconds, this.format);
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
// Neutralises markdown styling the parser applies to characters that are not
// markdown at all (see the Emphasis case below).
const plainText = Decoration.mark({ class: 'cm-lp-plain' });
const linkText = Decoration.mark({ class: 'cm-lp-link' });
const doneText = Decoration.mark({ class: 'cm-lp-task-done' });
// Quote lines get a hanging indent the width of their "> " prefix, so wrapped
// lines line up with the text instead of running under the rule (Obsidian
// does the same: padding-inline-start plus a negative text-indent).
const quoteLines = new Map<number, Decoration>();
function quoteLine(indent: number): Decoration {
  const px = Math.round(indent * 10) / 10;
  let deco = quoteLines.get(px);
  if (!deco) {
    deco = Decoration.line({
      class: 'cm-lp-quote',
      attributes: px > 0 ? { style: `padding-inline-start:${px}px;text-indent:-${px}px` } : {},
    });
    quoteLines.set(px, deco);
  }
  return deco;
}
// List lines, as Obsidian's .HyperMD-list-line: a hair of space above and
// below, and a hanging indent the width of the drawn marker so wrapped lines
// start under the text, not under the bullet.
const listLines = new Map<string, Decoration>();
/** A list line's own decoration — and, when it is a task, the tappable leading
 *  a marker the tap handler knows by (see .cm-lp-task-line in style.css): the
 *  drawn box is 17px, and the box's own rect is what the handler measures the
 *  tap against. */
function listLine(indent: number, task = false): Decoration {
  const px = Math.round(indent * 10) / 10;
  const key = `${px}${task ? ':task' : ''}`;
  let deco = listLines.get(key);
  if (!deco) {
    deco = Decoration.line({
      class: task ? 'cm-lp-list-line cm-lp-task-line' : 'cm-lp-list-line',
      attributes: px > 0 ? { style: `padding-inline-start:${px}px;text-indent:-${px}px` } : {},
    });
    listLines.set(key, deco);
  }
  return deco;
}
/** The bullet's padding before the dot (Obsidian's --list-indent-editing, 0.75em). */
const BULLET_PAD_EM = 0.75;
/** A checkbox's drawn width: 17px box, 7px before, 0.25em after. */
const TASK_BOX_PX = 17 + 7;
let measureContext: CanvasRenderingContext2D | null = null;
const editorFonts = new WeakMap<EditorView, string>();
function textWidth(view: EditorView, text: string): number {
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) return 0;
  // The editor font is read once per editor, not per quote line per keystroke
  // (getComputedStyle can force a style recalculation).
  let font = editorFonts.get(view);
  if (!font) {
    const style = getComputedStyle(view.contentDOM);
    font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    editorFonts.set(view, font);
  }
  measureContext.font = font;
  return measureContext.measureText(text).width;
}
// Obsidian keeps the ">" in place but transparent (so text doesn't shift when
// it is revealed); the first level's border is drawn by the line, deeper
// levels by the marker itself.
const quoteMarkFirst = Decoration.mark({ class: 'cm-lp-transparent' });
const quoteMarkNested = Decoration.mark({ class: 'cm-lp-quote-border' });
// Footnotes, styled as in Obsidian's editor: references raised and small with
// their brackets faint but visible; definition lines in the footnote size.
const footref = Decoration.mark({ class: 'cm-lp-footref' });
const footrefMark = Decoration.mark({ class: 'cm-lp-footref-mark' });
const footnoteLine = Decoration.line({ class: 'cm-lp-footnote-line' });
const footnoteLabel = Decoration.mark({ class: 'cm-lp-footnote-label' });
const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:/;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\]|\^\[([^\]]+)\]/g;
const inCode = (name: string): boolean => /Code|CodeMark|CodeText|CodeInfo/.test(name);

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
  // Inside `$…$` / `$$…$$` nothing is markdown: no marker is hidden, no
  // element is styled (11). True when the node sits in a formula or spans
  // into one (the parts of a split node stay source too, so nothing shifts).
  const insideMath = (from: number, to: number): boolean =>
    inMath(state, from) || inMath(state, Math.max(from, to - 1)) || overlapsMath(state, from, to);
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
          case 'Strikethrough':
          case 'Highlight': {
            const mark = node.name === 'Strikethrough' ? 'StrikethroughMark' : node.name === 'Highlight' ? 'HighlightMark' : 'EmphasisMark';
            const marks: { from: number; to: number }[] = [];
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === mark) marks.push({ from: child.from, to: child.to });
            }
            // A pair of dollar signs can hand the parser two *marker-shaped*
            // characters to pair across prose: `$**$ foo $**$` reads as a
            // `<strong>` whose markers sit inside two formulas, and the theme
            // then bolds the prose between them (the dollars as well). A
            // marker that is really inside a formula is not a marker, so the
            // whole node is an artefact of the parser: nothing is hidden (the
            // source stays as typed) and nothing outside a formula keeps the
            // styling it borrowed (7).
            const spans = state.field(mathSpans, false) ?? [];
            const artefact = marks.some((one) => spansHold(spans, one.from) || spansHold(spans, Math.max(one.from, one.to - 1)));
            if (artefact) {
              let at = node.from;
              for (const span of spans) {
                const from = span.from + span.delim;
                const to = span.to - span.delim;
                if (to <= at || from >= node.to) continue;
                if (from > at) out.push(plainText.range(at, Math.min(from, node.to)));
                at = Math.max(at, to);
              }
              if (at < node.to) out.push(plainText.range(at, node.to));
              return;
            }
            // Inside math source these are just characters of the formula:
            // `**` is never bold, never revealed or hidden (11).
            if (insideMath(node.from, node.to)) return;
            if (touches(node.from, node.to)) return;
            for (const one of marks) out.push(hidden.range(one.from, one.to));
            return;
          }
          case 'InlineCode': {
            // A backtick pair inside a formula is part of the formula, not code.
            if (insideMath(node.from, node.to)) return;
            out.push(inlineCode.range(node.from, node.to));
            if (touches(node.from, node.to)) return false;
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === 'CodeMark') out.push(hidden.range(child.from, child.to));
            }
            return false;
          }
          case 'Link': {
            // Only inline links: [text](url). Reference links stay as source.
            if (insideMath(node.from, node.to)) return;
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
            const first = node.from === line.from + line.text.indexOf('>');
            if (first) {
              const prefix = /^\s*(?:>\s?)+/.exec(line.text)?.[0] ?? '';
              out.push(quoteLine(textWidth(view, prefix)).range(line.from));
            }
            if (!touches(line.from, line.to)) out.push((first ? quoteMarkFirst : quoteMarkNested).range(node.from, node.to));
            return;
          }
          case 'ListMark': {
            // As in Obsidian: a marker is drawn (dot / checkbox) only while a
            // space follows it — "- " is a bullet, "-" is just a dash — and it
            // stays drawn wherever the caret is on the line. Backspacing the
            // space turns it back into plain text, character by character.
            // Only a caret inside the marker itself shows the raw syntax.
            const item = node.node.parent;
            const list = item?.parent;
            const spaced = (end: number): boolean => /^[ \t]/.test(state.sliceDoc(end, end + 1));
            const inside = (from: number, to: number): boolean => focused && ranges.some((r) => r.to > from && r.from <= to);
            const task = node.node.nextSibling?.name === 'Task' ? node.node.nextSibling.firstChild : null;
            {
              const line = state.doc.lineAt(node.from);
              const before = line.text.slice(0, node.from - line.from);
              if (!before.includes('>')) {
                textWidth(view, ''); // fills the font cache
                const em = parseFloat(editorFonts.get(view)?.split(' ')[2] ?? '') || 16;
                const indentText = before.replace(/\t/g, '  ');
                const isTask = task?.name === 'TaskMarker' && spaced(task.to);
                const drawnTask = isTask && !inside(list?.name === 'BulletList' ? node.from : task!.from, task!.to);
                let px = textWidth(view, indentText);
                if (drawnTask) {
                  if (list?.name !== 'BulletList') px += textWidth(view, state.sliceDoc(node.from, task!.from));
                  px += TASK_BOX_PX + 0.25 * em + textWidth(view, ' ');
                } else {
                  const markEnd = isTask ? task!.to : node.to;
                  px += textWidth(view, state.sliceDoc(node.from, markEnd) + ' ');
                  if (list?.name === 'BulletList' && spaced(node.to) && !inside(node.from, node.to)) px += BULLET_PAD_EM * em;
                }
                out.push(listLine(px, drawnTask).range(line.from));
              }
            }
            if (task && task.name === 'TaskMarker') {
              const checked = /x/i.test(state.sliceDoc(task.from, task.to));
              const line = state.doc.lineAt(task.from);
              const textStart = task.to + (/^\s*/.exec(state.sliceDoc(task.to, line.to))?.[0].length ?? 0);
              if (!spaced(task.to)) return; // "- [ ]" without the space: plain text
              if (checked && textStart < line.to) out.push(doneText.range(textStart, line.to));
              // "- [ ]" becomes a checkbox; in ordered lists the number stays.
              const start = list?.name === 'BulletList' ? node.from : task.from;
              if (inside(start, task.to)) return;
              if (start < task.from) out.push(listHidden.range(start, task.from));
              out.push((checked ? taskDone : taskOpen).range(task.from, task.to));
              return;
            }
            if (list?.name === 'BulletList' && spaced(node.to) && !inside(node.from, node.to)) out.push(bullet.range(node.from, node.to));
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
  // Timestamps: the time they name, unless the cursor is on the code. A
  // formula or a code span holding one is never a timestamp.
  const inCode = (pos: number): boolean => {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
      if (/Code/.test(node.name)) return true;
    }
    return false;
  };
  for (const { from, to } of view.visibleRanges) {
    for (const match of state.sliceDoc(from, to).matchAll(/<t:-?\d{1,15}(?::[tTdDfFR])?>/g)) {
      const at = from + (match.index ?? 0);
      const end = at + match[0].length;
      if (insideMath(at, end) || inCode(at) || touches(at, end)) continue;
      const parsed = TIMESTAMP_START.exec(match[0]);
      if (!parsed) continue;
      out.push(Decoration.replace({ widget: new TimestampWidget(Number(parsed[1]), (parsed[2] ?? 'f') as TimestampFormat) }).range(at, end));
    }
  }
  addFootnotes(view, out);
  return Decoration.set(out, true);
}

function addFootnotes(view: EditorView, out: Range<Decoration>[]): void {
  const { state } = view;
  const tree = syntaxTree(state);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (!line.text.includes('[^') && !line.text.includes('^[')) continue;
      let scanFrom = 0;
      const def = FOOTNOTE_DEF.exec(line.text);
      if (def && !inCode(tree.resolveInner(line.from, 1).name)) {
        const end = line.from + def[0].length - 1; // the label, without ":"
        out.push(footnoteLine.range(line.from));
        out.push(footnoteLabel.range(line.from, end));
        out.push(footrefMark.range(line.from, line.from + 2));
        out.push(footrefMark.range(end - 1, end));
        scanFrom = def[0].length;
      }
      FOOTNOTE_REF.lastIndex = scanFrom;
      for (let match = FOOTNOTE_REF.exec(line.text); match; match = FOOTNOTE_REF.exec(line.text)) {
        const start = line.from + match.index;
        const end = start + match[0].length;
        if (inCode(tree.resolveInner(start, 1).name)) continue;
        if (inMath(state, start) || inMath(state, end - 1)) continue; // a formula, not a reference
        out.push(footref.range(start, end));
        out.push(footrefMark.range(start, start + 2));
        out.push(footrefMark.range(end - 1, end));
      }
    }
  }
}

// Tapping a rendered checkbox toggles it without moving the caret, opening
// the keyboard or moving the page.
//
// A tap on a widget is claimed from its very first touch event, so the
// WebView never places a caret on the marker — and never drags the view back
// to that caret a moment later, which is why tapping a checkbox used to jump
// the note away from the line the writer was looking at. A finger that moves
// is scrolling, not tapping: the claim is dropped at once and the scroll
// happens as if the checkbox were any other text.
/** Where the tap is, not merely what it hit. The line is the element a touch
 *  reports for the text and for the marker alike, so a tap's meaning has to be
 *  read from where the finger is: on the marker — the drawn box and the 7px of
 *  margin it carries on the line's side — it is the checkbox's; on the words it
 *  is a caret, which is what editing them needs.
 *
 *  The marker's own rect is the box plus that leading margin, and the task's
 *  text starts at its trailing edge (the box's 0.25em of margin is the last of
 *  it). So the area is generous where there is nothing to take — the whole
 *  line's height, and the empty room on the line's leading side — and stops at
 *  the marker: a version of this that reached 8px past it swallowed the first
 *  character or two of every task ("the hit box got too big and I can no
 *  longer select the first few chars of a checklist item"). */
function inTaskLeadingArea(line: HTMLElement, marker: HTMLElement, clientX: number): boolean {
  const lineBox = line.getBoundingClientRect();
  const markerBox = marker.getBoundingClientRect();
  return getComputedStyle(line).direction === 'rtl'
    ? clientX >= markerBox.left + 1 && clientX <= lineBox.right + 2
    : clientX <= markerBox.right - 1 && clientX >= lineBox.left - 2;
}

let pendingTaskTap: { target: HTMLElement; x: number; y: number } | null = null;

const toggleTask = EditorView.domEventHandlers({
  touchstart(event) {
    const target = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('.cm-lp-task, .cm-lp-task-line');
    if (!target) return false;
    const touch = event.touches[0];
    if (!target.classList.contains('cm-lp-task')) {
      const marker = target.querySelector<HTMLElement>('.cm-lp-task');
      if (!marker || !inTaskLeadingArea(target, marker, touch?.clientX ?? 0)) return false;
    }
    pendingTaskTap = { target, x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
    event.preventDefault(); // no caret, no handles, no synthetic click
    return true;
  },
  touchcancel() {
    // The WebView cancels the touch on its own account (a scroll it decided
    // was happening, the system's gesture): a cancelled tap is not a tap.
    pendingTaskTap = null;
    return false;
  },
  touchmove(event) {
    if (!pendingTaskTap) return false;
    const touch = event.touches[0];
    // The tap area is roomier than the box (style.css): the slop is what tells
    // a tap on it from a scroll that started on it.
    if (touch && Math.hypot(touch.clientX - pendingTaskTap.x, touch.clientY - pendingTaskTap.y) > 16) pendingTaskTap = null;
    return false;
  },
  touchend(event, view) {
    const pending = pendingTaskTap;
    pendingTaskTap = null;
    if (!pending) return false;
    event.preventDefault();
    toggleTaskAt(view, pending.target);
    // A tick is a tap on a box, not a caret: the note lets its focus go, the
    // way a press on the bottom bar does (src/main.ts). Nothing can raise a
    // keyboard for an editable that has let it go, and the caret the WebView
    // may have placed on the marker — if it placed one at all — goes with
    // the focus. Nothing is put back and nothing is held: with no glide left
    // that runs on a focus (src/editor.ts), a tap on a box cannot move the
    // note, so there is nothing here to undo afterwards.
    if (view.hasFocus) view.contentDOM.blur();
    return true;
  },
  click(event, view) {
    // Tapping a footnote reference opens its note in a popover at the
    // reference (Obsidian's footnote popover). A second tap, with the caret already in the
    // reference, edits the reference text itself.
    const ref = (event.target as HTMLElement | null)?.closest?.('.cm-lp-footref');
    if (!ref || !(event.target as HTMLElement).isConnected) return false;
    const pos = view.posAtDOM(ref);
    const line = view.state.doc.lineAt(pos);
    const match = /^\[\^([^\]\s]+)\]/.exec(view.state.sliceDoc(pos, line.to));
    if (!match || !findDefinition(view, match[1])) return false;
    if (lastTapHead > pos && lastTapHead < pos + match[0].length) return false;
    editFootnote(view, match[1], { at: pos });
    return true;
  },
  mousedown(event, view) {
    lastTapHead = view.hasFocus ? view.state.selection.main.head : -1;
    const target = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('.cm-lp-task, .cm-lp-task-line');
    if (!target) return false;
    if (!target.classList.contains('cm-lp-task')) {
      const marker = target.querySelector<HTMLElement>('.cm-lp-task');
      if (!marker || !inTaskLeadingArea(target, marker, event.clientX)) return false;
    }
    event.preventDefault();
    toggleTaskAt(view, target);
    return true;
  },
});

/** Flip the box's `[ ]` / `[x]` in the note, wherever the caret is. `target`
 *  is the marker itself or the line that carries the tappable area; both point
 *  at the same line, and the marker on it is what is looked for. */
function toggleTaskAt(view: EditorView, target: HTMLElement): void {
  const pos = view.posAtDOM(target);
  const line = view.state.doc.lineAt(pos);
  const match = /\[([ xX])\]/.exec(view.state.sliceDoc(pos, line.to));
  if (!match) return;
  const at = pos + match.index + 1;
  view.dispatch({ changes: { from: at, to: at + 1, insert: match[1] === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle-task' });
}

let lastTapHead = -1; // caret before the tap, to tell a first tap from a second

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
