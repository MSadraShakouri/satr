// Side drawers (files on the left, outline + search on the right), both on
// Obsidian's mobile drawer physics as measured in its production bundle:
// the drawer follows the finger, velocity is EMA-smoothed, and on release a
// fling projection decides (position + 1s of velocity must cross half the
// width); the settle animation's duration scales with the distance left
// (200ms for a full traversal, ease-out). Grabbing a drawer mid-animation
// continues from where it visually is. Scrollable content, text selections
// and the bottom gesture area win over the drawer. The note, the header
// buttons and the bottom bar slide aside with the drawer.
//
// Both sides share one implementation, so opening with a button, swiping
// open, swiping closed and tapping the backdrop feel the same on the left
// and on the right.

export type Side = 'left' | 'right';

const MOVE_DEADLINE_MS = 200;
const SETTLE_MS = 200;
const PROJECT_MS = 1000;
const EMA_ALPHA = 0.2;
const HIDE_FACTOR = 1.05; // closed panels sit 5% past the edge, hiding their shadow

export interface DrawerOptions {
  panels: Record<Side, HTMLElement>;
  /** Elements that slide aside with the drawer (note, header, bottom bar). */
  movers: HTMLElement[];
  backdrop: HTMLElement;
  /** Body class while each side is open. */
  classes: Record<Side, string>;
  /** A drawer starts opening (button or drag). */
  onOpening?(side: Side): void;
  /** A drawer finished settling. */
  onSettled?(side: Side, open: boolean): void;
}

