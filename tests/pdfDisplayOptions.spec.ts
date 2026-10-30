import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// The display options Obsidian keeps on its PDF toolbar: the two zoom
// stops and "Adapt to theme". The test pages are A4, 595×842.

test.use({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2 });

const PDF = tinyPdf(6);
// Page 2 of this one is painted dark with pale ink, the way a slide deck is.
const MIXED = tinyPdf(3, [2]);
const NOTE = '# a note\n\nwith a line in it\n';

async function boot(page: Page, open: string, theme?: 'dark', doc: string = PDF): Promise<void> {
  await page.addInitScript(([pdf, note, dark]) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: { 'Notes/handout.pdf': 1, 'Notes/note.md': 1 }, folders: ['Notes'],
    }));
    localStorage.setItem('satr:fs:file:Notes/handout.pdf', pdf as string);
    localStorage.setItem('satr:fs:file:Notes/note.md', note as string);
    if (dark) localStorage.setItem('satr:theme', 'dark');
  }, [doc, NOTE, theme === 'dark'] as [string, string, boolean]);
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
  await page.locator('.pdf-toolbar-button[aria-label="Display options"]').click();
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
  await page.locator('.pdf-toolbar-button[aria-label="Display options"]').click();
  for (const title of ['Fit width', 'Fit height', 'Adapt to theme']) {
    await expect(page.locator('.menu-item', { hasText: title })).toBeVisible();
  }
  // and the things Obsidian has that we decided against are not smuggled in
  for (const title of ['Thumbnails', 'Table of contents', 'Two-page']) {
    await expect(page.locator('.menu-item', { hasText: title })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  // a note cannot reach them at all: the strip they live on belongs to a
  // document, and a note has no strip
  await boot(page, 'note.md');
  await expect(page.locator('.pdf-toolbar')).toHaveCount(0);
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
  await page.locator('.pdf-toolbar-button[aria-label="Display options"]').click();
  await expect(page.locator('.menu-item', { hasText: 'Fit width' })).toHaveClass(/mod-selected/);
  await expect(page.locator('.menu-item', { hasText: 'Fit height' })).not.toHaveClass(/mod-selected/);
  await page.keyboard.press('Escape');
  await option(page, 'Fit height');
  await page.locator('.pdf-toolbar-button[aria-label="Display options"]').click();
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

  // Dark, and nothing chosen yet: the paper is turned over without being
  // asked. Obsidian starts this off; a white page opening in a dark app is
  // the thing a reader notices and the setting is the thing they do not.
  await page.evaluate(() => localStorage.removeItem('satr:pdf-theme')); // the tap above is not this reader's
  await boot(page, 'handout.pdf', 'dark');
  await openDocument(page);
  await expect(page.locator('body')).toHaveClass(/is-pdf-themed/);
  expect(await inked()).toContain('invert');
  // and turning it off is remembered, the way Obsidian remembers its own
  await option(page, 'Adapt to theme');
  expect(await inked()).toBe('none');
  await boot(page, 'handout.pdf', 'dark');
  await openDocument(page);
  expect(await inked()).toBe('none');
});

test('the ⋮ carries adapt to theme as well, beside settings', async ({ page }) => {
  // The one setting a reader of a PDF actually goes looking for was a menu
  // deep behind an icon on the toolbar. It is still there, and it is also
  // where someone hunting for a setting opens first.
  await boot(page, 'handout.pdf', 'dark');
  await openDocument(page);
  await page.locator('#file-actions').click();
  const items = await page.locator('[role="menuitem"]').allInnerTexts();
  expect(items).toEqual(['Rename…', 'Move to…', 'Delete', 'Adapt to theme', 'Settings']);
  // on by default in the dark, and the menu says so
  await expect(page.locator('.menu-item.mod-selected')).toHaveText('Adapt to theme');

  // and it is the same switch, not a second one
  const inked = () => page.evaluate(() => getComputedStyle(document.querySelector('.pdf-raster')!).filter);
  expect(await inked()).toContain('invert');
  await page.locator('.menu-item', { hasText: 'Adapt to theme' }).click();
  await page.waitForTimeout(300);
  expect(await inked()).toBe('none');
  await page.locator('.pdf-toolbar-button[aria-label="Display options"]').click();
  await expect(page.locator('.menu-item', { hasText: 'Adapt to theme' })).not.toHaveClass(/mod-selected/);
});

test('the inversion is softened, so paper is not pitch and ink is not glare', async ({ page }) => {
  await boot(page, 'handout.pdf', 'dark');
  await openDocument(page);
  // 0.86, not 1: white paper lands on #242424 and black ink on #dbdbdb,
  // this app's own dark pairing, rather than pure black against pure white.
  const paint = await page.evaluate(() => {
    const raster = document.querySelector<HTMLElement>('.pdf-raster')!;
    const box = document.querySelector<HTMLElement>('.pdf-page')!;
    return { filter: getComputedStyle(raster).filter, box: getComputedStyle(box).backgroundColor };
  });
  expect(paint.filter).toBe('invert(0.86) hue-rotate(180deg)');
  expect(paint.box).toBe('rgb(36, 36, 36)'); // the colour white turns into, so no rim and no flash
});

test('a page that was authored dark is left alone', async ({ page }) => {
  await boot(page, 'handout.pdf', 'dark', MIXED);
  await openDocument(page);
  await page.mouse.move(195, 400);
  for (let i = 0; i < 5; i += 1) { await page.mouse.wheel(0, 200); await page.waitForTimeout(80); }
  await expect(page.locator('.pdf-page[data-page="2"] .pdf-raster')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(400);
  const marked = await page.evaluate(() => [1, 2].map((n) => {
    const box = document.querySelector<HTMLElement>(`.pdf-page[data-page="${n}"]`)!;
    return { dark: box.classList.contains('is-dark-page'),
      filter: getComputedStyle(box.querySelector<HTMLElement>('.pdf-raster')!).filter };
  }));
  // white page: turned over. dark page: inverting it would hand back the
  // white page the reader was getting away from.
  expect(marked[0].dark).toBe(false);
  expect(marked[0].filter).toContain('invert');
  expect(marked[1].dark).toBe(true);
  expect(marked[1].filter).toBe('none');
});
