import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// A one-finger zoom must not open a drawer.
//
// Reported: "funny thing about zooming with single finger: it can open the
// sidebar", and, asked where it happens: "when the width is the page and lower
// but never when zoomed in". That is the whole shape of it. A double tap and a
// drag is a zoom (src/pdfView.ts); the drawer (src/drawers.ts) takes any drag
// that is more sideways than not, and it leaves a pane alone only when the pane
// has something to pan. Zoomed in, the pages are wider than the screen, the
// pane claims the drag as its own, and the drawer bows out. At the page's own
// width there is nothing to pan, so nothing claimed it — and a thumb that
// drifted sideways while it zoomed pulled the files drawer open instead.
//
// The fix is the pane claiming the drag for as long as a zoom gesture is live:
// `data-ignore-swipe`, which the drawer already looks for when a finger lands
// (the app's own buttons and sheets carry it permanently). Nothing is claimed
// outside a gesture, so an ordinary sideways swipe on a page that fits still
// opens the drawer. These tests hold it from both sides.

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });

const PDF = tinyPdf(6);

async function boot(page: Page): Promise<void> {
  await page.addInitScript((bytes) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/handout.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/handout.pdf', bytes as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/handout.pdf' }], active: 0 }));
  }, PDF);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.waitForSelector('.pdf-page canvas', { timeout: 15000 });
  await page.waitForTimeout(700);
}

const room = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    return pane.scrollWidth - pane.clientWidth;
  });

/** Either drawer: a drag to the right opens the files one, to the left the
 *  outline. Which of them a sideways drift picks is the drawer's business;
 *  that neither opens during a zoom is the point. */
const drawerOpen = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.body.classList.contains('files-open') || document.body.classList.contains('outline-open'));

const claimed = (page: Page): Promise<boolean> =>
  page.evaluate(() => (document.querySelector('#preview-pane') as HTMLElement).dataset.ignoreSwipe !== undefined);

/**
 * A finger on a document, in the two families of event a real one sends: the
 * pointer events the viewer's gestures are built on, and the touch events the
 * drawer is built on, in the order Chromium fires them — pointer first, touch
 * second, for every move.
 *
 * `taps: 1` is the zoom: one tap, then a second landing kept down and dragged
 * (down zooms in, up zooms out — DRAG_SPEED in src/pdfView.ts). `taps: 0` is
 * just a finger dragged across the glass.
 */
async function finger(
  page: Page,
  { x, y, dx, dy, taps, steps = 8 }: { x: number; y: number; dx: number; dy: number; taps: 0 | 1; steps?: number },
): Promise<void> {
  await page.evaluate(({ x, y, dx, dy, taps, steps }) => {
    const sheet = document.querySelector('.pdf-page[data-page="1"]') as HTMLElement;
    const target = (document.elementFromPoint(x, y) ?? sheet) as HTMLElement;
    let id = 7;
    const pointer = (type: string, px: number, py: number): void => {
      target.dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: true, clientX: px, clientY: py, bubbles: true, cancelable: true,
      }));
    };
    const touch = (type: string, px: number, py: number): void => {
      const point = new Touch({ identifier: id, target, clientX: px, clientY: py });
      const list = type === 'touchend' ? [] : [point];
      target.dispatchEvent(new TouchEvent(type, { touches: list, targetTouches: list, changedTouches: [point], bubbles: true, cancelable: true }));
    };
    const lift = (px: number, py: number): void => { pointer('pointerup', px, py); touch('touchend', px, py); };
    if (taps === 1) {
      pointer('pointerdown', x, y); touch('touchstart', x, y);
      lift(x, y); // the first tap, released
    }
    pointer('pointerdown', x, y); touch('touchstart', x, y); // the second landing, held
    for (let step = 1; step <= steps; step += 1) {
      const px = x + (dx * step) / steps;
      const py = y + (dy * step) / steps;
      pointer('pointermove', px, py);
      if (step % 2 === 0) touch('touchmove', px, py);
    }
    lift(x + dx, y + dy);
  }, { x, y, dx, dy, taps, steps });
  await page.waitForTimeout(600);
}

test('zooming out at page width, with a sideways drift, leaves the drawer shut', async ({ page }) => {
  // His case exactly: "when the width is the page and lower but never when
  // zoomed in". Zooming *out* keeps the pages narrower than the screen, so
  // the pane still has nothing to pan and the drawer had nothing to bow out
  // to -- a sideways drift during that drag opened it.
  await boot(page);
  expect(await room(page), 'the page is at its own width: nothing to pan').toBeLessThan(2);
  const before = await page.evaluate(() => (document.querySelector('.pdf-page') as HTMLElement).getBoundingClientRect().width);
  await finger(page, { x: 195, y: 420, dx: 200, dy: -60, taps: 1 });
  expect(await drawerOpen(page), 'the drawer stays shut while a zoom is under way').toBe(false);
  const after = await page.evaluate(() => (document.querySelector('.pdf-page') as HTMLElement).getBoundingClientRect().width);
  expect(after, 'and the drag zoomed out, so it really was the zoom gesture').toBeLessThan(before - 20);
});

test('the claim lasts exactly as long as the gesture', async ({ page }) => {
  // Sideways while the finger is down, and given back when it lifts: the
  // drawer must be reachable again straight afterwards.
  await boot(page);
  await finger(page, { x: 195, y: 420, dx: 0, dy: 40, taps: 1 });
  expect(await claimed(page), 'the pane gives the gesture back when the finger lifts').toBe(false);
});

test('an ordinary sideways swipe still opens the drawer', async ({ page }) => {
  // Nothing is claimed outside a zoom, so a page that fits is navigated
  // exactly as it always was.
  await boot(page);
  await finger(page, { x: 110, y: 420, dx: 170, dy: 0, taps: 0, steps: 10 });
  expect(await drawerOpen(page), 'a swipe with no double tap in front of it is the drawer').toBe(true);
});

test('a zoomed-in page does not hand the drag to the drawer either', async ({ page }) => {
  // The half that already worked, held so the fix cannot quietly break it.
  await boot(page);
  await finger(page, { x: 195, y: 420, dx: 0, dy: 260, taps: 1 });
  expect(await room(page), 'zoomed in, the pages are wider than the screen').toBeGreaterThan(100);
  await finger(page, { x: 250, y: 420, dx: -120, dy: -10, taps: 0 });
  expect(await drawerOpen(page), 'no drawer over a zoomed page').toBe(false);
});
