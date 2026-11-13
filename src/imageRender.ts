import type { ImageGeometry } from './imageGeometry';

/** A region of the final result, in full-resolution output pixels. */
export interface ImageRegion { x: number; y: number; width: number; height: number }
export interface ImageRenderOptions {
  region?: ImageRegion;
  /** A smaller output, for a fit preview only. Insertion omits this. */
  size?: { width: number; height: number };
  signal?: AbortSignal;
  /** For environments without workers, and for testing the fallback. */
  useWorker?: boolean;
}
interface MapData {
  sw: number; sh: number; ow: number; oh: number; rx: number; ry: number; w: number; h: number;
  pageWidth: number; pageHeight: number; xmin: number; ymin: number;
  g: number; k: number; a: number; b: number; c: number; d: number; e: number; f: number;
}
function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}
function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  if (c.width !== width || c.height !== height || !c.getContext('2d')) throw new Error('Could not allocate image');
  return c;
}
function oriented(ctx: CanvasRenderingContext2D, image: CanvasImageSource, geo: ImageGeometry, x: number, y: number): void {
  ctx.translate(-x, -y);
  if (geo.turn === 1) { ctx.translate(geo.sourceWidth, 0); ctx.rotate(Math.PI / 2); }
  else if (geo.turn === 2) { ctx.translate(geo.sourceWidth, geo.sourceHeight); ctx.rotate(Math.PI); }
  else if (geo.turn === 3) { ctx.translate(0, geo.sourceHeight); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(image, 0, 0);
}

/** One row. Alpha-weighted interpolation avoids dark halos around transparent
 * pixels. Kept self-contained so exactly this code can run in a worker. */
function mapRows(pixels: Uint8ClampedArray, out: Uint8ClampedArray, m: MapData, first: number, last: number): void {
  const { sw, sh, ow, oh, rx, ry, w, h, pageWidth, pageHeight, xmin, ymin, g, k, a, b, c, d, e, f } = m;
  for (let yy = first; yy < last; yy += 1) {
    for (let xx = 0; xx < ow; xx += 1) {
      const X = rx + xx * (w - 1) / Math.max(1, ow - 1), Y = ry + yy * (h - 1) / Math.max(1, oh - 1);
      const u = X / Math.max(1, pageWidth - 1), v = Y / Math.max(1, pageHeight - 1), z = g * u + k * v + 1;
      const x = Math.max(0, Math.min(sw - 1, (a * u + b * v + c) / z - xmin));
      const y = Math.max(0, Math.min(sh - 1, (d * u + e * v + f) / z - ymin));
      const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const tx = x - x0, ty = y - y0, i0 = (y0 * sw + x0) * 4, i1 = (y0 * sw + x1) * 4;
      const i2 = (y1 * sw + x0) * 4, i3 = (y1 * sw + x1) * 4;
      const wa = (1 - tx) * (1 - ty) * pixels[i0 + 3], wb = tx * (1 - ty) * pixels[i1 + 3];
      const wc = (1 - tx) * ty * pixels[i2 + 3], wd = tx * ty * pixels[i3 + 3], alpha = wa + wb + wc + wd;
      const dest = (yy * ow + xx) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        out[dest + channel] = alpha ? (wa * pixels[i0 + channel] + wb * pixels[i1 + channel] + wc * pixels[i2 + channel] + wd * pixels[i3 + channel]) / alpha : 0;
      }
      out[dest + 3] = alpha;
    }
  }
}

