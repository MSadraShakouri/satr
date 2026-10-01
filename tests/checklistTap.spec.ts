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

test('the tappable area is the box and the line around it, and stops at the text', async ({ page }) => {
  await mount(page);
  // The drawn box is 17px, and the marker's own pseudo-element only ever
  // covered its upper-left half: a finger aiming at the square landed on the
  // line and placed a caret — "the hit box is small", and the caret coming
  // back, were the same thing. The area is the marker's own rect now (the box
  // and the 7px of margin it carries) taken to the line's full height: a tap
  // anywhere in it, at any height in the line, ticks the box.
  for (const dy of [-16, -8, 0, 4]) {
    await reset(page);
    expect((await touchAt(page, -12, dy)).taskLine, `left of the box at ${dy}`).toBe('- [x] a task to tick');
    await reset(page);
    expect((await touchAt(page, 6, dy)).taskLine, `over the box at ${dy}`).toBe('- [x] a task to tick');
  }
  // Below the box's own row, too: the area is the line's height, and a finger
  // that lands low in it is still aiming at the square.
  await reset(page);
  expect((await touchAt(page, 0, 8)).taskLine).toBe('- [x] a task to tick');
  // The words are not the marker's: a tap on the task's own text is a caret,
  // which is what editing it needs. That includes its first character — an
  // area that reached 8px past the marker swallowed the first one or two
  // ("the hit box got too big and I can no longer select the first few chars
  // of a checklist item"), so this is the boundary the area has to respect.
  await reset(page);
  const onText = await touchAt(page, 46, -8);
  expect(onText.taskLine).toBe('- [ ] a task to tick'); // not the marker's tap
  await reset(page);
  const onFirstChar = await touchAt(page, 18, 0);
  expect(onFirstChar.taskLine).toBe('- [ ] a task to tick');
  // And the line above is not this marker's to take.
  await reset(page);
  const above = await touchAt(page, -12, -24);
  expect(above.taskLine).toBe('- [ ] a task to tick');
});

test('a tick holds the note still, whatever else moves it', async ({ page }) => {
  // The reveal's quiet window (touchState) covers the editor's own glide; what
  // it cannot cover is a WebView that focuses the editable on the tap and
  // brings the caret into view for itself, or the keyboard's own scroll. Those
  // move the note with nobody to blame, so a tick holds the scroller for a
  // moment and puts back whatever it finds moved — and the reader's own next
  // finger releases the hold at once, so a scroll that was asked for stands.
  await mount(page, 40);
  const report = await page.evaluate(async () => {
    const view = window.testEditor.view;
    const box = view.dom.querySelector<HTMLElement>('.cm-lp-task')!;
    const rect = box.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top;
    const fire = (type: string, clientY: number): void => {
      const target = document.elementFromPoint(x, clientY) ?? view.contentDOM;
      const touch = new Touch({ identifier: 1, target, clientX: x, clientY });
      const live = type !== 'touchend';
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: live ? [touch] : [], targetTouches: live ? [touch] : [], changedTouches: [touch],
      }));
    };
    const scroller = view.scrollDOM;
    scroller.scrollTop = 0;
    fire('touchstart', y);
    fire('touchend', y);
    await new Promise((r) => window.setTimeout(r, 80));
    const ticked = window.testEditor.getValue().includes('- [x] a task to tick');
    // What a WebView's own focus does a moment later: the note jumps to the caret.
    scroller.scrollTop = 260;
    await new Promise((r) => window.setTimeout(r, 160));
    const held = scroller.scrollTop;
    // The reader's own finger: the hold lets go at once.
    fire('touchstart', y);
    scroller.scrollTop = 90;
    await new Promise((r) => window.setTimeout(r, 160));
    return { ticked, held, afterReader: scroller.scrollTop };
  });
  expect(report.ticked).toBe(true);
  expect(report.held).toBe(0);
  expect(report.afterReader).toBe(90);
});

test('a finger that moves is scrolling, not ticking', async ({ page }) => {
  await mount(page, 40);
  const report = await touchAt(page, 0, -12, 40);
  expect(report.kept).toBe(true); // the scroll was not prevented
  expect(report.taskLine).toBe('- [ ] a task to tick');
});

// The same complaint as the note moving, one step smaller: "tapping a checkbox
// returns back to caret position". The app claims the tap and places no caret,
// but a WebView that focuses the editable anyway puts its own caret where the
// finger was — on the marker, several characters back — a moment after the
// finger is up. For the same window the scroller is held, the caret is held
// too, and the writer's own next touch or key ends the hold.
test('the WebView\'s own caret after a tick is put back, and typing is never fought', async ({ page }) => {
  await mount(page, 6);
  const box = await page.evaluate(async () => {
    const view = window.testEditor.view;
    const marker = view.dom.querySelector<HTMLElement>('.cm-lp-task')!;
    const rect = marker.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y)!;
    // The writer's caret, away from the task line, and then the tap.
    const elsewhere = view.state.doc.line(6).from;
    window.testEditor.setSelection(elsewhere);
    for (const type of ['touchstart', 'touchend']) {
      const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
      const live = type !== 'touchend';
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: live ? [touch] : [], targetTouches: live ? [touch] : [], changedTouches: [touch],
      }));
    }
    // ... and then the platform's own reaction, which is a bare selection
    // move onto the marker's `[` — exactly what a focus-following caret looks
    // like on the checkbox the finger ticked.
    const task = view.state.doc.line(4);
    view.dispatch({ selection: { anchor: task.from + task.text.indexOf('[') } });
    await new Promise((r) => window.setTimeout(r, 200));
    return { head: view.state.selection.main.head, wanted: elsewhere, text: window.testEditor.getValue() };
  });
  expect(box.head).toBe(box.wanted);
  expect(box.text).toContain('- [x] a task to tick');
});

test('a tick followed by typing keeps the typing', async ({ page }) => {
  await mount(page, 3);
  await touchAt(page, 0, 0);
  await page.evaluate(() => {
    window.testEditor.setSelection(window.testEditor.view.state.doc.length);
    window.testEditor.focus();
  });
  await page.keyboard.type('Z');
  await page.waitForTimeout(150);
  const text = await page.evaluate(() => window.testEditor.getValue());
  expect(text.slice(-80)).toContain('Z');
});
