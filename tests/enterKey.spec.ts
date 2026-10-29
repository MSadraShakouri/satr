import { test, expect, type Page } from '@playwright/test';

// What a new line starts with.
//
// Two rules (src/enterKey.ts). A line of code repeats exactly — a tab stays a
// tab, four spaces stay four, and a fenced block written inside a quote keeps
// its `> ` instead of breaking in half. A line of prose that holds nothing but
// its own opening gives one level of it back instead of repeating it, so a
// quote can be left and an indent can be escaped without reaching for
// Backspace.
//
// The reference is Obsidian 1.14.4's own Enter, read out of app.js
// (newlineAndIndentContinueMarkdownList / newlineAndIndentOnly): every
// expectation below is what it produces for the same keystrokes, except the
// indent step, which is Satr's own Tab (two spaces) rather than its four.

async function boot(page: Page, name: string, body: string): Promise<void> {
  await page.addInitScript(([file, text]) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { [`Notes/${file}`]: 1 }, folders: ['Notes'] }));
    localStorage.setItem(`satr:fs:file:Notes/${file}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: `Notes/${file}` }], active: 0 }));
  }, [name, body]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('.cm-content')).toBeVisible();
}

/** The caret at the end of the line that ends with `tail`, and the editor
 *  focused — the caret is placed through the view so no click can land it a
 *  character off. */
const caretAfter = (page: Page, tail: string) => page.evaluate(async (end) => {
  const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
  const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
  const { doc } = view.state;
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    if (line.text.endsWith(end)) { view.dispatch({ selection: { anchor: line.to } }); view.focus(); return line.number; }
  }
  throw new Error(`no line ends with ${JSON.stringify(end)}`);
}, tail);

/** The whole file, with the caret written in as ‸. */
const written = (page: Page) => page.evaluate(async () => {
  const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
  const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
  const text = view.state.doc.toString();
  const head = view.state.selection.main.head;
  return `${text.slice(0, head)}‸${text.slice(head)}`;
});

// ---- code: the line's own indentation, repeated exactly ----

test('a fenced block inside a quote keeps its quote', async ({ page }) => {
  await boot(page, 'A.md', '> ```\n> kod\n> ```\n');
  await expect(page.locator('.cm-lp-code-line').first()).toBeVisible(); // the fence is parsed
  await caretAfter(page, '> kod');
  await page.keyboard.press('Enter');
  // the block used to be cut in half here: the new line came out unquoted
  await expect.poll(() => written(page)).toBe('> ```\n> kod\n> ‸\n> ```\n');
});

test('a tab stays a tab', async ({ page }) => {
  await boot(page, 'a.js', 'function a() {\n\tconst x = 1;\n}\n');
  await expect(page.locator('.cm-content')).toHaveClass(/is-code-file/);
  await caretAfter(page, 'const x = 1;');
  await page.keyboard.press('Enter');
  await expect.poll(() => written(page)).toBe('function a() {\n\tconst x = 1;\n\t‸\n}\n');
});

test('the file’s own indentation is what repeats, not CodeMirror’s two spaces', async ({ page }) => {
  await boot(page, 'a.py', 'def f():\n    if x:\n        pass\n');
  await expect(page.locator('.cm-content')).toHaveClass(/is-code-file/);
  await caretAfter(page, '        pass');
  await page.keyboard.press('Enter');
  await expect.poll(() => written(page)).toBe('def f():\n    if x:\n        pass\n        ‸\n');
});

test('nothing re-indents: an opening brace adds no level of its own', async ({ page }) => {
  await boot(page, 'a.js', 'function a() {\n}\n');
  await expect(page.locator('.cm-content')).toHaveClass(/is-code-file/);
  await caretAfter(page, 'function a() {');
  await page.keyboard.press('Enter');
  await expect.poll(() => written(page)).toBe('function a() {\n‸\n}\n');
});

test('Shift-Tab steps the caret’s own line back, with nothing selected', async ({ page }) => {
  await boot(page, 'a.py', 'def f():\n    if x:\n        pass\n');
  await expect(page.locator('.cm-content')).toHaveClass(/is-code-file/);
  await caretAfter(page, '        pass');
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => written(page)).toBe('def f():\n    if x:\n      pass‸\n');
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => written(page)).toBe('def f():\n    if x:\n    pass‸\n');
});

// ---- prose: a line that is only its own opening gives one level back ----

test('an empty quote line ends the quote, with nothing left behind', async ({ page }) => {
  await boot(page, 'A.md', '> سلام\n');
  await caretAfter(page, 'سلام');
  await page.keyboard.press('Enter');
  await expect.poll(() => written(page)).toBe('> سلام\n> ‸\n');
  await page.keyboard.press('Enter');
  // out of the quote, and no bare `>` line where the writer was standing
  await expect.poll(() => written(page)).toBe('> سلام\n\n‸\n');
});

test('a nested quote comes out one level a press', async ({ page }) => {
  await boot(page, 'A.md', '>> سلام\n');
  await caretAfter(page, 'سلام');
  await page.keyboard.press('Enter');
  await expect.poll(() => written(page)).toBe('>> سلام\n>> ‸\n');
  await page.keyboard.press('Enter');
  await expect.poll(() => written(page)).toBe('>> سلام\n>\n>‸\n');
  await page.keyboard.press('Enter');
  await expect.poll(() => written(page)).toBe('>> سلام\n>\n\n‸\n');
});

test('an empty indented line gives a step back instead of repeating it', async ({ page }) => {
  await boot(page, 'A.md', 'متن\n\n  دو\n');
  await caretAfter(page, '  دو');
  await page.keyboard.press('Enter');
  await expect.poll(() => written(page)).toBe('متن\n\n  دو\n  ‸\n');
  await page.keyboard.press('Enter'); // the step Tab inserts, given back
  await expect.poll(() => written(page)).toBe('متن\n\n  دو\n‸\n');
  await page.keyboard.press('Enter'); // nothing left to give: an ordinary line
  await expect.poll(() => written(page)).toBe('متن\n\n  دو\n\n‸\n');
});

test('an empty sub-item leaves its list one level a press', async ({ page }) => {
  await boot(page, 'A.md', '- یک\n  - دو\n');
  await caretAfter(page, '  - دو');
  await page.keyboard.press('Enter');
  await expect.poll(() => written(page)).toBe('- یک\n  - دو\n  - ‸\n');
  await page.keyboard.press('Enter'); // out of the sub-list, into the one above it
  await expect.poll(() => written(page)).toBe('- یک\n  - دو\n- ‸\n');
  await page.keyboard.press('Enter'); // and the list itself ends
  await expect.poll(() => written(page)).toBe('- یک\n  - دو\n‸\n');
});

test('a sub-item inside a quote walks all the way out, a level a press', async ({ page }) => {
  await boot(page, 'A.md', '> - یک\n>   - دو\n');
  await caretAfter(page, '>   - دو');
  await page.keyboard.press('Enter');
  await expect.poll(() => written(page)).toBe('> - یک\n>   - دو\n>   - ‸\n');
  await page.keyboard.press('Enter'); // the indent
  await expect.poll(() => written(page)).toBe('> - یک\n>   - دو\n> - ‸\n');
  await page.keyboard.press('Enter'); // the marker, the quote kept
  await expect.poll(() => written(page)).toBe('> - یک\n>   - دو\n> ‸\n');
  await page.keyboard.press('Enter'); // the quote
  await expect.poll(() => written(page)).toBe('> - یک\n>   - دو\n\n‸\n');
});

test('a list is untouched: the item continues, the empty one ends', async ({ page }) => {
  await boot(page, 'A.md', '- یک\n');
  await caretAfter(page, 'یک');
  await page.keyboard.press('Enter');
  await expect.poll(() => written(page)).toBe('- یک\n- ‸\n');
  await page.keyboard.press('Enter');
  await expect.poll(() => written(page)).toBe('- یک\n‸\n');
});
