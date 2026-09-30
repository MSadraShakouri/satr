import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

// Automatic numbering for ordered lists (the writer's request): Enter on an
// item numbers the new one and shifts the items after it up by one, deleting a
// whole item shifts the items after it down by one, and nothing else is
// touched. A blank line, prose or another list ends the run; nested items
// number themselves and are stepped over; a note being loaded and a list being
// pasted keep the numbers they came with.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {});
    await document.fonts.ready;
  });
});

/** The offset of a column on a 1-based line. */
function at(text: string, line: number, col: number | 'end' = 0): number {
  const lines = text.split('\n');
  const start = lines.slice(0, line - 1).reduce((total, value) => total + value.length + 1, 0);
  return start + (col === 'end' ? lines[line - 1].length : col);
}

type Action = 'enter' | 'button' | 'deleteLine' | 'selectAndDelete' | 'backspace' | 'none' |
  { changes: { from: number; to?: number; insert?: string }[] };

async function edit(page: Page, text: string, caret: number, action: Action): Promise<{ text: string; caret: number }> {
  return page.evaluate(async ({ text, caret, action }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    ed.setSelection(caret, caret);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    const view = ed.view;
    if (action === 'enter') {
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    } else if (action === 'button') {
      ed.run('lineBelow');
    } else if (action === 'deleteLine') {
      ed.run('deleteLine');
    } else if (action === 'none') {
      // Just the loaded note, nothing else.
    } else if (action === 'selectAndDelete' || action === 'backspace') {
      if (action === 'selectAndDelete') {
        const line = view.state.doc.lineAt(caret);
        ed.setSelection(line.from, line.to + 1);
        await new Promise((r) => setTimeout(r, 20));
      }
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    } else {
      view.dispatch({ changes: action.changes });
    }
    await new Promise((r) => setTimeout(r, 40));
    return { text: ed.getValue(), caret: ed.getSelection()[0] };
  }, { text, caret, action });
}

test('Enter numbers the new item and shifts the items after it up by one', async ({ page }) => {
  const latin = '1. a\n2. b\n3. c';
  expect((await edit(page, latin, at(latin, 1, 'end'), 'enter')).text).toBe('1. a\n2. \n3. b\n4. c');
  // The digits keep the set they were written in.
  const persian = '۱. یک\n۲. دو\n۳. سه';
  expect((await edit(page, persian, at(persian, 1, 'end'), 'enter')).text).toBe('۱. یک\n۲. \n۳. دو\n۴. سه');
  const arabic = '٣. ثالث\n٤. رابع';
  expect((await edit(page, arabic, at(arabic, 1, 'end'), 'enter')).text).toBe('٣. ثالث\n٤. \n٥. رابع');
  // And the delimiter the writer used.
  const paren = '1) a\n2) b';
  expect((await edit(page, paren, at(paren, 1, 'end'), 'enter')).text).toBe('1) a\n2) \n3) b');
  // A task list keeps its boxes.
  const tasks = '1. [ ] a\n2. [ ] b';
  expect((await edit(page, tasks, at(tasks, 1, 'end'), 'enter')).text).toBe('1. [ ] a\n2. [ ] \n3. [ ] b');
  // The toolbar's new-line button numbers like Enter.
  expect((await edit(page, latin, at(latin, 1, 'end'), 'button')).text).toBe('1. a\n2. \n3. b\n4. c');
});

test('the new item follows the number above it, and the run shifts by one', async ({ page }) => {
  // 6. → 7. then 8. becomes 9.: the writer's spacing is kept, not normalised.
  const odd = '6. a\n8. b';
  expect((await edit(page, odd, at(odd, 1, 'end'), 'enter')).text).toBe('6. a\n7. \n9. b');
  // The last item has nothing after it, so nothing else moves.
  const last = '1. a\n2. b';
  expect((await edit(page, last, at(last, 2, 'end'), 'enter')).text).toBe('1. a\n2. b\n3. ');
});