export function initDrawers(options: DrawerOptions) {
  const { panels, movers, backdrop, classes } = options;
  const sign = (side: Side): number => (side === 'left' ? 1 : -1);
  const width = (): number => Math.min(window.innerWidth * 0.84, 420);
  const isOpen = (side: Side): boolean => document.body.classList.contains(classes[side]);
  const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const insetProbe = document.createElement('div');
  insetProbe.setAttribute('aria-hidden', 'true');
  insetProbe.style.cssText = 'position:fixed;inset:auto 0 0;height:0;visibility:hidden;pointer-events:none;padding-bottom:var(--safe-bottom)';
  document.body.appendChild(insetProbe);
  const bottomInset = (): number => parseFloat(getComputedStyle(insetProbe).paddingBottom) || 0;

  let settleSide: Side | null = null;
  let settleTarget: boolean | null = null;
  let settleAnims: Animation[] = [];
  let dragWidth = 0;

  const all = (side: Side): HTMLElement[] => [panels[side], ...movers, backdrop];

  /** How far a drawer is open in px, from its panel's computed transform. */
  function shiftOf(side: Side): number {
    const w = width();
    const m = new DOMMatrixReadOnly(getComputedStyle(panels[side]).transform);
    return Math.max(0, Math.min(w, w - (sign(side) * -m.m41) / HIDE_FACTOR));
  }
  function render(side: Side, shift: number): void {
    const w = dragWidth || width();
    const s = Math.max(0, Math.min(w, shift));
    for (const el of all(side)) el.style.transition = 'none';
    panels[side].style.transform = `translate3d(${-sign(side) * HIDE_FACTOR * (w - s)}px,0,0)`;
    panels[side].style.visibility = 'visible';
    for (const el of movers) el.style.transform = `translate3d(${sign(side) * s}px,0,0)`;
    // A fully closed drawer must not leave the (invisible) backdrop covering
    // the note, or it becomes the scroll target and scrolling dies.
    backdrop.style.display = s > 0 ? 'block' : 'none';
    backdrop.style.opacity = String(s / w);
  }
  /** Back to the steady state given by the body class (no visible jump). */
  function clear(side: Side): void {
    for (const el of all(side)) { el.style.transition = ''; el.style.transform = ''; }
    panels[side].style.visibility = '';
    backdrop.style.display = '';
    backdrop.style.opacity = '';
  }
  function cancelSettle(): void {
    if (settleSide === null) return;
    const side = settleSide;
    const shift = shiftOf(side);
    for (const anim of settleAnims) anim.cancel();
    settleAnims = [];
    settleSide = null;
    settleTarget = null;
    dragWidth = width();
    render(side, shift);
  }
  function settle(side: Side, open: boolean): void {
    const w = dragWidth || width();
    const from = shiftOf(side);
    const end = open ? w : 0;
    const duration = reducedMotion() ? 0 : Math.max(SETTLE_MS * (w ? Math.abs(end - from) / w : 1), 1);
    const timing: KeyframeAnimationOptions = { duration, easing: 'ease-out', fill: 'forwards' };
    const s = sign(side);
    for (const anim of settleAnims) anim.cancel();
    settleSide = side;
    settleTarget = open;
    for (const el of all(side)) el.style.transition = 'none';
    panels[side].style.visibility = 'visible';
    backdrop.style.display = 'block';
    settleAnims = [
      panels[side].animate([
        { transform: `translate3d(${-s * HIDE_FACTOR * (w - from)}px,0,0)` },
        { transform: `translate3d(${-s * HIDE_FACTOR * (w - end)}px,0,0)` },
      ], timing),
      ...movers.map((el) => el.animate(
        [{ transform: `translate3d(${s * from}px,0,0)` }, { transform: `translate3d(${s * end}px,0,0)` }], timing)),
      backdrop.animate([{ opacity: w ? from / w : 0 }, { opacity: open ? 1 : 0 }], timing),
    ];
    settleAnims[0].onfinish = () => {
      document.body.classList.toggle(classes[side], open);
      clear(side);
      for (const anim of settleAnims) anim.cancel();
      settleAnims = [];
      settleSide = null;
      settleTarget = null;
      options.onSettled?.(side, open);
    };
  }

  /** Open or close a drawer with the settle animation (buttons, backdrop). */
  function toggle(side: Side, open = !isOpen(side)): void {
    const other: Side = side === 'left' ? 'right' : 'left';
    if (open && (isOpen(other) || settleSide === other)) {
      // One drawer at a time.
      cancelSettle();
      document.body.classList.remove(classes[other]);
      clear(other);
    }
    if (settleSide === side) cancelSettle();
    else if (open === isOpen(side)) return;
    if (open) options.onOpening?.(side);
    dragWidth = width();
    render(side, shiftOf(side));
    settle(side, open);
  }

  // ---- Gesture ----
  let id = -1;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let lastX = 0;
  let lastTime = 0;
  let velocity = 0;
  let startShift = 0;
  let engaged = false;
  let side: Side | null = null; // decided at touchstart if one is open, else by direction
  let resumeTarget: boolean | null = null;

  function freeze(which: Side): number {
    // Pin a drawer that is in flight to where it visually is, so a re-grab
    // starts from there. At rest, leave the DOM alone (a plain scroll or tap
    // must not pay for inline styles or a shown backdrop).
    dragWidth = width();
    const shift = shiftOf(which);
    const open = isOpen(which);
    if ((!open && shift <= 0) || (open && shift >= dragWidth)) return shift;
    render(which, shift);
    return shift;
  }
  function abort(): void {
    // Not a drawer swipe: settle back to where the drawer came from, or
    // resume the settle we froze on touchstart. Never leave it hanging.
    if (side && engaged) settle(side, resumeTarget ?? isOpen(side));
    else if (side && resumeTarget !== null) settle(side, resumeTarget);
    else if (side) clear(side);
    resumeTarget = null;
    engaged = false;
    id = -1;
  }
  document.addEventListener('touchstart', (event) => {
    if (id !== -1 || event.touches.length !== 1) return;
    const touch = event.touches[0] as Touch & { touchType?: string };
    if (touch.touchType === 'stylus') return;
    for (let el = event.target as HTMLElement | null; el; el = el.parentElement) {
      if (el.dataset && el.dataset.ignoreSwipe !== undefined) return;
    }
    // The bottom gesture-navigation zone belongs to the system.
    if (window.innerHeight - touch.clientY < bottomInset() + 4) return;
    side = settleSide ?? (isOpen('left') ? 'left' : isOpen('right') ? 'right' : null);
    resumeTarget = settleTarget;
    cancelSettle();
    startShift = side ? freeze(side) : 0;
    dragWidth = width();
    id = touch.identifier;
    startX = lastX = touch.clientX;
    startY = touch.clientY;
    startTime = lastTime = performance.now();
    velocity = 0;
    engaged = false;
  }, { passive: true, capture: true });

  document.addEventListener('touchmove', (event) => {
    if (id === -1) return;
    if (event.touches.length !== 1) { abort(); return; }
    const touch = [...event.touches].find((item) => item.identifier === id);
    if (!touch) return;
    const now = performance.now();
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    velocity = (1 - EMA_ALPHA) * velocity + EMA_ALPHA * ((touch.clientX - lastX) / Math.max(1, now - lastTime));
    lastX = touch.clientX;
    lastTime = now;
    if (!engaged) {
      // Not ours: held still too long, moved vertically, or overshot vertically.
      if (now - startTime > MOVE_DEADLINE_MS || Math.abs(dy) > 80) { abort(); return; }
      if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) <= 4) return;
      // With both closed, the direction picks the drawer: right for the left one.
      const which: Side = side ?? (dx > 0 ? 'left' : 'right');
      const opening = sign(which) * dx > 0;
      // Only a drag away from the settled edge counts.
      if ((opening && startShift >= dragWidth) || (!opening && startShift <= 0)) return;
      // Horizontally scrollable content under the finger wins.
      for (let el = event.target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        if (el.scrollWidth <= el.clientWidth) continue;
        if (!['auto', 'scroll'].includes(getComputedStyle(el).overflowX)) continue;
        if ((dx > 0 && el.scrollLeft > 0) || (dx < 0 && el.scrollLeft < el.scrollWidth - el.clientWidth - 1)) {
          abort(); return;
        }
      }
      // An active text selection takes priority over the drawer.
      if (window.getSelection()?.toString()) { abort(); return; }
      side = which;
      engaged = true;
      if (startShift === 0) options.onOpening?.(which);
    }
    event.preventDefault();
    render(side!, startShift + sign(side!) * dx);
  }, { passive: false, capture: true });

  const finish = (event: TouchEvent, cancelled = false): void => {
    if (id === -1) return;
    if (side && engaged) {
      const touch = [...event.changedTouches].find((item) => item.identifier === id);
      const dx = touch ? touch.clientX - startX : 0;
      const dy = touch ? Math.abs(touch.clientY - startY) : 999;
      if (cancelled) {
        settle(side, resumeTarget ?? isOpen(side));
      } else {
        // Fling projection: where the drawer would be after 1s of coasting.
        const projected = startShift + sign(side) * (dx + velocity * PROJECT_MS);
        settle(side, projected > dragWidth / 2 && dy < 80 && Math.abs(dx) > dy);
      }
    } else if (side && resumeTarget !== null) {
      settle(side, resumeTarget);
    } else if (side) {
      clear(side); // plain tap: release the touchstart freeze
    }
    resumeTarget = null;
    engaged = false;
    id = -1;
  };
  document.addEventListener('touchend', (event) => finish(event), { passive: true, capture: true });
  document.addEventListener('touchcancel', (event) => finish(event, true), { passive: true, capture: true });

  backdrop.addEventListener('click', () => {
    if (isOpen('left') || settleSide === 'left') toggle('left', false);
    if (isOpen('right') || settleSide === 'right') toggle('right', false);
  });

  return { toggle, isOpen, bottomInset };
}
