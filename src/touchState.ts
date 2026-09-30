// A shared flag: the editor is mid-gesture extending a selection with the
// finger still down. The drawer's capture-phase listeners check this before
// they engage, because at that moment the DOM selection may not yet reflect
// what the finger is doing, and the drawer would otherwise steal a diagonal
// drag as a workspace swipe.

let draggingSelection = false;

export const beginSelectionDrag = (): void => { draggingSelection = true; };
export const endSelectionDrag = (): void => { draggingSelection = false; };
export const isDraggingSelection = (): boolean => draggingSelection;
