import { registerPlugin } from '@capacitor/core';

/** An ephemeral capability to an already-open file. Not a filesystem URL. */
export interface DevicePdfSource { kind: 'device-pdf'; token: string; url: string; size: number }
interface RangePlugin {
  openVault(options: { path: string }): Promise<Omit<DevicePdfSource, 'kind'>>;
  openIncoming(options: { id: string; operation: string }): Promise<Omit<DevicePdfSource, 'kind'>>;
  cancelOpen(options: { operation: string }): Promise<void>;
  close(options: { token: string }): Promise<void>;
}
const plugin = registerPlugin<RangePlugin>('SatrPdfRange');

async function checked(opened: Promise<Omit<DevicePdfSource, 'kind'>>): Promise<DevicePdfSource> {
  const result = await opened;
  try {
    const url = new URL(result.url);
    if (url.origin !== location.origin || url.pathname !== `/__satr_pdf_range/${result.token}` ||
        !/^[0-9a-f-]{36}$/.test(result.token) || !Number.isSafeInteger(result.size) || result.size <= 0 || result.size > 0xffffffff) throw new Error('Invalid PDF source');
    return { ...result, kind: 'device-pdf' };
  } catch (error) {
    if (result.token) void plugin.close({ token: result.token }).catch(() => undefined);
    throw error;
  }
}
export const openDevicePdf = (path: string): Promise<DevicePdfSource> => checked(plugin.openVault({ path }));
export async function openIncomingPdf(id: string, signal?: AbortSignal): Promise<DevicePdfSource> {
  if (signal?.aborted) throw new DOMException('PDF open cancelled', 'AbortError');
  const operation = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const cancel = () => { void plugin.cancelOpen({ operation }).catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try { return await checked(plugin.openIncoming({ id, operation })); }
  finally { signal?.removeEventListener('abort', cancel); }
}
export const closeDevicePdf = (source: DevicePdfSource): Promise<void> => plugin.close({ token: source.token }).catch(() => undefined);

export async function readDeviceRange(source: DevicePdfSource, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
  const url = new URL(source.url);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('length', String(length));
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('PDF source is unavailable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== length) throw new Error('Short PDF source read');
    return bytes;
  } finally { window.clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
export const readDeviceHead = (source: DevicePdfSource, signal?: AbortSignal): Promise<Uint8Array> => readDeviceRange(source, 0, Math.min(64 * 1024, source.size), signal);

/** Binary fallback if worker interception is unavailable. One bounded chunk at a time. */
export async function readDeviceAll(source: DevicePdfSource, signal?: AbortSignal): Promise<Uint8Array> {
  // An unbounded fallback would trade a failed range request for a process kill.
  if (source.size > 128 * 1024 * 1024) throw new Error('PDF is too large for the whole-file fallback');
  const result = new Uint8Array(source.size);
  for (let offset = 0; offset < source.size; offset += 1024 * 1024) {
    result.set(await readDeviceRange(source, offset, Math.min(1024 * 1024, source.size - offset), signal), offset);
  }
  return result;
}

let workerRanges: boolean | null = null;
/** Verify WebView actually intercepts worker XHR; terminate a stuck probe. */
export async function probeDeviceWorker(source: DevicePdfSource, head: Uint8Array, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) throw new DOMException('PDF open cancelled', 'AbortError');
  if (workerRanges !== null) return workerRanges;
  const length = Math.min(32, head.length);
  const worker = new Worker(new URL('./pdfProbeWorker.ts', import.meta.url), { type: 'module' });
  const ok = await new Promise<boolean>((resolve) => {
    const finish = (value: boolean) => { window.clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(value); };
    const abort = () => finish(false);
    const timer = window.setTimeout(() => finish(false), 1000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ ok?: boolean; bytes?: number[] }>) => {
      finish(Boolean(event.data.ok && event.data.bytes?.length === length && event.data.bytes.every((byte, i) => byte === head[i])));
    };
    worker.onerror = () => finish(false);
    worker.postMessage({ url: source.url, length });
  });
  worker.terminate();
  if (signal?.aborted) throw new DOMException('PDF open cancelled', 'AbortError');
  workerRanges = ok;
  return ok;
}
