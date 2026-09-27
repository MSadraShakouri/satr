// Editor ⇄ preview scroll position, the way Obsidian does it: a position is a
// fractional source line — "the line at the top edge of the viewport, plus
// how far into it we are". Obsidian's MarkdownView reads it from the current
// mode (getScroll) and hands it to the other one (setEphemeralState({scroll}))
// when switching; its reading view interpolates inside sections that know
// their source line span. Satr's preview sections carry data-line/data-lines
// (src/markdown.ts), so both directions map exactly at section boundaries and
// proportionally inside a section.
import { BlockType, EditorView, type BlockInfo } from '@codemirror/view';

function scrollInstantly(el: HTMLElement, top: number): void {
  el.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
}

function textBlock(block: BlockInfo): BlockInfo {
  // Line 1 carries the title widget; use the text part of the block.
  return Array.isArray(block.type) ? block.type.find((part) => part.type === BlockType.Text) ?? block : block;
}

export function editorScroll(view: EditorView): number {
  const top = view.scrollDOM.getBoundingClientRect().top;
  const height = top - view.documentTop;
  if (height <= 0) return 0;
  const block = view.elementAtHeight(height);
  if (block.type !== BlockType.Text) return view.state.doc.lineAt(block.from).number - 1;
  const first = view.state.doc.lineAt(block.from).number - 1;
  const last = view.state.doc.lineAt(block.to).number - 1;
  const into = Math.min(1, Math.max(0, (height - block.top) / Math.max(1, block.height)));
  return first + (last - first + 1) * into;
}

export function applyEditorScroll(view: EditorView, position: number): void {
  const { doc } = view.state;
  if (!(position > 0)) { scrollInstantly(view.scrollDOM, 0); return; }
  const index = Math.min(doc.lines - 1, Math.floor(position));
  const fraction = Math.min(0.999, position - index);
  const line = doc.line(index + 1);
  const place = (): void => {
    const block = textBlock(view.lineBlockAt(line.from));
    const target = view.documentTop + block.top + fraction * block.height;
    const top = view.scrollDOM.getBoundingClientRect().top;
    scrollInstantly(view.scrollDOM, view.scrollDOM.scrollTop + target - top);
  };
  // Off-screen line heights are estimates until CodeMirror measures them:
  // jump, let it measure, then correct.
  place();
  view.requestMeasure({ read: () => null, write: () => place() });
  window.requestAnimationFrame(() => window.requestAnimationFrame(place));
}

function anchors(preview: HTMLElement): HTMLElement[] {
  return [...preview.querySelectorAll<HTMLElement>('[data-line]')];
}

export function previewScroll(pane: HTMLElement, preview: HTMLElement): number {
  const top = pane.getBoundingClientRect().top;
  const list = anchors(preview);
  let passed = 0;
  for (const [index, el] of list.entries()) {
    const rect = el.getBoundingClientRect();
    const line = Number(el.dataset.line);
    const lines = Number(el.dataset.lines) || 1;
    if (rect.bottom <= top) { passed = line + lines; continue; }
    if (rect.top >= top) return index === 0 ? 0 : Math.max(passed, line);
    return line + lines * (top - rect.top) / Math.max(1, rect.height);
  }
  return passed;
}

export function applyPreviewScroll(pane: HTMLElement, preview: HTMLElement, position: number): void {
  if (!(position > 0)) { scrollInstantly(pane, 0); return; }
  const list = anchors(preview);
  if (!list.length) return;
  let target: number | null = null;
  for (const el of list) {
    const rect = el.getBoundingClientRect();
    const line = Number(el.dataset.line);
    const lines = Number(el.dataset.lines) || 1;
    if (position < line) { target = rect.top; break; }
    if (position < line + lines) { target = rect.top + (position - line) / lines * rect.height; break; }
  }
  if (target === null) target = list[list.length - 1].getBoundingClientRect().bottom;
  scrollInstantly(pane, pane.scrollTop + target - pane.getBoundingClientRect().top);
}
