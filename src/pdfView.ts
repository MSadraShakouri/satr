// A PDF, opened where it was left.
//
// pdf.js draws it, which is what both readers this was measured against do:
// Obsidian embeds pdf.js's own viewer, and Gander (MIT, mokshablr/gander)
// vendors the library into a WebView with a few hundred lines of its own
// around it. The library is fetched only when a PDF is actually opened, so a
// session that never opens one never pays for it.
//
// Three things, and deliberately no more for now: the pages, a zoom that
// redraws instead of blurring, and the place. Selecting text inside a page,
// searching it, and anything that writes to the file are not here.
//
// What is drawn is never a whole page at full zoom. A page at eight times
// the width of the pane would be a canvas of some thirty million pixels,
// most of it off screen; what is rasterised is the band the reader is
// looking at, one screen either side of it, exactly as Gander redraws "the
// part of it being looked at at whatever zoom the reader has actually
// reached". Scrolling past the band redraws it; the old picture stays up
// meanwhile, so there is never a blank page.
import { PdfErrorCode, type PdfDocumentObject, type PdfPageObject, type PdfTask } from '@embedpdf/models';
import { pdfium } from './pdfiumEngine';

/** Where the reader was. The page and how far into it, rather than a scroll
 *  offset, so the place survives a different zoom, a rotation, or a wider
 *  screen — the offset would mean a different line of a different page. */
export interface PdfPlace {
  /** 1-based, the page at the top of the screen. */
  page: number;
  /** How far into that page the top of the screen is, 0 to 1. */
  into: number;
  /** Multiples of the width that fits the pane: 1 is a page edge to edge. */
  zoom: number;
}

export interface PdfOptions {
  /** The pane that scrolls, which the pages are laid out inside. */
  scroller: HTMLElement;
  place?: PdfPlace | null;
  /** Called as the reader moves, already settled — the caller writes it down. */
  onPlace?: (place: PdfPlace) => void;
  /** About to scroll the pane itself, rather than the reader doing it: the
   *  app's own chrome reads scrolling as a hand and hides the bars for it. */
  ownScroll?: () => void;
}

export interface PdfHandle {
  pages: number;
  place(): PdfPlace;
  goTo(page: number): void;
  destroy(): void;
}

/** His floor, measured on a 52-page handout at 390px: about five pages of it
 *  on the screen at once. Below that a page is no longer recognisable even
 *  by its shape. The ceiling is as far in as the band-drawing stays cheap. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
/** Where a double tap lands, and the point below which it zooms in rather
 *  than back out (Gander's rule: the geometric middle of the two). */
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24;
/** Between two pages, in CSS pixels at any zoom — a gap that grew with the
 *  zoom would push the pages apart as they were read. */
const GAP = 8;
/** How many device pixels one page's picture may cost. Obsidian's own pair,
 *  read out of its app.js: 16777216, and `isMobile && 5242880`. A page is
 *  drawn at the screen's own pixel ratio until that would cost more than
 *  this, and at whatever ratio fits when it would — which is what keeps a
 *  page sharp at a phone's 2.75 or 3 without a canvas the size of a room
 *  when it is zoomed all the way in. */
const maxCanvasPixels = (): number => (Math.min(window.innerWidth, window.innerHeight) < 600 ? 5_242_880 : 16_777_216);
/** Pages are drawn one screen either side of the one being read, and their
 *  pictures kept until they are this far off it, so turning back a page
 *  costs nothing. Gander draws 3 and keeps 5 — of pages, not screens. */
const DRAW_SCREENS = 1;
const KEEP_SCREENS = 2.5;
/** After the reader stops, before the band is drawn again. */
const SETTLE_MS = 120;

