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

/** PDFium's numbers for the two kinds of page object this reads. */
const OBJECT_TEXT = 1;
const OBJECT_IMAGE = 3;
/** And for text that is drawn as nothing at all: an OCR layer, the words a
 *  machine read off a scan, kept behind the picture so the page can be
 *  searched. Written text is never set this way. */
const TEXT_INVISIBLE = 3;
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
    FPDFTextObj_GetTextRenderMode(object: number): number;
    FPDFPageObj_GetBounds(object: number, left: number, bottom: number, right: number, top: number): boolean;
    pdfium: { getValue(pointer: number, type: string): number };
  };
  memoryManager: { malloc(bytes: number): number; free(pointer: number): void };
  cache: { getContext(id: string): { acquirePage(index: number): { pagePtr: number; release(): void } } | undefined };
}

/**
 * Where the photographs on a page are, in the page's own units.
 *
 * The dark theme is a filter over the whole drawn page, and a photograph
 * is part of a drawn page: a whiteboard came out black with white chalk on
 * it. These rectangles are what the viewer leaves alone.
 *
 * A scanned page is the hard case, because a scan is a picture too -- of a
 * page -- and leaving it alone means a dark theme does nothing at all for
 * a scanned book. What tells the two apart is the writing: a page that was
 * typeset carries its words as text, so the pictures on it are pictures
 * printed in a document; a page with no words on it at all that is covered
 * in pictures is not a page with pictures on it, it is a photograph of a
 * page. Nothing has to be counted or guessed at.
 *
 * Measured on his 528-page scan, on a 52-page handout and on an OCR'd
 * sheet: the book has no text object anywhere, five to forty-nine image
 * strips a page, 82% to 139% of the sheet covered; the handout has one to
 * two thousand text objects a page and no images; an OCR'd scan has its
 * words, but set to be drawn as nothing, which is how it is known from a
 * page someone wrote. The rule this replaced went by a count and a share
 * -- more than eight pictures, or six tenths of the page -- and both of
 * them break on a real document: nine photographs on one slide came out
 * inverted, and a full-bleed photograph behind a heading did too.
 *
 * The one count left is for a sheet handed over in pieces. A page in more
 * than two dozen fragments that cover it is a scan whatever is written on
 * it -- a stamp, a page number, a line of OCR left visible -- because
 * nothing meant to be looked at comes in two dozen pieces.
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
  let written = false;
  try {
    const count = inner.pdfiumModule.FPDFPage_CountObjects(held.pagePtr);
    for (let index = 0; index < count; index += 1) {
      const object = inner.pdfiumModule.FPDFPage_GetObject(held.pagePtr, index);
      if (!object) continue;
      const kind = inner.pdfiumModule.FPDFPageObj_GetType(object);
      // The question is whether anything is written here, so the asking
      // stops at the first word that shows. On a page of the handout that
      // is one call where reading the whole text layer would be two
      // thousand, and five milliseconds.
      if (kind === OBJECT_TEXT) {
        if (!written && inner.pdfiumModule.FPDFTextObj_GetTextRenderMode(object) !== TEXT_INVISIBLE) written = true;
        continue;
      }
      if (kind !== OBJECT_IMAGE) continue;
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
  // A document with no pictures on this page -- most pages of most
  // documents -- is out before anything is weighed.
  if (!found.length) return found;
  const sheet = Math.max(1, page.size.width * page.size.height);
  const covered = found.reduce((sum, rect) => sum + rect.width * rect.height, 0) / sheet;
  const scan = covered >= COVERED && (!written || found.length > PIECES);
  return scan ? [] : found;
}

/** A page with nothing written on it, with this much of it in pictures:
 *  the page is a picture. */
const COVERED = 0.5;
/** And a sheet in this many fragments is a sheet in pieces, whatever is
 *  written on it. */
const PIECES = 24;
