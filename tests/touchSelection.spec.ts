import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

// Double tap to select a word, and drag to select more.
//
// Android's WebView selects a word on a double tap and shows its handles and
// the cut/copy bar — but only where the caret goes through the DOM selection.
// CodeMirror hands text input to Chrome's EditContext API wherever the browser
// has it (every Android WebView from Chrome 121 on), and that path takes the
// caret away from the DOM selection: the keyboard never hears where a tap put
// it (no suggestion strip, no auto-correct), a double tap never arrives as a
// selection, and "Select all" from the selection bar has nothing to act on.
// src/editor.ts therefore opts out of EditContext and keeps the contenteditable
// path, with this selection as the fallback for anything the browser still
// doesn't do by itself.
const NOTE = 'the quick brown fox jumps over the lazy dog\nسلام دنیا زیباست و این خط فارسی است\nsecond line with several words in it';

/** One finger step: a document position to put the finger on, optionally
 *  offset from it (dx / dy), so a drag can be diagonal. */
type Step = { action: 'down' | 'up' | 'move'; at: number; wait?: number; on?: string; dx?: number; dy?: number };

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async (text) => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {});
    window.testEditor.setValue(text);
    window.testEditor.setSelection(0);
    window.testEditor.focus();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, NOTE);
});

/** Play a finger on the note: a list of touch steps, in one go, the way a
 *  gesture arrives. `at` is a document position — the point of the test is the
 *  word under the finger, so the finger is put on the character itself. */
async function gesture(page: Page, steps: Step[]) {
  return page.evaluate(async (steps) => {
    const view = window.testEditor.view;
    for (const step of steps) {
      if (step.wait) await new Promise((r) => window.setTimeout(r, step.wait));
      const rect = view.coordsAtPos(step.at);
      if (!rect) throw new Error(`position ${step.at} is not on screen`);
      const x = rect.left + 1 + (step.dx ?? 0);
      const y = (rect.top + rect.bottom) / 2 + (step.dy ?? 0);
      // The event lands on the editor (or on a widget when that is the point
      // of the test); the position under the finger is read from the
      // coordinates, as it is in the app.
      const target = step.on ? view.dom.querySelector(step.on)! : view.contentDOM;
      const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y });
      const live = step.action !== 'up';
      const type = step.action === 'down' ? 'touchstart' : step.action === 'up' ? 'touchend' : 'touchmove';
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: live ? [touch] : [], targetTouches: live ? [touch] : [], changedTouches: [touch],
      }));
    }
    // The fallback waits for the browser's own selection before it acts.
    await new Promise((r) => window.setTimeout(r, 200));
    const { anchor, head } = view.state.selection.main;
    return { anchor, head, text: window.testEditor.getValue().slice(anchor, head) };
  }, steps);
}

/** One tap: finger down and up, nothing else. */
const tap = (at: number, on?: string): Step[] => [
  { action: 'down', at, on }, { action: 'up', at, on },
];

test('a double tap on a word selects that word', async ({ page }) => {
  expect(await gesture(page, tap(6))).toMatchObject({ anchor: 0, head: 0, text: '' });
  // 6 is inside "quick" (4..9).
  expect(await gesture(page, [...tap(6), ...tap(6)])).toMatchObject({ anchor: 4, head: 9, text: 'quick' });
});

test('a double tap on a Persian word selects the whole word', async ({ page }) => {
  const at = NOTE.indexOf('دنیا') + 2;
  expect(await gesture(page, [...tap(at), ...tap(at)])).toMatchObject({ text: 'دنیا' });
});

test('a double tap then a drag selects from the word to the word under the finger', async ({ page }) => {
  // 6 is inside "quick", 20 inside "jumps": the gesture takes in everything
  // between them, the way dragging a selection handle does.
  const report = await gesture(page, [
    ...tap(6),
    { action: 'down', at: 6 }, { action: 'move', at: 12 }, { action: 'move', at: 20 }, { action: 'up', at: 20 },
  ]);
  expect(report.text).toBe(NOTE.slice(4, 25));
  expect(report.anchor).toBe(4);
});

test('a scroll is not a tap: a tap right after it does not select a word', async ({ page }) => {
  // Scrolling and then tapping quickly used to arrive as a double tap: the
  // scroll left its starting point recorded as a tap, and the real tap landed
  // inside the double tap window (320ms, 30px), so a word was selected out of
  // two gestures that never belonged together. A scroll is not a tap.
  const report = await gesture(page, [
    { action: 'down', at: 6 },
    { action: 'move', at: 6, dy: -50 }, // 50px up the page: a scroll, not a tap
    { action: 'up', at: 6, dy: -50 },
    { action: 'down', at: 6, wait: 120 }, // well inside DOUBLE_TAP_MS of the scroll
    { action: 'up', at: 6 },
  ]);
  expect(report.text).toBe('');
});

