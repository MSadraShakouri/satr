// A shared flag: the editor is mid-gesture extending a selection with the
// finger still down. The drawer's capture-phase listeners check this before
// they engage, because at that moment the DOM selection may not yet reflect
// what the finger is doing, and the drawer would otherwise steal a diagonal
// drag as a workspace swipe.

let draggingSelection = false;

export const beginSelectionDrag = (): void => { draggingSelection = true; };
export const endSelectionDrag = (): void => { draggingSelection = false; };
export const isDraggingSelection = (): boolean => draggingSelection;

// A widget tap — a checkbox, a wiki link, a footnote — is not a caret
// placement. The WebView can blur and refocus the editable region when such a
// tap is claimed, and the editor's focus handler then glides the caret back
// into view: right after tapping a checkbox the writer had scrolled to, the
// note jumped back to the line the caret was on. The tap says "this tap is
// mine", and the reveal stays quiet for a moment. The window is a second:
// on the phone the WebView's own reaction (the focus, and the caret it puts
// on the marker) arrives well after the finger is up, and a shorter window
// let the glide through behind it.
let revealSuppressedUntil = 0;

export const suppressCaretReveal = (ms = 1000): void => { revealSuppressedUntil = performance.now() + ms; };
export const isCaretRevealSuppressed = (): boolean => performance.now() < revealSuppressedUntil;

// A tick must not move the note. The reveal's quiet window (above) covers the
// editor's own glide; it cannot cover what is not the editor's: a WebView that
// focuses the editable on the tap and brings the caret into view, the
// keyboard's own scroll, a focus that lands after the finger is up. Those show
// up as the note's scroller moving, started by nobody the app can see. So for
// a moment after a tick the scroller's position is held: any move in that
// window is undone. The reader's own next finger — or wheel, or key —
// releases the hold at once, so nothing that was asked for is ever undone.
let hold: { el: HTMLElement; top: number; left: number; until: number; frame: number } | null = null;

export function releaseScrollHold(): void {
  if (!hold) return;
  window.cancelAnimationFrame(hold.frame);
  hold = null;
}

export function holdScrollStill(el: HTMLElement, ms = 700): void {
  releaseScrollHold();
  hold = { el, top: el.scrollTop, left: el.scrollLeft, until: performance.now() + ms, frame: 0 };
  const step = (): void => {
    if (!hold) return;
    if (performance.now() > hold.until) { hold = null; return; }
    if (hold.el.scrollTop !== hold.top) hold.el.scrollTop = hold.top;
    if (hold.el.scrollLeft !== hold.left) hold.el.scrollLeft = hold.left;
    hold.frame = window.requestAnimationFrame(step);
  };
  hold.frame = window.requestAnimationFrame(step);
}


// The same idea for a drag that is extending a selection: the note must not
// move under the finger, but the gesture must stay the *platform's* — a drag
// that turns vertical has to scroll, and a scroll the browser never started
// cannot be resumed half-way. So nothing is prevented; the scroller is pinned
// for as long as the drag is an extend, and let go the moment it becomes a
// scroll (src/editor.ts's touchmove). Pinning writes the position back on
// every frame, so the browser's own pan continues to work — it just has
// nothing to move until the pin is gone.
let pin: { el: HTMLElement; top: number; left: number; frame: number } | null = null;

export function pinScrollStill(el: HTMLElement): void {
  if (pin?.el === el) return;
  unpinScrollStill();
  pin = { el, top: el.scrollTop, left: el.scrollLeft, frame: 0 };
  const step = (): void => {
    if (!pin) return;
    if (pin.el.scrollTop !== pin.top) pin.el.scrollTop = pin.top;
    if (pin.el.scrollLeft !== pin.left) pin.el.scrollLeft = pin.left;
    pin.frame = window.requestAnimationFrame(step);
  };
  pin.frame = window.requestAnimationFrame(step);
}

export function unpinScrollStill(): void {
  if (!pin) return;
  window.cancelAnimationFrame(pin.frame);
  pin = null;
}

// The reader taking over ends the hold: a new finger, a wheel, a key.
for (const type of ['touchstart', 'pointerdown', 'wheel', 'keydown']) {
  window.addEventListener(type, releaseScrollHold, { capture: true, passive: true });
}
// A second finger, a wheel or a key during a drag means the reader is doing
// something else: the pin goes (the drag's own release unpins too).
for (const type of ['wheel', 'keydown']) {
  window.addEventListener(type, unpinScrollStill, { capture: true, passive: true });
}
