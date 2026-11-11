/**
 * PDFium — the engine Chrome draws PDFs with, and the one behind Google
 * Drive's reader — compiled to WebAssembly, and running on a thread that
 * is not this one.
 *
 * pdf.js is a PDF renderer written in JavaScript, and that was the first
 * ceiling: a page is parsed and painted by script, so a fling through a
 * long document shows grey rectangles and a pinch goes soft until the
 * redraw lands. This is the same C++ engine the browser itself uses, and
 * it can draw a rectangle of a page rather than the whole of it, which is
 * what makes a sharp zoom cheap.
 *
 * The second ceiling was the thread. Fast as it is, the engine ran where
 * the finger is answered, and a page of his book is 26 to 35 milliseconds
 * of it, a sharp tile a tenth of a second, a search of the whole book
 * seconds of it. It is in a worker now (src/pdfiumWorker.ts): this file
 * is the near end of a message channel, and everything it returns is a
 * promise over a thread that cannot block the page.
 *
 * One engine for the app, made the first time a document is opened and
 * kept afterwards: the wasm is 4.5 MB and compiling it twice would be
 * felt.
 */
import { WebWorkerEngine } from '@embedpdf/engines';
import type { PdfDocumentObject, PdfPageObject } from '@embedpdf/models';
import type { PageRect } from './pdfiumImages';

export type { PageRect } from './pdfiumImages';

let engine: Promise<WebWorkerEngine> | null = null;
let link: Worker | null = null;

/**
 * The wasm, from this app's own origin. Resolved against the document's
 * base here, on the thread that has one, and handed to the worker: a
 * worker resolves a relative URL against itself, which is the mistake that
 * leaves a reader with no decoders and no explanation (the same one Gander
 * documents).
 */
const wasmUrl = (): string => new URL('pdfium/pdfium.wasm', document.baseURI).href;

export function pdfium(): Promise<WebWorkerEngine> {
  engine ??= (async () => {
    const worker = new Worker(new URL('./pdfiumWorker.ts', import.meta.url), { type: 'module' });
    link = worker;
    // Told what to fetch before anything is asked of it; the engine's own
    // side of the channel is listening from the moment it is made, and
    // waits for the worker's ready message by itself.
    worker.postMessage({ type: 'Start', wasmUrl: wasmUrl() });
    const made = new WebWorkerEngine(worker);
    await made.readyTask.toPromise();
    return made;
  })();
  return engine;
}

/**
 * Where the photographs on a page are, in the page's own units — the one
 * question the package's protocol has never heard of, asked over the same
 * channel because the answer comes out of the same wasm module. The walk
 * itself, and why it is written the way it is, is in src/pdfiumImages.ts.
 *
 * Answered with nothing if the engine is not up yet: a page with no
 * pictures is the common case and the right thing to assume, and the
 * caller asks again when the engine lands.
 */
let asked = 0;
export function imagesOnPage(doc: PdfDocumentObject, page: PdfPageObject): Promise<PageRect[]> {
  const worker = link;
  if (!worker) return Promise.resolve([]);
  const id = `satr-images-${asked += 1}`;
  return new Promise<PageRect[]>((resolve) => {
    const hear = (event: MessageEvent<{ id: string; type: string; data?: { type: string; value?: unknown } }>): void => {
      if (event.data?.id !== id || event.data.type !== 'ExecuteResponse') return;
      worker.removeEventListener('message', hear);
      const answer = event.data.data;
      resolve(answer?.type === 'result' && Array.isArray(answer.value) ? answer.value as PageRect[] : []);
    };
    worker.addEventListener('message', hear);
    worker.postMessage({ id, type: 'ExecuteRequest', data: { name: 'imagesOnPage', args: [doc, page] } });
  });
}

/** Open an immutable Blob without first materializing it as a whole buffer. */
export async function openPdfBlob(id: string, blob: Blob): Promise<{ document: PdfDocumentObject; reads: number; bytes: number }> {
  await pdfium();
  const worker = link;
  if (!worker) throw new Error('PDF engine unavailable');
  const requestId = `satr-blob-${asked += 1}`;
  return new Promise((resolve, reject) => {
    const hear = (event: MessageEvent<{ id: string; type: string; data?: { type: string; value?: unknown } }>): void => {
      if (event.data?.id !== requestId || event.data.type !== 'ExecuteResponse') return;
      worker.removeEventListener('message', hear);
      const answer = event.data.data;
      if (answer?.type === 'result') resolve(answer.value as { document: PdfDocumentObject; reads: number; bytes: number });
      else reject(new Error('Could not open PDF by random access'));
    };
    worker.addEventListener('message', hear);
    worker.postMessage({ id: requestId, type: 'ExecuteRequest', data: { name: 'openRandomBlob', args: [id, blob] } });
  });
}

/** Open a bounded native capability through the worker's synchronous adapter. */
export async function openPdfUrlSource(id: string, source: { url: string; size: number }): Promise<{ document: PdfDocumentObject; reads: number; bytes: number }> {
  await pdfium();
  const worker = link;
  if (!worker) throw new Error('PDF engine unavailable');
  const requestId = `satr-url-${asked += 1}`;
  return new Promise((resolve, reject) => {
    const hear = (event: MessageEvent<{ id: string; type: string; data?: { type: string; value?: unknown } }>): void => {
      if (event.data?.id !== requestId || event.data.type !== 'ExecuteResponse') return;
      worker.removeEventListener('message', hear);
      if (event.data.data?.type === 'result') resolve(event.data.data.value as { document: PdfDocumentObject; reads: number; bytes: number });
      else reject(new Error('Could not open PDF by random access'));
    };
    worker.addEventListener('message', hear);
    worker.postMessage({ id: requestId, type: 'ExecuteRequest', data: { name: 'openRandomUrl', args: [id, source] } });
  });
}

/** Report a read failure after a successful custom open; a partial page is not success. */
export function onPdfReadFailure(id: string, callback: () => void): () => void {
  const worker = link;
  if (!worker) return () => undefined;
  const hear = (event: MessageEvent<{ type?: string; documentId?: string }>): void => {
    if (event.data?.type === 'satr-pdf-read-failed' && event.data.documentId === id) callback();
  };
  worker.addEventListener('message', hear);
  return () => worker.removeEventListener('message', hear);
}

/** Cumulative input reads as seen by PDFium, not the page bitmap size. */
export function randomPdfStats(document: PdfDocumentObject): Promise<{ reads: number; bytes: number } | null> {
  const worker = link;
  if (!worker) return Promise.resolve(null);
  const requestId = `satr-stats-${asked += 1}`;
  return new Promise((resolve) => {
    const hear = (event: MessageEvent<{ id: string; type: string; data?: { type: string; value?: unknown } }>): void => {
      if (event.data?.id !== requestId || event.data.type !== 'ExecuteResponse') return;
      worker.removeEventListener('message', hear);
      resolve(event.data.data?.type === 'result' ? event.data.data.value as { reads: number; bytes: number } | null : null);
    };
    worker.addEventListener('message', hear);
    worker.postMessage({ id: requestId, type: 'ExecuteRequest', data: { name: 'randomPdfStats', args: [document.id] } });
  });
}
