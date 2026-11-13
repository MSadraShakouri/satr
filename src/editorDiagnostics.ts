// Input diagnostics deliberately never read event.data, keys, text, paths or
// exact selection positions. A frame callback is an opportunity before paint,
// not a measurement of the screen or of keyboard-to-character latency.
import * as log from './log';

const LIMIT = 20;
const SLOW_FRAME_MS = 120;
const RECENT_INPUT_MS = 1000;

export function watchEditorDiagnostics(root: HTMLElement) {
  let composing = false;
  let lastInput = -Infinity;
  let lastNavigation = -Infinity;
  let recentHeads: number[] = [];
  let oscillations = 0;
  let previousHead: number | null = null;
  let inputFrame = 0;
  let slowFrames = 0;
  let selections = 0;
  let corrections = 0;
  root.addEventListener('keydown', (event) => {
    // Only these navigation controls affect the detector; no key is logged.
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Backspace') lastNavigation = performance.now();
  }, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' && inputFrame) { cancelAnimationFrame(inputFrame); inputFrame = 0; }
  });
  root.addEventListener('compositionstart', () => { composing = true; }, { capture: true });
  root.addEventListener('compositionend', () => { composing = false; }, { capture: true });
  root.addEventListener('beforeinput', (event) => {
    lastInput = performance.now();
    if (inputFrame || slowFrames >= LIMIT || document.visibilityState !== 'visible') return;
    const started = lastInput;
    const inComposition = composing || (event as InputEvent).isComposing;
    inputFrame = requestAnimationFrame(() => {
      inputFrame = 0;
      if (document.visibilityState !== 'visible') return;
      const delay = performance.now() - started;
      if (delay < SLOW_FRAME_MS) return;
      slowFrames += 1;
      log.note('app', 'input frame delayed', { delayMs: Math.round(delay), composing: inComposition,
        ...(slowFrames === LIMIT ? { andNoMore: true } : {}) });
    });
  }, { capture: true, passive: true });
  return {
    selection(head: number, collapsed: boolean, inComposition: boolean): void {
      const old = previousHead; previousHead = head;
      const now = performance.now();
      if (now - Math.max(lastInput, lastNavigation) <= RECENT_INPUT_MS && collapsed) {
        recentHeads.push(head);
        if (recentHeads.length > 4) recentHeads.shift();
        if (recentHeads.length === 4 && recentHeads[0] === recentHeads[2]
          && recentHeads[1] === recentHeads[3] && recentHeads[0] !== recentHeads[1] && oscillations < LIMIT) {
          oscillations += 1;
          log.note('app', 'selection oscillation', { composing: composing || inComposition,
            ...(oscillations === LIMIT ? { andNoMore: true } : {}) });
          recentHeads = [];
        }
      } else recentHeads = [];
      if (old === null || Math.abs(head - old) < 100 || now - lastInput > RECENT_INPUT_MS || selections >= LIMIT) return;
      selections += 1;
      // A paste or an intentional selection can do this too: it is a clue,
      // not a claim of a bug. No offsets or exact distance leave this function.
      log.note('app', 'large selection after input', { composing: composing || inComposition, collapsed,
        ...(selections === LIMIT ? { andNoMore: true } : {}) });
    },
    correction(inComposition: boolean): void {
      if (corrections >= LIMIT) return;
      corrections += 1;
      log.note('app', 'editor restore correction', { composing: composing || inComposition,
        recentInput: performance.now() - lastInput <= RECENT_INPUT_MS,
        ...(corrections === LIMIT ? { andNoMore: true } : {}) });
    },
  };
}
