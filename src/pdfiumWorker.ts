/**
 * PDFium, on a thread of its own.
 *
 * The engine draws a page, reads its text and searches it by running C++
 * compiled to WebAssembly, and until now it ran on the thread that answers
 * the finger. A page of his book is 26 to 35 milliseconds of that thread;
 * a tile at eight times is a tenth of a second; and a search over a
 * 528-page document is seconds of it. Nothing else can happen while any
 * of that is happening -- which is why typing into the find bar of a
 * document could stop dead between two letters and backspace could seem
 * not to work: the keystrokes were queued behind a search of the whole
 * book, and the keyboard's own idea of the word being composed had moved
 * on by the time they arrived.
 *
 * So the engine lives here instead, and the page talks to it by message.
 * The protocol is the engines package's own (`EngineRunner` on this side,
 * `WebWorkerEngine` on the other), with one method added that the package
 * does not have: `imagesOnPage`, which asks the wasm module directly where
 * the photographs on a page are (src/pdfiumImages.ts).
 *
 * The wasm URL is handed in rather than worked out here. A worker resolves
 * a relative URL against itself, which is the mistake that leaves a reader
 * with no decoders and no explanation.
 *
 * No font fallback: the package's own worker reaches out to a CDN for a
 * missing font, and this app asks the network for nothing.
 */
import { init } from '@embedpdf/pdfium';
import { EngineRunner, PdfEngine as PdfiumEngine, PdfiumNative } from '@embedpdf/engines';
import type { ImageDataConverter } from '@embedpdf/engines';
import type { PdfDocumentObject, PdfPageObject } from '@embedpdf/models';
import { imagesOnPage } from './pdfiumImages';
import { blobPdfSource, openRandomPdf, urlPdfSource } from './pdfRandom';

/** What the page sends to start us: everything the engine needs that only
 *  a document can know. */
interface Start { type: 'Start'; wasmUrl: string }

/** A request as the runner understands it, loosened so the one method the
 *  package has never heard of can travel the same road. */
interface Ask { id: string; type: 'ExecuteRequest'; data: { name: string; args: readonly unknown[] } }

/**
 * A picture as a file, for the one caller that ever wants one. The viewer
 * asks only for raw pixels, so this never runs in practice -- but the
 * engine will not be built without a converter, and a worker has an
 * OffscreenCanvas to do it with.
 */
const toBlob: ImageDataConverter<Blob> = async (getImageData, type = 'image/png', quality) => {
  const image = getImageData();
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context in the worker');
  context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas.convertToBlob({ type, quality });
};

const runner = new EngineRunner();
let native: PdfiumNative | null = null;
const randomDocuments = new Map<string, { release(): void; stats(): { reads: number; bytes: number } }>();
const closingRandom = new Map<string, string>();
const respond = runner.respond.bind(runner);
runner.respond = ((message: { id: string; type: string; data?: { type?: string } }) => {
  const documentId = closingRandom.get(message.id);
  if (documentId && message.type === 'ExecuteResponse') {
    closingRandom.delete(message.id);
    if (message.data?.type === 'result') {
      randomDocuments.get(documentId)?.release();
      randomDocuments.delete(documentId);
    }
  }
  respond(message as never);
}) as typeof runner.respond;

// The runner's own execute is an instance property, so this keeps hold of
// it and stands in front of it rather than replacing it.
const engineAnswers = runner.execute;
runner.execute = (async (request: Ask) => {
  if (request.data?.name === 'openRandomBlob' || request.data?.name === 'openRandomUrl') {
    try {
      if (!native) throw new Error('PDF engine is not ready');
      const [id, input] = request.data.args as [string, Blob | { url: string; size: number }];
      const source = input instanceof Blob ? blobPdfSource(input) : urlPdfSource(input.url, input.size);
      let reads = 0, bytes = 0;
      const read = source.read;
      source.read = (position, length) => { reads += 1; bytes += length; return read(position, length); };
      const opened = openRandomPdf(native, id, source, () => self.postMessage({ type: 'satr-pdf-read-failed', documentId: id }));
      randomDocuments.set(id, { release: opened.release, stats: () => ({ reads, bytes }) });
      runner.respond({ id: request.id, type: 'ExecuteResponse', data: { type: 'result', value: { document: opened.document, reads, bytes } } as never });
    } catch (error) {
      runner.respond({ id: request.id, type: 'ExecuteResponse', data: { type: 'error', value: { type: 'reject', reason: { message: String(error) } } } as never });
    }
    return;
  }
  if (request.data?.name === 'randomPdfStats') {
    const [id] = request.data.args as [string];
    runner.respond({ id: request.id, type: 'ExecuteResponse', data: { type: 'result', value: randomDocuments.get(id)?.stats() ?? null } as never });
    return;
  }
  if (request.data?.name === 'closeDocument') {
    const doc = request.data.args[0] as PdfDocumentObject;
    if (randomDocuments.has(doc.id)) closingRandom.set(request.id, doc.id);
  }
  if (request.data?.name === 'imagesOnPage') {
    const [document_, page] = request.data.args as [PdfDocumentObject, PdfPageObject];
    let value: unknown = [];
    try { value = imagesOnPage(native, document_, page); } catch { value = []; }
    runner.respond({ id: request.id, type: 'ExecuteResponse', data: { type: 'result', value } as never });
    return;
  }
  await engineAnswers(request as never);
}) as unknown as typeof runner.execute;

self.onmessage = async (event: MessageEvent<Start>): Promise<void> => {
  if (event.data?.type !== 'Start' || native) return;
  const wasmBinary = await (await fetch(event.data.wasmUrl)).arrayBuffer();
  native = new PdfiumNative(await init({ wasmBinary }));
  runner.engine = new PdfiumEngine(native, { imageConverter: toBlob }) as never;
  // ready() takes the message channel over for the runner, which is what
  // the other side has been waiting for since the worker was made.
  runner.ready();
};