test('what the browser selected itself is never taken away from the writer', async ({ page }) => {
  // The WebView's own double tap, arriving a frame after the lift: whatever
  // it selected is the writer's selection and stays.
  const report = await page.evaluate(async () => {
    const view = window.testEditor.view;
    const rect = view.coordsAtPos(6)!;
    const x = rect.left + 1;
    const y = (rect.top + rect.bottom) / 2;
    const fire = (type: string) => {
      const touch = new Touch({ identifier: 1, target: view.contentDOM, clientX: x, clientY: y });
      const live = type !== 'touchend';
      view.contentDOM.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: live ? [touch] : [], targetTouches: live ? [touch] : [], changedTouches: [touch],
      }));
    };
    const taps = ['touchstart', 'touchend', 'touchstart', 'touchend'];
    for (const [index, type] of taps.entries()) {
      fire(type);
      // The WebView's own word selection, one frame after the second lift.
      if (index === taps.length - 1) view.dispatch({ selection: { anchor: 10, head: 19 } });
    }
    await new Promise((r) => window.setTimeout(r, 200));
    const { anchor, head } = view.state.selection.main;
    return { anchor, head, text: window.testEditor.getValue().slice(anchor, head) };
  });
  expect(report).toMatchObject({ anchor: 10, head: 19, text: NOTE.slice(10, 19) });
});

test('a single tap, two taps far apart, and a tap on a widget change nothing', async ({ page }) => {
  // A gesture that starts long after the last one is a new gesture, whatever
  // the test did before it.
  const fresh = (steps: Step[], wait = 400): Step[] => [{ ...steps[0], wait }, ...steps.slice(1)];
  expect((await gesture(page, tap(6))).text).toBe('');
  // A second tap a whole word away is two taps, not one gesture.
  expect((await gesture(page, fresh([...tap(6), ...tap(30)]))).text).toBe('');
  // A tap on the file name, the widget at the top of the note, brings its own
  // editing and is never a word of the note.
  expect((await gesture(page, fresh([...tap(0, '.cm-file-name'), ...tap(0, '.cm-file-name')]))).text).toBe('');
  // Neither is a double tap whose two taps are half a second apart.
  const slow = [
    { ...tap(6)[0], wait: 400 }, tap(6)[1],
    { ...tap(6)[0], wait: 600 }, tap(6)[1],
    { ...tap(6)[0], wait: 600 }, tap(6)[1],
  ];
  expect((await gesture(page, slow)).text).toBe('');
});

test('the word rules and the tap counter, on their own', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { wordRangeAt, TapTracker, DOUBLE_TAP_MS, TAP_SLOP_PX } = await import('/src/touchSelection.ts');
    const text = 'the quick brown fox';
    const range = (source: string, pos: number) => {
      const found = wordRangeAt(source, pos);
      return found ? [found.from, found.to, source.slice(found.from, found.to)] : null;
    };
    const tracker = new TapTracker();
    const taps = [tracker.start(1000, 100, 100), tracker.start(1100, 104, 98), tracker.start(3000, 100, 100)];
    const lateAt = 3000 + DOUBLE_TAP_MS + 1;
    const late = tracker.start(lateAt, 104, 102);
    const near = tracker.start(lateAt + 100, 105, 100); // just inside the window, a finger's width away
    const secondFinger = tracker.start(9000, 100, 100) === 1 ? tracker.start(9100, 100, 100, 2) : -1;
    return {
      middle: range(text, 6), atStart: range(text, 0), atEnd: range(text, text.length),
      onSpace: range('hello world', 5), onPunctuation: range('hello, world', 5),
      persian: range('سلام دنیا زیباست', 7), persianEdge: range('سلام دنیا زیباست', 4),
      underscore: range('snake_case_name', 7), digits: range('x = 42 + 7', 5),
      past: range('abc', 99), empty: range('', 0),
      doubleTapMs: DOUBLE_TAP_MS, tapSlop: TAP_SLOP_PX,
      taps, late, near, secondFinger,
    };
  });
  expect(report.middle).toEqual([4, 9, 'quick']);
  expect(report.atStart).toEqual([0, 3, 'the']);
  expect(report.atEnd).toEqual([16, 19, 'fox']);
  // A caret just past a word — the right half of its last letter, or the
  // space beside it — belongs to the word the finger is on: whitespace and
  // punctuation never make a word of their own.
  expect(report.onSpace).toEqual([0, 5, 'hello']);
  expect(report.onPunctuation).toEqual([0, 5, 'hello']);
  // A Persian word is a word, in either direction of the phrase.
  expect(report.persian).toEqual([5, 9, 'دنیا']);
  expect(report.persianEdge).toEqual([0, 4, 'سلام']);
  expect(report.underscore).toEqual([0, 15, 'snake_case_name']);
  expect(report.digits).toEqual([4, 6, '42']);
  expect(report.past).toEqual([0, 3, 'abc']);
  expect(report.empty).toBeNull();
  // Two taps close together are one gesture; a third tap starts over.
  expect(report.taps).toEqual([1, 2, 1]);
  expect(report.late).toBe(1);
  expect(report.near).toBe(2);
  expect(report.secondFinger).toBe(0);
});

test('the editor asks the browser for its contenteditable input, not EditContext', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { usesEditContext } = await import('/src/editor.ts');
    const content = window.testEditor.view.contentDOM;
    return {
      usesEditContext,
      // Whatever the browser supports, the editor is a plain editable region:
      // that is what the keyboard, the handles and the selection bar act on.
      editable: content.getAttribute('contenteditable'),
      role: content.getAttribute('role'),
      editContext: 'editContext' in content ? content.editContext : null,
      autocorrect: content.getAttribute('autocorrect'),
      spellcheck: content.getAttribute('spellcheck'),
    };
  });
  expect(report.usesEditContext).toBe(false);
  expect(report.editable).toBe('true');
  expect(report.role).toBe('textbox');
  expect(report.editContext).toBeNull();
  // Markor's keyboard: suggestions and auto-correct on, no squiggles.
  expect(report.autocorrect).toBe('on');
  expect(report.spellcheck).toBe('false');
});
