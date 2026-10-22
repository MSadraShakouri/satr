// Editor ⇄ preview scroll position, the way Obsidian does it: a position is a
// fractional source line — "the line at this height in the viewport, plus how
// far into it we are". The app's height is three body lines down (the typing
// band), not the glass edge; the outline passes two thirds instead. Obsidian's
// MarkdownView reads it from the current mode (getScroll) and hands it to the
// other one (setEphemeralState({scroll})) when switching; its reading view
// interpolates inside sections that know their source line span. Satr's
// preview sections carry data-line/data-lines (src/markdown.ts), so both
// directions map exactly at section boundaries and proportionally inside a
// section.
import { BlockType, EditorView, type BlockInfo } from '@codemirror/view';

/** Body lines of keep-out above the caret, and the edit⇄preview origin. */
export const TYPING_TOP_LINES = 3;

/** Three live body lines, in pixels — same number the caret uses at the top. */
export function typingTop(view: EditorView): number {
  return TYPING_TOP_LINES * view.defaultLineHeight;
}

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

export function applyEditorScroll(view: EditorView, position: number, isCurrent: () => boolean = () => true, settle = false, anchor = 0): void {
  const { doc } = view.state;
  if (!(position > 0)) { scrollInstantly(view.scrollDOM, 0); return; }
  const index = Math.min(doc.lines - 1, Math.floor(position));
  const fraction = Math.min(0.999, position - index);
  const line = doc.line(index + 1);
  const place = (): void => {
    if (!view.dom.isConnected || view.state.doc !== doc || !isCurrent()) return;
    const block = textBlock(view.lineBlockAt(line.from));
    const target = view.documentTop + block.top + fraction * block.height;
    const top = view.scrollDOM.getBoundingClientRect().top + anchor;
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

/** A folded-away section is display:none, and so is every section while the
 * pane itself is hidden. A box of nothing reports top 0 and bottom 0, which
 * reads as "above you" from anywhere in the note — so these are skipped
 * rather than counted as sections the reader has already passed. Each box
 * is asked for once, in the walk that needs it: asking all of them costs
 * the whole note's layout, which is what the reading view is built to
 * avoid. */
const boxless = (rect: DOMRect): boolean => rect.width === 0 && rect.height === 0;

/** The fractional source line at the top edge of the pane, or — with an
 * anchor — at `anchor` pixels below it. `null` when the reading view cannot
 * be read at all (nothing rendered, nothing shown): Obsidian's getScroll
 * returns null the same way rather than naming a line it cannot see, and a
 * caller that is told nothing keeps what it already had. */
export function previewScroll(pane: HTMLElement, preview: HTMLElement, anchor = 0): number | null {
  const top = pane.getBoundingClientRect().top + anchor;
  const list = anchors(preview);
  let passed = 0;
  let seen = 0;
  for (const [index, el] of list.entries()) {
    const rect = el.getBoundingClientRect();
    if (boxless(rect)) continue;
    seen += 1;
    const line = Number(el.dataset.line);
    const lines = Number(el.dataset.lines) || 1;
    if (rect.bottom <= top) { passed = line + lines; continue; }
    if (rect.top >= top) return index === 0 ? 0 : Math.max(passed, line);
    // Inside a section that may contain tall math/tables: the proportional
    // mapping uses the section's actual rendered height, which already
    // includes math/table heights, so source line -> pixel stays stable.
    return line + lines * (top - rect.top) / Math.max(1, rect.height);
  }
  return seen ? passed : null;
}

export function applyPreviewScroll(pane: HTMLElement, preview: HTMLElement, position: number, isCurrent: () => boolean = () => true, settle = false, anchor = 0): void {
  const place = (): void => {
    if (!isCurrent()) return;
    if (!(position > 0)) { scrollInstantly(pane, 0); return; }
    const list = anchors(preview);
    if (!list.length) return;
    let target: number | null = null;
    let last: DOMRect | null = null;
    for (const el of list) {
      const rect = el.getBoundingClientRect();
      if (boxless(rect)) continue;
      last = rect;
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
    if (!last) return; // nothing on the page to measure against
    const paneTop = pane.getBoundingClientRect().top;
    const past = target === null;
    // Past everything the reading view knows about: the blank line every
    // note ends with, a fold at the tail, a section that renders to
    // nothing. The end of a note is its last lines sitting at the foot of
    // the screen — putting that last section's end at the typing band
    // instead scrolls the note up into the 50vh the article keeps below
    // itself, and one line of note above half a screen of nothing is what
    // the reader reports as "it opened at the bottom". A position that is
    // inside a section is left exactly where it maps, so a place near the
    // tail still comes back to itself on the way to the source and back.
    const end = last.bottom;
    if (target === null) target = end;
    const wanted = pane.scrollTop + target - (paneTop + anchor);
    if (!past) { scrollInstantly(pane, Math.max(0, wanted)); return; }
    const tail = Math.max(end, (preview.lastElementChild ?? preview).getBoundingClientRect().bottom);
    const foot = pane.scrollTop + tail - paneTop - pane.clientHeight;
    scrollInstantly(pane, Math.max(0, Math.min(wanted, Math.max(0, foot))));
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
