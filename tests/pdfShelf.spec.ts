import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// What a document leaves behind for the next time it is opened.
//
// It used to be ten pages at a hundred pixels, so coming back to a book
// showed a smear that sharpened a beat later. He asked for the opposite
// trade: "shouldn't we make the current view good quality" -- one good
// page and a few rough ones. So the page he was on is kept at nine
// hundred pixels and its four nearest neighbours stay rough, for a flick.

const PDF = tinyPdf(8);

type Shelf = {
  keepSketches(key: string, pages: number, near: number, book: Map<number, HTMLCanvasElement>, good?: HTMLCanvasElement | null): Promise<void>;
  recallSketches(key: string, pages: number): Promise<{ page: number; canvas: HTMLCanvasElement }[]>;
  forgetSketches(): Promise<void>;
  sketchShelfBytes(): Promise<number>;
};

declare global {
  interface Window { __satr: { load(path: string): Shelf } }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

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
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: `Notes/${first as string}` }], active: 0 }));
  }, [files, open] as [Record<string, string>, string]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

async function readThis(page: Page): Promise<void> {
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });
  await expect.poll(async () => page.locator('.pdf-page canvas').count(), { timeout: 15000 }).toBeGreaterThan(0);
}

test('one page is kept properly and its neighbours roughly', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page);

  const kept = await page.evaluate(async () => {
    const shelf = window.__satr.load('/src/pdfSketchCache.ts');
    await shelf.forgetSketches();
    // A page's picture, with enough on it that the JPEG is a real size.
    const draw = (width: number, height: number, number: number): HTMLCanvasElement => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ink = canvas.getContext('2d')!;
      ink.fillStyle = '#fff';
      ink.fillRect(0, 0, width, height);
      ink.fillStyle = '#111';
      for (let line = 0; line < height / 24; line += 1) {
        ink.fillRect(width * 0.1, line * 24 + 8, width * 0.8 * ((line * 37 % 10) / 10 + 0.2), 9);
      }
      ink.fillText(String(number), 4, 12);
      return canvas;
    };
    const book = new Map<number, HTMLCanvasElement>();
    for (let page_ = 0; page_ < 10; page_ += 1) book.set(page_, draw(100, 141, page_));
    // The page he is on, as the engine drew it on a phone: 390 points at
    // three device pixels.
    await shelf.keepSketches('book', 50, 7, book, draw(1170, 1653, 7));
    const back = await shelf.recallSketches('book', 50);
    return {
      leaves: back.map((leaf) => ({ page: leaf.page, width: leaf.canvas.width })).sort((a, b) => a.page - b.page),
      bytes: await shelf.sketchShelfBytes(),
    };
  });

  // One good page and four rough ones, not ten rough ones.
  expect(kept.leaves.map((leaf) => leaf.page)).toEqual([5, 6, 7, 8, 9]);
  const good = kept.leaves.find((leaf) => leaf.page === 7)!;
  expect(good.width).toBe(900);
  for (const leaf of kept.leaves) if (leaf.page !== 7) expect(leaf.width).toBe(100);
  // And the whole shelf is still a shelf, not a document store.
  expect(kept.bytes).toBeLessThan(400_000);
});

test('a page recalled sharp is not filed away again as a sketch', async ({ page }) => {
  // The sharp page goes back into the view's sketch book at its own size
  // and sits there until the engine redraws it. If the reader moves on and
  // the view is torn down in between, that canvas is one of the rough
  // neighbours -- and it must be shrunk like any other, or the shelf grows
  // a full-size page every time a document is opened and closed.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page);

  const widths = await page.evaluate(async () => {
    const shelf = window.__satr.load('/src/pdfSketchCache.ts');
    await shelf.forgetSketches();
    const plain = (width: number, height: number): HTMLCanvasElement => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.fillRect(0, 0, width, height);
      return canvas;
    };
    const book = new Map<number, HTMLCanvasElement>();
    book.set(0, plain(100, 141));
    book.set(1, plain(900, 1270)); // recalled sharp last time, still sitting there
    book.set(2, plain(100, 141));
    await shelf.keepSketches('book', 50, 0, book, plain(1170, 1653));
    const back = await shelf.recallSketches('book', 50);
    return back.sort((a, b) => a.page - b.page).map((leaf) => leaf.canvas.width);
  });

  expect(widths).toEqual([900, 100, 100]);
});

test('closing a document leaves a picture of the page behind, not a smear', async ({ page }) => {
  // The wiring: the view has to hand its own drawn page over. Measured on
  // this document, whose pages are nearly blank and so flatter the old
  // shelf: ten sketches of it weigh 7.9 kB all told, the new shelf 14.3,
  // of which the one good page is 11.1 on its own. So the gate sits
  // between them at 9.5 -- a sixth clear of each, and the only way under
  // it is a shelf with no real page on it.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page);
  await page.waitForTimeout(900); // the page drawn properly, not just placed

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => page.evaluate(() => window.__satr.load('/src/pdfSketchCache.ts').sketchShelfBytes()), { timeout: 8000 })
    .toBeGreaterThan(9_500);
});
