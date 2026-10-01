// Tapping a rendered checkbox: it toggles, and nothing else moves.
//
// Reported: "tapping a checkbox returns back to caret position, shouldn't do
// that" and "checkbox hit box is small". Both come from the same place — the
// marker is a 17px box drawn over the "[ ]" text of the line, and a tap on it
// was handled as a tap on text: the WebView placed a caret on the marker (and
// the editor's focus handler then glided the view back to the caret's line),
// while the box itself was the only thing that could be hit.
import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

const NOTE = [
  'A note with tasks:',
  '',
  '- first item of prose',
  '- [ ] a task to tick',
  '- [x] one already done',
  '',
  'More prose after the list.',
].join('\n');

async function mount(page: Page, lines = 1) {
  await page.goto('/');
  await page.evaluate(async ({ text, lines }) => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000;overflow:auto';
    document.body.appendChild(host);
    // The checkbox geometry is the note's: a repeatable size, whatever the
    // phone's scale, so a hit box can be measured against it.
    document.documentElement.style.setProperty('--note-font-size', '16px');
    window.testEditor = new SatrEditor(host, () => {});
    window.testEditor.setValue(text + (lines > 1 ? `\n${'filler prose line\n'.repeat(lines - 1)}` : ''));
    window.testEditor.setSelection(0);
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, { text: NOTE, lines });
}

/** One finger: down, up (or a move of `move` px in between) on a point in the
 *  note, measured from the checkbox's drawn box. */
async function touchAt(page: Page, dx: number, dy: number, move = 0) {
  return page.evaluate(async ({ dx, dy, move }) => {
    const box = window.testEditor.view.dom.querySelector<HTMLElement>('.cm-lp-task')!;
    const rect = box.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + dx;
    const y = rect.top + dy;
    const target = document.elementFromPoint(x, y)!;
    const fire = (type: string, clientY: number): boolean => {
      const touch = new Touch({ identifier: 1, target, clientX: x, clientY });
      const live = type !== 'touchend';
      return document.elementFromPoint(x, clientY)!.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: live ? [touch] : [], targetTouches: live ? [touch] : [], changedTouches: [touch],
      }));
    };
    const view = window.testEditor.view;
    const before = { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head };
    const scrollTop = view.scrollDOM.scrollTop;
    fire('touchstart', y);
    let kept: boolean | null = null;
    if (move) kept = fire('touchmove', y + move);
    fire('touchend', y + move);
    await new Promise((r) => window.setTimeout(r, 120));
    const after = view.state.selection.main;
    return {
      hit: target.className ? String(target.className) : target.tagName,
      kept,
      // The task's own line, so a second tap in the same test cannot be read
      // as a first one.
      taskLine: window.testEditor.getValue().split('\n').find((line) => line.includes('a task to tick')) ?? '',
      caretMoved: before.anchor !== after.anchor || before.head !== after.head,
      scrolled: view.scrollDOM.scrollTop !== scrollTop,
      text: window.testEditor.getValue(),
    };
  }, { dx, dy, move });
}

test('a tap on a checkbox ticks it, and the caret does not move', async ({ page }) => {
  await mount(page);
  const report = await touchAt(page, 0, -12);
  expect(report.taskLine).toBe('- [x] a task to tick');
  expect(report.caretMoved).toBe(false);
  expect(report.scrolled).toBe(false);
});

const reset = (page: Page) => page.evaluate((text) => {
  window.testEditor.setValue(text);
  window.testEditor.setSelection(0);
}, NOTE);

test('the tappable area is the line’s leading side, the box included', async ({ page }) => {
  await mount(page);
  // The drawn box is 17px, and the marker's own pseudo-element only ever
  // covered its upper-left half: a finger aiming at the square landed on the
  // line and placed a caret — "the hit box is small", and the caret coming
  // back, were the same thing. The area is the line's own leading side now:
  // the line's full height, from its start edge through the marker and a
  // little past it. A tap anywhere in it, at any height in the line, ticks
  // the box.
  for (const dy of [-16, -8, 0, 4]) {
    await reset(page);
    expect((await touchAt(page, -12, dy)).taskLine, `left of the box at ${dy}`).toBe('- [x] a task to tick');
    await reset(page);
    expect((await touchAt(page, 6, dy)).taskLine, `over the box at ${dy}`).toBe('- [x] a task to tick');
  }
  // The words are not the marker's: a tap on the task's own text is a caret,
  // which is what editing it needs.
  await reset(page);
  const onText = await touchAt(page, 46, -8);
  expect(onText.taskLine).toBe('- [ ] a task to tick'); // not the marker's tap
  expect(onText.caretMoved).toBe(false); // and nothing of ours touched the caret
  // (a real tap there is the browser's own caret placement — a synthetic touch
  // has no browser behind it to place one, which is why this pins the claim,
  // not the caret)
  // And the line above is not this marker's to take.
  await reset(page);
  const above = await touchAt(page, -12, -24);
  expect(above.taskLine).toBe('- [ ] a task to tick');
});

test('a finger that moves is scrolling, not ticking', async ({ page }) => {
  await mount(page, 40);
  const report = await touchAt(page, 0, -12, 40);
  expect(report.kept).toBe(true); // the scroll was not prevented
  expect(report.taskLine).toBe('- [ ] a task to tick');
});
