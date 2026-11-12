// Frame opportunities while a finger is down. requestAnimationFrame runs
// before paint; a gap here can identify a stutter, but is not proof that a
// particular frame reached the display. Listen to touch rather than pointer:
// the browser can cancel a pointer as soon as it takes over scrolling.
import * as log from './log';

const MAX_GESTURES = 80;

export function watchGestureFrames(): void {
  let frame = 0;
  let last = 0;
  let longest = 0;
  let samples = 0;
  let started = 0;
  let moving = false;
  let active = false;
  let said = 0;
  const tick = (at: number): void => {
    if (!active) return;
    if (last) { longest = Math.max(longest, at - last); samples += 1; }
    last = at;
    frame = requestAnimationFrame(tick);
  };
  const finish = (cancelled: boolean): void => {
    if (!active) return;
    active = false;
    cancelAnimationFrame(frame);
    frame = 0;
    if (!cancelled && moving && samples && said < MAX_GESTURES) {
      said += 1;
      log.note('app', 'frames under a finger', {
        longestMs: Math.round(longest), intervals: samples,
        gestureMs: Math.round(performance.now() - started),
        ...(said === MAX_GESTURES ? { andNoMore: true } : {}),
      });
    }
  };
  document.addEventListener('touchstart', () => {
    if (active || said >= MAX_GESTURES || document.visibilityState !== 'visible') return;
    active = true; last = 0; longest = 0; samples = 0; moving = false;
    started = performance.now();
    frame = requestAnimationFrame(tick);
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', () => { if (active) moving = true; }, { passive: true, capture: true });
  document.addEventListener('touchend', (event) => { if (!event.touches.length) finish(false); }, { passive: true, capture: true });
  document.addEventListener('touchcancel', (event) => { if (!event.touches.length) finish(true); }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') finish(true); });
  window.addEventListener('pagehide', () => finish(true));
}
