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

/** The place the reading view is being held at, while it is being held —
 *  see the hold in applyPreviewScroll. Until it lets go, this is where the
 *  reader is meant to be, and the pane itself is not evidence of anything:
 *  it is mid-answer, and halfway through a cold note it can be sitting at
 *  the end of a note that is still growing. */
let holding: { pane: HTMLElement; position: number; token: object } | null = null;
export function heldPreviewPlace(pane: HTMLElement): number | null {
  return holding && holding.pane === pane ? holding.position : null;
}

export function applyPreviewScroll(pane: HTMLElement, preview: HTMLElement, position: number, isCurrent: () => boolean = () => true, settle = false, anchor = 0): void {
  // What this last asked the pane for, as the pane was able to answer it
  // (short of the end of a note it scrolls to the end instead). The reader
  // moving a single pixel of their own is the one thing that ends the
  // corrections: see keepPlaced below.
  let placed: number | null = null;
  // Whether the pane could go where it was asked. A note whose sections are
  // still estimates can be shorter than the place the reader asked for: the
  // scroll is clamped to the end of the note as it stands, which is not
  // where they were put — it is as far as the page would let them go.
  let reached = false;
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
    // A position that is inside a section, in a note long enough to hold
    // it, is left exactly where it maps — so a place near the tail still
    // comes back to itself on the way to the source and back.
    const end = last.bottom;
    if (target === null) target = end;
    const wanted = Math.max(0, pane.scrollTop + target - (paneTop + anchor));
    // How far this note can honestly be scrolled: its last line sitting at the
    // foot of the screen. The article keeps 50vh of padding below itself, so
    // the pane can always scroll further than the note goes; letting the
    // browser clamp to that leaves the last line half a screen up with the
    // padding filling the rest, which is the empty screen a reader reports as
    // "it opened at the bottom". One limit, asked before anything moves, so
    // that two places in the same note cannot be measured against two
    // different ends of it: asking for a line further down the note used to
    // fall off the end of the first rule and onto the second, and land the
    // reader higher up the page than the line before it.
    const tail = Math.max(end, (preview.lastElementChild ?? preview).getBoundingClientRect().bottom);
    const foot = Math.max(0, pane.scrollTop + tail - paneTop - pane.clientHeight);
    // A note shorter than the screen has no foot to stop at: stopping there
    // would be the top of the note for every line in it, which is the jump a
    // reader sees as "it went back to the beginning". The place is kept
    // instead, as far as the pane can honestly go, and the empty screen it
    // leaves below a short note is the price of still being where you were.
    // Still one limit for the whole note, decided by the note and not by the
    // line asked for: two limits is how a line further down the page came to
    // land higher up the screen than the line before it.
    const limit = foot > 0 ? foot : pane.scrollHeight - pane.clientHeight;
    scrollInstantly(pane, Math.min(wanted, limit));
    placed = pane.scrollTop; // what it could actually do, not what was asked
    // Not where it was asked to go: a note still arriving is short for a
    // moment, and when the rest of it lands the place is there to be had.
    // The hold below keeps asking until it is.
    reached = !past && Math.abs(placed - wanted) <= 1;
  };
  place();
  // The reading view is not finished when the jump lands. Formulas and
  // images arrive, and — the big one — every section the reader has never
  // seen is standing on an estimate until the browser lays it out, which
  // it does tens of milliseconds after the scroll that made that section
  // matter, not in the next frame. So the note's own length goes on
  // changing for as long as the reader keeps reading. When it shortens
  // past the offset they are at, the browser clamps them to the new end of
  // the note and there they stay.
  //
  // The corrections could not cover that: two timers, fonts, and at most
  // eight resize callbacks inside two seconds. So the place is held
  // instead — the same answer applied again whenever the page changes
  // shape, until the reader moves the pane themselves. A finger on the
  // glass is not that: they tap a link, they rest a thumb, and the old
  // rule (any touch cancels every outstanding correction) threw the
  // corrections away at exactly the moment a reader who had landed in the
  // wrong place reached for the screen. Only their scrolling counts, and
  // it is read from the pane — a pixel away from what was placed and this
  // stops for good.
  const token = {};
  holding = { pane, position, token };
  let stopped = false;
  const stop = (): void => {
    stopped = true;
    ro?.disconnect();
    if (holding?.token === token) holding = null;
  };
  // The page's own length, last time this looked. The browser moves the
  // pane by itself when content above the reader changes size — scroll
  // anchoring, keeping what they can see where it is — and that move is
  // not the reader's. Telling the two apart is the difference between a
  // hold that survives a note settling and one that lets go at the first
  // section to arrive: the pane moving while the note is changing length
  // is the page, the pane moving while nothing else changed is the reader.
  let shape = pane.scrollHeight;
  const keepPlaced = (): void => {
    if (stopped) return;
    if (!isCurrent()) { stop(); return; }
    const moved = pane.scrollHeight !== shape;
    shape = pane.scrollHeight;
    if (!moved && placed !== null && Math.abs(pane.scrollTop - placed) > 2) { stop(); return; }
    place();
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    keepPlaced();
    window.setTimeout(keepPlaced, 120);
    window.setTimeout(keepPlaced, 350);
  }));
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => keepPlaced());
  // The whole page, not just the element being placed against: a section
  // further down resolving from its estimate changes the note's length
  // without changing anything about that element.
  ro?.observe(preview);
  // A switch waits for the fonts too, and is covered for as long as a cold
  // note can take to settle on a slow phone. A plain placement is held for
  // a moment — long enough for the sections it landed among to be laid
  // out. A place the note was too short to reach is held for as long as
  // either: the note has not finished arriving, and letting go now would
  // leave the reader at the end of a note they were not sent to. Either
  // way a page that is not changing shape never calls back.
  if (settle) void (document.fonts?.ready ?? Promise.resolve()).then(() => window.requestAnimationFrame(keepPlaced));
  if (!settle) window.setTimeout(() => { if (reached) stop(); }, 1_000);
  window.setTimeout(stop, 12_000);
}
