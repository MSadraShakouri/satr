import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// A one-finger zoom survives the viewer redrawing the page underneath it.
//
// Reported from the phone: double tap to 2x on a typeset document, then
// hold and drag to zoom, and the zoom stops after a moment -- "not a
// limit, but clearly interrupted". On a scanned document, never. Without
// the double tap first, never.
//
// A touch is implicitly captured by the element it lands on, which was the
// topmost canvas of the page -- the sharp tile, which exists only above
// 1.01 zoom (hence the double tap first) and is removed every time a
// sharper one is ready, which on a typeset page is about 8 ms a megapixel
// and lands inside the gesture; on a scan it is 65, and it lands after.
// Removing an element that a touch is captured by makes the browser fire
// `pointercancel`, and this view ends the zoom on `pointercancel`.
//
// Moving the capture to the pane does NOT fix this: Chrome cancels on the
// removal of the element the touch first hit, whatever holds the capture
// afterwards. Measured, with the capture on the pane:
//   gotpointercapture:preview-pane | pointercancel:preview-pane
// The fix is that the pictures are not hit-testable at all.
//
// These have to be real touches, dispatched through CDP. Synthetic
// PointerEvents (the dragZoom helper in pdfFile.spec.ts) create no capture
// of any kind, so a test built on them passes against both builds.

const PDF = tinyPdf(6);

type Cdp = Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>;

declare global {
  interface Window { __seen?: string[] }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

async function boot(page: Page, files: Record<string, string>, open: string): Promise<void> {
  await page.addInitScript(() => {
    window.__seen = [];
    for (const type of ['pointercancel', 'gotpointercapture']) {
      document.addEventListener(type, (event) => {
        const target = event.target as Element | null;
        window.__seen?.push(`${type}:${target?.id || target?.className || '?'}`);
      }, true);
    }
  });
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
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });
  await expect.poll(async () => page.locator('.pdf-page canvas').count(), { timeout: 15000 }).toBeGreaterThan(0);
}

const touchAt = (cdp: Cdp, type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number): Promise<unknown> =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

const widthOfPage = async (page: Page): Promise<number> =>
  (await page.locator('.pdf-page[data-page="1"]').boundingBox())?.width ?? 0;

/** What the renderer does to the page under the finger the moment a
 *  sharper picture is ready: the old canvas goes. */
const swapPicture = (page: Page, x: number, y: number): Promise<void> =>
  page.evaluate(([px, py]) => {
    const hit = document.elementFromPoint(px as number, py as number);
    const box = hit?.closest('.pdf-page') ?? document.querySelector('.pdf-page');
    box?.querySelectorAll('canvas').forEach((canvas) => { canvas.remove(); });
  }, [x, y] as [number, number]);

test('the finger holds the page, not the picture of it', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  const cdp = await page.context().newCDPSession(page);
  const box = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 80;

  await touchAt(cdp, 'touchStart', x, y);
  await touchAt(cdp, 'touchEnd', x, y);
  const held = await page.evaluate(() => window.__seen ?? []);

  // What the touch landed on is the page box. A canvas here means the
  // gesture is hanging off something this view throws away.
  expect(held[0]).toBe('gotpointercapture:pdf-page');
});

test('swapping the page picture mid-drag does not end the zoom', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  const cdp = await page.context().newCDPSession(page);
  const box = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 80;
  const fit = await widthOfPage(page);

  await touchAt(cdp, 'touchStart', x, y);
  await touchAt(cdp, 'touchEnd', x, y);
  await touchAt(cdp, 'touchStart', x, y);
  // Down is in: 1.005 to the pixel, so 150 pixels is about twice.
  for (let step = 1; step <= 6; step += 1) await touchAt(cdp, 'touchMove', x, y + step * 25);
  const half = await widthOfPage(page);
  expect(half).toBeGreaterThan(fit * 1.5); // the drag really is zooming

  // A sharper tile arrives and the old picture is taken away, under the
  // finger, in the middle of the stroke.
  await swapPicture(page, x, y + 150);

  // The rest of the same stroke must answer exactly as the first half did.
  for (let step = 7; step <= 12; step += 1) await touchAt(cdp, 'touchMove', x, y + step * 25);
  const whole = await widthOfPage(page);
  await touchAt(cdp, 'touchEnd', x, y + 300);

  expect(whole).toBeGreaterThan(half * 1.5);
  expect(await page.evaluate(() => (window.__seen ?? []).filter((line) => line.startsWith('pointercancel')))).toEqual([]);
});
