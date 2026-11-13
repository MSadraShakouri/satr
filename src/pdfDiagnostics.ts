import * as log from './log';

/** Worker round trips include waiting and transfer, not engine CPU or paint.
 *  Bound the rare slow lines per opened document; never include its name. */
export function slowPdfRenders() {
  let said = 0;
  return (roundTripMs: number, pixels: number, kind: 'base' | 'detail'): void => {
    if (roundTripMs < 300 || said >= 20) return;
    said += 1;
    log.note('pdf', 'slow PDF render round trip', {
      roundTripMs: Math.round(roundTripMs), megapixels: Math.round(pixels / 100_000) / 10, kind,
      ...(said === 20 ? { andNoMore: true } : {}),
    });
  };
}
