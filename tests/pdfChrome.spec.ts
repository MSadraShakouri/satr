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
  for (const label of ['Thumbnails', 'Table of contents', 'Zoom out', 'Zoom in', 'Display options']) {
    await expect(control(page, label)).toBeVisible();
  }
  await expect(page.locator('.pdf-page-numbers')).toHaveText('of 8');
  // left group is the panel, right group is zoom and the page
  const order = await page.evaluate(() => [...document.querySelectorAll('.pdf-toolbar [aria-label], .pdf-toolbar input, .pdf-toolbar span')]
    .map((el) => el.getAttribute('aria-label') ?? el.className));
  expect(order).toEqual(['Thumbnails', 'Table of contents', 'Find in document', 'Zoom out', 'Zoom in',
    'Display options', 'Page', 'pdf-page-numbers']);

  await boot(page, 'note.md');
  await expect(page.locator('.pdf-toolbar')).toHaveCount(0); // a note has no document chrome
});

test('the strip sits under the file\'s header, and the pages under both', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const bar = (await page.locator('.topbar').boundingBox())!;
  const strip = (await page.locator('.pdf-toolbar').boundingBox())!;
  const first = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!;
  // The strip is the header's second line, inside it: a seam is not possible
  // because there is only one element painting the glass.
  expect(await page.evaluate(() => document.querySelector('.pdf-toolbar')!.parentElement!.className)).toBe('topbar');
  expect(Math.round(strip.y + strip.height)).toBe(Math.round(bar.y + bar.height));
  expect(first.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1); // nothing behind either
});

test('the panel lies over the pages, with a thumbnail for every page', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await expect(page.locator('.pdf-sidebar-container')).toBeHidden();
  await control(page, 'Thumbnails').click();
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
  await control(page, 'Table of contents').click();
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

test('find marks every match and walks them', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await expect(page.locator('.pdf-findbar')).toBeHidden();
  await control(page, 'Find in document').click();
  await expect(page.locator('.pdf-findbar')).toBeVisible();
  // every page of this document says "Page", so there is one hit per page
  await page.locator('.pdf-findbar input').fill('Page');
  await expect(page.locator('.pdf-find-results-count')).toHaveText('1 of 8', { timeout: 15000 });
  await expect(page.locator('.pdf-find-hit')).toHaveCount(8);
  await expect(page.locator('.pdf-find-hit.is-current')).toHaveCount(1);
  // and a mark is actually painted: the colours here are Satr's own, and a
  // name borrowed from the app being mimicked would leave a box of nothing
  const paint = await page.evaluate(() => {
    const el = document.querySelector('.pdf-find-hit')!;
    const seen = getComputedStyle(el);
    return { fill: seen.backgroundColor, wide: Math.round(el.getBoundingClientRect().width) };
  });
  expect(paint.fill).not.toBe('rgba(0, 0, 0, 0)');
  expect(paint.wide).toBeGreaterThan(4);
  // the arrows walk them, and the document follows
  await control(page, 'Next match').click();
  await expect(page.locator('.pdf-find-results-count')).toHaveText('2 of 8');
  await page.waitForTimeout(500);
  await expect(page.locator('.pdf-counter')).toHaveText('2 / 8');
  // a word that is not there says so rather than going quiet
  await page.locator('.pdf-findbar input').fill('zzzzz');
  await expect(page.locator('.pdf-find-results-count')).toHaveText('No matches', { timeout: 15000 });
  await expect(page.locator('.pdf-find-hit')).toHaveCount(0);
  // and closing it puts the page back the way it was
  await control(page, 'Close find').click();
  await expect(page.locator('.pdf-findbar')).toBeHidden();
  await expect(page.locator('.pdf-toolbar')).toBeVisible();
});

