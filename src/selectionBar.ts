// The bar that appears over a selection on a phone: the app's own menu for
// what a finger has selected.
//
// Android gives a WebView its own selection bar, and when it appears it is the
// right one to use — Cut, Copy, Paste, Select all in the reader's own language.
// What the app cannot do is make it appear: the platform shows it for a
// selection *it* made, from a gesture it recognised, and Satr's double tap is
// its own (the note is CodeMirror's editable, and the word under the finger is
// found by src/touchSelection.ts). So the app brings its own, in the same
// place and with the same actions — plus the one Markor taught us to want:
// **Line**, which grows the selection to the whole line or lines it touches
// (Markor's "expand selection of cursor to whole line"), so a line can be
// copied or deleted whole without dragging handles.
//
// Placement follows the finger's own selection: above it, centred, and inside
// what is actually visible — with the keyboard up, the visual viewport is the
// part of the page the reader can see, and a selection under the keyboard puts
// the bar at the keyboard's own edge instead of nowhere.
//
// The bar carries the selection's two handles as well. The platform draws
// handles only for a selection it made from a gesture of its own, and Satr's
// double tap and drag are the app's; a selection the app made therefore had no
// way to be adjusted — the reader's only recourse was to let go and start
// again, which is why the drag read as unreliable. These are the same two
// grips, on the same two ends of the same selection, and dragging one moves
// that end (src/main.ts turns the finger's coordinates into a document
// position). Nothing is taken from the platform: while its own selection and
// handles are up, this bar is not there at all (src/main.ts's syncSelectionBar).
export type SelectionAction = 'line' | 'copy' | 'cut' | 'paste' | 'all';
export type SelectionEdge = 'start' | 'end';

export interface SelectionBarDeps {
  /** Viewport coordinates of the selection's first and last rows. */
  anchor(from: number, to: number): { top: number; bottom: number } | null;
  run(action: SelectionAction): void;
  /** A point on the selection's edge, as the hand would take hold of it:
   *  the start handle sits under the selection's first character, the end
   *  handle under its last. */
  point(pos: number, side: 1 | -1): { x: number; y: number } | null;
  /** The finger dragging a handle: move that end of the selection to a point
   *  on the page. */
  handle(edge: SelectionEdge, x: number, y: number): void;
}

const LABELS: [SelectionAction, string][] = [
  ['line', 'Line'],
  ['cut', 'Cut'],
  ['copy', 'Copy'],
  ['paste', 'Paste'],
  ['all', 'Select all'],
];

export interface SelectionBar {
  show(from: number, to: number): void;
  hide(): void;
  reposition(from: number, to: number): void;
  readonly visible: boolean;
}

export function createSelectionBar(deps: SelectionBarDeps): SelectionBar {
  const bar = document.createElement('div');
  bar.className = 'selection-bar';
  const handles = document.createElement('div');
  handles.className = 'selection-handles';
  handles.hidden = true;
  handles.innerHTML = (['start', 'end'] as const).map((edge) =>
    `<button type="button" class="selection-handle" data-edge="${edge}" aria-label="${edge === 'start' ? 'Selection start' : 'Selection end'}"><span></span></button>`).join('');
  document.body.appendChild(handles);
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Selection');
  bar.hidden = true;
  bar.innerHTML = LABELS.map(([action, label]) =>
    `<button type="button" data-act="${action}">${label}</button>`).join('');
  document.body.appendChild(bar);

  // The bar is chrome: a press on it must never take the note's focus, move
  // the caret or start a selection of its own (the same rule as the tab bar
  // and the keyboard toolbar).
  bar.addEventListener('pointerdown', (event) => event.preventDefault());
  bar.addEventListener('mousedown', (event) => event.preventDefault());

  // A handle, on the other hand, is exactly where the finger is *meant* to
  // drag: the press is claimed, and every move after it is the app's until the
  // finger is up. The element captures the pointer, so the drag survives the
  // finger leaving the small circle — as the platform's own handles do.
  let dragging: SelectionEdge | null = null;
  handles.addEventListener('pointerdown', (event) => {
    const handle = (event.target as HTMLElement).closest<HTMLElement>('.selection-handle');
    if (!handle) return;
    event.preventDefault();
    dragging = handle.dataset.edge as SelectionEdge;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('is-dragging');
  });
  handles.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    event.preventDefault();
    deps.handle(dragging, event.clientX, event.clientY);
  });
  const release = (event: PointerEvent): void => {
    if (!dragging) return;
    const handle = handles.querySelector<HTMLElement>(`.selection-handle[data-edge="${dragging}"]`);
    if (handle?.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    handle?.classList.remove('is-dragging');
    dragging = null;
  };
  handles.addEventListener('pointerup', release);
  handles.addEventListener('pointercancel', release);
  bar.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button[data-act]');
    if (!button) return;
    event.preventDefault();
    deps.run(button.dataset.act as SelectionAction);
  });

  let shown = false;
  const place = (from: number, to: number): void => {
    const rect = deps.anchor(from, to);
    if (!rect) return;
    const view = window.visualViewport;
    const visibleTop = view?.offsetTop ?? 0;
    const visibleBottom = visibleTop + (view?.height ?? window.innerHeight);
    const height = bar.getBoundingClientRect().height || 44;
    const width = bar.getBoundingClientRect().width || 0;
    const anchorX = (rect as { left?: number; right?: number }).left ?? window.innerWidth / 2;
    // Above the selection; below it when there is no room above; and never
    // under the keyboard (the visual viewport's own bottom edge).
    let top = rect.top - height - 8;
    if (top < visibleTop + 8) top = Math.min(rect.bottom + 8, visibleBottom - height - 8);
    top = Math.max(visibleTop + 8, Math.min(top, visibleBottom - height - 8));
    const left = Math.max(8, Math.min(anchorX - width / 2, window.innerWidth - width - 8));
    bar.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    // The handles hang under the two ends of the selection, a little below the
    // line so a thumb does not cover the text it is adjusting.
    const start = deps.point(from, 1);
    const end = deps.point(to, -1);
    const put = (edge: SelectionEdge, at: { x: number; y: number } | null): void => {
      const handle = handles.querySelector<HTMLElement>(`.selection-handle[data-edge="${edge}"]`);
      if (!handle) return;
      if (!at) { handle.hidden = true; return; }
      handle.hidden = false;
      handle.style.transform = `translate3d(${Math.round(at.x - 11)}px, ${Math.round(at.y + 2)}px, 0)`;
    };
    put('start', start);
    put('end', end);
  };

  return {
    get visible() { return shown; },
    show(from, to) {
      if (from === to) { this.hide(); return; }
      bar.hidden = false;
      handles.hidden = false;
      bar.classList.add('is-open');
      shown = true;
      place(from, to);
    },
    reposition(from, to) {
      if (!shown || from === to) return;
      place(from, to);
    },
    hide() {
      if (!shown) return;
      shown = false;
      bar.classList.remove('is-open');
      bar.hidden = true;
      handles.hidden = true;
    },
  };
}
