import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// Obsidian's PDF toolbar carries a ▾ of display options: the two zoom stops
// and "Adapt to theme". We have no toolbar and are not growing one, so they
// live in the ⋮ a shown file already has. Its pages are A4, 595×842.

test.use({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2 });

const PDF = tinyPdf(6);
const NOTE = '# a note\n\nwith a line in it\n';

async function boot(page: Page, open: string, theme?: 'dark'): Promise<void> {
  await page.addInitScript(([pdf, note, dark]) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: { 'Notes/handout.pdf': 1, 'Notes/note.md': 1 }, folders: ['Notes'],
    }));
    localStorage.setItem('satr:fs:file:Notes/handout.pdf', pdf as string);
    localStorage.setItem('satr:fs:file:Notes/note.md', note as string);
    if (dark) localStorage.setItem('satr:theme', 'dark');
  }, [PDF, NOTE, theme === 'dark'] as [string, string, boolean]);
  await page.addInitScript((first) => {
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: `Notes/${first as string}` }], active: 0 }));
  }, open);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

const openDocument = async (page: Page): Promise<void> => {
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
};
const option = async (page: Page, title: string): Promise<void> => {
  await page.locator('#file-actions').click();
  await page.locator('.menu-item', { hasText: title }).click();
  await page.waitForTimeout(300);
};
const pageBox = async (page: Page): Promise<{ width: number; height: number }> => {
  const box = await page.locator('.pdf-page[data-page="1"]').boundingBox();
  return { width: Math.round(box!.width), height: Math.round(box!.height) };
};

test('a document carries the display options, a note has none to carry', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await openDocument(page);
  await page.locator('#file-actions').click();
  for (const title of ['Fit width', 'Fit height', 'Adapt to theme']) {
    await expect(page.locator('.menu-item', { hasText: title })).toBeVisible();
  }
  // and the things Obsidian has that we decided against are not smuggled in
  for (const title of ['Thumbnails', 'Table of contents', 'Two-page']) {
    await expect(page.locator('.menu-item', { hasText: title })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  // a note cannot reach them at all: the ⋮ they live in is the chrome of a
  // file that is shown, and a note's chrome has no such button
  await boot(page, 'note.md');
  await expect(page.locator('#file-actions')).toBeHidden();
});

test('fit height puts a whole page on the screen, fit width fills the pane', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await openDocument(page);
  const pane = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.preview-pane')!;
    return { width: el.clientWidth, height: el.clientHeight };
  });
  // as opened: a page is as wide as the pane allows, and taller than it
  const wide = await pageBox(page);
  expect(wide.width).toBeGreaterThan(pane.width - 20);
  expect(wide.height).toBeGreaterThan(pane.height - 200);

  await option(page, 'Fit height');
  const tall = await pageBox(page);
  // the whole page is on the screen at once, under the header
  expect(tall.height).toBeLessThanOrEqual(pane.height - 60);
  expect(tall.height).toBeGreaterThan(pane.height - 200);
  expect(tall.width).toBeGreaterThan(wide.width); // A4 is wider than the screen at that height

  await option(page, 'Fit width');
  expect((await pageBox(page)).width).toBe(wide.width); // all the way back
});

test('the stop a page is sitting at is the one that is ticked', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await openDocument(page);
  await page.locator('#file-actions').click();
  await expect(page.locator('.menu-item', { hasText: 'Fit width' })).toHaveClass(/mod-selected/);
  await expect(page.locator('.menu-item', { hasText: 'Fit height' })).not.toHaveClass(/mod-selected/);
  await page.keyboard.press('Escape');
  await option(page, 'Fit height');
  await page.locator('#file-actions').click();
  await expect(page.locator('.menu-item', { hasText: 'Fit height' })).toHaveClass(/mod-selected/);
  await expect(page.locator('.menu-item', { hasText: 'Fit width' })).not.toHaveClass(/mod-selected/);
});

test('adapt to theme turns the paper over, and only in the dark', async ({ page }) => {
  const inked = () => page.evaluate(() => getComputedStyle(document.querySelector('.pdf-raster')!).filter);
  await boot(page, 'handout.pdf'); // light
  await openDocument(page);
  expect(await inked()).toBe('none');
  await option(page, 'Adapt to theme');
  expect(await inked()).toBe('none'); // adapting to a light theme leaves the paper alone
  await expect(page.locator('body')).toHaveClass(/is-pdf-themed/);

  await boot(page, 'handout.pdf', 'dark');
  await openDocument(page);
  // the flag was remembered, the way Obsidian remembers its own
  await expect(page.locator('body')).toHaveClass(/is-pdf-themed/);
  expect(await inked()).toContain('invert');
  await option(page, 'Adapt to theme');
  expect(await inked()).toBe('none');
});
