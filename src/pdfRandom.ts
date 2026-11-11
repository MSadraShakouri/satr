/** PDFium custom-file adapter. Runs only in the PDF worker. */
declare const FileReaderSync: { new(): { readAsArrayBuffer(blob: Blob): ArrayBuffer } };
import type { PdfDocumentObject, PdfPageObject, Rotation } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

interface Internals {
  pdfiumModule: WrappedPdfiumModule;
  memoryManager: { malloc(size: number): number; free(ptr: number): void };
  cache: { setDocument(id: string, filePtr: number, docPtr: number, normalizeRotation: boolean): void };
  readPageBoxes(doc: number, index: number, ptr: number): PdfPageObject['boxes'];
}

/** Synchronous because PDFium's FPDF_FILEACCESS callback is synchronous. */
export interface RandomPdfSource {
  size: number;
  read(position: number, length: number): Uint8Array;
}

export function blobPdfSource(blob: Blob): RandomPdfSource {
  const reader = new FileReaderSync();
  return { size: blob.size, read: (position, length) => new Uint8Array(reader.readAsArrayBuffer(blob.slice(position, position + length))) };
}

/** Worker XHR is synchronous because PDFium requests its bytes synchronously.
 * The app's native interceptor accepts bounded ranges, not HTTP Range headers. */
export function urlPdfSource(url: string, size: number): RandomPdfSource {
  return { size, read(position, length) {
    const result = new Uint8Array(length);
    for (let done = 0; done < length;) {
      const take = Math.min(1024 * 1024, length - done);
      const target = new URL(url);
      target.searchParams.set('offset', String(position + done));
      target.searchParams.set('length', String(take));
      const xhr = new XMLHttpRequest();
      xhr.open('GET', target.href, false);
      xhr.responseType = 'arraybuffer';
      xhr.send();
      if (xhr.status !== 200 || !(xhr.response instanceof ArrayBuffer) || xhr.response.byteLength !== take) throw new Error('PDF range read failed');
      result.set(new Uint8Array(xhr.response), done);
      done += take;
    }
    return result;
  } };
}

/** Registers the open document with the engine's usual page cache. The caller
 *  must call release after the engine closes it, never before. */
export function openRandomPdf(native: unknown, id: string, source: RandomPdfSource, onReadFailure?: () => void): { document: PdfDocumentObject; release(): void } {
  // PDFium's wasm ABI here uses a 32-bit unsigned long for m_FileLen.
  if (!Number.isSafeInteger(source.size) || source.size <= 0 || source.size > 0xffffffff) throw new Error('Unsupported PDF source size');
  const inner = native as Internals;
  const m = inner.pdfiumModule;
  const heap = m.pdfium;
  const mem = inner.memoryManager;
  let access = 0, fn = 0, document = 0, allocated = 0;
  let failedRead = false;
  try {
    fn = heap.addFunction((_parameter: number, position: number, output: number, length: number): number => {
      try {
        // Emscripten passes signed i32s; PDFium's offsets are unsigned.
        position >>>= 0; length >>>= 0; output >>>= 0;
        if (position + length > source.size) throw new Error('PDF read outside file');
        const bytes = source.read(position, length);
        if (bytes.byteLength !== length) throw new Error('Short PDF read');
        (heap as typeof heap & { HEAPU8: Uint8Array }).HEAPU8.set(bytes, output);
        return 1;
      } catch { if (!failedRead) onReadFailure?.(); failedRead = true; return 0; }
    }, 'iiiii');
    access = mem.malloc(12);
    heap.setValue(access, source.size, 'i32');
    heap.setValue(access + 4, fn, 'i32');
    heap.setValue(access + 8, 0, 'i32');
    document = m.FPDF_LoadCustomDocument(access, '');
    if (!document || failedRead) throw new Error(`PDFium could not open random source (${m.FPDF_GetLastError()})`);
    const pageCount = m.FPDF_GetPageCount(document);
    const pages: PdfPageObject[] = [];
    allocated = mem.malloc(24);
    for (let index = 0; index < pageCount; index++) {
      if (!m.FPDF_GetPageSizeByIndexF(document, index, allocated) || failedRead) throw new Error(`PDF page ${index + 1} could not be read`);
      pages.push({
        index,
        size: { width: heap.getValue(allocated, 'float'), height: heap.getValue(allocated + 4, 'float') },
        rotation: m.EPDF_GetPageRotationByIndex(document, index) as Rotation,
        objectNumber: m.EPDFDoc_GetPageObjectNumberByIndex(document, index),
        boxes: inner.readPageBoxes(document, index, allocated + 8),
      });
      if (failedRead) throw new Error(`PDF page ${index + 1} could not be read`);
    }
    mem.free(allocated); allocated = 0;
    const result: PdfDocumentObject = { id, pageCount, pages, isEncrypted: m.EPDF_IsEncrypted(document), isOwnerUnlocked: m.EPDF_IsOwnerUnlocked(document), permissions: m.FPDF_GetDocPermissions(document), normalizedRotation: false };
    if (failedRead) throw new Error('PDF security data could not be read');
    inner.cache.setDocument(id, access, document, false);
    // The engine cache owns and frees access on close; the callback must live
    // until after that close, and must not keep the Blob alive afterwards.
    return { document: result, release: () => heap.removeFunction(fn) };
  } catch (error) {
    if (allocated) mem.free(allocated);
    if (document) m.FPDF_CloseDocument(document);
    if (access) mem.free(access);
    if (fn) heap.removeFunction(fn);
    throw error;
  }
}
