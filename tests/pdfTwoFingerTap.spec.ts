import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// Two fingers tapped on a page put the zoom back to the page's own width.
//
// His line: "a single tap with two fingers reset zoom". A double tap
// already comes back down, but it comes back about the point it lands on,
// so it has to be aimed, and after pushing a page out to read a figure the
// way back wanted a tap in a place that did not matter. This is that.
//
// The three things it must not be: a pinch (the fingers moved), a pinch
// that happens to end where it began (the fingers took their time), and a
// pair of lifts the tap handler could read as a double tap.

const PDF = tinyPdf(6);

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
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });
  await expect.poll(async () => page.locator('.pdf-page canvas').count(), { timeout: 15000 }).toBeGreaterThan(0);
}

const widthOfPage = async (page: Page): Promise<number> =>
  (await page.locator('.pdf-page[data-page="1"]').boundingBox())?.width ?? 0;

/** One half of a two-finger gesture, so a test can wait in the middle of
 *  one. `spread` is in pixels either side of the pane's middle. */
async function fingers(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup', spread = 50): Promise<void> {
  await page.locator('#preview-pane').evaluate((pane, [kind, apart]: [string, number]) => {
    const box = pane.getBoundingClientRect();
    const middleY = box.top + box.height / 2;
    const middleX = box.left + box.width / 2;
    for (const [id, side] of [[1, -1], [2, 1]] as [number, number][]) {
      pane.dispatchEvent(new PointerEvent(kind, {
        pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true,
        clientX: middleX, clientY: middleY + side * apart,
      }));
    }
  }, [type, spread] as [string, number]);
}

/** Out to `factor` and left there, the way pdfFile.spec.ts does it. */
async function pinch(page: Page, factor: number): Promise<void> {
  await fingers(page, 'pointerdown', 50);
  await fingers(page, 'pointermove', 50 * factor);
  await fingers(page, 'pointerup', 50 * factor);
  await page.waitForTimeout(400);
}

test('two fingers tapped put the page back to its own width', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  const own = await widthOfPage(page);
  expect(own).toBeGreaterThan(0);

  await pinch(page, 2.5);
  const out = await widthOfPage(page);
  expect(out).toBeGreaterThan(own * 1.5);

  await fingers(page, 'pointerdown');
  await fingers(page, 'pointerup');
  await expect.poll(async () => widthOfPage(page), { timeout: 4000 }).toBeLessThan(own * 1.05);
  expect(await widthOfPage(page)).toBeGreaterThan(own * 0.95);
});

test('a pinch is not a tap', async ({ page }) => {
  // The fingers moved, so the zoom they asked for is the zoom they get --
  // this is the one that fails if every two-finger lift resets.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  const own = await widthOfPage(page);

  await pinch(page, 2.5);
  await page.waitForTimeout(600);
  expect(await widthOfPage(page)).toBeGreaterThan(own * 1.5);
});

test('fingers that stay a while are not a tap either', async ({ page }) => {
  // Two contacts resting on the glass -- a hand laid on the phone, a
  // pinch that thought better of it -- must leave the page where it is.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  const own = await widthOfPage(page);

  await pinch(page, 2.5);
  const out = await widthOfPage(page);

  await fingers(page, 'pointerdown');
  await page.waitForTimeout(600);
  await fingers(page, 'pointerup');
  await page.waitForTimeout(500);
  expect(await widthOfPage(page)).toBeGreaterThan(out * 0.95);
});

test('a tenth of a pinch is a pinch', async ({ page }) => {
  // Caught by pdfFile.spec.ts, "a pinch that drifts a little keeps the
  // tile it already has": a deliberate tenth moves each finger five
  // pixels, which is inside any honest idea of two fingers holding
  // still, and it was being answered with a reset. Distance cannot
  // decide this one -- the zoom asked for does.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  const own = await widthOfPage(page);

  await pinch(page, 2.5);
  const out = await widthOfPage(page);

  await pinch(page, 1.1);
  await page.waitForTimeout(600);
  const after = await widthOfPage(page);
  expect(after).toBeGreaterThan(out * 0.95);
  expect(after).toBeGreaterThan(own * 1.5);
});
