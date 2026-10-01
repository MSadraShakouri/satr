import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

// The `=` key. Markdown uses a lone `=` for setext underlines, table rules and
// arithmetic; `==text==` needs two. Pairing the first press made every lone `=`
// impossible — and put the caret between two `=` the writer never typed — so
// the first `=` is one `=`, and the second (with the first still the last thing
// written) is what opens `==|==`. A space in the empty pair takes its closing
// two away, as a space does in every other empty pair.

async function mount(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {});
    window.testEditor.setValue('');
    await new Promise((r) => requestAnimationFrame(r));
    window.testEditor.focus();
  });
}

const state = (page: Page) => page.evaluate(() => {
  const view = window.testEditor.view;
  const { anchor, head } = view.state.selection.main;
  return { text: view.state.doc.toString(), anchor, head };
});

test('the first = is one =, and the second opens the pair', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('=');
  expect(await state(page)).toEqual({ text: '=', anchor: 1, head: 1 });
  await page.keyboard.type('=');
  expect(await state(page)).toEqual({ text: '====', anchor: 2, head: 2 });
});

test('a space takes the two the second = inserted away', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('==');
  await page.keyboard.type(' ');
  expect(await state(page)).toEqual({ text: '== ', anchor: 3, head: 3 });
});

test('a = after a word, or on its own line, is just a =', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('a=');
  expect((await state(page)).text).toBe('a=');
  await page.keyboard.type('=');
  expect((await state(page)).text).toBe('a==');
  // A setext underline, made of the key itself: each `=` grows the run, and
  // the caret stays in the middle of the pair it is building.
  await mount(page);
  await page.keyboard.type('Title\n===');
  expect(await state(page)).toEqual({ text: 'Title\n=====', anchor: 9, head: 9 });
  // More presses keep it a run of `=` (the caret walks out through the
  // closing half, as it does with any other mark, and `=` past it grows it):
  // what matters is that a setext underline can be written at all.
  await page.keyboard.type('==');
  expect((await state(page)).text).toMatch(/^Title\n=+$/);
});

test('* and _ still open their pair on the first press, as before', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('*');
  expect(await state(page)).toEqual({ text: '**', anchor: 1, head: 1 });
  await mount(page);
  await page.keyboard.type('_');
  expect(await state(page)).toEqual({ text: '__', anchor: 1, head: 1 });
});

// `~` follows `=` for the same reason: a lone `~` is a range ("10~20") or a
// subscript, and `~~strikethrough~~` is two presses either way.
test('~ types one ~, and the second opens the strikethrough pair', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('~');
  expect(await state(page)).toEqual({ text: '~', anchor: 1, head: 1 });
  await page.keyboard.type('~');
  expect(await state(page)).toEqual({ text: '~~~~', anchor: 2, head: 2 });
  await page.keyboard.type(' ');
  expect(await state(page)).toEqual({ text: '~~ ', anchor: 3, head: 3 });
});

test('a ~ after a word, or between numbers, is just a ~', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('10~20');
  expect((await state(page)).text).toBe('10~20');
  await page.keyboard.type('~');
  expect((await state(page)).text).toBe('10~20~');
});

// Backticks are the other way round: one backtick is almost always the start
// of `code`, so the first press opens the pair and each press inside it grows
// the run, up to three. A run of three is a fence, and Enter in it opens the
// block — the same door `$$|$$` opens for display math.
test('a backtick pairs, then grows, and the third one is a fence', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('`');
  expect(await state(page)).toEqual({ text: '``', anchor: 1, head: 1 });
  await page.keyboard.type('`');
  expect(await state(page)).toEqual({ text: '````', anchor: 2, head: 2 });
  // The third backtick is the writer opening a fence: the run ends there and
  // the closing half goes away, so the line is a fence and not six backticks.
  await page.keyboard.type('`');
  expect(await state(page)).toEqual({ text: '```', anchor: 3, head: 3 });
});

test('Enter inside an empty fence opens the block', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('```');
  await page.keyboard.press('Enter');
  expect(await state(page)).toEqual({ text: '```\n\n```', anchor: 4, head: 4 });
  // A fence with a language written after the opening backticks opens too —
  // and the caret is on the empty line inside the block, not on the fence.
  await mount(page);
  await page.keyboard.type('```js');
  await page.keyboard.press('Enter');
  expect(await state(page)).toEqual({ text: '```js\n\n```js', anchor: 6, head: 6 });
});

test('a fence that is being closed is not re-opened by Enter', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    window.testEditor.setValue('```\ntext\n```');
    window.testEditor.setSelection(9); // the closing fence's own line
    window.testEditor.focus();
  });
  await page.keyboard.press('Enter');
  // Enter on the closing fence's own line is an ordinary newline: the line
  // becomes empty, and no second block is opened inside the first.
  expect((await state(page)).text).toBe('```\ntext\n\n```');
});

// A `"` is a quotation mark, not a markdown delimiter: it pairs only inside a
// bracket, where the writer is quoting something into it.
test('a quote inside a bracket makes a pair, and anywhere else is one quote', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('("');
  expect(await state(page)).toEqual({ text: '("")', anchor: 2, head: 2 });
  await mount(page);
  await page.keyboard.type('he said "');
  expect(await state(page)).toEqual({ text: 'he said "', anchor: 9, head: 9 });
  // A second quote is just a second quote, as typed.
  await page.keyboard.type('"');
  expect(await state(page)).toEqual({ text: 'he said ""', anchor: 10, head: 10 });
});
