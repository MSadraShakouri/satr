/** Geometry for an image selection. Coordinates are fractions of the oriented
 * source, ordered top-left, top-right, bottom-right, bottom-left. The renderer
 * works from the original pixels; the smaller editing picture is never input. */
export type ImagePoint = readonly [number, number];
export type ImageQuad = readonly [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
export type ImageRect = readonly [number, number, number, number];
export type ImageTurn = 0 | 1 | 2 | 3;

export interface ImageGeometry {
  readonly kind: 'crop' | 'page';
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly width: number;
  readonly height: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly quad: ImageQuad;
  readonly turn: ImageTurn;
}

function finiteFraction(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
function dimensions(width: number, height: number, turn: ImageTurn): [number, number] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || ![0, 1, 2, 3].includes(turn)) {
    throw new Error('Invalid source image dimensions or rotation');
  }
  return turn % 2 ? [height, width] : [width, height];
}
function rectPixels(rect: ImageRect, width: number, height: number): [number, number, number, number] {
  const [left, top, right, bottom] = rect;
  if (!rect.every(finiteFraction) || left >= right || top >= bottom) throw new Error('Invalid crop');
  const x = Math.min(width - 1, Math.round(left * width));
  const y = Math.min(height - 1, Math.round(top * height));
  const r = Math.min(width, Math.max(x + 1, Math.round(right * width)));
  const b = Math.min(height, Math.max(y + 1, Math.round(bottom * height)));
  return [x, y, r - x, b - y];
}
function distance(a: ImagePoint, b: ImagePoint, width: number, height: number): number {
  return Math.hypot((a[0] - b[0]) * width, (a[1] - b[1]) * height);
}
function validQuad(quad: ImageQuad): boolean {
  if (quad.length !== 4 || !quad.every((p) => p.length === 2 && p.every(finiteFraction))) return false;
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i], b = quad[(i + 1) % 4], c = quad[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-10) return false;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return sign > 0;
}

/** Integer crop boundaries are calculated once, before rendering or encoding. */
export function cropGeometry(width: number, height: number, turn: ImageTurn, rect: ImageRect): ImageGeometry {
  const [sourceWidth, sourceHeight] = dimensions(width, height, turn);
  const [offsetX, offsetY, outputWidth, outputHeight] = rectPixels(rect, sourceWidth, sourceHeight);
  return {
    kind: 'crop', sourceWidth, sourceHeight, width: outputWidth, height: outputHeight,
    pageWidth: sourceWidth, pageHeight: sourceHeight, offsetX, offsetY, turn,
    quad: [[0, 0], [1, 0], [1, 1], [0, 1]],
  };
}

/** Page + Crop is an offset inside the natural-size perspective result. It
 * does not require creating or encoding a full straightened intermediate. */
export function pageGeometry(width: number, height: number, turn: ImageTurn, quad: ImageQuad, crop?: ImageRect): ImageGeometry {
  const [sourceWidth, sourceHeight] = dimensions(width, height, turn);
  if (!validQuad(quad)) throw new Error('Invalid page corners');
  const pageWidth = Math.max(1, Math.round(Math.max(distance(quad[0], quad[1], sourceWidth, sourceHeight), distance(quad[3], quad[2], sourceWidth, sourceHeight))));
  const pageHeight = Math.max(1, Math.round(Math.max(distance(quad[0], quad[3], sourceWidth, sourceHeight), distance(quad[1], quad[2], sourceWidth, sourceHeight))));
  const [offsetX, offsetY, outputWidth, outputHeight] = rectPixels(crop ?? [0, 0, 1, 1], pageWidth, pageHeight);
  const stableQuad = quad.map(([x, y]) => [x, y] as const) as unknown as ImageQuad;
  return { kind: 'page', sourceWidth, sourceHeight, width: outputWidth, height: outputHeight, pageWidth, pageHeight, offsetX, offsetY, quad: stableQuad, turn };
}
