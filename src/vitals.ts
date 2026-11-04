// What the app is holding, and what went wrong with it.
//
// The author's phone kept killing Satr and would not say why from inside:
// five exits in one log reading "low memory", one resident set of 990 MB,
// and two spells of not answering a touch for five seconds. The log had
// nothing to put beside any of that -- it could say how long a pdf took to
// open and nothing at all about what the app was carrying while it did.
//
// Two things live here. Memory, which is two numbers that can be had for
// almost nothing: the JavaScript heap, and the pixels behind every canvas on
// the page. The second is the one that matters for a reader of books -- a
// full-screen tile on a 390x844 phone at three times the pixels is eleven
// megabytes, and the reader of a long pdf has several -- and it is invisible
// to every JavaScript measurement, because canvas pixels are not on the JS
// heap. That is how an app with a 60 MB heap can be holding nearly a
// gigabyte.
//
// And trouble: an error nobody caught, a promise nobody handled, a
// console.error from a library. Those went nowhere before. A log that is
// silent about the moment something broke is a log of the wrong half.

import * as log from './log';
import type { Facts } from './log';

interface HeapInfo { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }

const mb = (bytes: number): number => Math.round(bytes / 100_000) / 10;

/** The pixels every canvas on the page is holding, four bytes each. A page
 *  of a pdf, the sharp tile over it and the soft one under it are all
 *  canvases, and none of them show up in any heap figure. */
export function canvasBytes(): { canvases: number; bytes: number } {
  let bytes = 0;
  const all = document.querySelectorAll('canvas');
  for (const canvas of all) bytes += (canvas as HTMLCanvasElement).width * (canvas as HTMLCanvasElement).height * 4;
  return { canvases: all.length, bytes };
}

/** What the app is carrying, as facts. `performance.memory` is Chromium's
 *  own and not a standard, which is fine: Chromium is what Android runs. A
 *  browser without it still gets the canvases, which is the half that
 *  matters anyway. */
export function memoryFacts(): Facts {
  const facts: Facts = {};
  const heap = (performance as unknown as { memory?: HeapInfo }).memory;
  if (heap) {
    facts.heapMb = mb(heap.usedJSHeapSize);
    facts.heapLimitMb = mb(heap.jsHeapSizeLimit);
  }
  const { canvases, bytes } = canvasBytes();
  facts.canvases = canvases;
  facts.pictureMb = mb(bytes);
  return facts;
}

/** One line about what is being held. `why` says what prompted it, so a
 *  reading of 900 MB can be told from a reading taken at the quiet moment
 *  before a launch. */
export function sayMemory(why: string): void {
  log.note('app', 'holding', { why, ...memoryFacts() });
}

let watching = false;

/** Everything that breaks without anybody asking. Installed once, early --
 *  an error during the launch is exactly the one worth having. */
export function watchForTrouble(): void {
  if (watching) return;
  watching = true;

  window.addEventListener('error', (event) => {
    // A failed <img>/<script> fires this too, with no message and a target
    // that is not the window: worth a line, but not the same line.
    if (event.error || event.message) {
      log.fail('app', 'an error nobody caught', {
        why: String(event.message || event.error),
        where: `${event.filename ?? '?'}:${event.lineno ?? 0}`,
      });
      return;
    }
    const target = event.target as { src?: string; href?: string; tagName?: string } | null;
    if (target?.tagName) log.warn('app', 'something would not load', { what: target.tagName.toLowerCase(), from: String(target.src ?? target.href ?? '?').slice(-80) });
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const why = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason);
    log.fail('app', 'a promise nobody handled', { why: why.slice(0, 200) });
  });

  // Libraries say things through console.error and nowhere else -- pdfium's
  // own complaints arrive that way. The original is still called, so nothing
  // is taken away from anyone watching with a cable.
  const was = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    try {
      log.warn('app', 'console.error', { said: args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ').slice(0, 200) });
    } catch { /* a log line is never worth breaking a console call */ }
    was(...args);
  };
}
