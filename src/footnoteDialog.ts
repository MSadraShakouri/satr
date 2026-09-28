// Footnote editing in a popover, after Obsidian: inserting a footnote puts
// "[^n]" at the caret and opens a small card right at the reference to write
// the note — no jump to the end of the file, no dialog over the page. Tapping
// a reference opens the same card. The note is written into the definition
// ("[^n]: text" at the end of the note) as you type, like Obsidian's
// embedded editor; extra lines become indented continuation lines, which is
// how Markdown footnotes hold several lines. Closing an empty new footnote
// removes it again.
import type { EditorView } from '@codemirror/view';
import { openPopover } from './popover';

interface Definition { from: number; to: number; text: string }

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findDefinition(view: EditorView, id: string): Definition | null {
  const { doc } = view.state;
  const head = new RegExp(`^\\[\\^${escapeRegExp(id)}\\]:[ \\t]?`);
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    const match = head.exec(line.text);
    if (!match) continue;
    const parts = [line.text.slice(match[0].length)];
    let to = line.to;
    // Continuation lines: indented, directly below.
    for (let m = n + 1; m <= doc.lines; m += 1) {
      const next = doc.line(m);
      if (!/^( {2,}|\t)\S/.test(next.text)) break;
      parts.push(next.text.replace(/^( {2,4}|\t)/, ''));
      to = next.to;
    }
    return { from: line.from + match[0].length, to, text: parts.join('\n') };
  }
  return null;
}

/** Set by the app: height hidden at the bottom (keyboard toolbar). */
export const footnoteLayout = { obscuredBottom: (): number => 0 };

/** Position of the first reference to this footnote (not the definition). */
function firstReference(view: EditorView, id: string): number {
  const match = new RegExp(`\\[\\^${escapeRegExp(id)}\\](?!:)`).exec(view.state.doc.toString());
  return match ? match.index : -1;
}

export function editFootnote(view: EditorView, id: string, options: { isNew?: boolean; at?: number } = {}): void {
  const hadFocus = view.hasFocus;
  const label = `[^${id}]`;
  let at = options.at ?? firstReference(view, id);
  const lineText = at >= 0 ? view.state.doc.lineAt(at) : null;
  const firstLetter = lineText ? /\p{L}/u.exec(lineText.text.replace(/\[\^[^\]]*\]/g, ''))?.[0] ?? '' : '';
  const rtl = /[\p{sc=Arabic}\p{sc=Hebrew}]/u.test(firstLetter);
  const content = document.createElement('div');
  content.className = 'markdown-embed footnote-embed';
  content.dataset.type = 'footnote';
  const input = document.createElement('textarea');
  input.className = 'footnote-input';
  input.dir = 'auto';
  input.rows = 1;
  input.placeholder = 'Footnote';
  input.setAttribute('aria-label', `Footnote ${id}`);
  input.value = findDefinition(view, id)?.text ?? '';
  content.appendChild(input);

  // Changes elsewhere move the reference; keep the anchor on it.
  const anchor = (): DOMRect | null => {
    if (at < 0 || at > view.state.doc.length) return null;
    if (view.state.sliceDoc(at, at + label.length) !== label) at = firstReference(view, id);
    if (at < 0) return null;
    const start = view.coordsAtPos(at, 1);
    const end = view.coordsAtPos(at + label.length, -1) ?? start;
    if (!start || !end) return null;
    const scroller = view.scrollDOM.getBoundingClientRect();
    // Off screen: park it at the nearest edge rather than closing.
    const top = Math.max(scroller.top, Math.min(start.top, scroller.bottom));
    const bottom = Math.max(scroller.top, Math.min(start.bottom, scroller.bottom));
    return new DOMRect(Math.min(start.left, end.left), top, Math.abs(end.right - start.left), bottom - top);
  };
  const grow = (): void => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
    popover.reposition();
  };
  const write = (): void => {
    const current = findDefinition(view, id);
    if (!current) return;
    const value = input.value.replace(/\s+$/, '');
    if (value !== current.text) {
      view.dispatch({ changes: { from: current.from, to: current.to, insert: value.split('\n').join('\n    ') }, userEvent: 'input.footnote' });
    }
  };
  const popover = openPopover({
    className: 'footnote-popover',
    anchor,
    rtl,
    content,
    obscuredBottom: () => footnoteLayout.obscuredBottom(),
    scrollers: [view.scrollDOM],
    onClose: () => {
      write();
      if (options.isNew && !input.value.trim()) removeFootnote(view, id);
      // Closed without tapping somewhere else that takes focus (Escape, or a
      // tap on empty space): hand the caret back, as Obsidian does.
      if (hadFocus || options.isNew) {
        window.setTimeout(() => {
          if (document.activeElement === document.body || document.activeElement === null) view.focus();
        });
      }
    },
  });
  input.addEventListener('input', () => { write(); grow(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); popover.close(); }
  });
  // Focus in the same task as the tap, so the keyboard stays up (or opens).
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
  grow();
}

/** Remove a footnote's references and its definition. */
export function removeFootnote(view: EditorView, id: string): void {
  const { doc } = view.state;
  const text = doc.toString();
  const changes: { from: number; to: number }[] = [];
  const ref = new RegExp(`\\[\\^${escapeRegExp(id)}\\](?!:)`, 'g');
  for (const match of text.matchAll(ref)) changes.push({ from: match.index!, to: match.index! + match[0].length });
  const def = findDefinition(view, id);
  if (def) {
    const line = doc.lineAt(def.from);
    let from = line.from;
    // Also drop the blank line(s) that were added in front of it.
    while (from > 0 && doc.lineAt(from - 1).text.trim() === '' && doc.lineAt(from - 1).from > 0) from = doc.lineAt(from - 1).from;
    changes.push({ from: Math.max(0, from - (from > 0 ? 1 : 0)), to: def.to });
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'delete.footnote' });
}
