import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

// The note's selection belongs to the platform, exactly as Obsidian's does.
//
// Obsidian's editor has no touch handling of its own (its 1.13.8 bundle: the
// only long-press helper belongs to the file list, and the editor's touch
// surface is CodeMirror's own plus the WebView's), and its viewport forbids
// zoom — `width=device-width, initial-scale=1.0, maximum-scale=1.0,
// user-scalable=no` — which is what leaves the engine's double tap, drag,
// handles, long press and action mode as the only actors. Satr used to bring
// its own word finder, its own drag and its own bar on top of that; this file
// pins the replacement: **nothing about a touch is the app's**.
//
// What a synthetic touch can prove here is exactly that: nothing is prevented,
// nothing is selected by the app, and the page's viewport leaves no room for
// the double-tap zoom that made the same gesture ambiguous.
const NOTE = 'the quick brown fox jumps over the lazy dog\nسلام دنیا زیباست و این خط فارسی است\nsecond line with several words in it';

type Step = { action: 'down' | 'up' | 'move'; at: number; wait?: number; on?: string; dx?: number; dy?: number };

async function mount(page: Page, text = NOTE): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (text) => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {});
    window.testEditor.setValue(text);
    window.testEditor.setSelection(4, 9); // a word, as a tap would leave it
    window.testEditor.focus();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, text);
  await page.evaluate(() => document.fonts.ready);
}

/** Play a finger on the note and report, for every step, whether the page
 *  refused it — and what the editor's selection was before, during and after.
 *  The app must not answer any of these: the platform does. */
async function gesture(page: Page, steps: Step[]) {
  return page.evaluate(async (steps) => {
    const view = window.testEditor.view;
    const prevented: boolean[] = [];
    const before = { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head };
    for (const step of steps) {
      if (step.wait) await new Promise((r) => window.setTimeout(r, step.wait));
      const rect = view.coordsAtPos(step.at);
      if (!rect) throw new Error(`position ${step.at} is not on screen`);
      const x = rect.left + 1 + (step.dx ?? 0);
      const y = (rect.top + rect.bottom) / 2 + (step.dy ?? 0);
      const target = step.on ? view.dom.querySelector(step.on)! : view.contentDOM;
      const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y });
      const live = step.action !== 'up';
      const type = step.action === 'down' ? 'touchstart' : step.action === 'up' ? 'touchend' : 'touchmove';
      const event = new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: live ? [touch] : [], targetTouches: live ? [touch] : [], changedTouches: [touch],
      });
      target.dispatchEvent(event);
      prevented.push(event.defaultPrevented);
    }
    await new Promise((r) => window.setTimeout(r, 250));
    const after = view.state.selection.main;
    return {
      prevented,
      before: { anchor: before.anchor, head: before.head },
      after: { anchor: after.anchor, head: after.head },
    };
  }, steps);
}

const tap = (at: number, on?: string): Step[] => [{ action: 'down', at, on }, { action: 'up', at, on }];

test('no touch is ever refused: the platform keeps every gesture it gets', async ({ page }) => {
  await mount(page);
  const doubleTap = await gesture(page, [...tap(6), ...tap(6)]);
  const dragAfterTap = await gesture(page, [
    ...tap(6), ...tap(6),
    { action: 'down', at: 6 }, { action: 'move', at: 20, dx: 120 }, { action: 'up', at: 20, dx: 120 },
  ]);
  const longPress = await gesture(page, [{ action: 'down', at: 6 }, { action: 'move', at: 6, wait: 400, dy: 1 }, { action: 'up', at: 6 }]);
  const verticalDrag = await gesture(page, [
    { action: 'down', at: 6 }, { action: 'move', at: 6, dy: -60 }, { action: 'up', at: 6, dy: -60 },
  ]);
  for (const report of [doubleTap, dragAfterTap, longPress, verticalDrag]) {
    expect(report.prevented.every((p) => p === false)).toBe(true);
  }
});

test('the app selects nothing itself: a touch leaves the selection exactly where it was', async ({ page }) => {
  await mount(page);
  const report = await gesture(page, [...tap(6), ...tap(6)]);
  // The word that stood before the gesture is the word that stands after it:
  // with no browser underneath a synthetic touch, a word found by the app
  // would be the only way this could have changed — and there is no such code
  // any more.
  expect(report.before).toEqual({ anchor: 4, head: 9 });
  expect(report.after).toEqual({ anchor: 4, head: 9 });
});

test('the viewport forbids the double-tap zoom, as Obsidian’s does', async ({ page }) => {
  await page.goto('/');
  const content = await page.evaluate(() => document.querySelector('meta[name="viewport"]')!.getAttribute('content')!);
  expect(content).toContain('user-scalable=no');
  expect(content).toContain('maximum-scale=1.0');
  // Obsidian 1.13.8's own meta, for comparison:
  //   width=device-width, initial-scale=1.0, maximum-scale=1.0,
  //   user-scalable=no, viewport-fit=cover
  expect(content).toContain('width=device-width');
});

test('the note sets no touch-action of its own: the page gets out of the gesture’s way', async ({ page }) => {
  await mount(page);
  const action = await page.evaluate(() => getComputedStyle(window.testEditor.view.contentDOM).touchAction);
  expect(action).toBe('auto');
  // And the editor is selectable — the note is the platform's to select.
  const select = await page.evaluate(() => getComputedStyle(window.testEditor.view.contentDOM).userSelect);
  expect(select).toBe('text');
});

// CodeMirror hands text input to Chrome's EditContext API wherever the browser
// has it (every Android WebView from Chrome 121 on), and that path takes the
// caret away from the DOM selection: the keyboard never hears where a tap put
// it (no suggestion strip, no auto-correct), and the platform has no selection
// to raise its bar for. The contenteditable path is the one Obsidian uses too.
test('the editor asks the browser for its contenteditable input, not EditContext', async ({ page }) => {
  await mount(page);
  const kind = await page.evaluate(() => ({
    editContext: window.testEditor.view.contentDOM.editContext ?? null,
    contentEditable: window.testEditor.view.contentDOM.contentEditable,
  }));
  expect(kind.editContext).toBeNull();
  expect(kind.contentEditable).toBe('true');
});

test('a scroll is never undone by the editor’s own caret glide', async ({ page }) => {
  // The reveal still runs for a caret a tap placed — but a gesture that moved
  // the note must never move it again (\"double tap scroll is very
  // unreliable\" was this glide, 350ms after the finger).
  const long = Array.from({ length: 120 }, (_, i) => `line ${i} of a note long enough to scroll`).join('\n');
  await mount(page, long);
  const report = await page.evaluate(async () => {
    const view = window.testEditor.view;
    const scroller = view.scrollDOM;
    scroller.scrollTop = 200;
    await new Promise((r) => requestAnimationFrame(r));
    const found = scroller.scrollTop;
    // A tap on the first line, and then the note is scrolled by the reader.
    const rect = view.coordsAtPos(6)!;
    const touch = new Touch({ identifier: 1, target: view.contentDOM, clientX: rect.left + 1, clientY: (rect.top + rect.bottom) / 2 });
    for (const type of ['touchstart', 'touchmove', 'touchend']) {
      const live = type !== 'touchend';
      view.contentDOM.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: live ? [touch] : [], targetTouches: live ? [touch] : [], changedTouches: [touch],
      }));
    }
    scroller.scrollTop = 400; // the reader scrolled away during the tap's quiet window
    await new Promise((r) => window.setTimeout(r, 600));
    return { found, after: scroller.scrollTop };
  });
  expect(report.found).toBe(200);
  expect(report.after).toBe(400);
});
