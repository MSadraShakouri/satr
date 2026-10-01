import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

// Double tap, then drag. The drag decides what it is from its first movement —
// sideways extends the selection by words, up or down is a scroll — but the
// decision can be revisited: a drag that starts sideways and then travels
// vertically is a reader who wants to scroll, and the note has to go with them
// ("double tap select can't scroll", "double tap to select and then drag logic
// is bad", "selection drag logic is terrible").
//
// Nothing is prevented while a drag is extending: a prevented touch is a touch
// the platform has given up on, and a scroll that was never started cannot be
// resumed half-way through the same gesture. The note is held still by pinning
// the scroller instead (touchState.pinScrollStill), so when the drag turns
// vertical the pin goes and the platform's own pan — which never stopped —
// carries the note.
const LINES = Array.from({ length: 80 }, (_, i) => `line ${i} of prose with several words in it`).join('\n');

async function mount(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (text) => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    document.documentElement.style.setProperty('--note-font-size', '16px');
    window.testEditor = new SatrEditor(host, () => {});
    window.testEditor.setValue(text);
    window.testEditor.setSelection(0);
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, LINES);
}

/** Where a finger lands on a character: the drag's own coordinates are what
 *  the gesture is made of, so the steps give them outright. */
async function point(page: Page, at: number): Promise<{ x: number; y: number }> {
  return page.evaluate((at) => {
    const rect = window.testEditor.view.coordsAtPos(at)!;
    return { x: rect.left + 2, y: (rect.top + rect.bottom) / 2 };
  }, at);
}

type Step = { action: 'down' | 'up' | 'move'; at: number; x: number; y: number };

/** A finger, one step at a time, reporting what the page did with each move:
 *  whether the touch was prevented, and the selection after it. */
async function finger(page: Page, steps: Step[]): Promise<{ prevented: boolean[]; head: number; anchor: number }> {
  return page.evaluate(async (steps) => {
    const view = window.testEditor.view;
    const prevented: boolean[] = [];
    for (const step of steps) {
      const touch = new Touch({ identifier: 1, target: view.contentDOM, clientX: step.x, clientY: step.y });
      const live = step.action !== 'up';
      const type = step.action === 'down' ? 'touchstart' : step.action === 'up' ? 'touchend' : 'touchmove';
      const event = new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: live ? [touch] : [], targetTouches: live ? [touch] : [], changedTouches: [touch],
      });
      view.contentDOM.dispatchEvent(event);
      if (type === 'touchmove') prevented.push(event.defaultPrevented);
      await new Promise((r) => requestAnimationFrame(r));
    }
    const main = view.state.selection.main;
    return { prevented, head: main.head, anchor: main.anchor };
  }, steps);
}

/** What the note does with a nudge of its own scroller (the browser panning,
 *  or a WebView's scroll nobody asked for): pinned, it comes straight back. */
async function nudgeScroller(page: Page, by = 120): Promise<{ moved: number; after: number }> {
  return page.evaluate(async (by) => {
    const scroller = window.testEditor.view.scrollDOM;
    const was = scroller.scrollTop;
    scroller.scrollTop = was + by;
    const moved = scroller.scrollTop;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { moved, after: scroller.scrollTop };
  }, by);
}

test('a sideways drag extends the selection and holds the note still, without preventing the touch', async ({ page }) => {
  await mount(page);
  await finger(page, [{ action: 'down', at: 6, ...(await point(page, 6)) }, { action: 'up', at: 6, ...(await point(page, 6)) }]);
  const start = await point(page, 6);
  const drag = await finger(page, [
    { action: 'down', at: 6, ...start },
    { action: 'move', at: 12, x: start.x + 40, y: start.y },
    { action: 'move', at: 20, x: start.x + 120, y: start.y },
  ]);
  // Nothing was prevented, and the selection grew to the word under the
  // finger — the two halves of "the drag is ours, the gesture is not".
  expect(drag.prevented).toEqual([false, false]);
  expect(drag.head - drag.anchor).toBeGreaterThan(10);
  // And the note the finger is dragging over does not move: any scroll that
  // nobody asked for is put back while the drag lasts.
  const nudge = await nudgeScroller(page, 120);
  expect(nudge.after).toBeLessThan(nudge.moved - 60);
  await finger(page, [{ action: 'up', at: 20, x: start.x + 120, y: start.y }]);
});

test('a drag that turns vertical hands the note back to the platform', async ({ page }) => {
  await mount(page);
  const start = await point(page, 6);
  await finger(page, [{ action: 'down', at: 6, ...start }, { action: 'up', at: 6, ...start }]);
  await finger(page, [
    { action: 'down', at: 6, ...start },
    { action: 'move', at: 12, x: start.x + 40, y: start.y }, // decided: an extend
    { action: 'move', at: 12, x: start.x + 30, y: start.y - 90 }, // ... and now a scroll
  ]);
  // The pin is gone with the decision, so the note stays where the platform
  // put it: this is the scroll that "double tap select can't scroll" could
  // never start.
  const nudge = await nudgeScroller(page, 120);
  expect(nudge.after).toBeGreaterThan(nudge.moved - 5);
  const after = await finger(page, [
    { action: 'move', at: 12, x: start.x + 20, y: start.y - 200 },
    { action: 'up', at: 12, x: start.x + 20, y: start.y - 200 },
  ]);
  expect(after.prevented).toEqual([false]);
});

test('a drag that was never sideways is a scroll from the start', async ({ page }) => {
  await mount(page);
  const start = await point(page, 6);
  await finger(page, [{ action: 'down', at: 6, ...start }, { action: 'up', at: 6, ...start }]);
  const drag = await finger(page, [
    { action: 'down', at: 6, ...start },
    { action: 'move', at: 6, x: start.x, y: start.y - 60 },
  ]);
  expect(drag.prevented).toEqual([false]);
  const nudge = await nudgeScroller(page, 120);
  expect(nudge.after).toBeGreaterThan(nudge.moved - 5);
  await finger(page, [{ action: 'up', at: 6, x: start.x, y: start.y - 60 }]);
});
