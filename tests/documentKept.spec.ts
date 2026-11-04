import { expect, test, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// Coming back to a document's tab must not read the file again. On the
// author's phone a 2.2MB pdf took 240ms to read and was re-read on every
// switch; it is per byte, so his 31MB book is seconds of it.

const PDF = tinyPdf(6);

declare global {
  interface Window {
    __satr: { load(path: string): { lines(): { area: string; text: string; facts?: Record<string, unknown> }[]; forget(): void } };
  }
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript((pdf: string) => {
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/doc.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n\nwords\n');
    localStorage.setItem('satr:fs:file:Notes/doc.pdf', pdf);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/doc.pdf' }, { path: 'Notes/A.md' }], active: 0 }));
  }, PDF);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.waitForSelector('.pdf-page canvas', { timeout: 30_000 });
}

async function switchTo(page: Page, name: string): Promise<void> {
  await page.locator('#nav-tabs').evaluate((el) => (el as HTMLElement).click());
  await page.locator('.mobile-tab-title').getByText(name, { exact: true }).click();
  await page.waitForTimeout(700);
}

const pdfLines = (page: Page) => page.evaluate(() =>
  window.__satr.load('/src/log.ts').lines().filter((line) => line.area === 'pdf').map((line) => `${line.text} ${JSON.stringify(line.facts ?? {})}`));

test.beforeEach(async ({ page }) => { await boot(page); });

test('coming back to a document does not read the file again', async ({ page }) => {
  await page.evaluate(() => window.__satr.load('/src/log.ts').forget());
  await switchTo(page, 'A');
  await switchTo(page, 'doc.pdf');
  await page.waitForSelector('.pdf-page canvas', { timeout: 30_000 });
  const lines = await pdfLines(page);
  expect(lines.filter((line) => line.startsWith('bytes read')), 'the file is not read a second time').toHaveLength(0);
  expect(lines.filter((line) => line.startsWith('bytes kept')), 'and the log says why it was quick').toHaveLength(1);
  expect(lines.some((line) => line.startsWith('document parsed')), 'the document is still opened').toBe(true);
});

test('a document replaced on disk is read again, not served from memory', async ({ page }) => {
  await page.evaluate(() => window.__satr.load('/src/log.ts').forget());
  await switchTo(page, 'A');
  // The same path, a different file: the vault's index carries the modified
  // time, so this is what a document replaced underneath the app looks like.
  await page.evaluate((pdf: string) => {
    // The vault reads its index once and keeps it, so a replacement has to
    // reach the live one -- the same thing a file changing on disk does.
    const vault = window.__satr.load('/src/vault.ts') as unknown as { backend: { index: { files: Record<string, number> } } };
    vault.backend.index.files['Notes/doc.pdf'] = Date.now() + 1000;
    localStorage.setItem('satr:fs:file:Notes/doc.pdf', pdf);
  }, tinyPdf(3));
  await switchTo(page, 'doc.pdf');
  await page.waitForTimeout(600);
  const lines = await pdfLines(page);
  expect(lines.filter((line) => line.startsWith('bytes read')), 'a changed file is read').toHaveLength(1);
  expect(lines.filter((line) => line.startsWith('bytes kept'))).toHaveLength(0);
});

test('the first open still reads it, and says so', async ({ page }) => {
  const lines = await pdfLines(page);
  expect(lines.filter((line) => line.startsWith('bytes read'))).toHaveLength(1);
  expect(lines.filter((line) => line.startsWith('bytes kept'))).toHaveLength(0);
});
