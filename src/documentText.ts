/**
 * What a document says, for a search that covers every file.
 *
 * The search panel works on text: it runs the reader's words over a note
 * and shows the lines they fall in. A PDF has text too -- under the
 * picture, where the type was -- and a reader who keeps their lecture
 * notes and the lecturer's handout in the same folder means both when
 * they search the folder.
 *
 * Three things make this cheap enough to do at all:
 *
 * - The engine is on its own thread now (src/pdfiumWorker.ts), so reading
 *   four hundred pages costs the page that is being typed into nothing.
 * - A document is read once and kept. The reader types a letter at a
 *   time and the panel searches on every pause; reading the file again
 *   each time would be unforgivable.
 * - A document that has not been read yet is not waited for. It joins the
 *   search with no text, which is enough for its *name* to match, and the
 *   panel is told to search again when its text lands. Results come in as
 *   they are found rather than after the slowest file in the folder.
 *
 * A scan -- which most of his are -- has no text layer at all, and comes
 * back empty in a few hundred milliseconds. That is the right answer, not
 * a failure: there is nothing written in the file to find. Reading the
 * words off the picture is a different job (OCR) and is not this one.
 */
import { pdfium } from './pdfiumEngine';
import { inReadingOrder } from './pdfText';
import { backend, extension } from './vault';

/** Documents this can read. Only PDFs today; the app opens nothing else
 *  that has text in it. */
export const isDocument = (name: string): boolean => extension(name) === 'pdf';

/** What has been read, by path. A document is a file on disk and this is
 *  a session's worth of searching: a file that changes while the app is
 *  open is read again when the app is next started. */
interface Read {
  /** Every page's text, run together. */
  text: string;
  /** Where each page starts in it, so a hit can say which page it is on:
   *  a page's own text has newlines of its own, so counting lines would
   *  not do it. */
  starts: number[];
}
const held = new Map<string, Read>();
/** What is being read, so a search on every keystroke asks once. */
const reading = new Map<string, Promise<string>>();
/** Nothing is read until the panel asks for documents at all, and only
 *  one document is read at a time: ten files opened in the engine at once
 *  is ten copies of ten files in memory, and the queue is over in a
 *  second anyway. */
let queue: Promise<unknown> = Promise.resolve();

/** The text of a document already read, or null if it has not been. */
export const textHeld = (path: string): string | null => held.get(path)?.text ?? null;

/** Which page an offset into that text falls on, counting from one. */
export function pageAt(path: string, offset: number): number {
  const starts = held.get(path)?.starts;
  if (!starts?.length) return 1;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle; else high = middle - 1;
  }
  return low + 1;
}

/** Forget a document's text: it has been written over or removed. */
export const forgetText = (path: string): void => { held.delete(path); reading.delete(path); };

async function read(path: string): Promise<Read> {
  const bytes = await backend.readBytes(path);
  if (!bytes) return { text: '', starts: [] };
  const engine = await pdfium();
  const id = `satr-search-${path}`;
  const document_ = await engine.openDocumentBuffer({ id, content: bytes.slice().buffer }).toPromise();
  try {
    const pages: string[] = [];
    const starts: number[] = [];
    let at = 0;
    for (const page of document_.pages) {
      starts.push(at);
      // The same reading the find bar does (src/pdfView.ts): PDFium hands
      // back the characters in the order they were *painted*, which on a
      // Persian page written by Word puts every lam-alef back to front.
      // The glyph boxes say which pairs those are.
      const glyphs = await engine.getPageGlyphs(document_, page).toPromise();
      const [raw] = await engine.getTextSlices(document_,
        [{ pageIndex: page.index, charIndex: 0, charCount: glyphs.length }]).toPromise();
      const text = inReadingOrder(raw ?? '', glyphs);
      pages.push(text);
      at += text.length + 1; // the newline this page is joined on
    }
    return { text: pages.join('\n'), starts };
  } finally {
    await engine.closeDocument(document_).toPromise().catch(() => undefined);
  }
}

/**
 * A document's text, read if it has not been read yet. Never throws: a
 * file that cannot be read is a file with nothing in it, which is how the
 * search should treat it either way.
 */
export function textOf(path: string): Promise<string> {
  const already = held.get(path);
  if (already) return Promise.resolve(already.text);
  let asked = reading.get(path);
  if (!asked) {
    asked = queue
      .then(() => read(path))
      .catch((): Read => ({ text: '', starts: [] }))
      .then((found) => {
        held.set(path, found);
        reading.delete(path);
        return found.text;
      });
    queue = asked;
    reading.set(path, asked);
  }
  return asked;
}
