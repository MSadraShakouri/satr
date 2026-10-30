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
import { PdfErrorCode, type PdfBookmarkObject, type PdfDocumentObject, type PdfPageObject, type PdfTask } from '@embedpdf/models';
import type { Rect as PageRect } from '@embedpdf/models';
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
  /** The app's floating layer — where the navbar pill lives. The page
   *  counter belongs there rather than in the document: it is chrome, not
   *  part of the page. */
  overlay?: HTMLElement | null;
}

/** The two stops Obsidian offers in its display options' zoom section. */
export type PdfFit = 'width' | 'height';
/** A line of the document's own table of contents. Obsidian shows this as a
 *  tree in the second of its two sidebar views; PDFium reads it out of the
 *  file's bookmarks, where pdf.js reads the same thing from its outline. */
export interface PdfOutlineItem {
  title: string;
  /** Null for a bookmark that runs an action rather than naming a page. */
  page: number | null;
  children: PdfOutlineItem[];
}
/** One match: the page it is on, and the boxes to draw over it. */
export interface PdfHit { page: number; rects: PageRect[] }
export interface PdfHandle {
  pages: number;
  place(): PdfPlace;
  goTo(page: number): void;
  fitTo(mode: PdfFit): void;
  /** Which stop the page is sitting at, if either — for the checkmark. */
  fitNow(): PdfFit | null;
  /** The toolbar's − and +: a step in or out, about the middle of the screen. */
  zoomBy(step: number): void;
  zoomNow(): number;
  /** A page as a small picture, for the sidebar. */
  thumbnail(page: number, width: number): Promise<string | null>;
  outline(): Promise<PdfOutlineItem[]>;
  /** Told whenever the page at the top of the screen changes, so the
   *  toolbar's number and the sidebar's highlight follow the reader. */
  onPage(listen: (page: number) => void): () => void;
  /** Every hit for a word, in reading order. PDFium searches the text
   *  itself, where pdf.js makes a viewer assemble the text first. */
  find(keyword: string): Promise<PdfHit[]>;
  /** Mark them all, and put the one being looked at on the screen. */
  showHits(hits: PdfHit[], current: number): void;
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
  proxy: PdfPageObject | null;
  /**
   * The whole page, drawn once at the width the pane gives it — not at the
   * zoom. The browser stretches it for free, so a zoom shows something
   * immediately and a page is never blank, and no amount of zooming asks
   * for it again.
   */
  base: HTMLCanvasElement | null;
  baseFit: number;
  baseTask: PdfTask<Blob> | null;
  /**
   * The part of the page actually on screen, drawn at the screen's own
   * pixels and laid over the stretched base. Zoomed in, this is the only
   * thing a zoom or a scroll costs: one screenful, whatever the zoom.
   */
  detail: HTMLCanvasElement | null;
  detailRect: Rect | null;
  detailZoom: number;
  detailTask: PdfTask<Blob> | null;
  width: number; // natural, at scale 1
  height: number;
  laid: number;
}

