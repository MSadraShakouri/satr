// Whether a gesture is a selection's rather than the workspace's.
//
// The selection is the platform's now (see the touch block in src/editor.ts):
// the app neither makes one nor knows when a drag is extending one, so the
// flag this used to be is answered from the document instead. The drawer's
// capture-phase listeners ask before they engage, because a horizontal drag
// over the note that is extending a selection must not be read as a workspace
// swipe. Only a selection standing *in the editor* counts: a selection that
// belongs to the reading view is not a reason to refuse the drawer.
//
// (No whitespace here is a real difference: a drag inside the note is the
// platform's, and the platform's own handles are on screen for it.)
export function isDraggingSelection(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  const anchor = selection.anchorNode;
  const content = document.querySelector('.cm-content');
  if (!anchor || !content) return false;
  return content.contains(anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentNode);
}

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


// The reader taking over ends the hold: a new finger, a wheel, a key.
for (const type of ['touchstart', 'pointerdown', 'wheel', 'keydown']) {
  window.addEventListener(type, releaseScrollHold, { capture: true, passive: true });
}
