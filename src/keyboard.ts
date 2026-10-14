// The keyboard's geometry, in one place: how much of the layout viewport
// the on-screen keyboard actually COVERS — the number a bottom sheet's lift
// and the caret's bottom scroll margin are both built from.
//
// The measured shrink (visual-viewport height lost, or the VirtualKeyboard
// rectangle) is only a cover when the viewport itself was NOT resized for
// the keyboard. In the Android app the WebView is resized instead:
// SystemBarsPlugin gives it a bottom margin as tall as the keyboard (and
// the activity is adjustResize), so `position: fixed; bottom: 0` and the
// editor's scroll box already end exactly on the keyboard's top edge.
// Counting the measured keyboard height there too lifts a sheet by a whole
// keyboard above the keys — the date sheet "flying high" — and hands
// CodeMirror a bottom scroll margin of a keyboard-height on top of a box
// that already ends above the keyboard, collapsing the caret's visible
// band until writing is scrolled to the top of the page.
//
// In a browser nothing resizes the layout viewport for the keyboard
// (index.html: interactive-widget=resizes-visual, and the VirtualKeyboard
// API is set to overlay content), so the measured height is a real cover
// and a sheet must be lifted by it or sit behind the keys.

/** Pixels of the layout viewport's bottom the keyboard covers: 0 when the
 *  viewport was already resized for it (the app), the measured keyboard
 *  height when it was not (a browser). Never negative. */
export function keyboardCoverPx(viewportResizedForKeyboard: boolean, measuredPx: number): number {
  if (viewportResizedForKeyboard) return 0;
  return Math.max(0, measuredPx);
}

/** Height still visible above a lift of `liftPx` in a viewport
 *  `viewportHeightPx` tall — a sheet's room. Never negative. */
export function sheetRoomPx(viewportHeightPx: number, liftPx: number): number {
  return Math.max(0, Math.round(viewportHeightPx - liftPx));
}
