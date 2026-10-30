import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// A PDF is read here: its pages, a zoom, and the place it was left at. It is
// never text — the editor has nothing to show for it and never writes it
// back. The fixture is a document built byte by byte below rather than a
// recorded one, so the page count and the page size in these assertions are
// known rather than guessed at.

const PDF = tinyPdf(6);
const OTHER = tinyPdf(3); // a different document, to tell the places apart

/** The vault as the web backend keeps it: a PDF is a data: URL in a value. */
async function boot(page: Page, files: Record<string, string>, open: string): Promise<void> {
  await page.addInitScript(([seed, first]) => {
    const vault = seed as Record<string, string>;
    const names = Object.keys(vault);
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: Object.fromEntries(names.map((name) => [`Notes/${name}`, 1])),
      folders: ['Notes'],
    }));
    for (const name of names) localStorage.setItem(`satr:fs:file:Notes/${name}`, vault[name]);
    // Seeded once: this runs again on every reload, and a later test step
    // that opens another file must not be undone by it.
    if (!localStorage.getItem('satr:tabs')) {
      localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: `Notes/${first as string}` }], active: 0 }));
    }
  }, [files, open] as [Record<string, string>, string]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

const pageBox = (page: Page, number: number) => page.locator(`.pdf-page[data-page="${number}"]`);
const widthOf = async (page: Page, number: number): Promise<number> =>
  (await pageBox(page, number).boundingBox())?.width ?? 0;

/** The document is up and a page has been drawn — whichever page the reader
 *  is on, since the ones far from it are deliberately not drawn at all. */
async function readThis(page: Page, name: string): Promise<void> {
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });
  await expect.poll(async () => page.locator('.pdf-page canvas').count(), { timeout: 15000 }).toBeGreaterThan(0);
  expect(name).toBeTruthy();
}

test('a PDF opens as its pages, and the editor is not offered for it', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await expect(page.locator('.pdf-page')).toHaveCount(6);
  // every page is laid out at its own size before anything is drawn, so the
  // column does not jump as the reader goes down it
  const first = await pageBox(page, 1).boundingBox();
  const last = await pageBox(page, 6).boundingBox();
  expect(Math.round(first?.width ?? 0)).toBe(Math.round(last?.width ?? 0));
  expect((first?.height ?? 0) / (first?.width ?? 1)).toBeCloseTo(842 / 595, 1);
  // read-only, and the bytes never reach the editor as text
  await expect(page.locator('body')).toHaveClass(/is-view-only/);
  expect(await page.locator('.cm-content').innerText()).not.toContain('%PDF');
});

test('a page fills the pane edge to edge when it opens', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const room = await page.locator('#preview-pane').evaluate((pane) => pane.clientWidth);
  const first = await widthOf(page, 1);
  // the pane's own width, less the 8px the column keeps either side of a page
  expect(first).toBeGreaterThan(room - 20);
  expect(first).toBeLessThanOrEqual(room);
});

/** Scroll until the given page is at the top of the pane, the way a reader
 *  gets there now that the counter is no longer a control. */
async function scrollToPage(page: Page, n: number): Promise<void> {
  const box = await pageBox(page, n).boundingBox();
  const pane = await page.locator('#preview-pane').boundingBox();
  await page.locator('#preview-pane').evaluate((el, to: number) => { el.scrollTop += to; }, (box?.y ?? 0) - (pane?.y ?? 0));
}

test('the counter says which page is being read, and only when there are several', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF, 'one.pdf': tinyPdf(1) }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await expect(page.locator('.pdf-counter')).toHaveText('1 / 6');
  const third = await pageBox(page, 3).boundingBox();
  const pane = await page.locator('#preview-pane').boundingBox();
  await page.locator('#preview-pane').evaluate((el, to: number) => { el.scrollTop += to; }, (third?.y ?? 0) - (pane?.y ?? 0));
  await expect(page.locator('.pdf-counter')).toHaveText('3 / 6');
});

test('the last page is named as the last page', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  // The bottom of a document is as far as it scrolls, so the last page can
  // never reach the top of the pane: the counter has to know that.
  await page.locator('#preview-pane').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('.pdf-counter')).toHaveText('6 / 6');
});

