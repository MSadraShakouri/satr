/**
 * Where the photographs on a page are, in the page's own units.
 *
 * This runs inside the worker, beside PDFium itself (src/pdfiumWorker.ts).
 * It is the one question the engine's own wrapper does not answer, and it
 * is asked of the wasm module directly, so it has to live where the module
 * does.
 *
 * The dark theme is a filter over the whole drawn page, and a photograph
 * is part of a drawn page: a whiteboard came out black with white chalk on
 * it. These rectangles are what the viewer leaves alone.
 *
 * A scanned page is the hard case, because a scan is a picture too -- of a
 * page -- and leaving it alone means a dark theme does nothing at all for
 * a scanned book. What tells the two apart is the writing.
 *
 * Which writing, though, is the whole of the question. The rule this
 * replaced asked only whether the page carried a word set to be read, and
 * that is wrong on the commonest scan of all: a sheet run through OCR,
 * where the words are laid on the page and the picture of the sheet is
 * painted over the top of them. Some tools set those words to be drawn as
 * nothing; plenty do not, and leave them in plain black underneath the
 * scan, where no reader will ever see them. The old rule called every one
 * of those pages a typeset page and left the scan bright white in a dark
 * theme -- the very thing the exemption exists to avoid.
 *
 * So the question is not whether words are there. It is whether any of
 * them can be seen:
 *
 *   a page is a scan when pictures cover half of it or more, and what
 *   writing is left showing between and over them does not amount to a
 *   line of text.
 *
 * A word is hidden by a picture only if the picture was painted after it,
 * because that is what covering means in a page description -- words over
 * a photograph are a caption and count, words under one are OCR and do
 * not. Coverage is added up across every later picture, so an OCR line
 * running across the join between two strips of a scan is as hidden as
 * one sitting inside a single strip.
 *
 * Measured on his 528-page scan, on a 52-page handout and on OCR'd sheets:
 * the book has no text object anywhere, five to forty-nine image strips a
 * page, 82% to 139% of the sheet covered; the handout has one to two
 * thousand text objects a page and no images at all, and never reaches the
 * question. Nothing is counted: not the pictures, not the words.
 *
 * A rotated page is answered too. The bounds come back in PDF user space,
 * which a page with a /Rotate on it does not share with what is drawn --
 * that was the reason this used to give up and return nothing, leaving
 * every picture on a sideways page to be inverted with the paper. The
 * quarter turn is a quarter turn: the rectangle is carried through it
 * here (see `asShown`) instead of the page being abandoned.
 */
import type { PdfDocumentObject, PdfPageObject } from '@embedpdf/models';

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
export interface Innards {
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

export function imagesOnPage(native: unknown, doc: PdfDocumentObject, page: PdfPageObject): PageRect[] {
  if (!native) return [];
  const inner = native as Innards;
  const context = inner.cache.getContext(doc.id);
  if (!context) return [];
  const module = inner.pdfiumModule;
  // A page's own sheet, before the viewer turns it. `page.size` is the size
  // the page is *shown* at, so on a quarter turn it is the sheet the other
  // way round.
  const turn = (page.rotation ?? 0) & 3;
  const sideways = turn === 1 || turn === 3;
  const sheet = {
    width: sideways ? page.size.height : page.size.width,
    height: sideways ? page.size.width : page.size.height,
  };
  const held = context.acquirePage(page.index);
  const bounds = inner.memoryManager.malloc(FLOAT * 4);
  const found: PageRect[] = [];
  /** Where each picture came in the painting order, so a word can ask
   *  which of them went down on top of it. */
  const over: number[] = [];
  let scan = false;
  try {
    /**
     * A box in PDF user space, as it is drawn: measured from the top left
     * of the page the reader sees, after the page's own quarter turns.
     *
     * User space counts up from the foot of the unturned sheet, so even an
     * unturned page needs its y flipped. A turn is then one of four, and a
     * right angle takes a rectangle to a rectangle -- which is why this is
     * four lines of arithmetic and not a matrix. Checked by its corners:
     * the head of the sheet goes to the right-hand edge on a quarter turn
     * clockwise, to the foot on a half one, to the left-hand edge on three
     * quarters.
     */
    const asShown = (left: number, bottom: number, right: number, top: number): PageRect | null => {
      const width = right - left;
      const height = top - bottom;
      if (width <= 0 || height <= 0) return null;
      if (turn === 1) return { x: bottom, y: left, width: height, height: width };
      if (turn === 2) return { x: sheet.width - right, y: bottom, width, height };
      if (turn === 3) return { x: sheet.height - top, y: sheet.width - right, width: height, height: width };
      return { x: left, y: sheet.height - top, width, height };
    };
    /** A page object's box, where it is drawn on the page as shown. */
    const boxOf = (object: number): PageRect | null => {
      if (!module.FPDFPageObj_GetBounds(object, bounds, bounds + FLOAT, bounds + FLOAT * 2, bounds + FLOAT * 3)) return null;
      const at = (slot: number): number => module.pdfium.getValue(bounds + FLOAT * slot, 'float');
      return asShown(at(0), at(1), at(2), at(3));
    };
    const count = module.FPDFPage_CountObjects(held.pagePtr);
    // The first walk asks only for the pictures. Most pages of most
    // documents have none, and the walk is then a type check an object --
    // no boxes, no render modes, nothing asked of the text layer.
    for (let index = 0; index < count; index += 1) {
      const object = module.FPDFPage_GetObject(held.pagePtr, index);
      if (!object || module.FPDFPageObj_GetType(object) !== OBJECT_IMAGE) continue;
      const box = boxOf(object);
      if (!box) continue;
      found.push(box);
      over.push(index);
    }
    if (!found.length) return found;
    const paper = Math.max(1, sheet.width * sheet.height);
    const covered = found.reduce((sum, rect) => sum + rect.width * rect.height, 0) / paper;
    // Half a page of pictures or less leaves room for a page: it is a
    // document with photographs in it, and the words need not be read.
    if (covered < COVERED) return found;
    // And now, on the few pages that are covered in pictures, what shows
    // through them. The adding stops the moment there is a line's worth:
    // on a page of plain prose that is the second or third word.
    const enough = paper * WRITING;
    let showing = 0;
    for (let index = 0; index < count && showing < enough; index += 1) {
      const object = module.FPDFPage_GetObject(held.pagePtr, index);
      if (!object || module.FPDFPageObj_GetType(object) !== OBJECT_TEXT) continue;
      if (module.FPDFTextObj_GetTextRenderMode(object) === TEXT_INVISIBLE) continue;
      const box = boxOf(object);
      if (!box) continue;
      const area = box.width * box.height;
      let hidden = 0;
      for (let other = 0; other < found.length && hidden < area; other += 1) {
        if (over[other] < index) continue; // painted before these words: underneath them
        hidden += overlap(box, found[other]);
      }
      showing += Math.max(0, area - hidden);
    }
    scan = showing < enough;
  } catch { return []; } finally {
    inner.memoryManager.free(bounds);
    held.release();
  }
  return scan ? [] : found;
}

/** How much of the first rectangle the second one covers. */
function overlap(box: PageRect, other: PageRect): number {
  const width = Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x);
  const height = Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** This much of a page in pictures, and the page is a picture unless
 *  something is written across them. */
const COVERED = 0.5;
/** And this much of it in writing that shows -- about one line of text on
 *  a sheet of A4 -- is a page someone wrote, whatever is printed on it. A
 *  page number stamped in the corner of a scan is a twentieth of this. */
const WRITING = 0.005;
