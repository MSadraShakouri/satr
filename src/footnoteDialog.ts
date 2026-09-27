// Footnote editing in a dialog, after Obsidian: inserting a footnote puts
// "[^n]" at the caret and opens a small dialog to write the note, instead of
// jumping to the end of the file. Tapping a reference opens the same dialog.
// The definition lives at the end of the note as "[^n]: text"; extra lines are
// written as indented continuation lines, which is how Markdown footnotes
// hold several lines.
import type { EditorView } from '@codemirror/view';

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

let open: HTMLElement | null = null;

export function editFootnote(view: EditorView, id: string, options: { isNew?: boolean; label?: string } = {}): void {
  open?.remove();
  const definition = findDefinition(view, id);
  const hadFocus = view.hasFocus;
  const container = document.createElement('div');
  container.className = 'modal-container footnote-modal';
  container.dataset.ignoreSwipe = '';
  container.innerHTML = `
    <div class="modal-bg"></div>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="footnote-title">
      <div class="modal-title" id="footnote-title"></div>
      <textarea class="modal-textarea" dir="auto" rows="3" placeholder="Footnote text"></textarea>
      <div class="modal-button-container">
        <button type="button" class="mod-cancel">Cancel</button>
        <button type="button" class="mod-cta">Done</button>
      </div>
    </div>`;
  const title = container.querySelector<HTMLElement>('.modal-title')!;
  title.textContent = `Footnote ${options.label ?? id}`;
  const input = container.querySelector<HTMLTextAreaElement>('textarea')!;
  input.value = definition?.text ?? '';
  document.body.appendChild(container);
  open = container;

  const close = (save: boolean): void => {
    if (open !== container) return;
    open = null;
    container.remove();
    const value = input.value.replace(/\s+$/, '');
    const current = findDefinition(view, id);
    if (save && current) {
      const text = value.split('\n').join('\n    ');
      if (text !== current.text) view.dispatch({ changes: { from: current.from, to: current.to, insert: text }, userEvent: 'input.footnote' });
    } else if (!save && options.isNew && !value && !current?.text) {
      removeFootnote(view, id);
    }
    if (hadFocus || options.isNew) view.focus();
  };
  container.querySelector('.mod-cta')!.addEventListener('click', () => close(true));
  container.querySelector('.mod-cancel')!.addEventListener('click', () => close(false));
  container.querySelector('.modal-bg')!.addEventListener('click', () => close(true));
  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(false); }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); close(true); }
  });
  // Focus in the same task as the tap, so the keyboard stays up (or opens).
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
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
