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
