import { expect, test, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// A note whose file has gone closes its own tab. A pdf's tab did not: it
// stayed open around an empty frame, which is what skipping the read cost
// when a document stopped being read as text ("that is the one thing the
// fix changed that was not the bug").

const PDF = tinyPdf(6);

declare global {
  interface Window {
    __satr: { load(path: string): { backend: { index: { files: Record<string, number> } } } };
  }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

async function boot(page: Page, tabs: { path: string }[], active = 0): Promise<void> {
  await page.addInitScript(([pdf, open]: [string, string]) => {
    // Once, not on every navigation: one of these tests reloads after
    // deleting a file, and a second seeding would put it back.
    if (localStorage.getItem('satr:spec:seeded')) return;
    localStorage.setItem('satr:spec:seeded', '1');
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:demoShown', '1'); // not the first run: no tour
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/doc.pdf': 1, 'Notes/B.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n\nwords\n');
    localStorage.setItem('satr:fs:file:Notes/B.md', '# B\n\nmore words\n');
    localStorage.setItem('satr:fs:file:Notes/doc.pdf', pdf);
    localStorage.setItem('satr:tabs', open);
  }, [PDF, JSON.stringify({ tabs, active })] as [string, string]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

async function switchTo(page: Page, name: string): Promise<void> {
  await page.locator('#nav-tabs').evaluate((el) => (el as HTMLElement).click());
  await page.locator('.mobile-tab-title').getByText(name, { exact: true }).click();
  await page.waitForTimeout(800);
}

/** Delete a file the way the world deletes one: behind the app's back. The
 *  vault reads its index once and keeps it, so the live one is the file
 *  system as far as the app is concerned. */
async function deleteFile(page: Page, path: string): Promise<void> {
  await page.evaluate((gone: string) => {
    delete window.__satr.load('/src/vault.ts').backend.index.files[gone];
    localStorage.removeItem(`satr:fs:file:${gone}`);
  }, path);
}

const tabNames = (page: Page) => page.locator('.mobile-tab-title').allTextContents();

test('a pdf that has gone closes its own tab', async ({ page }) => {
  await boot(page, [{ path: 'Notes/doc.pdf' }, { path: 'Notes/A.md' }], 1);
  await expect(page.locator('.cm-file-name')).toBeVisible();
  await deleteFile(page, 'Notes/doc.pdf');
  await switchTo(page, 'doc.pdf');
  // The tab is gone and so is its entry in the switcher; the reader is left
  // on a file that still exists rather than in front of nothing.
  await page.locator('#nav-tabs').evaluate((el) => (el as HTMLElement).click());
  expect(await tabNames(page), 'the pdf tab closed behind it').toEqual(['A']);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pdf-page canvas')).toHaveCount(0);
});

test('the last tab becomes the empty tab rather than an empty frame', async ({ page }) => {
  // Nothing in the vault but the document, so there is no other note for the
  // app to fall back on: either the tab becomes the empty tab or the reader
  // is left looking at a frame with nothing in it.
  await page.addInitScript((pdf: string) => {
    if (localStorage.getItem('satr:spec:seeded')) return;
    localStorage.setItem('satr:spec:seeded', '1');
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:demoShown', '1'); // not the first run: no tour
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/doc.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/doc.pdf', pdf);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/doc.pdf' }], active: 0 }));
  }, PDF);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.waitForSelector('.pdf-page canvas', { timeout: 30_000 });
  // Deleted from somewhere else and the app opened again: the only tab it
  // has points at a file that is not there.
  await page.evaluate(() => {
    const index = JSON.parse(localStorage.getItem('satr:fs:index') ?? '{}') as { files: Record<string, number> };
    delete index.files['Notes/doc.pdf'];
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    localStorage.removeItem('satr:fs:file:Notes/doc.pdf');
  });
  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  await expect(page.locator('.empty-state-title')).toHaveText('No file is open');
});

test('a note that has gone still closes its tab', async ({ page }) => {
  await boot(page, [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }], 1);
  await expect(page.locator('.cm-file-name')).toBeVisible();
  await deleteFile(page, 'Notes/A.md');
  await switchTo(page, 'A');
  await page.locator('#nav-tabs').evaluate((el) => (el as HTMLElement).click());
  expect(await tabNames(page), 'the note tab closed, as it always has').toEqual(['B']);
});

test('a pdf that is still there keeps its tab', async ({ page }) => {
  await boot(page, [{ path: 'Notes/doc.pdf' }, { path: 'Notes/A.md' }], 1);
  await expect(page.locator('.cm-file-name')).toBeVisible();
  await switchTo(page, 'doc.pdf');
  await page.waitForSelector('.pdf-page canvas', { timeout: 30_000 });
  await page.locator('#nav-tabs').evaluate((el) => (el as HTMLElement).click());
  expect(await tabNames(page), 'the asking must not cost the tab').toEqual(['doc.pdf', 'A']);
});
