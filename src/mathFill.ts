// Drawing a note's formulas after its words are already on the screen.
//
// "Opening is slow for big files, I have an idea for it: don't do it all at
// once, do the current expected screen and then go upwards and downwards (do
// one direction with a higher priority if scrolling while still loading)...
// but I still want the entire thing to load at the end."
//
// That is this file, for the one thing that costs the time. Measured on
// 128kB of his own notes: 3317ms from the pen to the reading view, of which
// 1263ms is building the markup -- nearly all of it KaTeX, 5538 times -- and
// another 1064ms laying out the 9.1MB of HTML that comes back. The words
// themselves are a couple of hundred kB and cost almost nothing.
//
// So src/markdown.ts hands over the note with its formulas still as the
// placeholders it was already using, and this draws them: the ones on the
// screen first, then outwards from there, in slices short enough that a
// finger on the glass never waits for one. The reader's own scrolling moves
// the front line, so going down a long note draws downwards ahead of them.
// Nothing is skipped -- the far end of the note is drawn in the quiet after
// the near end is finished, so the whole note is there at the end, as asked.
import { renderMath } from './math';

export interface Formula { tex: string; display: boolean }

export interface Filling {
  /** Draw everything left, now. For an export, a search, or a print. */
  all(): void;
  /** How many formulas are still placeholders. */
  left(): number;
  /** Stop: the note is being replaced. */
  stop(): void;
}

// A slice short enough to lose nothing at 60Hz, from the same family as the
// document viewer's (src/pdfView.ts SLICE_MS).
const SLICE_MS = 24;
// How far past the screen to keep drawn, so that a scroll meets finished
// work rather than catching up with the front line.
const AHEAD_SCREENS = 1.5;

const holesIn = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('[data-satr-math]')];

/**
 * Draw `formulas` into the placeholders under `root`, nearest the screen
 * first. Returns a handle: the caller stops it when the note changes.
 */
export function fillMath(root: HTMLElement, formulas: Formula[], scroller?: HTMLElement | null, onDrawn?: () => void): Filling {
  const holes = holesIn(root);
  // The two ends of the drawn stretch: everything between them is done, and
  // the note is filled by pushing them apart from wherever the reader is.
  let down = 0; // the next undrawn hole below the stretch
  let up = -1; // the next undrawn hole above it
  let anchored = false;
  let goingDown = true; // the way the reader last moved
  let lastTop = scroller?.scrollTop ?? 0;
  let scheduled = 0;
  let idle = 0;
  let stopped = false;

  const draw = (hole: HTMLElement): void => {
    const id = Number(hole.dataset.satrMath);
    const formula = formulas[id];
    // A placeholder with nothing behind it is still removed: an empty box
    // that never fills is worse than no box.
    const slot = document.createElement('template');
    slot.innerHTML = formula ? renderMath(formula.tex, formula.display) : '';
    hole.replaceWith(slot.content);
  };

  /** The band of the note worth drawing before anything else. */
  const band = (): { top: number; bottom: number } | null => {
    if (!scroller) return null;
    const box = scroller.getBoundingClientRect();
    if (!box.height) return null;
    const slack = box.height * AHEAD_SCREENS;
    return { top: box.top - slack, bottom: box.bottom + slack };
  };

  /**
   * The first undrawn hole at or after the top of the band.
   *
   * Binary search rather than a walk: reading a position costs a layout, and
   * a note of his has five and a half thousand of these. Thirteen reads find
   * the place in a note that size.
   */
  const frontLine = (top: number): number => {
    let low = 0; // the drawn stretch is in the middle of the note, not at its head
    let high = holes.length - 1;
    let found = holes.length;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const hole = holes[middle];
      // A hole already drawn is detached; treat it as behind us.
      const box = hole.isConnected ? hole.getBoundingClientRect() : null;
      if (!box || box.bottom < top) low = middle + 1;
      else { found = middle; high = middle - 1; }
    }
    return found;
  };

  /** Step the two ends past anything already drawn. True while work is left. */
  const open = (): boolean => {
    while (down < holes.length && !holes[down].isConnected) down += 1;
    while (up >= 0 && !holes[up].isConnected) up -= 1;
    return down < holes.length || up >= 0;
  };

  /** One slice of work. Returns true while anything is left. */
  const slice = (): boolean => {
    const until = performance.now() + SLICE_MS;
    const view = band();
    // On screen (and the screen and a half either side of it) first.
    let first = holes.length;
    let after = 0;
    if (view) {
      let index = frontLine(view.top);
      first = index;
      while (index < holes.length && performance.now() < until) {
        const hole = holes[index];
        if (!hole.isConnected) { index += 1; continue; }
        if (hole.getBoundingClientRect().top > view.bottom) break;
        draw(hole);
        index += 1;
      }
      after = index;
      // The rest of the note is filled outwards from the screen, not from
      // the top of the file: the next thing the reader will see is the line
      // under the one they are on. A jump -- opening deep into a note, or
      // scrolling faster than this can draw -- leaves the stretch behind,
      // so the ends are re-hung on the screen they are now looking at.
      if (!anchored || first > down || first < up) { up = first - 1; down = after; anchored = true; }
      else if (after > down) down = after;
    }
    // Then outwards, both ways. The way the reader is going gets three
    // holes to the other way's one: going down a note draws downwards
    // ahead of them, and the pages behind are still filled in.
    for (let turn = 0; performance.now() < until && open(); turn += 1) {
      const favourDown = goingDown ? turn % 4 !== 3 : turn % 4 === 3;
      if (down < holes.length && (favourDown || up < 0)) { draw(holes[down]); down += 1; }
      else { draw(holes[up]); up -= 1; }
    }
    return open();
  };

  const schedule = (): void => {
    if (stopped || scheduled || idle) return;
    // Near work rides the frame; the far end waits for a quiet moment, so a
    // reader who is scrolling is never competing with the end of the note.
    scheduled = window.requestAnimationFrame(() => {
      scheduled = 0;
      if (stopped) return;
      const more = slice();
      // Freshly drawn formulas have not been through the line-breaking and
      // sign-sizing pass yet (src/mathLayout.ts); the page is told after
      // every batch rather than once at the end.
      onDrawn?.();
      if (more) schedule();
    });
  };

  const onScroll = (): void => {
    const top = scroller?.scrollTop ?? 0;
    if (top !== lastTop) goingDown = top > lastTop;
    lastTop = top;
    if (!stopped && open()) schedule();
  };
  scroller?.addEventListener('scroll', onScroll, { passive: true });

  // The first screenful is drawn before this returns: the reader is looking
  // at the top of the note right now, and a formula that appears a frame
  // later is a line of text that moves under their eyes.
  if (holes.length) { slice(); onDrawn?.(); }
  if (open()) schedule();

  return {
    all(): void {
      let drew = false;
      for (const hole of holes) if (hole.isConnected) { draw(hole); drew = true; }
      down = holes.length;
      up = -1;
      if (drew) onDrawn?.();
    },
    left(): number {
      let count = 0;
      for (const hole of holes) if (hole.isConnected) count += 1;
      return count;
    },
    stop(): void {
      stopped = true;
      if (scheduled) window.cancelAnimationFrame(scheduled);
      if (idle) window.clearTimeout(idle);
      scheduled = 0;
      idle = 0;
      scroller?.removeEventListener('scroll', onScroll);
    },
  };
}
