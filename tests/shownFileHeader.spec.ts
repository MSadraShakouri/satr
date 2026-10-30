import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// A file that is shown rather than read — a PDF, a picture, an HTML page —
// carries its name in the chrome, and so keeps that chrome on screen. This
// is the line Obsidian draws: its auto-full-screen is wired into the two
// markdown views and nothing else, so only a note ever scrolls its header
// away. A note still does, in reading view as well as in source.

const PDF = tinyPdf(8);
const LONG = `# note\n\n${'a line of the note\n\n'.repeat(120)}`;

async function boot(page: Page, files: Record<string, string>, open: string): Promise<void> {
  await page.addInitScript(([seed, first]) => {
    const vault = seed as Record<string, string>;
    const names = Object.keys(vault);
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: Object.fromEntries(names.map((name) => [`Notes/${name}`, 1])),
      folders: ['Notes'],
    }));
    for (const name of names) localStorage.setItem(`satr:fs:file:Notes/${name}`, vault[name]);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: `Notes/${first as string}` }], active: 0 }));
  }, [files, open] as [Record<string, string>, string]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

const hidden = (page: Page) => page.evaluate(() => document.body.classList.contains('is-hidden-nav'));

/** Scroll the reading pane the way a reader does. A wheel over the pane,
 *  not an assignment to scrollTop: the bars answer to the reader's own
 *  movement, and a pane that has not been laid out yet ignores the
 *  assignment outright. */
async function scrollPane(page: Page, steps: number): Promise<void> {
  await page.mouse.move(195, 400);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(400);
  }
}

test('a document keeps its header however far it is scrolled', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  expect(await hidden(page)).toBe(false);
  await scrollPane(page, 3);
  // the pane really moved — otherwise this proves nothing
  expect(await page.evaluate(() => document.querySelector('.preview-pane')?.scrollTop ?? 0)).toBeGreaterThan(600);
  expect(await hidden(page)).toBe(false);
});

test('a note still hides the bars in reading view, not only in source', async ({ page }) => {
  await boot(page, { 'note.md': LONG }, 'note.md');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('.preview-pane article')).toBeVisible();
  expect(await hidden(page)).toBe(false);
  await scrollPane(page, 3);
  expect(await hidden(page)).toBe(true);
});

test('opening a shown file brings the chrome back', async ({ page }) => {
  await boot(page, { 'note.md': LONG, 'handout.pdf': PDF }, 'note.md');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('.preview-pane article')).toBeVisible();
  await scrollPane(page, 3);
  expect(await hidden(page)).toBe(true);
  // the open file changes: the header is back, and nothing in the document
  // will ever report a scroll that could bring it back later.
  // The navbar has slid away by now, which is exactly the condition under
  // test, so reach the control the handler is bound to rather than the
  // place on screen where it used to be.
  await page.locator('#files').dispatchEvent('click');
  await page.locator('.nav-file-title', { hasText: 'handout.pdf' }).click();
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  expect(await hidden(page)).toBe(false);
});