/** A rectangle of a page, in the page's own units (scale 1). */
interface Rect { x: number; y: number; width: number; height: number }

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
  // Chrome, not content. It used to ride inside the scroller, which made it
  // part of the document in every way that shows: it sat under the floating
  // buttons rather than with them, it slid sideways with a zoomed column,
  // and a sticky thing is moved by the compositor as the scroll goes by, so
  // it shifted a little when a fast scroll hit an edge. In the app's own
  // floating layer it is fixed to the screen, in the same stack as the
  // navbar pill, and none of that can happen.
  const overlay = options.overlay ?? window.document.querySelector<HTMLElement>('.navbar-wrap') ?? scroller;
  // One page is its own counter: it says nothing a reader doesn't see.
  counter.hidden = document_.pageCount < 2;
  host.append(doc);
  overlay.prepend(counter); // above the navbar pill, which is the layer's own child

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
    slabs.push({ page: index + 1, box, proxy: page, base: null, baseFit: 0, baseTask: null,
      detail: null, detailRect: null, detailZoom: 0, detailTask: null, width, height, laid: height });
  });

  const widest = sizes.reduce((most, size) => Math.max(most, size.width), 1);
  const tallest = sizes.reduce((most, size) => Math.max(most, size.height), 1);
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
  /** The matches on screen. They are boxes over the page rather than
   *  anything the renderer knows about, so a zoom just re-lays them. */
  let marks: PdfHit[] = [];
  let marked = -1;
  const drawMarks = (): void => {
    const scale = scaleNow();
    for (const slab of slabs) for (const old of slab.box.querySelectorAll('.pdf-find-hit')) old.remove();
    marks.forEach((hit, index) => {
      const slab = slabs[hit.page - 1];
      if (!slab) return;
      for (const rect of hit.rects) {
        const el = document.createElement('div');
        el.className = index === marked ? 'pdf-find-hit is-current' : 'pdf-find-hit';
        el.style.left = `${rect.origin.x * scale}px`;
        el.style.top = `${rect.origin.y * scale}px`;
        el.style.width = `${rect.size.width * scale}px`;
        el.style.height = `${rect.size.height * scale}px`;
        slab.box.append(el);
      }
    });
  };

  const layout = (): void => {
    const scale = scaleNow();
    for (const slab of slabs) {
      slab.laid = Math.round(slab.height * scale);
      slab.box.style.width = `${Math.round(slab.width * scale)}px`;
      slab.box.style.height = `${slab.laid}px`;
      // the sharp picture goes where the zoom put it, stretched for now and
      // redrawn when the reader stops moving
      placeDetail(slab);
    }
    if (marks.length) drawMarks();
    measureTop();
  };

  /** The strip the chrome keeps for itself at the top of the pane. A file
   *  that is shown rather than read never hides its header, so a place at
   *  "the top of the screen" belongs under the header and not behind it —
   *  otherwise opening a document scrolls its first page straight back
   *  under the bar and undoes the room the stylesheet just made.
   *  drawBand deliberately does NOT use this: the bar is frosted, so the
   *  page behind it is visible and still has to be drawn. */
  const chromeTop = (): number => parseFloat(getComputedStyle(host).paddingTop) || 0;
  /** Where the top of the screen is, as a page and a fraction into it. */
  const placeNow = (): PdfPlace => {
    const top = scroller.scrollTop + chromeTop() - columnTop;
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
  /** The same offset, as a scroll position: the place lands just below the
   *  header rather than under it. The pinch keeps the raw offsetOf, because
   *  there the anchor is the finger and not the top of the screen. */
  const topFor = (place: { page: number; into: number }): number =>
    Math.max(0, offsetOf(place) - chromeTop());

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
    scroller.scrollTop = topFor(pending);
    return true;
  };
  const letGo = (): void => { pending = null; };

  let settleTimer = 0;

  /** Everything this slab is holding, handed back. */
  const forget = (slab: Slab): void => {
    stop(slab.baseTask); stop(slab.detailTask);
    slab.baseTask = null; slab.detailTask = null;
    slab.base?.remove(); slab.base = null; slab.baseFit = 0;
    slab.detail?.remove(); slab.detail = null; slab.detailRect = null; slab.detailZoom = 0;
  };

  /**
   * Two pictures per page, not one.
   *
   * The base is the whole page at the pane's width, and it never changes
   * when the reader zooms: the browser stretches it, which costs nothing
   * and means a zoom is instant and a page is never blank. Zoomed in, the
   * stretch is soft, so a second picture is drawn over it — but only of the
   * part on screen, at the screen's own pixels. That is the whole of what a
   * zoom costs now: one screenful, at 8x as at 2x.
   *
   * The page used to be redrawn whole at every zoom, which at 4x is sixteen
   * times the pixels of the screen it is shown on, nearly all of them off
   * the edges — and over the budget, so the engine was asked for fewer
   * pixels than the screen has and the text came back soft anyway. Slicing
   * was tried before this and abandoned, because with pdf.js a slice cost a
   * page: the engine can draw a rectangle on its own now.
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
      if (!keep) { forget(slab); continue; } // far from the screen: its memory back
      if (!near || !slab.proxy) continue;
      if (slab.baseFit !== fit) void paintBase(slab);
      const want = detailWanted(slab);
      if (!want) {
        if (slab.detail) { stop(slab.detailTask); slab.detailTask = null; slab.detail.remove(); slab.detail = null; slab.detailRect = null; }
        continue;
      }
      if (slab.detailZoom === zoom && slab.detailRect && covers(slab.detailRect, want)) continue;
      void paintDetail(slab, want);
    }
  };

  /** The screen's own pixels, unless the picture asked for would cost more
   *  than the budget, and then as many as fit. */
  const rasterFor = (width: number, height: number): number => {
    const fitted = Math.sqrt(maxCanvasPixels() / Math.max(1, width * height));
    return Math.max(1, Math.min(window.devicePixelRatio || 1, fitted));
  };

  /**
   * A canvas of a given size in the screen's pixels. It is given no size in
   * CSS: the base fills its page box by the stylesheet (inset: 0), so the
   * browser stretches it to whatever the zoom makes the box — which is the
   * whole point of drawing it once. A tile is placed by placeDetail.
   *
   * Pinning a CSS size here was a bug worth naming: zoomed out, a picture
   * drawn for the page's full width stayed that wide while its box shrank,
   * so pages overlapped the ones below them; zoomed in, the page was empty
   * wherever a tile had not landed yet, instead of soft.
   */
  const sheet = (width: number, height: number, raster: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null => {
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.round(width * raster);
    canvas.height = Math.round(height * raster);
    const context = canvas.getContext('2d');
    return context ? { canvas, context } : null;
  };

  /** The whole page at the pane's width. Drawn once, stretched thereafter. */
  async function paintBase(slab: Slab): Promise<void> {
    const drawnFor = fit;
    const width = Math.round(slab.width * drawnFor);
    const height = Math.round(slab.height * drawnFor);
    if (!slab.proxy || width <= 0 || height <= 0) return;
    slab.baseFit = drawnFor; // claimed, so the next pass does not ask again
    stop(slab.baseTask);
    const raster = rasterFor(width, height);
    const made = sheet(width, height, raster);
    if (!made) return;
    const task = engine.renderPage(document_, slab.proxy, { scaleFactor: drawnFor, dpr: raster, withAnnotations: true });
    slab.baseTask = task;
    let picture: ImageBitmap;
    try {
      picture = await createImageBitmap(await task.toPromise());
    } catch {
      if (slab.baseFit === drawnFor) slab.baseFit = 0;
      return; // called off, or the document went away
    }
    if (slab.baseTask !== task) { picture.close(); return; }
    made.canvas.width = picture.width;
    made.canvas.height = picture.height;
    made.context.drawImage(picture, 0, 0);
    picture.close();
    made.canvas.className = 'pdf-raster';
    // the picture it replaces stays up until this one is ready, so a resize
    // is never a column of empty boxes
    slab.base?.remove();
    slab.box.prepend(made.canvas);
    slab.base = made.canvas;
    slab.baseTask = null;
  }

  /** The part of a page the reader can see, with a quarter-screen of margin
   *  so a small scroll does not need a new one. Null when the page is not
   *  zoomed past its own width, where the base is already sharp. */
  const detailWanted = (slab: Slab): Rect | null => {
    if (zoom <= 1.01) return null;
    const scale = scaleNow();
    const box = slab.box.getBoundingClientRect();
    const pane = scroller.getBoundingClientRect();
    const margin = { x: pane.width / 4, y: pane.height / 4 };
    const left = clamp((pane.left - margin.x - box.left) / scale, 0, slab.width);
    const right = clamp((pane.right + margin.x - box.left) / scale, 0, slab.width);
    const top = clamp((pane.top - margin.y - box.top) / scale, 0, slab.height);
    const bottom = clamp((pane.bottom + margin.y - box.top) / scale, 0, slab.height);
    if (right - left < 1 || bottom - top < 1) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  /** Whether a tile already drawn still covers what is wanted. */
  const covers = (have: Rect, want: Rect): boolean =>
    have.x <= want.x + 0.5 && have.y <= want.y + 0.5
    && have.x + have.width >= want.x + want.width - 0.5
    && have.y + have.height >= want.y + want.height - 0.5;

  async function paintDetail(slab: Slab, rect: Rect): Promise<void> {
    const scale = scaleNow();
    const drawnAt = zoom;
    if (!slab.proxy) return;
    const width = Math.round(rect.width * scale);
    const height = Math.round(rect.height * scale);
    if (width <= 0 || height <= 0) return;
    slab.detailZoom = drawnAt;
    stop(slab.detailTask);
    const raster = rasterFor(width, height);
    const made = sheet(width, height, raster);
    if (!made) return;
    const task = engine.renderPageRect(document_, slab.proxy,
      { origin: { x: rect.x, y: rect.y }, size: { width: rect.width, height: rect.height } },
      { scaleFactor: scale, dpr: raster, withAnnotations: true });
    slab.detailTask = task;
    let picture: ImageBitmap;
    try {
      picture = await createImageBitmap(await task.toPromise());
    } catch {
      if (slab.detailZoom === drawnAt) slab.detailZoom = 0;
      return;
    }
    if (slab.detailTask !== task) { picture.close(); return; }
    made.canvas.width = picture.width;
    made.canvas.height = picture.height;
    made.context.drawImage(picture, 0, 0);
    picture.close();
    made.canvas.className = 'pdf-raster pdf-detail';
    slab.detail?.remove();
    slab.box.append(made.canvas);
    slab.detail = made.canvas;
    slab.detailRect = rect;
    slab.detailZoom = drawnAt;
    slab.detailTask = null;
    placeDetail(slab);
  }

  /** Where a tile sits on its page, in the layout's own pixels. Recomputed
   *  rather than redrawn when the zoom changes, so the sharp picture is
   *  stretched into its new place and stays until a fresh one lands. */
  const placeDetail = (slab: Slab): void => {
    if (!slab.detail || !slab.detailRect) return;
    const scale = scaleNow();
    slab.detail.style.left = `${Math.round(slab.detailRect.x * scale)}px`;
    slab.detail.style.top = `${Math.round(slab.detailRect.y * scale)}px`;
    slab.detail.style.width = `${Math.round(slab.detailRect.width * scale)}px`;
    slab.detail.style.height = `${Math.round(slab.detailRect.height * scale)}px`;
  };

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
  /** Everything that follows the reader down the document: the counter in
   *  the floating layer, and the toolbar's number and the sidebar's
   *  highlight, which are told only when the page actually changes. */
  const watchers = new Set<(page: number) => void>();
  let announced = 0;
  const showCounter = (): void => {
    const page = pageShown();
    counter.textContent = `${page} / ${document_.pageCount}`;
    if (page === announced) return;
    announced = page;
    for (const listen of watchers) listen(page);
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
    if (pending && Math.abs(scroller.scrollTop - topFor(pending)) > 4) {
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
  /** Fit width is zoom 1 by construction, because fit is measured from the
   *  pane's width. Fit height is therefore the ratio between the two fits:
   *  the whole of the tallest page on the screen at once, which is how a
   *  handout gets read a page at a time without a spread mode. */
  const heightStop = (): number => {
    const room = scroller.clientHeight - chromeTop() - 2 * GAP;
    return room > 0 && fit > 0 ? (room / tallest) / fit : 1;
  };

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
    if (!applyPending()) scroller.scrollTop = topFor(held);
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
    fitTo: (mode: PdfFit) => {
      const pane = scroller.getBoundingClientRect();
      // anchored at the top of the readable area, not the middle: a fit is
      // a request to see this page, from its top
      zoomTo(mode === 'height' ? heightStop() : 1, pane.top + chromeTop(), pane.left + pane.width / 2);
    },
    fitNow: () => {
      if (Math.abs(zoom - 1) < 0.01) return 'width';
      return Math.abs(zoom - heightStop()) < 0.01 ? 'height' : null;
    },
    zoomBy: (step: number) => {
      const pane = scroller.getBoundingClientRect();
      const top = pane.top + chromeTop();
      zoomTo(zoom * step, top + (pane.bottom - top) / 2, pane.left + pane.width / 2);
    },
    zoomNow: () => zoom,
    thumbnail: async (page: number, width: number) => {
      const slab = slabs[page - 1];
      if (!slab?.proxy) return null;
      const made = engine.renderThumbnail(document_, slab.proxy,
        { scaleFactor: width / Math.max(1, slab.width), dpr: 1, withAnnotations: true });
      try {
        const picture = await createImageBitmap(await made.toPromise());
        const canvas = document.createElement('canvas');
        canvas.width = picture.width;
        canvas.height = picture.height;
        canvas.getContext('2d')?.drawImage(picture, 0, 0);
        picture.close();
        return canvas.toDataURL('image/png');
      } catch { return null; }
    },
    outline: async () => {
      const read = (items: PdfBookmarkObject[]): PdfOutlineItem[] => items.map((item) => ({
        title: item.title,
        page: item.target?.type === 'destination' ? item.target.destination.pageIndex + 1 : null,
        children: read(item.children ?? []),
      }));
      try { return read((await engine.getBookmarks(document_).toPromise()).bookmarks ?? []); }
      catch { return []; }
    },
    find: async (keyword: string) => {
      if (!keyword.trim()) return [];
      try {
        const found = await engine.searchAllPages(document_, keyword).toPromise();
        return found.results.map((result) => ({ page: result.pageIndex + 1, rects: result.rects }));
      } catch { return []; }
    },
    showHits: (hits: PdfHit[], current: number) => {
      marks = hits;
      marked = current;
      drawMarks();
      const hit = hits[current];
      if (!hit) return;
      const slab = slabs[hit.page - 1];
      const box = hit.rects[0];
      if (!slab || !box) { handle.goTo(hit.page); return; }
      // A couple of lines of context above the match, but never so far up
      // that its own page is no longer the page at the top of the screen —
      // otherwise the counter and the page box would name the page before.
      const scale = scaleNow();
      const edge = offsetOf({ page: hit.page, into: 0 });
      letGo();
      options.ownScroll?.();
      scroller.scrollTop = Math.max(0, Math.max(edge, edge + box.origin.y * scale - 48) - chromeTop());
      showCounter();
      drawBand();
    },
    onPage: (listen: (page: number) => void) => {
      watchers.add(listen);
      return () => { watchers.delete(listen); };
    },
    goTo: (page: number) => {
      letGo();
      options.ownScroll?.();
      scroller.scrollTop = topFor({ page: clamp(Math.round(page), 1, document_.pageCount), into: 0 });
      showCounter();
      drawBand();
      remember();
    },
    destroy: () => {
      watchers.clear();
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
      for (const slab of slabs) forget(slab);
      // The document's memory goes back to the engine; the engine itself is
      // the app's and stays up, because compiling the wasm again for the
      // next document would be felt.
      void engine.closeDocument(document_).toPromise().catch(() => undefined);
      doc.remove();
      counter.remove();
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
