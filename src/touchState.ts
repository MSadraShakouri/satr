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
