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
 */
import { createPdfiumEngine } from '@embedpdf/engines/pdfium-direct-engine';
import type { PdfEngine } from '@embedpdf/engines';

let engine: Promise<PdfEngine<Blob>> | null = null;

/**
 * The wasm, from this app's own origin. Resolved against the document's base
 * rather than written as a bare path: the worker that fetches it resolves a
 * relative URL against itself, which is the mistake that leaves a reader
 * with no decoders and no explanation (the same one Gander documents).
 */
const wasmUrl = (): string => new URL('pdfium/pdfium.wasm', document.baseURI).href;

export function pdfium(): Promise<PdfEngine<Blob>> {
  engine ??= createPdfiumEngine(wasmUrl());
  return engine;
}
