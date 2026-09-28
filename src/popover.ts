// Popover anchored to a spot in the text, after Obsidian's .popover.hover-
// popover (app.css): page-coloured card, 1px border, --shadow-s, 8px corners,
// up to 450px wide (80vw on a phone). It opens just below the anchor, or
// above it when the space left above the keyboard is too small, lines up
// with the anchor's start edge (the right edge in RTL text), and follows the
// anchor while the page scrolls or the keyboard opens.

export interface PopoverHandle {
  el: HTMLElement;
  /** Re-measure after the content changed size. */
  reposition(): void;
  close(): void;
}

let current: PopoverHandle | null = null;
export const isPopoverOpen = (): boolean => current !== null;

export function closePopover(): void {
  current?.close();
}

const GAP = 6; // between the anchor line and the card
const MARGIN = 8; // from the screen edges

export function openPopover(options: {
  className?: string;
  /** Anchor rectangle, recomputed on every reposition (the page may scroll). */
  anchor: () => DOMRect | null;
  rtl: boolean;
  content: HTMLElement;
  /** Height hidden at the bottom of the visible area, e.g. the keyboard toolbar. */
  obscuredBottom?: () => number;
  /** Elements that scroll the anchor; the card follows them. */
  scrollers?: HTMLElement[];
  onClose?: () => void;
}): PopoverHandle {
  current?.close();
  const el = document.createElement('div');
  el.className = `popover hover-popover ${options.className ?? ''}`.trim();
  el.dataset.ignoreSwipe = '';
  el.setAttribute('role', 'dialog');
  el.dir = options.rtl ? 'rtl' : 'ltr';
  el.appendChild(options.content);
  document.body.appendChild(el);

  let closed = false;
  const reposition = (): void => {
    if (closed) return;
    const rect = options.anchor();
    if (!rect) { handle.close(); return; }
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? window.innerHeight) - (options.obscuredBottom?.() ?? 0);
    const left = viewport?.offsetLeft ?? 0;
    const right = left + (viewport?.width ?? window.innerWidth);
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    // Vertical: below the anchor if it fits, else above if that fits better.
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - height;
    let y = below;
    if (below + height > bottom - MARGIN && rect.top - top > bottom - rect.bottom) y = Math.max(top + MARGIN, above);
    else y = Math.min(below, Math.max(top + MARGIN, bottom - MARGIN - height));
    // Horizontal: start edge at the anchor, kept on screen.
    let x = options.rtl ? rect.right - width : rect.left;
    x = Math.max(left + MARGIN, Math.min(x, right - MARGIN - width));
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  };

  const onPointerDown = (event: Event): void => {
    if (!el.contains(event.target as Node)) handle.close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); handle.close(); }
  };
  const handle: PopoverHandle = {
    el,
    reposition,
    close() {
      if (closed) return;
      closed = true;
      if (current === handle) current = null;
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
      for (const scroller of options.scrollers ?? []) scroller.removeEventListener('scroll', reposition);
      el.remove();
      options.onClose?.();
    },
  };
  current = handle;
  // A tap anywhere else closes it (and still does what it was meant to do,
  // e.g. place the caret in the note).
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKey, true);
  window.visualViewport?.addEventListener('resize', reposition);
  window.visualViewport?.addEventListener('scroll', reposition);
  window.addEventListener('resize', reposition);
  for (const scroller of options.scrollers ?? []) scroller.addEventListener('scroll', reposition, { passive: true });
  reposition();
  return handle;
}
