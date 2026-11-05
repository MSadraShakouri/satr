import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// What a document costs while it is being read, and what the tab switcher
// costs while one is open.
//
// From his phone: six exits for low memory, two five-second freezes, and a
// resident set of 990 MB. The pictures are where that goes -- a page fitted
// to a 390-point phone at three device pixels is 7.7 MB, and the app was
// holding about seven of them, plus a tile of up to 50 MB, plus 24 MB of
// sketches. These are the bounds that replaced those, measured rather than
// asserted in a comment.

const PDF = tinyPdf(12);

declare global {
  interface Window {
    __satr: { load(path: string): {
      canvasBytes(): { canvases: number; bytes: number };
      backend: { read(path: string): Promise<string | null> };
    } };
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

const pictureMb = (page: Page): Promise<number> =>
  page.evaluate(() => window.__satr.load('/src/vitals.ts').canvasBytes().bytes / 1_000_000);

test('reading down a document does not keep every page it has been past', async ({ page }) => {
  test.slow();
  await boot(page, { 'book.pdf': PDF }, 'book.pdf');
  await readThis(page);
  const atTop = await pictureMb(page);

  // Down the whole document at a reader's pace -- half a screen at a time,
  // waiting at each stop for the band to be drawn. Going down in jumps
  // proves nothing: the pages jumped over are never drawn, so a run that
  // keeps everything looks as thrifty as one that keeps nothing.
  let worst = atTop;
  for (let step = 0; step < 24; step += 1) {
    await page.locator('#preview-pane').evaluate((pane) => { pane.scrollTop += pane.clientHeight / 2; });
    await page.waitForTimeout(420);
    worst = Math.max(worst, await pictureMb(page));
  }
  await page.waitForTimeout(800);
  const atEnd = await pictureMb(page);

  // Twelve pages at 7.7 MB each is 92 MB if nothing is let go of, and about
  // 70 at the old two-and-a-half screens. Half a screen drawn and one kept
  // is five pages at the very most, and that is what is being pinned here.
  expect(worst, `the most it ever held (${worst.toFixed(1)} MB)`).toBeLessThan(45);
  expect(atEnd, `what it holds at the end (${atEnd.toFixed(1)} MB)`).toBeLessThan(45);
  // And it is not that nothing was drawn at all.
  expect(atTop).toBeGreaterThan(1);
  expect(atEnd).toBeGreaterThan(1);
});

test('a double tap still zooms when the thread was busy between the taps', async ({ page }) => {
  await boot(page, { 'book.pdf': PDF }, 'book.pdf');
  await readThis(page);
  const width = async (): Promise<number> => (await page.locator('.pdf-page[data-page="1"]').boundingBox())?.width ?? 0;
  const before = await width();

  // Two taps 120 ms apart on the clock the browser stamps them with -- but
  // with the main thread held for 250 ms in between, so the second handler
  // does not run until long after DOUBLE_TAP_MS has passed. This is the
  // scanned-page case: a page of his scan is 65 ms a megapixel, so the
  // engine is routinely mid-draw when the second tap lands.
  await page.evaluate(() => {
    const doc = document.querySelector('.pdf-doc')!;
    const tap = (at: number): void => {
      const common = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 195, clientY: 350 };
      const up = new PointerEvent('pointerup', common);
      // The browser stamps timeStamp itself; override it to say when the
      // finger really left the glass, which is what the fix reads.
      Object.defineProperty(up, 'timeStamp', { value: at });
      doc.dispatchEvent(up);
    };
    tap(1000);
    // Longer than DOUBLE_TAP_MS, which is the whole point: a 6-million-pixel
    // tile of a scan at 65 ms a megapixel is around 400 ms of held thread.
    const until = performance.now() + 420;
    while (performance.now() < until) { /* the engine, holding the thread */ }
    tap(1120);
  });

  await expect.poll(width, { timeout: 4000 }).toBeGreaterThan(before * 1.5);
});

test('the pages go while the app is away, and the one on screen stays', async ({ page }) => {
  // His phone kills the app in the background: "signalled status=9
  // rssMb=383", "[MEMORY PRESSURE] screen-on memory reclaim". What it was
  // holding at that moment was 62 canvases and 37 MB of pictures, one
  // screen's worth of which anybody could use.
  test.slow();
  await boot(page, { 'book.pdf': PDF }, 'book.pdf');
  await readThis(page);
  // Read down a little, so there is something behind us to let go of.
  for (let step = 0; step < 6; step += 1) {
    await page.locator('#preview-pane').evaluate((pane) => { pane.scrollTop += pane.clientHeight / 2; });
    await page.waitForTimeout(420);
  }
  const held = await pictureMb(page);
  expect(held, `holding while it is being read (${held.toFixed(1)} MB)`).toBeGreaterThan(8);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // Measured, not hoped for: the sharp pages outside the screen are what
  // goes, and on this twelve-page document at 390x700 that is about a
  // quarter of what was held. The screen's own pages are the rest.
  await expect.poll(() => pictureMb(page), { timeout: 5000 }).toBeLessThan(held - 4);
  const away = await pictureMb(page);

  // Not to nothing: the page he is looking at is still drawn, so coming
  // back cannot flash.
  expect(away, `holding while away (${away.toFixed(1)} MB)`).toBeGreaterThan(1);
  expect(await page.locator('.pdf-page canvas').count(), 'the screen still has its pictures').toBeGreaterThan(0);
});