interface Slab {
  page: number;
  box: HTMLElement;
  canvas: HTMLCanvasElement | null;
  proxy: PdfPageObject | null;
  task: PdfTask<Blob> | null;
  /** The zoom its picture was drawn at, and the one being drawn now. */
  drawnZoom: number;
  painting: number;
  width: number; // natural, at scale 1
  height: number;
  /** The height of its box as the page is actually laid out: whole pixels,
   *  because that is what the browser gives it. The place arithmetic works
   *  in these and not in the exact fractions, or a jump to page thirty of
   *  fifty-two lands a pixel short of it and reads as page twenty-nine. */
  laid: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** Tells a draw already in flight that nobody wants its picture — a zoom
 *  that lands mid-render, or a page scrolled far enough away to be given
 *  back. Without this the engine would finish every page ever asked for. */
const stop = (task: PdfTask<Blob> | null): void => {
  task?.abort({ code: PdfErrorCode.Cancelled, message: 'superseded' });
};

/** Each document opened in this session gets its own name, so two tabs on
 *  the same file never share the engine's copy of it. */
let opened = 0;

export async function showPdf(host: HTMLElement, source: string | ArrayBuffer, options: PdfOptions): Promise<PdfHandle> {
  // PDFium, not pdf.js: the engine draws on its own and hands back a
  // picture, so there is no worker to wire up and no cmap, font or decoder
  // directory to point at — the one wasm file carries all of it, which is
  // why a scanned page can no longer come out blank for a missing decoder.
  const engine = await pdfium();
  opened += 1;
  const id = `satr-${opened}`;
  const document_: PdfDocumentObject = await (typeof source === 'string'
    ? engine.openDocumentUrl({ id, url: source })
    : engine.openDocumentBuffer({ id, content: source })).toPromise();

  const { scroller } = options;
  const doc = window.document.createElement('div');
  doc.className = 'pdf-doc';
  // A reading of where the reader is, and nothing else: it is not tapped and
  // not dragged. The way through a long document is the scrollbar.
  const counter = window.document.createElement('div');
  counter.className = 'pdf-counter';
  // The pill is a reading of the pane, not a part of the column. Zoomed in,
  // the column is wider than the pane and slides sideways beneath it, and a
  // counter living in the column slid away with it. This bar is the
  // scroller's own child, so it is the pane's width whatever the column
  // does, and the pill stays centred in it.
  const counterBar = window.document.createElement('div');
  counterBar.className = 'pdf-counter-bar';
  // One page is its own counter: it says nothing a reader doesn't see.
  counterBar.hidden = document_.pageCount < 2;
  counterBar.append(counter);
  host.append(doc);
  (scroller.contains(host) ? scroller : host).append(counterBar);

  let zoom = clamp(options.place?.zoom ?? 1, MIN_ZOOM, MAX_ZOOM);
  let fit = 1; // the scale at which a page fills the pane's width
  const slabs: Slab[] = [];

  // Every page's natural size, which is what the column is laid out from.
  // The engine reports all of them when the document opens, so the column is
  // laid out whole from the first frame and never jumps as the reader
  // scrolls into a page of another size.
  const sizes = document_.pages.map((page) => ({ page, width: page.size.width, height: page.size.height }));
  sizes.forEach(({ page, width, height }, index) => {
    const box = window.document.createElement('div');
    box.className = 'pdf-page';
    box.dataset.page = String(index + 1);
    doc.append(box);
    slabs.push({ page: index + 1, box, canvas: null, proxy: page, task: null, drawnZoom: 0, painting: 0, width, height, laid: height });
  });

  const widest = sizes.reduce((most, size) => Math.max(most, size.width), 1);
  const measureFit = (): void => {
    const room = scroller.clientWidth - 2 * GAP;
    fit = room > 0 ? room / widest : 1;
  };
  const scaleNow = (): number => fit * zoom;
  const heightOf = (slab: Slab): number => slab.laid;
  /** Where the first page's top edge sits in the scroller — the column's own
   *  padding, and anything the pane puts above it. Measured rather than
   *  assumed: a jump to page five that lands eight pixels into page four is
   *  not a jump to page five. */
  let columnTop = 0;
  const measureTop = (): void => {
    columnTop = doc.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      + scroller.scrollTop + (parseFloat(getComputedStyle(doc).paddingTop) || 0);
  };
  const layout = (): void => {
    const scale = scaleNow();
    for (const slab of slabs) {
      slab.laid = Math.round(slab.height * scale);
      slab.box.style.width = `${Math.round(slab.width * scale)}px`;
      slab.box.style.height = `${slab.laid}px`;
    }
    measureTop();
  };

  /** Where the top of the screen is, as a page and a fraction into it. */
  const placeNow = (): PdfPlace => {
    const top = scroller.scrollTop - columnTop;
    let edge = 0;
    for (const slab of slabs) {
      const height = heightOf(slab);
      // A pixel short of a page's top edge is that page, not the gap above
      // it: scroll offsets are not exact and a reader who asked for page
      // thirty is on page thirty.
      if (top < edge + height + GAP - 1 || slab.page === slabs.length) {
        return { page: slab.page, into: clamp((top - edge) / Math.max(1, height), 0, 1), zoom };
      }
      edge += height + GAP;
    }
    return { page: 1, into: 0, zoom };
  };
  /** The scroll offset that puts a place at the top of the screen. */
  const offsetOf = (place: { page: number; into: number }): number => {
    let edge = 0;
    for (const slab of slabs) {
      if (slab.page === place.page) return columnTop + edge + place.into * heightOf(slab);
      edge += heightOf(slab) + GAP;
    }
    return 0;
  };

  // The place a document is opened at, held until the reader touches it.
  // Opening is not a quiet moment: the pane is measured, laid out, hidden
  // and shown again while the app settles, and a pane that is re-laid out
  // loses its scroll offset without anybody setting it — the browser simply
  // drops it. So the place is not applied once and trusted; it is kept and
  // put back after every one of those, and only a hand on the document
  // spends it. Until then nothing is written down either, or the stray
  // scroll to the top would become the place.
  let pending: PdfPlace | null = null;
  const applyPending = (): boolean => {
    if (!pending) return false;
    if (!scroller.clientWidth || !scroller.clientHeight) return true; // nowhere to put it yet
    options.ownScroll?.();
    scroller.scrollTop = offsetOf(pending);
    return true;
  };
  const letGo = (): void => { pending = null; };

  let settleTimer = 0;
  /**
   * One picture per page, as pdf.js's own viewer draws them — Obsidian's and
   * Gander's alike. Drawing a slice of a page instead meant a new picture
   * for every scroll and every pinch, each landing at a different offset,
   * which is what made zooming flicker and crawl.
   */
  const drawBand = (): void => {
    const screen = scroller.clientHeight;
    const top = scroller.scrollTop - columnTop;
    let edge = 0;
    for (const slab of slabs) {
      const height = heightOf(slab);
      const from = edge;
      const to = edge + height;
      edge += height + GAP;
      const near = to > top - DRAW_SCREENS * screen && from < top + (1 + DRAW_SCREENS) * screen;
      const keep = to > top - KEEP_SCREENS * screen && from < top + (1 + KEEP_SCREENS) * screen;
      if (!keep) { // far from the screen: give its memory back
        if (slab.canvas) { stop(slab.task); slab.task = null; slab.canvas.remove(); slab.canvas = null; slab.drawnZoom = 0; slab.painting = 0; }
        continue;
      }
      if (!near || !slab.proxy) continue;
      if (slab.drawnZoom === zoom || slab.painting === zoom) continue;
      void paint(slab);
    }
  };

  async function paint(slab: Slab): Promise<void> {
    const scale = scaleNow();
    const width = Math.round(slab.width * scale);
    const height = Math.round(slab.height * scale);
    if (!slab.proxy || width <= 0 || height <= 0) return;
    // The screen's own pixels, unless the page is zoomed far enough in that
    // they would cost more than the budget, and then as many as fit. This is
    // the whole of why a page looked soft before: it was drawn at two device
    // pixels per CSS pixel on a screen with three.
    const fit = Math.sqrt(maxCanvasPixels() / Math.max(1, width * height));
    const raster = Math.max(1, Math.min(window.devicePixelRatio || 1, fit));
    const drawnAt = zoom;
    slab.painting = drawnAt;
    stop(slab.task);
    const canvas = window.document.createElement('canvas');
    canvas.className = 'pdf-raster';
    canvas.width = Math.round(width * raster);
    canvas.height = Math.round(height * raster);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    // The engine draws the page off this thread and hands back a picture of
    // it; the only work left here is putting that picture on the canvas.
    const task = engine.renderPage(document_, slab.proxy, { scaleFactor: scale, dpr: raster, withAnnotations: true });
    slab.task = task;
    let picture: ImageBitmap;
    try {
      picture = await createImageBitmap(await task.toPromise());
    } catch {
      if (slab.painting === drawnAt) slab.painting = 0;
      return; // cancelled by a later zoom, or the document went away
    }
    if (slab.task !== task) { picture.close(); return; }
    canvas.width = picture.width;
    canvas.height = picture.height;
    context.drawImage(picture, 0, 0);
    picture.close();
    // the page it replaces stays up until this one is ready, so a zoom is
    // never a column of empty boxes
    slab.canvas?.remove();
    slab.box.append(canvas);
    slab.canvas = canvas;
    slab.drawnZoom = drawnAt;
    slab.painting = 0;
    slab.task = null;
  }

  /** Which page the counter names. The page at the top of the screen,
   *  except at the very bottom of a document: there the scroll cannot go
   *  any further, the last page can never reach the top, and the reader is
   *  plainly on it. (The place written down stays the exact top-of-screen
   *  one, so reopening lands on the same pixels.) */
  const pageShown = (): number => {
    const scrollable = scroller.scrollHeight > scroller.clientHeight + 4;
    const atEnd = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 2;
    return scrollable && atEnd ? slabs.length : placeNow().page;
  };
  const showCounter = (): void => {
    counter.textContent = `${pageShown()} / ${document_.pageCount}`;
  };

  let placeTimer = 0;
  const remember = (): void => {
    window.clearTimeout(placeTimer);
    placeTimer = window.setTimeout(() => options.onPlace?.(placeNow()), 400);
  };

  const settle = (): void => {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(drawBand, SETTLE_MS);
  };

  const onScroll = (): void => {
    // A scroll nobody asked for, while the document is still being put back
    // where it was: put it back again.
    if (pending && Math.abs(scroller.scrollTop - offsetOf(pending)) > 4) {
      applyPending();
      showCounter();
      return;
    }
    showCounter();
    settle();
    if (!pending) remember();
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  // A hand on the document: it is the reader's now.
  scroller.addEventListener('pointerdown', letGo, { passive: true });
  scroller.addEventListener('wheel', letGo, { passive: true });
  scroller.addEventListener('keydown', letGo);

  /** Zoom to `next`, keeping whatever is under `anchorY` (a client y) where
   *  it is — the pinch's middle, or the point a double tap landed on. */
  /**
   * Zoom about a point, which is the point the reader put their fingers on
   * — in both directions. Vertically that is a page and a fraction into it,
   * because the gaps between pages do not scale with the pages; across, it
   * is a fraction of the column's width, which is the whole of what used to
   * throw a zoomed-in page sideways: the column grew and the sideways
   * scroll stayed where it was.
   */
  const zoomTo = (next: number, anchorY: number, anchorX?: number): void => {
    const limited = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (limited === zoom) return;
    const pane = scroller.getBoundingClientRect();
    const paneTop = pane.top;
    const column = doc.getBoundingClientRect();
    const acrossAt = anchorX ?? pane.left + pane.width / 2;
    const across = clamp((acrossAt - column.left) / Math.max(1, column.width), 0, 1);
    const held = scroller.scrollTop + (anchorY - paneTop) - columnTop;
    let edge = 0;
    let found = { page: 1, into: 0 };
    for (const slab of slabs) {
      const height = heightOf(slab);
      if (held < edge + height + GAP) { found = { page: slab.page, into: clamp((held - edge) / Math.max(1, height), 0, 1) }; break; }
      edge += height + GAP;
    }
    zoom = limited;
    letGo();
    layout();
    options.ownScroll?.();
    scroller.scrollTop = Math.max(0, offsetOf(found) - (anchorY - paneTop));
    // the same slice of the page stays under the finger across as well as down
    const reach = scroller.scrollWidth - scroller.clientWidth;
    if (reach > 0) scroller.scrollLeft = clamp(doc.offsetLeft + across * doc.offsetWidth - (acrossAt - pane.left), 0, reach);
    showCounter();
    drawBand();
    remember();
  };

  // Pinch: the pages follow the fingers at once, scaled as they are, and are
  // drawn again at the zoom the fingers left them at. Drawing during the
  // gesture would be a page of work per frame for a picture that is about to
  // be wrong anyway.
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { span: number; middle: number; across: number; zoom: number } | null = null;
  const spanOf = (): { span: number; middle: number; across: number } => {
    const [a, b] = [...touches.values()];
    return { span: Math.hypot(a.x - b.x, a.y - b.y), middle: (a.y + b.y) / 2, across: (a.x + b.x) / 2 };
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 2) {
      const { span, middle, across } = spanOf();
      pinch = { span, middle, across, zoom };
      // The origin is the point between the fingers in the column's own
      // coordinates, both ways. Measured off the column's live box, so it
      // carries the scroll and the padding above the first page with it —
      // which the old one did not, and the pages slid at every pinch.
      const column = doc.getBoundingClientRect();
      doc.style.transformOrigin = `${across - column.left}px ${middle - column.top}px`;
    }
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!touches.has(event.pointerId)) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!pinch || touches.size !== 2) return;
    event.preventDefault();
    const { span } = spanOf();
    const factor = clamp((span / pinch.span) * pinch.zoom, MIN_ZOOM, MAX_ZOOM) / pinch.zoom;
    doc.style.transform = `scale(${factor})`;
  };
  const endPinch = (event: PointerEvent): void => {
    touches.delete(event.pointerId);
    if (!pinch || touches.size >= 2) return;
    const factor = parseFloat(/scale\(([\d.]+)\)/.exec(doc.style.transform)?.[1] ?? '1');
    doc.style.transform = '';
    doc.style.transformOrigin = '';
    const { middle, across } = pinch;
    const from = pinch.zoom;
    pinch = null;
    zoomTo(from * factor, middle, across);
  };
  scroller.addEventListener('pointerdown', onPointerDown, { passive: true });
  scroller.addEventListener('pointermove', onPointerMove, { passive: false });
  scroller.addEventListener('pointerup', endPinch, { passive: true });
  scroller.addEventListener('pointercancel', endPinch, { passive: true });

  // A double tap zooms in about the place tapped, and the next one takes it
  // back to the page's own width.
  let lastTap = { time: 0, x: 0, y: 0 };
  const onTap = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const now = Date.now();
    const quick = now - lastTap.time < DOUBLE_TAP_MS;
    const near = Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_SLOP;
    lastTap = { time: now, x: event.clientX, y: event.clientY };
    // > 1, not > 0: the finger doing the tapping is itself in the set, and
    // asking for an empty one meant a double tap never zoomed on a phone at
    // all — this fires before the pointerup that clears it. Two fingers
    // down is a pinch, and a pinch is not a tap.
    if (!quick || !near || touches.size > 1) return;
    lastTap.time = 0;
    zoomTo(zoom < Math.sqrt(DOUBLE_TAP_ZOOM) ? DOUBLE_TAP_ZOOM : 1, event.clientY, event.clientX);
  };
  doc.addEventListener('pointerup', onTap);

  const onResize = (): void => {
    const held = placeNow();
    measureFit();
    layout();
    if (!applyPending()) scroller.scrollTop = offsetOf(held);
    showCounter();
    drawBand();
  };
  const watcher = new ResizeObserver(onResize);
  watcher.observe(scroller);

  measureFit();
  layout();
  pending = options.place ? { ...options.place, zoom } : null;
  applyPending();
  showCounter();
  drawBand();

  const handle: PdfHandle = {
    pages: document_.pageCount,
    place: placeNow,
    goTo: (page: number) => {
      letGo();
      options.ownScroll?.();
      scroller.scrollTop = offsetOf({ page: clamp(Math.round(page), 1, document_.pageCount), into: 0 });
      showCounter();
      drawBand();
      remember();
    },
    destroy: () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(placeTimer);
      watcher.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('pointerdown', letGo);
      scroller.removeEventListener('wheel', letGo);
      scroller.removeEventListener('keydown', letGo);
      scroller.removeEventListener('pointerdown', onPointerDown);
      scroller.removeEventListener('pointermove', onPointerMove);
      scroller.removeEventListener('pointerup', endPinch);
      scroller.removeEventListener('pointercancel', endPinch);
      for (const slab of slabs) stop(slab.task);
      // The document's memory goes back to the engine; the engine itself is
      // the app's and stays up, because compiling the wasm again for the
      // next document would be felt.
      void engine.closeDocument(document_).toPromise().catch(() => undefined);
      doc.remove();
      counterBar.remove();
    },
  };
  return handle;
}

/** What a document is remembered by: its first bytes and its length, never
 *  its name or where it sits. Gander's key (Positions.kt), and for its
 *  reasons — one file reaches the reader down several routes, and a place
 *  should survive it being moved or renamed. Two copies of one document
 *  therefore share a place, and a document saved again with changes in it
 *  starts from the top. */
const HEAD_BYTES = 64 * 1024;

export async function pdfKey(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const all = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = all.subarray(0, HEAD_BYTES);
  const stamp = new TextEncoder().encode(String(all.byteLength));
  const both = new Uint8Array(head.byteLength + stamp.byteLength);
  both.set(head, 0);
  both.set(stamp, head.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', both);
  return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
