/**
 * PDFium — the engine Chrome draws PDFs with, and the one behind Google
 * Drive's reader — compiled to WebAssembly.
 *
 * pdf.js is a PDF renderer written in JavaScript, and that was the ceiling:
 * a page is parsed and painted by script on the main thread, so a fling
 * through a long document shows grey rectangles and a pinch goes soft until
 * the redraw lands. This is the same C++ engine the browser itself uses,
 * and it can draw a rectangle of a page rather than the whole of it, which
 * is what makes a sharp zoom cheap.
 *
 * One engine for the app, made the first time a document is opened and kept
 * afterwards: the wasm is 4.5 MB and compiling it twice would be felt.
 *
 * It is built here from its three pieces rather than by the package's own
 * one-liner, because the dark theme needs something the wrapper does not
 * offer: where the pictures on a page are. Same wasm, same document, one
 * extra question asked of it (`imagesOnPage`).
 */
import { init } from '@embedpdf/pdfium';
import { PdfEngine as PdfiumEngine, PdfiumNative, browserImageDataToBlobConverter } from '@embedpdf/engines';
import type { PdfEngine } from '@embedpdf/engines';
import type { PdfDocumentObject, PdfPageObject } from '@embedpdf/models';

let engine: Promise<PdfEngine<Blob>> | null = null;
let native: PdfiumNative | null = null;

/**
 * The wasm, from this app's own origin. Resolved against the document's base
 * rather than written as a bare path: the worker that fetches it resolves a
 * relative URL against itself, which is the mistake that leaves a reader
 * with no decoders and no explanation (the same one Gander documents).
 */
const wasmUrl = (): string => new URL('pdfium/pdfium.wasm', document.baseURI).href;

export function pdfium(): Promise<PdfEngine<Blob>> {
  engine ??= (async () => {
    const wasmBinary = await (await fetch(wasmUrl())).arrayBuffer();
    native = new PdfiumNative(await init({ wasmBinary }));
    return new PdfiumEngine(native, { imageConverter: browserImageDataToBlobConverter }) as PdfEngine<Blob>;
  })();
  return engine;
}

/** A rectangle of a page, in the page's own units, measured from its top. */
export interface PageRect { x: number; y: number; width: number; height: number }

/** PDFium's number for a page object that is an image. */
const OBJECT_IMAGE = 3;
/** Four floats, for the bounds of one object. */
const FLOAT = 4;

/**
 * What the wrapper keeps to itself. These are the fields PdfiumNative is
 * built with -- the wasm module, its allocator, and the map of open
 * documents -- reached here by name because the class declares them
 * private. Pinned to the version in package.json; the test that reads an
 * image off a page fails loudly if a later one renames them.
 */
interface Innards {
  pdfiumModule: {
    FPDFPage_CountObjects(page: number): number;
    FPDFPage_GetObject(page: number, index: number): number;
    FPDFPageObj_GetType(object: number): number;
    FPDFPageObj_GetBounds(object: number, left: number, bottom: number, right: number, top: number): boolean;
    pdfium: { getValue(pointer: number, type: string): number };
  };
  memoryManager: { malloc(bytes: number): number; free(pointer: number): void };
  cache: { getContext(id: string): { acquirePage(index: number): { pagePtr: number; release(): void } } | undefined };
}

/**
 * Where the pictures on a page are, in the page's own units.
 *
 * The dark theme is a filter over the whole drawn page, and a photograph
 * is part of a drawn page: a whiteboard came out black with white chalk on
 * it. These rectangles are what the viewer leaves alone.
 *
 * A page that is mostly picture is not a page with pictures on it -- it is
 * a scanned page -- and a scan is left to the filter, or a dark theme would
 * do nothing at all for a scanned book.
 *
 * That is judged on the page and not on any one picture, because a scanner
 * does not hand over one image a page. A 528-page book of his comes in
 * strips: eleven to thirty-three JPEGs a page, 8x436, 1144x24, 64x8, which
 * together are the whole sheet. Measured against each picture on its own
 * every strip looked like a photograph, so every strip was laid back over
 * the page un-inverted, and a dark page came out as a patchwork of white
 * bands -- or, where the strips happened to tile the sheet, as a white page
 * in a dark theme. Two things say scan: how much of the page is covered,
 * all pictures counted, and how many there are. A slide with photographs on
 * it has one or two, or three; nothing meant to be read as a picture comes
 * in eleven pieces.
 *
 * Only unrotated pages are answered for. The bounds come back in PDF user
 * space, which a rotated page does not share with what is drawn, and a
 * rectangle in the wrong place would be worse than none.
 */
export function imagesOnPage(doc: PdfDocumentObject, page: PdfPageObject): PageRect[] {
  if (!native || page.rotation) return [];
  const inner = native as unknown as Innards;
  const context = inner.cache.getContext(doc.id);
  if (!context) return [];
  const held = context.acquirePage(page.index);
  const bounds = inner.memoryManager.malloc(FLOAT * 4);
  const found: PageRect[] = [];
  try {
    const count = inner.pdfiumModule.FPDFPage_CountObjects(held.pagePtr);
    for (let index = 0; index < count; index += 1) {
      const object = inner.pdfiumModule.FPDFPage_GetObject(held.pagePtr, index);
      if (!object || inner.pdfiumModule.FPDFPageObj_GetType(object) !== OBJECT_IMAGE) continue;
      if (!inner.pdfiumModule.FPDFPageObj_GetBounds(object, bounds, bounds + FLOAT, bounds + FLOAT * 2, bounds + FLOAT * 3)) continue;
      const at = (slot: number): number => inner.pdfiumModule.pdfium.getValue(bounds + FLOAT * slot, 'float');
      const [left, bottom, right, top] = [at(0), at(1), at(2), at(3)];
      const width = right - left;
      const height = top - bottom;
      if (width <= 0 || height <= 0) continue;
      // PDF space counts up from the foot of the page; a drawn page counts
      // down from its head.
      found.push({ x: left, y: page.size.height - top, width, height });
    }
  } catch { return []; } finally {
    inner.memoryManager.free(bounds);
    held.release();
  }
  if (found.length > MOST_PICTURES) return [];
  const sheet = Math.max(1, page.size.width * page.size.height);
  const covered = found.reduce((sum, rect) => sum + rect.width * rect.height, 0) / sheet;
  return covered >= SCANNED ? [] : found;
}

/** This much of the page in pictures, and the page is one. */
const SCANNED = 0.6;
/** And this many pictures is a sheet in pieces, whatever they cover. */
const MOST_PICTURES = 8;
