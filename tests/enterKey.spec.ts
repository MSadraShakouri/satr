import { test, expect, type Page } from '@playwright/test';

// What a new line starts with.
//
// A line of code repeats exactly (src/enterKey.ts) — a tab stays a tab, four
// spaces stay four, and a fenced block written inside a quote keeps its `> `
// instead of breaking in half.
//
// The reference is Obsidian 1.14.4's own Enter, read out of app.js
// (newlineAndIndentOnly): every expectation below is what it produces for the
// same keystrokes.

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
