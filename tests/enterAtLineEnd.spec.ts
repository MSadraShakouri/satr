// Enter at the end of a line as it is drawn.
//
// Reported: "when I press the end of a line, the signs aren't shown, and the
// caret goes to before it, it isn't a big issue but enter brings it to the new
// line, breaking the italic or whatever else exists, that's my issue, and for
// the solution I point to the enter button."
//
// A hidden mark has no width to tap. `word *bold*` is drawn as `word bold`, so
// a finger at the end of it puts the caret at 10 of 11 — in front of the
// closing `*` — and Enter, breaking at the caret, moved that mark onto the new
// line and left `word *bold` above it, which is not italic any more. The same
// for `**`, `~~`, a code span, `==` and a link's `](a.md)`.
//
// The toolbar's "new line below" never had the bug, because it parks the caret
// at the line's real end before it runs Enter. Enter now settles the caret the
// same way when only hidden characters are left after it, and then runs the
// rest of the chain untouched.
import { expect, test } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await window.__satr.load('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {});
    await document.fonts.ready;
  });
});

/** The note, with the caret parked on a second line first — the state you read
 *  in, where the marks on the first line are hidden. */
async function seed(page: import('@playwright/test').Page, line: string) {
  return page.evaluate(async (line) => {
    const ed = window.testEditor;
    ed.setValue(`${line}\nsecond line`);
    ed.view.focus();
    ed.view.dispatch({ selection: { anchor: line.length + 1 + 'second line'.length } });
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const first = ed.view.contentDOM.querySelector('.cm-line') as HTMLElement;
    return first.textContent ?? '';
  }, line);
}

/** A finger at the end of the first line, as it looks with its marks hidden. */
async function tapLineEnd(page: import('@playwright/test').Page) {
  const at = await page.evaluate(() => {
    const ed = window.testEditor;
    const first = ed.view.contentDOM.querySelector('.cm-line') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(first);
    const rect = range.getBoundingClientRect();
    return { x: rect.right, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(at.x - 1, at.y);
  await page.waitForTimeout(80);
}

type Result = { caret: number; lines: string[] };

async function enter(page: import('@playwright/test').Page): Promise<Result> {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  return page.evaluate(() => ({
    caret: window.testEditor.view.state.selection.main.head,
    lines: window.testEditor.getValue().split('\n'),
  }));
}

// Every shape whose close is hidden, tapped at the end of the line the way a
// reader taps it. The line above must come out of Enter exactly as it went in,
// and the new line must hold nothing at all.
for (const [name, line, drawn] of [
  ['italic', 'word *bold*', 'word bold'],
  ['bold', 'word **bold**', 'word bold'],
  ['strikethrough', 'word ~~struck~~', 'word struck'],
  ['code', 'word `code`', 'word code'],
  ['highlight', 'word ==hl==', 'word hl'],
  ['link', 'see [note](a.md)', 'see note'],
] as const) {
  test(`Enter at the end of a ${name} line leaves its marks behind`, async ({ page }) => {
    const asDrawn = await seed(page, line);
    expect(asDrawn, `${name}: the marks are hidden while the caret is on the other line`).toBe(drawn);
    await tapLineEnd(page);
    const before = await page.evaluate(() => window.testEditor.view.state.selection.main.head);
    expect(before, `${name}: the tap lands in front of the hidden close`).toBeLessThan(line.length);
    const after = await enter(page);
    expect(after.lines[0], `${name}: the line above keeps its marks`).toBe(line);
    expect(after.lines[1], `${name}: nothing you did not type starts the new line`).toBe('');
    expect(after.caret, `${name}: the caret is at the start of the new line`).toBe(line.length + 1);
    expect(after.lines.slice(2), `${name}: the rest of the note is untouched`).toEqual(['second line']);
  });
}

test('Enter in the middle of real words still splits there', async ({ page }) => {
  // The caret has letters after it: this is an ordinary break in the middle of
  // a line, and it must not be moved to the end of it.
  await page.evaluate(async () => {
    const ed = window.testEditor;
    ed.setValue('*one two* tail');
    ed.view.focus();
    ed.view.dispatch({ selection: { anchor: 5 } }); // between "one " and "two"
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
  const after = await enter(page);
  expect(after.lines, 'the break stays where the caret was').toEqual(['*one ', 'two* tail']);
});

test('an empty pair counts as ordinary text and is left above the new line', async ({ page }) => {
  // "If the pairs are empty, I think it doesn't count as pairs so it should act
  // like normal text": nothing is removed and nothing is dragged down.
  await page.evaluate(async () => {
    const ed = window.testEditor;
    ed.setValue('word **');
    ed.view.focus();
    ed.view.dispatch({ selection: { anchor: 6 } }); // between the two: word *|
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
  const result = await enter(page);
  expect(result.lines[0], 'both halves stay where they are').toBe('word **');
  expect(result.lines[1], 'the new line is empty').toBe('');
  expect(result.caret, 'the caret is at the start of the new line').toBe(8);
});

test('a bullet line ending in a mark keeps its mark and still continues', async ({ page }) => {
  const asDrawn = await seed(page, '- an item with *bold*');
  // The bullet is a mark over the real "-" (style.css draws it as a dot), so it
  // is still in the text; only the pair's marks are hidden.
  expect(asDrawn, 'the marks of the pair are hidden').toBe('- an item with bold');
  await tapLineEnd(page);
  const after = await enter(page);
  expect(after.lines[0], 'the item keeps its mark').toBe('- an item with *bold*');
  expect(after.lines[1], 'the list continues, as it always did').toBe('- ');
});

test('a line of source code is never settled to its end', async ({ page }) => {
  // In a fence nothing is markdown: `*` there is a character the writer wants
  // where they put it.
  await page.evaluate(async () => {
    const ed = window.testEditor;
    ed.setValue('```\nx = y *\n```');
    ed.view.focus();
    ed.view.dispatch({ selection: { anchor: 10 } }); // between "y " and "*"
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
  const after = await enter(page);
  expect(after.lines, 'the break stays inside the line').toEqual(['```', 'x = y ', '*', '```']);
});

test('a display formula line still opens a block rather than being settled', async ({ page }) => {
  // The one shape that had to keep its own Enter: `$$  $$` with the caret in
  // it opens a display block, and settling the caret to the end first would
  // have taken that away.
  await page.evaluate(async () => {
    const ed = window.testEditor;
    ed.setValue('$$  $$');
    ed.view.focus();
    ed.view.dispatch({ selection: { anchor: 3 } });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
  const after = await enter(page);
  expect(after.lines, 'the display block opened').toEqual(['$$', '', '$$']);
});

test('the new-line button and the Enter key come out the same', async ({ page }) => {
  // The button was the reference: it parks at the line's real end first, and
  // the comment above the chain says the two can never drift apart.
  await seed(page, 'word ==hl==');
  await page.evaluate(() => {
    window.testEditor.view.dispatch({ selection: { anchor: 9 } }); // in front of the closing ==
  });
  const byKey = await enter(page);

  await seed(page, 'word ==hl==');
  const byButton = await page.evaluate(async () => {
    const ed = window.testEditor;
    ed.view.dispatch({ selection: { anchor: 9 } });
    ed.run('lineBelow');
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return { caret: ed.view.state.selection.main.head, lines: ed.getValue().split('\n') };
  });
  expect(byKey.lines, 'the key and the button agree, line for line').toEqual(byButton.lines);
  expect(byKey.caret, 'and the caret lands in the same place').toBe(byButton.caret);
});
