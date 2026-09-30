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

/** The fractional line at the top edge of the editor, or — with an anchor —
 * at `anchor` pixels below it (the outline reads the line two thirds down). */
export function editorScroll(view: EditorView, anchor = 0): number {
  const top = view.scrollDOM.getBoundingClientRect().top + anchor;
  const height = top - view.documentTop;
  if (height <= 0) return 0;
  const block = view.elementAtHeight(height);
  if (block.type !== BlockType.Text) return view.state.doc.lineAt(block.from).number - 1;
  const first = view.state.doc.lineAt(block.from).number - 1;
  const last = view.state.doc.lineAt(block.to).number - 1;
  const into = Math.min(1, Math.max(0, (height - block.top) / Math.max(1, block.height)));
  return first + (last - first + 1) * into;
}

export function applyEditorScroll(view: EditorView, position: number, isCurrent: () => boolean = () => true, settle = false): void {
  const { doc } = view.state;
  if (!(position > 0)) { scrollInstantly(view.scrollDOM, 0); return; }
  const index = Math.min(doc.lines - 1, Math.floor(position));
  const fraction = Math.min(0.999, position - index);
  const line = doc.line(index + 1);
  const place = (): void => {
    if (!view.dom.isConnected || view.state.doc !== doc || !isCurrent()) return;
    const block = textBlock(view.lineBlockAt(line.from));
    const target = view.documentTop + block.top + fraction * block.height;
    const top = view.scrollDOM.getBoundingClientRect().top;
    scrollInstantly(view.scrollDOM, view.scrollDOM.scrollTop + target - top);
  };
  // Off-screen line heights are estimates until CodeMirror measures them:
  // jump, let it measure, then correct. With settle, keep correcting as math
  // and tables cause height changes.
  place();
  view.requestMeasure({ read: () => null, write: () => place() });
  window.requestAnimationFrame(() => window.requestAnimationFrame(place));
  if (!settle) return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    place();
    window.setTimeout(place, 120);
    window.setTimeout(place, 350);
  }));
  void (document.fonts?.ready ?? Promise.resolve()).then(() => window.requestAnimationFrame(place));
}

function anchors(preview: HTMLElement): HTMLElement[] {
  return [...preview.querySelectorAll<HTMLElement>('[data-line]')];
}

/** The fractional source line at the top edge of the pane, or — with an
 * anchor — at `anchor` pixels below it. */
export function previewScroll(pane: HTMLElement, preview: HTMLElement, anchor = 0): number {
  const top = pane.getBoundingClientRect().top + anchor;
  const list = anchors(preview);
  let passed = 0;
  for (const [index, el] of list.entries()) {
    const rect = el.getBoundingClientRect();
    const line = Number(el.dataset.line);
    const lines = Number(el.dataset.lines) || 1;
    if (rect.bottom <= top) { passed = line + lines; continue; }
    if (rect.top >= top) return index === 0 ? 0 : Math.max(passed, line);
    // Inside a section that may contain tall math/tables: the proportional
    // mapping uses the section's actual rendered height, which already
    // includes math/table heights, so source line -> pixel stays stable.
    return line + lines * (top - rect.top) / Math.max(1, rect.height);
  }
  return passed;
}

export function applyPreviewScroll(pane: HTMLElement, preview: HTMLElement, position: number, isCurrent: () => boolean = () => true, settle = false): void {
  const place = (): void => {
    if (!isCurrent()) return;
    if (!(position > 0)) { scrollInstantly(pane, 0); return; }
    const list = anchors(preview);
    if (!list.length) return;
    let target: number | null = null;
    for (const el of list) {
      const rect = el.getBoundingClientRect();
      const line = Number(el.dataset.line);
      const lines = Number(el.dataset.lines) || 1;
      if (position < line) { target = rect.top; break; }
      if (position < line + lines) {
        // For sections containing math/tables, the height is already the
        // rendered height. Using proportional mapping inside the section
        // keeps the scroll stable when math is tall.
        target = rect.top + (position - line) / lines * rect.height;
        break;
      }
    }
    if (target === null) target = list[list.length - 1].getBoundingClientRect().bottom;
    scrollInstantly(pane, pane.scrollTop + target - pane.getBoundingClientRect().top);
  };
  place();
  if (!settle) return;
  // Rendered math and tables are taller or shorter than their source lines,
  // and the numbers move under us after the jump: KaTeX's fonts, the Android
  // grow-box pass, lazy images. Measure the rendered heights again once
  // they settle, and compensate the scroll with the new ones. Do it several
  // times so a tall display math that changes height after font load doesn't
  // leave the user feeling a jump.
  const settlePlace = (): void => {
    if (!isCurrent()) return;
    place();
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    settlePlace();
    window.setTimeout(settlePlace, 120);
    window.setTimeout(settlePlace, 350);
  }));
  void (document.fonts?.ready ?? Promise.resolve()).then(() => window.requestAnimationFrame(settlePlace));
  // Images and KaTeX may load after fonts; observe height changes.
  if (typeof ResizeObserver !== 'undefined') {
    let observed = 0;
    const ro = new ResizeObserver(() => {
      if (!isCurrent() || observed++ > 8) { ro.disconnect(); return; }
      settlePlace();
    });
    // Observe the preview container; any math/table growth changes it.
    ro.observe(preview);
    window.setTimeout(() => ro.disconnect(), 2000);
  }
}