async function renderPixels(pixels: Uint8ClampedArray, map: MapData, signal?: AbortSignal, useWorker = true): Promise<Uint8ClampedArray> {
  abortIfNeeded(signal);
  // Transfer ownership, rather than copying a potentially large pixel buffer.
  // If the worker can't start, its input is re-read by the caller.
  if (useWorker && typeof Worker !== 'undefined' && map.ow * map.oh >= 200_000) {
    const script = `const mapRows=${mapRows.toString()};onmessage=e=>{const {pixels,map}=e.data;const out=new Uint8ClampedArray(map.ow*map.oh*4);mapRows(new Uint8ClampedArray(pixels),out,map,0,map.oh);postMessage(out.buffer,[out.buffer])}`;
    const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    try {
      return await new Promise<Uint8ClampedArray>((resolve, reject) => {
        let worker: Worker;
        try { worker = new Worker(url); } catch (error) { reject(error); return; }
        let done = false;
        const finish = (error?: unknown, result?: Uint8ClampedArray): void => {
          if (done) return;
          done = true; worker.terminate(); signal?.removeEventListener('abort', onAbort);
          if (error) reject(error); else resolve(result!);
        };
        const onAbort = (): void => finish(new DOMException('Cancelled', 'AbortError'));
        signal?.addEventListener('abort', onAbort, { once: true });
        worker.onmessage = (event: MessageEvent<ArrayBuffer>) => finish(undefined, new Uint8ClampedArray(event.data));
        worker.onerror = () => finish(new Error('Image worker unavailable'));
        try { worker.postMessage({ pixels: pixels.buffer, map }, [pixels.buffer]); } catch (error) { finish(error); }
        if (signal?.aborted) onAbort();
      });
    } finally { URL.revokeObjectURL(url); }
  }
  const out = new Uint8ClampedArray(map.ow * map.oh * 4);
  for (let row = 0; row < map.oh; row += 48) {
    abortIfNeeded(signal);
    mapRows(pixels, out, map, row, Math.min(row + 48, map.oh));
    if (row + 48 < map.oh) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  abortIfNeeded(signal);
  return out;
}

/** Render directly from the source. With no size or region, the result has
 * exactly the selected natural output dimensions. Never encodes an image. */
export async function renderImageSelection(image: CanvasImageSource, geo: ImageGeometry, options: ImageRenderOptions = {}): Promise<HTMLCanvasElement> {
  abortIfNeeded(options.signal);
  const region = options.region ?? { x: 0, y: 0, width: geo.width, height: geo.height };
  const { x, y, width, height } = region;
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1 || x + width > geo.width || y + height > geo.height) throw new Error('Invalid image region');
  const size = options.size ?? { width, height };
  if (![size.width, size.height].every(Number.isInteger) || size.width < 1 || size.height < 1) throw new Error('Invalid preview size');
  const output = canvas(size.width, size.height), ctx = output.getContext('2d')!;
  const rx = geo.offsetX + x, ry = geo.offsetY + y;
  if (geo.kind === 'crop') {
    ctx.imageSmoothingQuality = 'high'; ctx.scale(size.width / width, size.height / height);
    oriented(ctx, image, geo, rx, ry); abortIfNeeded(options.signal); return output;
  }
  const [p0, p1, p2, p3] = geo.quad.map(([px, py]) => [px * (geo.sourceWidth - 1), py * (geo.sourceHeight - 1)] as const);
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dx3 = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], dy3 = p0[1] - p1[1] + p2[1] - p3[1], den = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(den) < 1e-8 ? 0 : (dx3 * dy2 - dx2 * dy3) / den;
  const k = Math.abs(den) < 1e-8 ? 0 : (dx1 * dy3 - dx3 * dy1) / den;
  const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + k * p3[0], c = p0[0];
  const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + k * p3[1], f = p0[1];
  const mapPoint = (px: number, py: number): [number, number] => {
    const u = px / Math.max(1, geo.pageWidth - 1), v = py / Math.max(1, geo.pageHeight - 1), z = g * u + k * v + 1;
    return [(a * u + b * v + c) / z, (d * u + e * v + f) / z];
  };
  const corners = [mapPoint(rx, ry), mapPoint(rx + width - 1, ry), mapPoint(rx + width - 1, ry + height - 1), mapPoint(rx, ry + height - 1)];
  const xmin = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0]))) - 1), ymin = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]))) - 1);
  const xmax = Math.min(geo.sourceWidth - 1, Math.ceil(Math.max(...corners.map((p) => p[0]))) + 1), ymax = Math.min(geo.sourceHeight - 1, Math.ceil(Math.max(...corners.map((p) => p[1]))) + 1);
  const sw = xmax - xmin + 1, sh = ymax - ymin + 1, source = canvas(sw, sh), sourceCtx = source.getContext('2d', { willReadFrequently: true })!;
  oriented(sourceCtx, image, geo, xmin, ymin); abortIfNeeded(options.signal);
  const map: MapData = { sw, sh, ow: size.width, oh: size.height, rx, ry, w: width, h: height, pageWidth: geo.pageWidth, pageHeight: geo.pageHeight, xmin, ymin, g, k, a, b, c, d, e, f };
  const readPixels = (): Uint8ClampedArray => sourceCtx.getImageData(0, 0, sw, sh).data;
  let result: Uint8ClampedArray;
  try { result = await renderPixels(readPixels(), map, options.signal, options.useWorker); }
  catch (error) {
    abortIfNeeded(options.signal);
    // A disabled worker or a restrictive CSP is not a reason to lose the crop.
    result = await renderPixels(readPixels(), map, options.signal, false);
  }
  abortIfNeeded(options.signal);
  const data = ctx.createImageData(size.width, size.height); data.data.set(result); ctx.putImageData(data, 0, 0);
  return output;
}