test('the two left buttons are two buttons, each saying whether its view is up', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const lit = () => page.evaluate(() => ['Thumbnails', 'Table of contents'].map((label) =>
    document.querySelector(`.pdf-toolbar-button[aria-label="${label}"]`)!.classList.contains('is-active')));
  expect(await lit()).toEqual([false, false]); // panel shut: neither view is up

  await control(page, 'Thumbnails').click();
  await page.waitForTimeout(350);
  await expect(page.locator('.pdf-thumbnail-view')).toBeVisible();
  expect(await lit()).toEqual([true, false]);

  // the other button swaps the view rather than shutting anything
  await control(page, 'Table of contents').click();
  await page.waitForTimeout(350);
  await expect(page.locator('.pdf-outline-view')).toBeVisible();
  expect(await lit()).toEqual([false, true]);

  // and the button for the view already up puts it away
  await control(page, 'Table of contents').click();
  await page.waitForTimeout(350);
  await expect(page.locator('.pdf-sidebar-container')).toBeHidden();
  expect(await lit()).toEqual([false, false]);
});

test('the contents are read from the document, when the document has any', async ({ page }) => {
  // Every browser's print-to-PDF writes no outline dictionary at all, so a
  // file exported from a note app has nothing for a viewer to show. Given a
  // document that does carry one, this panel shows it.
  await page.addInitScript((pdf) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/book.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/book.pdf', pdf as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/book.pdf' }], active: 0 }));
  }, tinyPdf(4, [], ['Opening', 'Middle', 'The end']));
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await ready(page);
  await control(page, 'Table of contents').click();
  await expect(page.locator('.pdf-outline-view .tree-item-self')).toHaveCount(3);
  await expect(page.locator('.pdf-outline-view')).toContainText('Opening');
  await expect(page.locator('.pdf-outline-view')).toContainText('The end');
  await expect(page.locator('.pdf-outline-empty')).toHaveCount(0);
});

test('the thumbnails do not slide sideways under a thumb', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await control(page, 'Thumbnails').click();
  await page.waitForTimeout(400);
  const pan = await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('.pdf-thumbnail-view')!;
    view.scrollLeft = 200;
    return { left: view.scrollLeft, overflowX: getComputedStyle(view).overflowX };
  });
  expect(pan.overflowX).toBe('hidden');
  expect(pan.left).toBe(0);
});

test('the strip and the panel ride the drawer, and the switcher comes up over them', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await control(page, 'Thumbnails').click();
  await page.waitForTimeout(350);
  const where = () => page.evaluate(() => ['.topbar', '.pdf-toolbar', '.pdf-sidebar-container']
    .map((sel) => Math.round(document.querySelector(sel)!.getBoundingClientRect().x)));
  const home = await where();
  await page.locator('#files').dispatchEvent('click');
  await page.waitForTimeout(700);
  const moved = await where();
  const slid = moved[0] - home[0];
  expect(slid).toBeGreaterThan(0);                   // the header slid
  expect(moved[1] - home[1]).toBe(slid);             // the strip is part of it
  expect(moved[2] - home[2]).toBe(slid);             // and the panel went too

  await page.locator('#backdrop').dispatchEvent('click');
  await page.waitForTimeout(700);
  await control(page, 'Display options').click();
  await page.waitForTimeout(350);
  // the sheet used to open underneath the panel, which left half of it
  // unreachable: the panel sat at z-index 100 and the sheet at 41.
  const top = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('.menu')!;
    const at = menu.getBoundingClientRect();
    const hit = document.elementsFromPoint(at.x + at.width / 2, at.y + 20)[0];
    return { inMenu: !!hit.closest('.menu'), what: hit.className };
  });
  expect(top.inMenu).toBe(true); // nothing of the panel is in front of it
});

test('the header and the strip are one pane of glass', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const look = await page.evaluate(() => {
    const strip = getComputedStyle(document.querySelector('.pdf-toolbar')!);
    const bar = getComputedStyle(document.querySelector('.topbar')!);
    return { stripTint: strip.backgroundColor, stripBlur: strip.backdropFilter,
      barTint: bar.backgroundColor, barBlur: bar.backdropFilter,
      height: Math.round(document.querySelector('.topbar')!.getBoundingClientRect().height) };
  });
  // the strip paints nothing of its own: one surface, so no line can appear
  // between them whatever is behind
  expect(look.stripTint).toBe('rgba(0, 0, 0, 0)');
  expect(look.stripBlur).toBe('none');
  expect(look.barBlur).not.toBe('none');
  expect(look.height).toBe(104); // 12 + 44 + 8 + 40, the strip included
});