test('pinching zooms the pages, and stops at a quarter of the width', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const fit = await widthOf(page, 1);
  await pinch(page, 0.5);
  const half = await widthOf(page, 1);
  expect(half).toBeLessThan(fit * 0.6);
  expect(half).toBeGreaterThan(fit * 0.4);
  // and no further than his floor, however hard it is pinched
  await pinch(page, 0.1);
  await pinch(page, 0.1);
  expect(await widthOf(page, 1)).toBeGreaterThan(fit * 0.24);
  expect(await widthOf(page, 1)).toBeLessThan(fit * 0.27);
  // zoomed out, the pages are a single column still: one page per row
  const lefts = await page.locator('.pdf-page').evaluateAll((boxes) =>
    boxes.map((box) => Math.round(box.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(1);
});

test('zooming in redraws the page rather than blowing it up', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const fit = await widthOf(page, 1);
  const before = await rasterWidth(page);
  await pinch(page, 3);
  const after = await widthOf(page, 1);
  expect(after).toBeGreaterThan(fit * 2.5);
  // the canvas behind it holds more pixels than it did, which is the whole
  // point: a stretched picture would keep the same ones
  await expect.poll(async () => rasterWidth(page), { timeout: 15000 }).toBeGreaterThan(before * 2);
});

test('a document opens where it was left, by its own bytes rather than its name', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF, 'copy.pdf': PDF, 'other.pdf': OTHER }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await scrollToPage(page, 4);
  await expect(page.locator('.pdf-counter')).toHaveText('4 / 6');
  await page.waitForTimeout(600); // the place is written down once the reader settles
  // the app closed and opened again on the same document: the same page
  await reopen(page, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await expect(page.locator('.pdf-counter')).toHaveText('4 / 6');
  // the same bytes under another name: the same page, because the place
  // belongs to the document and not to where it happens to sit
  await reopen(page, 'copy.pdf');
  await readThis(page, 'copy.pdf');
  await expect(page.locator('.pdf-counter')).toHaveText('4 / 6');
  // a different document knows nothing about it
  await reopen(page, 'other.pdf');
  await readThis(page, 'other.pdf');
  await expect(page.locator('.pdf-counter')).toHaveText('1 / 3');
});

test('the zoom comes back with the place', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const fit = await widthOf(page, 1);
  await pinch(page, 2);
  const zoomed = await widthOf(page, 1);
  expect(zoomed).toBeGreaterThan(fit * 1.5);
  await page.waitForTimeout(600);
  await reopen(page, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  expect(await widthOf(page, 1)).toBeCloseTo(zoomed, -1);
});

test('a file that says .pdf and is not one says so where the pages would be', async ({ page }) => {
  await boot(page, { 'broken.pdf': 'data:application/pdf;base64,bm90IGEgUERGIGF0IGFsbA==' }, 'broken.pdf');
  await expect(page.locator('.pdf-unreadable')).toHaveText('“broken.pdf” could not be opened.', { timeout: 15000 });
  expect(await page.locator('.pdf-page').count()).toBe(0);
});

/** Two fingers, apart or together, as the pane sees them. */
async function pinch(page: Page, factor: number): Promise<void> {
  await page.locator('#preview-pane').evaluate((pane, by: number) => {
    const box = pane.getBoundingClientRect();
    const middleY = box.top + box.height / 2;
    const middleX = box.left + box.width / 2;
    const fire = (type: string, id: number, x: number, y: number): void => {
      pane.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    const span = 100;
    fire('pointerdown', 1, middleX, middleY - span / 2);
    fire('pointerdown', 2, middleX, middleY + span / 2);
    const moved = (span * by) / 2;
    fire('pointermove', 1, middleX, middleY - moved);
    fire('pointermove', 2, middleX, middleY + moved);
    fire('pointerup', 1, middleX, middleY - moved);
    fire('pointerup', 2, middleX, middleY + moved);
  }, factor);
}

/** How many pixels the visible page is actually drawn with. */
async function rasterWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.pdf-page canvas') as HTMLCanvasElement | null;
    return canvas ? canvas.width : 0;
  });
}

/** The app shut and opened again on a file: everything it remembers has to
 *  come from what it wrote down, not from anything still in memory. */
async function reopen(page: Page, name: string): Promise<void> {
  await page.evaluate((file) => {
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: `Notes/${file}` }], active: 0 }));
  }, name);
  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

/** Which page is under a point on the screen, and how far into it. */
const under = (page: Page, x: number, y: number): Promise<{ page: number; into: number } | null> => page.evaluate(([px, py]) => {
  const boxes = [...document.querySelectorAll('.pdf-page')];
  for (const [index, box] of boxes.entries()) {
    const r = box.getBoundingClientRect();
    if (py >= r.top && py <= r.bottom && px >= r.left && px <= r.right) {
      return { page: index + 1, into: Math.round(((py - r.top) / r.height) * 1000) / 1000, across: Math.round(((px - r.left) / r.width) * 1000) / 1000 };
    }
  }
  return null;
}, [x, y]) as Promise<{ page: number; into: number } | null>;

