import { test, expect, type Page } from '@playwright/test';

// A code file is edited as code: its own grammar, its own colours, left to
// right, with line numbers — and none of Markdown's cleverness, which would
// read a Python comment as a heading and a C pointer as an italic.

const JS = `// a tiny module
const greeting = "سلام";
function add(a, b) { return a + b; }
# not a heading
export default { greeting, add };
`;

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

test('the file is parsed by its own language, not by Markdown', async ({ page }) => {
  await boot(page, 'app.js', JS);
  await expect(page.locator('.cm-content')).toHaveClass(/is-code-file/);
  // `# not a heading` is a line of JavaScript here, and is left as text
  expect(await page.locator('.cm-line .cm-header, .cm-line .cm-heading').count()).toBe(0);
  // the grammar arrives and paints: a keyword and a string, in the palette
  // the reading view gives the same tokens
  await expect.poll(async () => page.locator('.cm-line span').count(), { timeout: 10000 }).toBeGreaterThan(2);
  const colours = await page.evaluate(() => [...document.querySelectorAll('.cm-line span')]
    .map((s) => getComputedStyle(s).color));
  expect(colours).toContain('rgb(213, 57, 132)'); // --code-keyword
  expect(colours).toContain('rgb(8, 185, 78)'); // --code-string
});

test('every line reads left to right, Persian inside a string included', async ({ page }) => {
  await boot(page, 'app.js', JS);
  const dirs = await page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => getComputedStyle(l).direction));
  expect(new Set(dirs)).toEqual(new Set(['ltr']));
});

test('a code file is shown in a monospace face with its line numbers', async ({ page }) => {
  await boot(page, 'app.js', JS);
  await expect(page.locator('.cm-gutters')).toBeVisible();
  const font = await page.locator('.cm-content').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font.toLowerCase()).toContain('code');
});

test('it is a text file like any other: typing works and is kept', async ({ page }) => {
  await boot(page, 'app.js', JS);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('const extra = 1;');
  await expect(page.locator('.cm-content')).toContainText('const extra = 1;');
});

test('a note is still Markdown, with everything Markdown brings', async ({ page }) => {
  await boot(page, 'note.md', '# سلام\n\n- یک\n- دو\n');
  await expect(page.locator('.cm-content')).not.toHaveClass(/is-code-file/);
  const dirs = await page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => getComputedStyle(l).direction));
  expect(dirs).toContain('rtl');
});
