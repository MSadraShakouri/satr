// How wide a list marker is, in the font the note is read in.
//
// A marker is drawn from its own end — every `۱.` and `الف.` in a list ends
// on the same line, a hair before the text — so the room a list needs is the
// widest marker in it. The reading view widens its strip to this
// (src/markdown.ts, src/style.css) and so does source mode (src/editor.ts),
// from this one measurement: the two views cannot disagree about where a
// lettered list's text begins.
//
// The canvas answers with the same advance the browser lays the marker out
// with. A note measured before the webfont has arrived is measured in the
// fallback, so src/main.ts measures again when the font loads.

/** Measured at a round size and reported in em, so the answer holds at any
 *  note font size. */
const MEASURE_PX = 1000;

let paint: CanvasRenderingContext2D | null | undefined;

/** The widest of these markers, in em of the note's font. 0 when there is
 *  nothing to measure, or no canvas to measure with. */
export function widestMarkerEm(markers: readonly string[], face: string): number {
  const host = globalThis.document as Document | undefined;
  if (!host || !markers.length) return 0;
  if (paint === undefined) paint = host.createElement('canvas').getContext('2d');
  if (!paint) return 0;
  paint.font = `${MEASURE_PX}px ${face || 'sans-serif'}`;
  let widest = 0;
  for (const marker of markers) widest = Math.max(widest, paint.measureText(marker).width / MEASURE_PX);
  return widest;
}

/** The strip that holds these markers, as the reading view's CSS writes it:
 *  the platform's 3ch, or the widest marker plus the hair of space before
 *  the text, whichever is more. */
export function markerStrip(markers: readonly string[], face: string): string | null {
  const widest = widestMarkerEm(markers, face);
  return widest > 0 ? `max(3ch, calc(${widest.toFixed(3)}em + 0.4em))` : null;
}
