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

test('the box is bigger than it looks: the tap area reaches past the 17px square', async ({ page }) => {
  await mount(page);
  // The drawn box is 17px; the marker's own space before it and the leading
  // around it are tappable too — a finger is not a mouse. (The area is drawn
  // by a pseudo-element, so a hit test is what can see it.)
  expect((await touchAt(page, -12, -12)).taskLine).toBe('- [x] a task to tick');
  // Roomier, but not greedy: the previous list item's line above is not this
  // marker's to take. (It was ticked by the line before this one, so what is
  // read here is that nothing ticked it *back*.)
  expect((await touchAt(page, -12, -24)).taskLine).toBe('- [x] a task to tick');
  expect((await touchAt(page, -12, -34)).taskLine).toBe('- [x] a task to tick');
});

test('a finger that moves is scrolling, not ticking', async ({ page }) => {
  await mount(page, 40);
  const report = await touchAt(page, 0, -12, 40);
  expect(report.kept).toBe(true); // the scroll was not prevented
  expect(report.taskLine).toBe('- [ ] a task to tick');
});
