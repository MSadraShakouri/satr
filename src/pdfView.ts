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
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

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
  /** The counter was tapped: the caller asks which page to go to. */
  onJump?: (current: number, total: number, goTo: (page: number) => void, chip: HTMLElement) => void;
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
/** At most two device pixels per CSS pixel: beyond that a phone's own screen
 *  has nothing left to show for the memory. */
const RASTER_CAP = 2;
/** The drawn band: the screen, and one screen either side of it. */
const BAND_SCREENS = 1;
/** After the reader stops, before the band is drawn again. */
const SETTLE_MS = 120;

interface Slab {
  page: number;
  box: HTMLElement;
  canvas: HTMLCanvasElement | null;
  proxy: PDFPageProxy | null;
  task: RenderTask | null;
  /** The band this canvas holds, in CSS pixels down the page, and at what zoom. */
  drawnFrom: number;
  drawnTo: number;
  drawnZoom: number;
  width: number; // natural, at scale 1
  height: number;
  /** The height of its box as the page is actually laid out: whole pixels,
   *  because that is what the browser gives it. The place arithmetic works
   *  in these and not in the exact fractions, or a jump to page thirty of
   *  fifty-two lands a pixel short of it and reads as page twenty-nine. */
  laid: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export async function showPdf(host: HTMLElement, source: string | ArrayBuffer, options: PdfOptions): Promise<PdfHandle> {
  const pdfjs = await import('pdfjs-dist');
  // The worker keeps parsing off the page's own thread; without it pdf.js
  // does the work inline and a large document visibly stalls.
  const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
  const data = typeof source === 'string' ? { url: source } : { data: source };
  const document_: PDFDocumentProxy = await pdfjs.getDocument({ ...data, isEvalSupported: false }).promise;

  const { scroller } = options;
  const doc = window.document.createElement('div');
  doc.className = 'pdf-doc';
  const counter = window.document.createElement('button');
  counter.type = 'button';
  counter.className = 'pdf-counter';
  // One page is its own counter: it says nothing a reader doesn't see.
  counter.hidden = document_.numPages < 2;
  host.append(doc, counter);

  let zoom = 1;
  let fit = 1; // the scale at which a page fills the pane's width
  const slabs: Slab[] = [];

  // Every page's natural size, which is what the column is laid out from.
  // Asked for once: a page's own viewport is the only thing needed before it
  // is drawn, and asking for all of them up front keeps the column from
  // jumping about as the reader scrolls into pages of another size.
  const sizes = await Promise.all(Array.from({ length: document_.numPages }, async (_, index) => {
    const page = await document_.getPage(index + 1);
    const view = page.getViewport({ scale: 1 });
    return { page, width: view.width, height: view.height };
  }));
  sizes.forEach(({ page, width, height }, index) => {
    const box = window.document.createElement('div');
    box.className = 'pdf-page';
    box.dataset.page = String(index + 1);
    doc.append(box);
    slabs.push({ page: index + 1, box, canvas: null, proxy: page, task: null, drawnFrom: 0, drawnTo: 0, drawnZoom: 0, width, height, laid: height });
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

  let settleTimer = 0;
  const drawBand = (): void => {
    const screen = scroller.clientHeight;
    const top = scroller.scrollTop - columnTop;
    let edge = 0;
    for (const slab of slabs) {
      const height = heightOf(slab);
      const from = clamp(top - BAND_SCREENS * screen - edge, 0, height);
      const to = clamp(top + (BAND_SCREENS + 1) * screen - edge, 0, height);
      edge += height + GAP;
      if (to <= from) { // far from the screen: give its memory back
        if (slab.canvas) { slab.task?.cancel(); slab.task = null; slab.canvas.remove(); slab.canvas = null; slab.drawnZoom = 0; }
        continue;
      }
      const covered = slab.drawnZoom === zoom && from >= slab.drawnFrom && to <= slab.drawnTo;
      if (covered || !slab.proxy) continue;
      void paint(slab, from, to);
    }
  };

  async function paint(slab: Slab, from: number, to: number): Promise<void> {
    const scale = scaleNow();
    const raster = Math.min(RASTER_CAP, window.devicePixelRatio || 1);
    const width = Math.round(slab.width * scale);
    const height = Math.round(to - from);
    if (!slab.proxy || width <= 0 || height <= 0) return;
    slab.task?.cancel();
    const canvas = window.document.createElement('canvas');
    canvas.className = 'pdf-raster';
    canvas.width = Math.round(width * raster);
    canvas.height = Math.round(height * raster);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.top = `${Math.round(from)}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    const viewport = slab.proxy.getViewport({ scale: scale * raster });
    const task = slab.proxy.render({
      canvas,
      canvasContext: context,
      viewport,
      // the band, not the page: everything above it is drawn off the top
      transform: [1, 0, 0, 1, 0, -from * raster],
    });
    slab.task = task;
    try {
      await task.promise;
    } catch {
      return; // cancelled by a later band, or the document went away
    }
    if (slab.task !== task) return;
    slab.canvas?.remove();
    slab.box.append(canvas);
    slab.canvas = canvas;
    slab.drawnFrom = from;
    slab.drawnTo = to;
    slab.drawnZoom = zoom;
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
    counter.textContent = `${pageShown()} / ${document_.numPages}`;
  };

  const settle = (): void => {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(drawBand, SETTLE_MS);
  };

  const onScroll = (): void => {
    showCounter();
    settle();
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });

  /** Zoom to `next`, keeping whatever is under `anchorY` (a client y) where
   *  it is — the pinch's middle, or the point a double tap landed on. */
  const zoomTo = (next: number, anchorY: number): void => {
    const limited = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (limited === zoom) return;
    const paneTop = scroller.getBoundingClientRect().top;
    const held = scroller.scrollTop + (anchorY - paneTop) - columnTop;
    let edge = 0;
    let found = { page: 1, into: 0 };
    for (const slab of slabs) {
      const height = heightOf(slab);
      if (held < edge + height + GAP) { found = { page: slab.page, into: clamp((held - edge) / Math.max(1, height), 0, 1) }; break; }
      edge += height + GAP;
    }
    zoom = limited;
    layout();
    scroller.scrollTop = Math.max(0, offsetOf(found) - (anchorY - paneTop));
    showCounter();
    drawBand();
  };

  // Pinch: the pages follow the fingers at once, scaled as they are, and are
  // drawn again at the zoom the fingers left them at. Drawing during the
  // gesture would be a page of work per frame for a picture that is about to
  // be wrong anyway.
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { span: number; middle: number; zoom: number } | null = null;
  const spanOf = (): { span: number; middle: number } => {
    const [a, b] = [...touches.values()];
    return { span: Math.hypot(a.x - b.x, a.y - b.y), middle: (a.y + b.y) / 2 };
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 2) {
      const { span, middle } = spanOf();
      pinch = { span, middle, zoom };
      doc.style.transformOrigin = `50% ${scroller.scrollTop + (middle - scroller.getBoundingClientRect().top)}px`;
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
    const middle = pinch.middle;
    const from = pinch.zoom;
    pinch = null;
    zoomTo(from * factor, middle);
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
    if (!quick || !near || touches.size) return;
    lastTap.time = 0;
    zoomTo(zoom < Math.sqrt(DOUBLE_TAP_ZOOM) ? DOUBLE_TAP_ZOOM : 1, event.clientY);
  };
  doc.addEventListener('pointerup', onTap);

  counter.addEventListener('click', () => {
    options.onJump?.(pageShown(), document_.numPages, (page) => handle.goTo(page), counter);
  });

  const onResize = (): void => {
    const held = placeNow();
    measureFit();
    layout();
    scroller.scrollTop = offsetOf(held);
    showCounter();
    drawBand();
  };
  const watcher = new ResizeObserver(onResize);
  watcher.observe(scroller);

  measureFit();
  layout();
  showCounter();
  drawBand();

  const handle: PdfHandle = {
    pages: document_.numPages,
    place: placeNow,
    goTo: (page: number) => {
      scroller.scrollTop = offsetOf({ page: clamp(Math.round(page), 1, document_.numPages), into: 0 });
      showCounter();
      drawBand();
    },
    destroy: () => {
      window.clearTimeout(settleTimer);
      watcher.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('pointerdown', onPointerDown);
      scroller.removeEventListener('pointermove', onPointerMove);
      scroller.removeEventListener('pointerup', endPinch);
      scroller.removeEventListener('pointercancel', endPinch);
      for (const slab of slabs) { slab.task?.cancel(); slab.proxy?.cleanup(); }
      void document_.destroy();
      doc.remove();
      counter.remove();
    },
  };
  return handle;
}
