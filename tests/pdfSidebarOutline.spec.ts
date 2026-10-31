import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

/** The outline panel is where the app answers "where am I" for a note. A PDF
 *  kept its contents to itself, in the viewer's own panel, and the outline
 *  stayed empty: both now show it. */
async function bootPdf(page: Page, pdf: string): Promise<void> {
  await page.addInitScript((bytes) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/book.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/book.pdf', bytes as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/book.pdf' }], active: 0 }));
  }, pdf);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(600);
}

async function openOutline(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+f');
  await expect(page.locator('body')).toHaveClass(/outline-open/);
  await page.waitForTimeout(700);
}

test('the contents of a document fill the outline panel', async ({ page }) => {
  await bootPdf(page, tinyPdf(6, [], ['Opening', 'Middle', 'The end']));
  await openOutline(page);
  const rows = page.locator('.outline-pane .tree-item-self, #right-panel .tree-item-self');
  await expect(rows).toHaveCount(3, { timeout: 15000 });
  await expect(rows.nth(0)).toContainText('Opening');
  // A document is counted in pages, not in words.
  await expect(page.locator('#right-panel')).toContainText('6 pages');
  await expect(page.locator('#right-panel')).not.toContainText('0 words');
  await expect(rows.nth(2)).toContainText('The end');
});

test('a row of the outline turns the document to its page', async ({ page }) => {
  await bootPdf(page, tinyPdf(6, [], ['Opening', 'Middle', 'The end']));
  await openOutline(page);
  const rows = page.locator('#right-panel .tree-item-self');
  await expect(rows).toHaveCount(3, { timeout: 15000 });
  await rows.nth(2).click();
  await page.waitForTimeout(900);
  const page3 = await page.locator('.pdf-page[data-page="3"]').boundingBox();
  expect(page3!.y).toBeLessThan(300);
  // The viewer keeps its own contents button: both ways in still work.
  await expect(page.locator('.pdf-toolbar-button[aria-label="Table of contents"]')).toBeVisible();
});

test('a document with no bookmarks shows the contents read off its type', async ({ page }) => {
  const { typesetPdf } = await import('./support/tinyPdf');
  await bootPdf(page, typesetPdf([
    { chapter: 'First chapter', body: 'Some words on this page, enough to be a page of a book.' },
    { section: 'A section', body: 'More words again, enough to be a page of a book as well.' },
  ]));
  await openOutline(page);
  await expect(page.locator('#right-panel')).toContainText('First chapter', { timeout: 20000 });
  await expect(page.locator('#right-panel')).toContainText('A section');
});

test('the panel searches the document, and a result turns to its page', async ({ page }) => {
  await bootPdf(page, tinyPdf(6, [], ['Opening', 'Middle', 'The end']));
  await openOutline(page);
  const box = page.locator('#right-panel input.vault-search');
  await expect(box).toHaveAttribute('placeholder', 'Search this document');
  await box.fill('Page 4');
  await expect(page.locator('#right-panel .search-result-file-match')).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator('#right-panel')).toContainText('1 result');
  // A result reads as the text it was found in, with the word marked.
  await expect(page.locator('#right-panel .search-result-file-matched-text')).toHaveText('Page 4');
  await expect(page.locator('#right-panel .search-result-line-number').first()).toHaveText('4');
  await expect(page.locator('#right-panel [data-scope="note"]')).toHaveText('This document');
  await page.locator('#right-panel .search-result-file-match').first().click();
  await page.waitForTimeout(900);
  const found = await page.locator('.pdf-page[data-page="4"]').boundingBox();
  expect(found!.y).toBeLessThan(400);
});

test('a result sits under the heading it was found under', async ({ page }) => {
  // A note's results sit in the tree, under the section each one is in,
  // with a count on the heading. A document's were a flat list of rows
  // above the contents, each labelled with a page number -- which says
  // where every match is and nothing about what any of them is part of.
  await bootPdf(page, tinyPdf(6, [], ['Opening', 'Middle', 'The end']));
  await openOutline(page);
  await page.locator('#right-panel input.vault-search').fill('Page');
  await expect(page.locator('#right-panel .search-result-file-match')).toHaveCount(6, { timeout: 15000 });
  // every row is inside a section of the tree, not loose above it
  const loose = await page.locator('#right-panel .outline-tree > .search-result-file-matches .search-result-file-match').count();
  expect(loose).toBe(0);
  // and the heading above a row is the one whose pages it falls in
  const filed = await page.evaluate(() => {
    const out: string[] = [];
    for (const row of document.querySelectorAll('#right-panel .search-result-file-match')) {
      const under = row.closest('.tree-item-children')?.previousElementSibling;
      out.push(`${under?.querySelector('.tree-item-inner')?.textContent} <- page ${row.querySelector('.search-result-line-number')?.textContent}`);
    }
    return out;
  });
  // this document's three bookmarks name pages 1, 2 and 3, so everything
  // from page three on belongs to the last of them
  expect(filed).toEqual([
    'Opening <- page 1',
    'Middle <- page 2',
    'The end <- page 3', 'The end <- page 4', 'The end <- page 5', 'The end <- page 6',
  ]);
  // a heading says how many are under it, as a note's does
  const flairs = await page.locator('#right-panel .tree-item-flair').allTextContents();
  expect(flairs).toEqual(['1', '1', '4']);
});

test('a paper written by LaTeX has contents that can be followed', async ({ page }) => {
  // hyperref writes a GoTo action rather than a destination, so these rows
  // named no page at all and went nowhere when tapped.
  await bootPdf(page, tinyPdf(6, [], ['Introduction', 'Background', 'Results'], true));
  await openOutline(page);
  const rows = page.locator('#right-panel .tree-item-self');
  await expect(rows).toHaveCount(3, { timeout: 15000 });
  await rows.nth(2).click();
  await page.waitForTimeout(900);
  const third = await page.locator('.pdf-page[data-page="3"]').boundingBox();
  expect(third!.y).toBeLessThan(300);
});
