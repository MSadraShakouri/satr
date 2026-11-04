import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// What a tab's card costs to draw.
//
// Reported: "pressing the tabs button when there's a pdf open is really
// slow, I think it's trying to do something for the pdf". It was: it read
// the whole file and decoded it to text to put a line and a half of
// markdown on the card -- 31 MB and forty-one million characters, for a
// picture the size of a postage stamp.

const PDF = tinyPdf(12);

declare global {
  interface Window {
    __satr: { load(path: string): { backend: { read(path: string): Promise<string | null> } } };
    __reads?: string[];
  }
}

test.use({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

async function boot(page: Page, files: Record<string, string>, open: string): Promise<void> {
  await page.addInitScript(([seed, first]) => {
    const vault = seed as Record<string, string>;
    const names = Object.keys(vault);
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: Object.fromEntries(names.map((name) => [`Notes/${name}`, 1])),
      folders: ['Notes'],
    }));
    for (const name of names) localStorage.setItem(`satr:fs:file:Notes/${name}`, vault[name]);
    localStorage.setItem('satr:demoShown', '1');
    if (!localStorage.getItem('satr:tabs')) {
      localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: `Notes/${first as string}` }], active: 0 }));
    }
  }, [files, open] as [Record<string, string>, string]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

async function readThis(page: Page): Promise<void> {
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });
  await expect.poll(async () => page.locator('.pdf-page canvas').count(), { timeout: 15000 }).toBeGreaterThan(0);
}

test('opening the tab switcher with a book open does not read the book', async ({ page }) => {
  await boot(page, { 'book.pdf': PDF, 'notes.md': '# Notes\n\nsome words\n' }, 'book.pdf');
  await readThis(page);

  // Count what the vault is asked to read, from here on.
  await page.evaluate(() => {
    const vault = window.__satr.load('/src/vault.ts');
    window.__reads = [];
    const was = vault.backend.read.bind(vault.backend);
    vault.backend.read = (path: string) => { window.__reads!.push(path); return was(path); };
  });

  await page.locator('#nav-tabs').dispatchEvent('click');
  await expect(page.locator('.mobile-tab-switcher')).toBeVisible();
  await page.waitForTimeout(600);

  const reads = await page.evaluate(() => window.__reads ?? []);
  // The card for a document is a picture we already had, or its name. The
  // one thing it must never be is the file: that read was 31 MB decoded
  // into a 41-million-character string, which is why this was slow.
  expect(reads.filter((path) => path.endsWith('.pdf')), 'the pdf was not read for a card').toEqual([]);
});

test('a document that has been read shows the page it was left on', async ({ page }) => {
  await boot(page, { 'book.pdf': PDF }, 'book.pdf');
  await readThis(page);
  // Down a few pages, then let the reader put its sketches down -- which is
  // what also files the card.
  await page.locator('#preview-pane').evaluate((pane) => { pane.scrollTop += pane.clientHeight * 3; });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(600);

  await page.locator('#nav-tabs').dispatchEvent('click');
  await expect(page.locator('.mobile-tab-switcher')).toBeVisible();
  const card = page.locator('.mobile-tab-preview-page .tab-card-page');
  await expect(card, 'the card is a picture of the page').toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('.mobile-tab-preview-page .tab-card-note')).toContainText(/Page \d+ of 12/);
  // A real picture, not a broken one.
  expect(await card.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});