test('a blank line, prose, or another list ends the run', async ({ page }) => {
  const blank = '1. a\n\n2. b';
  expect((await edit(page, blank, at(blank, 1, 'end'), 'enter')).text).toBe('1. a\n2. \n\n2. b');
  const prose = '1. a\nprose\n3. c';
  expect((await edit(page, prose, at(prose, 1, 'end'), 'enter')).text).toBe('1. a\n2. \nprose\n3. c');
  // Two lists under two headings do not count each other.
  const two = '1. a\n2. b\n\n# t\n\n3. c\n4. d';
  expect((await edit(page, two, at(two, 1, 'end'), 'enter')).text).toBe('1. a\n2. \n3. b\n\n# t\n\n3. c\n4. d');
});

test('deleting a whole item shifts the items after it down by one', async ({ page }) => {
  const text = '1. a\n2. b\n3. c';
  // A selection that takes the line and its break.
  expect((await edit(page, text, at(text, 2), 'selectAndDelete')).text).toBe('1. a\n2. c');
  // The toolbar's delete-line button takes the break *above* the line; the
  // items after it still come down by one.
  expect((await edit(page, text, at(text, 2), 'deleteLine')).text).toBe('1. a\n2. c');
  // The deletion lands on the run: 4. and 5. become 2. and 3.
  const longer = '1. a\n2. b\n3. c\n4. d\n5. e';
  expect((await edit(page, longer, at(longer, 2), 'selectAndDelete')).text).toBe('1. a\n2. c\n3. d\n4. e');
  // With a blank line between, the list below is another list and keeps its
  // numbers.
  const apart = '1. a\n2. b\n\n3. c';
  expect((await edit(page, apart, at(apart, 2), 'deleteLine')).text).toBe('1. a\n\n3. c');
});

test('only a whole line is an item leaving the list', async ({ page }) => {
  const text = '1. a\n2. b\n3. c';
  // Deleting the marker turns the line into something else, and deleting only
  // the break joins it to the line above: neither is removing the item.
  expect((await edit(page, text, 0, { changes: [{ from: 5, to: 8 }] })).text).toBe('1. a\nb\n3. c');
  expect((await edit(page, text, 0, { changes: [{ from: 4, to: 5 }] })).text).toBe('1. a2. b\n3. c');
});

test('a nested list numbers itself and does not stand between the items above it', async ({ page }) => {
  const nested = '1. a\n    1. n1\n    2. n2\n3. c';
  // Enter on the outer item 1: the outer 3. comes down to 4., the nested
  // numbers stay.
  expect((await edit(page, nested, at(nested, 1, 'end'), 'enter')).text).toBe('1. a\n2. \n    1. n1\n    2. n2\n4. c');
  // Deleting outer item 2: the nested list is stepped over, the outer 2.
  // continues.
  const withTwo = '1. a\n2. b\n    1. n1\n    2. n2\n3. c';
  expect((await edit(page, withTwo, at(withTwo, 2), 'selectAndDelete')).text).toBe('1. a\n    1. n1\n    2. n2\n2. c');
});

test('loading a note or pasting a list keeps the numbers it came with', async ({ page }) => {
  const odd = '5. a\n9. b';
  expect((await edit(page, odd, at(odd, 1, 'end'), 'none')).text).toBe(odd);
  const list = '1. a\n2. b';
  const pasted = await page.evaluate(async ({ text }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    ed.setSelection(text.length, text.length);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    ed.view.dispatch({ changes: { from: text.length, insert: '\n4. d\n5. e' } });
    await new Promise((r) => setTimeout(r, 40));
    return ed.getValue();
  }, { text: list });
  expect(pasted).toBe('1. a\n2. b\n4. d\n5. e');
});

test('undo puts the numbering back with the edit', async ({ page }) => {
  const text = '1. a\n2. b\n3. c';
  const after = await page.evaluate(async ({ text, caret }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    ed.setSelection(caret, caret);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    ed.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    const numbered = ed.getValue();
    ed.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    return { numbered, undone: ed.getValue() };
  }, { text, caret: at(text, 1, 'end') });
  expect(after.numbered).toBe('1. a\n2. \n3. b\n4. c');
  expect(after.undone).toBe(text);
});
