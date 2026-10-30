import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// Obsidian's PDF chrome: a strip of controls across the top and a panel
// that slides in over the pages. Its own class names, its own control
// order, and the two panel widths its phone layout uses.

test.use({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2 });

const PDF = tinyPdf(8);
const NOTE = '# a note\n\nwith a line in it\n';

async function boot(page: Page, open: string): Promise<void> {
  await page.addInitScript(([pdf, note, first]) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: { 'Notes/handout.pdf': 1, 'Notes/note.md': 1 }, folders: ['Notes'],
    }));
    localStorage.setItem('satr:fs:file:Notes/handout.pdf', pdf as string);
    localStorage.setItem('satr:fs:file:Notes/note.md', note as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: `Notes/${first as string}` }], active: 0 }));
  }, [PDF, NOTE, open] as [string, string, string]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}
const ready = async (page: Page): Promise<void> => {
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(600);
};
const control = (page: Page, label: string) => page.locator(`.pdf-toolbar-button[aria-label="${label}"]`);
const pageWidth = async (page: Page): Promise<number> =>
  Math.round((await page.locator('.pdf-page[data-page="1"]').boundingBox())!.width);

test('a document gets the strip of controls, in Obsidian\'s own order', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await expect(page.locator('.pdf-toolbar')).toBeVisible();
  for (const label of ['Toggle sidebar', 'Sidebar options', 'Zoom out', 'Zoom in', 'Display options']) {
    await expect(control(page, label)).toBeVisible();
  }
  await expect(page.locator('.pdf-page-numbers')).toHaveText('of 8');
  // left group is the panel, right group is zoom and the page
  const order = await page.evaluate(() => [...document.querySelectorAll('.pdf-toolbar [aria-label], .pdf-toolbar input, .pdf-toolbar span')]
    .map((el) => el.getAttribute('aria-label') ?? el.className));
  expect(order).toEqual(['Toggle sidebar', 'Sidebar options', 'Zoom out', 'Zoom in', 'Display options', 'Page', 'pdf-page-numbers']);

  await boot(page, 'note.md');
  await expect(page.locator('.pdf-toolbar')).toHaveCount(0); // a note has no document chrome
});

test('the strip sits under the file\'s header, and the pages under both', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const bar = (await page.locator('.topbar').boundingBox())!;
  const strip = (await page.locator('.pdf-toolbar').boundingBox())!;
  const first = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!;
  expect(Math.round(strip.y)).toBe(Math.round(bar.y + bar.height)); // no seam
  expect(first.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1); // nothing behind either
});

test('the panel lies over the pages, with a thumbnail for every page', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await expect(page.locator('.pdf-sidebar-container')).toBeHidden();
  await control(page, 'Toggle sidebar').click();
  await expect(page.locator('.pdf-sidebar-container')).toBeVisible();
  await expect(page.locator('.thumbnail')).toHaveCount(8);
  await expect(page.locator('.thumbnail[data-loaded]')).toHaveCount(8, { timeout: 20000 });
  // over the pages, not beside them: the column did not move
  const panel = (await page.locator('.pdf-sidebar-container').boundingBox())!;
  const first = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!;
  expect(Math.round(panel.width)).toBe(140); // the phone width Obsidian uses
  expect(first.x).toBeLessThan(panel.x + panel.width);
  // the page being read is the one marked
  await expect(page.locator('.thumbnail[data-page="1"]')).toHaveClass(/selected/);
  // and tapping one goes there and gets out of the way
  await page.locator('.thumbnail[data-page="6"]').click();
  await page.waitForTimeout(600);
  await expect(page.locator('.pdf-sidebar-container')).toBeHidden();
  await expect(page.locator('.pdf-counter')).toHaveText('6 / 8');
});

test('the panel\'s second view is the table of contents', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await control(page, 'Sidebar options').click();
  await page.locator('.menu-item', { hasText: /^Table of contents$/ }).click();
  await expect(page.locator('.pdf-outline-view')).toBeVisible();
  await expect(page.locator('.pdf-thumbnail-view')).toBeHidden();
  // Obsidian widens the panel for it: 275px against the thumbnails' 140px
  expect(Math.round((await page.locator('.pdf-sidebar-container').boundingBox())!.width)).toBe(275);
  // this document has no bookmarks in it, and it says so rather than sitting empty
  await expect(page.locator('.pdf-outline-empty')).toHaveText('No table of contents');
});

test('the page box says where you are and takes you where you ask', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const box = page.locator('.pdf-page-input');
  await expect(box).toHaveValue('1');
  await box.fill('5');
  await box.press('Enter');
  await page.waitForTimeout(600);
  await expect(page.locator('.pdf-counter')).toHaveText('5 / 8');
  await expect(box).toHaveValue('5');
  // and it follows the reader back
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, -4000);
  await page.waitForTimeout(800);
  await expect(box).toHaveValue('1');
});

test('zoom out and zoom in step the page', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const fit = await pageWidth(page);
  await control(page, 'Zoom in').click();
  await page.waitForTimeout(500);
  const bigger = await pageWidth(page);
  expect(bigger).toBeGreaterThan(fit);
  await control(page, 'Zoom out').click();
  await page.waitForTimeout(500);
  expect(await pageWidth(page)).toBe(fit); // a step out undoes a step in
});