test.describe('on a phone-sized screen, where a zoomed page is wider than the pane', () => {
  test.use({ viewport: { width: 390, height: 700 } });

test('a double tap zooms about the point tapped, not about the middle of the column', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await expect(page.locator('.pdf-raster').first()).toBeVisible();
  const at = { x: 300, y: 260 }; // off to one side: the sideways anchor is the point
  const before = await under(page, at.x, at.y);
  expect(before).not.toBeNull();
  const wide = await page.locator('.pdf-page').first().evaluate((box) => box.getBoundingClientRect().width);
  // on the page itself, which is where a finger lands
  for (const id of [3, 4]) {
    await page.locator('.pdf-page').first().dispatchEvent('pointerdown', { pointerId: id, pointerType: 'touch', clientX: at.x, clientY: at.y, isPrimary: true });
    await page.locator('.pdf-page').first().dispatchEvent('pointerup', { pointerId: id, pointerType: 'touch', clientX: at.x, clientY: at.y, isPrimary: true });
  }
  await page.waitForTimeout(400);
  const zoomed = await page.locator('.pdf-page').first().evaluate((box) => box.getBoundingClientRect().width);
  expect(zoomed).toBeGreaterThan(wide * 2); // it did zoom in, which on a phone it never used to
  const after = await under(page, at.x, at.y);
  expect(after).not.toBeNull();
  // the same place on the same page is still under the finger, both ways
  expect(after!.page).toBe(before!.page);
  expect(Math.abs(after!.into - before!.into)).toBeLessThan(0.06);
  expect(Math.abs((after as { across: number }).across - (before as unknown as { across: number }).across)).toBeLessThan(0.06);
});

test('the counter stays with the pane when a zoomed page is pushed sideways', async ({ page }) => {
  // It is a reading of where the reader is, so it has to be where the reader
  // can read it. Zoomed in, the column is wider than the pane and scrolls
  // sideways; the counter belongs to the pane, not to the column.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await expect(page.locator('.pdf-raster').first()).toBeVisible();
  for (const id of [7, 8]) { // a double tap, which is how a reader zooms in
    await page.locator('.pdf-page').first().dispatchEvent('pointerdown', { pointerId: id, pointerType: 'touch', clientX: 200, clientY: 300, isPrimary: true });
    await page.locator('.pdf-page').first().dispatchEvent('pointerup', { pointerId: id, pointerType: 'touch', clientX: 200, clientY: 300, isPrimary: true });
  }
  await page.waitForTimeout(400);
  const centred = async (): Promise<number> => page.evaluate(() => {
    const pill = document.querySelector('.pdf-counter')!.getBoundingClientRect();
    const pane = document.querySelector('#preview-pane')!.getBoundingClientRect();
    return Math.round((pill.left + pill.width / 2) - (pane.left + pane.width / 2));
  });
  const still = await centred();
  await page.evaluate(() => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    pane.scrollLeft = 160;
  });
  await page.waitForTimeout(60);
  const pushed = await page.evaluate(() => (document.querySelector('#preview-pane') as HTMLElement).scrollLeft);
  expect(pushed).toBeGreaterThan(0); // the pane really did scroll sideways
  expect(Math.abs(await centred() - still)).toBeLessThan(2);
});
});

test('a page is drawn at the screen’s own pixels, inside the budget', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await expect(page.locator('.pdf-raster').first()).toBeVisible();
  const drawn = await page.locator('.pdf-raster').first().evaluate((canvas: HTMLCanvasElement) => ({
    ratio: canvas.width / parseFloat(canvas.style.width),
    pixels: canvas.width * canvas.height,
    screen: window.devicePixelRatio,
  }));
  // the screen's ratio, not a cap of our own, and within the page budget
  expect(drawn.ratio).toBeCloseTo(drawn.screen, 1);
  expect(drawn.pixels).toBeLessThanOrEqual(16_777_216);
});

test('the engine itself is served by the app, whole and from its own origin', async () => {
  // PDFium is one 4.5 MB wasm file and the viewer is nothing without it:
  // unreachable or truncated, every page comes out blank. It is served from
  // the app's own origin so a document opens with no network at all.
  const response = await fetch('http://127.0.0.1:5173/pdfium/pdfium.wasm');
  expect(response.status).toBe(200);
  expect((await response.arrayBuffer()).byteLength).toBe(4_646_932);
});
