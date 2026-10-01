// Tapping a rendered checkbox: it toggles, and nothing else moves.
//
// Reported: "tapping a checkbox returns back to caret position, shouldn't do
// that", "checking a checkbox shouldn't open keyboard" and "checkbox hit box
// is small". The first two came from the same place: a tap on the marker was
// handled as a tap on text, the WebView placed a caret on it, and the editor's
// own focus handler *glided the view back to the caret* — the caret being
// wherever the writer had last left it, which is why the note "returned".
//
// That glide is gone (src/editor.ts: the note moves to a caret only for Enter
// and for the keyboard opening), so there is nothing here to hold, mute or put
// back. A tick now claims the tap, flips the box, and lets the note's focus go
// — which is also what keeps a keyboard from opening behind it.
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

test('a tick moves nothing, and nothing is forced back', async ({ page }) => {
  // No hold, no put-back, no mute: nothing in the app scrolls for a caret (or
  // for a focus) any more, so the note simply stays where it is, and whatever
  // the platform does afterwards is left alone rather than undone. This is the
  // regression test for what used to happen — a tick followed by the
  // WebView's own re-focus glided the note to the old caret (measured at up to
  // 1688px), and a scroll pin then fought the platform for 700ms.
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
    const focused = view.hasFocus;
    // What a WebView can still do a moment later: scroll, and move the
    // selection onto the marker. The app is a spectator: neither is undone.
    scroller.scrollTop = 260;
    const task = view.state.doc.line(4);
    view.dispatch({ selection: { anchor: task.from + task.text.indexOf('[') } });
    await new Promise((r) => window.setTimeout(r, 200));
    return { ticked, focused, left: scroller.scrollTop, caret: view.state.selection.main.head };
  });
  expect(report.ticked).toBe(true);
  expect(report.focused).toBe(false); // the focus let go: no keyboard can open behind it
  expect(report.left).toBe(260); // not held, not put back
  expect(report.caret).toBeGreaterThan(0); // the platform's own caret is left as it is
});

test('a finger that moves is scrolling, not ticking', async ({ page }) => {
  await mount(page, 40);
  const report = await touchAt(page, 0, -12, 40);
  expect(report.kept).toBe(true); // the scroll was not prevented
  expect(report.taskLine).toBe('- [ ] a task to tick');
});

// The writer's own caret is not the app's to move: a tick does not place one
// (the tap is claimed) and does not put one back either. The writer's caret
// stays exactly where it was, and the *view* — not the caret — is what no
// longer moves, because nothing in the app scrolls for a caret on its own.
test('a tick leaves the writer\'s caret alone and moves nothing', async ({ page }) => {
  await mount(page, 6);
  const box = await page.evaluate(async () => {
    const view = window.testEditor.view;
    const marker = view.dom.querySelector<HTMLElement>('.cm-lp-task')!;
    const rect = marker.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y)!;
    // The writer's caret, away from the task line, and the note scrolled to it.
    const elsewhere = view.state.doc.line(6).from;
    window.testEditor.setSelection(elsewhere);
    window.testEditor.focus();
    const top = view.scrollDOM.scrollTop;
    for (const type of ['touchstart', 'touchend']) {
      const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
      const live = type !== 'touchend';
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: live ? [touch] : [], targetTouches: live ? [touch] : [], changedTouches: [touch],
      }));
    }
    await new Promise((r) => window.setTimeout(r, 300));
    return { head: view.state.selection.main.head, wanted: elsewhere, top, after: view.scrollDOM.scrollTop, text: window.testEditor.getValue() };
  });
  expect(box.head).toBe(box.wanted);
  expect(box.after).toBe(box.top);
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
