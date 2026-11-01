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

/**
 * A finger kept on the glass, from before the document opens.
 *
 * Nothing is sketched in the background while the reader is moving, so a
 * test about what the engine is asked for can lay out its own scene --
 * otherwise the background has quietly drawn half the document first, and
 * what the test watches is the sketch book being put back rather than the
 * band deciding anything. Let go of it to give the background its turn.
 */
async function keepMoving(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tick = setInterval(() => {
      const pane = document.querySelector('#preview-pane') as HTMLElement | null;
      if (pane) pane.scrollTop = pane.scrollTop ? 0 : 1;
    }, 80);
    (window as unknown as { letGo: () => void }).letGo = () => { clearInterval(tick); };
  });
}
const letGo = (page: Page): Promise<void> =>
  page.evaluate(() => { (window as unknown as { letGo: () => void }).letGo(); });

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

test('the counter names the page being read, not the one just left', async ({ page }) => {
  // A sliver of the page above is still at the top of the screen while the
  // reader is plainly on the next one. The counter reads the page under the
  // line two thirds down, which is where the outline reads a heading from.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await scrollToPage(page, 3);
  await expect(page.locator('.pdf-counter')).toHaveText('3 / 6');
  // A third of a screen short of page three's top edge: page two owns the
  // top strip, page three owns the middle and the rest.
  const pane0 = await page.locator('#preview-pane').boundingBox();
  await page.locator('#preview-pane').evaluate((el, up: number) => { el.scrollTop -= up; }, pane0!.height / 3);
  await page.waitForTimeout(500); // let it settle, so this reads the new answer
  await expect(page.locator('.pdf-counter')).toHaveText('3 / 6');
  // And a screen that is mostly page two says two.
  const box = await pageBox(page, 3).boundingBox();
  const pane = await page.locator('#preview-pane').boundingBox();
  await page.locator('#preview-pane').evaluate((el, to: number) => { el.scrollTop += to; }, -(pane!.height * 0.75) + ((box?.y ?? 0) - (pane?.y ?? 0)));
  await page.waitForTimeout(500);
  await expect(page.locator('.pdf-counter')).toHaveText('2 / 6');
});

test.describe('on a phone-sized screen, where the wide band holds the whole document', () => {
  test.use({ viewport: { width: 390, height: 700 } });

  test('a page ahead of the sharp ones is already there, roughly', async ({ page }) => {
    // Scrolling fast outruns the sharp pictures. Every page in a far wider
    // band carries a hundred-pixel one, stretched over the box, so what goes
    // past is a soft page rather than an empty one.
    await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
    await readThis(page, 'handout.pdf');
    await page.waitForTimeout(1200);
    const far = page.locator('.pdf-page[data-page="5"]');
    await expect(far.locator('canvas.pdf-rough')).toHaveCount(1, { timeout: 15000 });
    // It is a hundred pixels wide, not a page of them.
    const width = await far.locator('canvas.pdf-rough').evaluate((el) => (el as HTMLCanvasElement).width);
    expect(width).toBeLessThanOrEqual(110);
    // A fast flick to the end: the page it lands on is never an empty box.
    await page.locator('#preview-pane').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(page.locator('.pdf-page[data-page="6"] canvas')).not.toHaveCount(0);
    // Coming back, the page left behind kept its rough picture rather than
    // becoming a blank box again.
    await page.waitForTimeout(600);
    await expect(page.locator('.pdf-page[data-page="1"] canvas.pdf-rough')).toHaveCount(1);
  });
});

test('one finger zooms: the second tap of a double tap, held and dragged', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const fit = await widthOf(page, 1);
  // Down to zoom in, the way Google's own apps answer this gesture.
  await dragZoom(page, 180);
  await page.waitForTimeout(500);
  const bigger = await widthOf(page, 1);
  expect(bigger).toBeGreaterThan(fit * 1.6);
  expect(bigger).toBeLessThan(fit * 2.6);
  // And up to take it back out again.
  await dragZoom(page, -180);
  await page.waitForTimeout(500);
  const back = await widthOf(page, 1);
  expect(back).toBeLessThan(bigger * 0.75);
});

test('a double tap keeps the point it was aimed at', async ({ page }) => {
  // The tap handler starts the zoom about the point tapped and the pointer
  // handler above it used to wipe the column's origin a moment later, so
  // every double tap flew out of the wrong corner.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const state = await page.locator('.pdf-page[data-page="1"]').evaluate((sheet) => {
    const box = sheet.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + 120;
    for (const type of ['pointerdown', 'pointerup', 'pointerdown', 'pointerup']) {
      sheet.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }
    const column = sheet.parentElement as HTMLElement;
    return { origin: column.style.transformOrigin, animations: column.getAnimations().length };
  });
  expect(state.origin).not.toBe('');
  expect(state.animations).toBeGreaterThan(0);
});

test('a one-finger drag refuses the scroll it would otherwise be', async ({ page }) => {
  // touch-action is read when a gesture begins, so asking for it on the
  // second tap is too late: the pane scrolled away under the finger. The
  // touch event itself has to be turned down as it happens.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const prevented = await page.locator('.pdf-page[data-page="1"]').evaluate((sheet) => {
    const box = sheet.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + 120;
    const point = (atY: number) => new PointerEvent('x', { clientX: x, clientY: atY });
    for (const type of ['pointerdown', 'pointerup', 'pointerdown']) {
      sheet.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }
    const touch = new Touch({ identifier: 1, target: sheet, clientX: x, clientY: y + 60 });
    const move = new TouchEvent('touchmove', { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true });
    sheet.dispatchEvent(move);
    void point;
    return move.defaultPrevented;
  });
  expect(prevented).toBe(true);
});

test('a double tap that does not drag is still a double tap', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const fit = await widthOf(page, 1);
  await dragZoom(page, 2); // a thumb never lands perfectly still
  await page.waitForTimeout(600);
  const after = await widthOf(page, 1);
  expect(after).toBeGreaterThan(fit * 1.6);
});

test('the column is made ready to be scaled while the finger is still down', async ({ page }) => {
  // The first zoom of a session had to rasterise the whole column into a
  // layer before it could scale it, which is the stutter that only ever
  // happens once. A finger on the pages is the warning.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const column = page.locator('.pdf-document, #preview-pane .pdf-page').first();
  await page.locator('.pdf-page[data-page="1"]').evaluate((sheet) => {
    const box = sheet.getBoundingClientRect();
    sheet.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: box.left + 20, clientY: box.top + 20, bubbles: true, cancelable: true }));
  });
  const warmed = await page.evaluate(() => {
    const doc = document.querySelector('.pdf-page')!.parentElement as HTMLElement;
    return doc.style.willChange;
  });
  expect(warmed).toBe('transform');
  await expect(column).toBeVisible();
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

test('zooming in draws the part on screen sharply, and does not redraw the page', async ({ page }) => {
  // The complaint this answers: zooming rendered the whole page again from
  // scratch. It no longer does. The page's own picture is drawn once at the
  // width the pane gives it and stretched from then on, and what a zoom
  // costs is one screenful of sharp pixels over the top of it.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const middle = await page.locator('#preview-pane').evaluate((pane) => {
    const box = pane.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  const fit = await widthOf(page, 1);
  const whole = await rasterWidth(page);
  const held = await pixelsHeld(page, 1);
  expect(await sharpnessAt(page, middle.x, middle.y)).toBeGreaterThan(0.95);

  await pinch(page, 3);
  expect(await widthOf(page, 1)).toBeGreaterThan(fit * 2.5);
  // what the reader looks at is drawn for the size it is shown at, still
  await expect.poll(async () => sharpnessAt(page, middle.x, middle.y), { timeout: 15000 }).toBeGreaterThan(0.95);
  // and the page's own picture was never asked for again: same pixels wide
  expect(await rasterWidth(page)).toBe(whole);
  // three times the zoom is nine times the page; what is held is a screen's
  // worth more, not nine times more
  expect(await pixelsHeld(page, 1)).toBeLessThan(held * 3);
});

test('a page\u2019s picture fits its page, zoomed in or out', async ({ page }) => {
  // Reported: zooming out acts weird. It did — the picture was drawn for
  // the page at the pane's width and kept that size while the box shrank
  // around it, so pages lay over the ones below them. A canvas is a
  // replaced element: it keeps the size of its own pixels unless it is told
  // otherwise, and being stretched to its box is the whole point of drawing
  // it once.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const fits = async (): Promise<string[]> => page.evaluate(() => {
    const wrong: string[] = [];
    for (const box of document.querySelectorAll<HTMLElement>('.pdf-page')) {
      const page_ = box.getBoundingClientRect();
      const base = box.querySelector<HTMLCanvasElement>('canvas:not(.pdf-detail)');
      if (!base) continue;
      const drawn = base.getBoundingClientRect();
      if (Math.abs(drawn.width - page_.width) > 1 || Math.abs(drawn.height - page_.height) > 1) {
        wrong.push(`page ${box.dataset.page}: box ${Math.round(page_.width)}x${Math.round(page_.height)}, picture ${Math.round(drawn.width)}x${Math.round(drawn.height)}`);
      }
    }
    return wrong;
  });
  expect(await fits()).toEqual([]);
  await pinch(page, 3);
  await page.waitForTimeout(500);
  expect(await fits()).toEqual([]);
  for (const out of [0.2, 0.4]) { // back out, and further out than the pane
    await pinch(page, out);
    await page.waitForTimeout(500);
    expect(await fits(), 'zoomed out').toEqual([]);
  }
  // and the pages are still a column, each below the last, none overlapping
  const overlaps = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.pdf-page')].map((b) => b.getBoundingClientRect());
    return boxes.filter((box, index) => index > 0 && box.top < boxes[index - 1].bottom - 0.5).length;
  });
  expect(overlaps).toBe(0);
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

test('the place across a zoomed page comes back too', async ({ page }) => {
  // Reported: "we save height and zoom but we don't save horizontal
  // position, a tab switch clings to the left". A reader zoomed into the
  // right-hand side of a sheet comes back to the left margin.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await dragZoom(page, 240); // well past the pane's width
  await page.waitForTimeout(500);
  const parked = await page.evaluate(() => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    const reach = pane.scrollWidth - pane.clientWidth;
    pane.scrollLeft = reach; // all the way to the right margin
    return { reach, left: pane.scrollLeft };
  });
  expect(parked.reach).toBeGreaterThan(50);
  await page.waitForTimeout(700); // the place is written down after 400ms
  await reopen(page, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    return { left: pane.scrollLeft, reach: pane.scrollWidth - pane.clientWidth };
  });
  expect(back.reach).toBeGreaterThan(50);
  expect(back.left).toBeGreaterThan(parked.left * 0.8);
});

test('a zoomed page follows a drag at an angle instead of clipping to an axis', async ({ page }) => {
  // Reported as a restricting feeling: "moving in a 30 degree downwards
  // angle prefers only vertical movement rather than free moving... it
  // clips to a specific direction of the 4 main". The browser rails a
  // touch scroll to one axis once the gesture leans one way; the pane
  // turns the rail off and the scrolling stays the browser's own.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const known = await page.evaluate(() => CSS.supports('scroll-axis-lock', 'none'));
  test.skip(!known, 'this browser has no say over scroll axis locking');
  const pane = await page.locator('#preview-pane').evaluate((el) => ({
    lock: getComputedStyle(el).getPropertyValue('scroll-axis-lock'),
    hand: getComputedStyle(el).touchAction,
  }));
  expect(pane.lock).toBe('none');
  expect(pane.hand).not.toBe('none'); // the scrolling is still the browser's
  await dragZoom(page, 240); // well past the pane's width
  await page.waitForTimeout(500);
  const reach = await page.evaluate(() => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    return pane.scrollWidth - pane.clientWidth;
  });
  expect(reach).toBeGreaterThan(100);
  const cdp = await page.context().newCDPSession(page);
  for (const angle of [20, 30, 60, 70]) {
    const was = await page.evaluate((start) => {
      const pane = document.querySelector('#preview-pane') as HTMLElement;
      pane.scrollTop = 1200;
      pane.scrollLeft = start;
      return { x: pane.scrollLeft, y: pane.scrollTop };
    }, Math.round(reach * 0.3));
    await page.waitForTimeout(250);
    const dist = 140;
    const dx = -Math.cos((angle * Math.PI) / 180) * dist;
    const dy = -Math.sin((angle * Math.PI) / 180) * dist;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 450 }] });
    for (let step = 1; step <= 12; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 + (dx * step) / 12, y: 450 + (dy * step) / 12 }] });
      await page.waitForTimeout(14);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(900); // the throw lands
    const now = await page.evaluate(() => {
      const pane = document.querySelector('#preview-pane') as HTMLElement;
      return { x: pane.scrollLeft, y: pane.scrollTop, reach: pane.scrollWidth - pane.clientWidth };
    });
    // nothing was measured against a wall
    expect(now.x).toBeGreaterThan(1);
    expect(now.x).toBeLessThan(now.reach - 1);
    const moved = { x: now.x - was.x, y: now.y - was.y };
    expect(moved.x).toBeGreaterThan(20);
    expect(moved.y).toBeGreaterThan(20);
    const went = (Math.atan2(moved.y, moved.x) * 180) / Math.PI;
    expect(Math.abs(went - angle)).toBeLessThan(12);
  }
});

test('a page at its own width does not drift sideways', async ({ page }) => {
  // The other half of turning the rail off: an unzoomed page has nothing
  // to either side, so a thumb that wanders while scrolling down must not
  // take the page with it. Nothing about ordinary reading changes.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const room = await page.evaluate(() => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    return pane.scrollWidth - pane.clientWidth;
  });
  expect(room).toBeLessThan(2); // the page is at the pane's own width
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 600 }] });
  for (let step = 1; step <= 12; step += 1) {
    // a thumb going down and wandering 3px to the side as it goes
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 + step * 3, y: 600 - step * 20 }] });
    await page.waitForTimeout(14);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
  const now = await page.evaluate(() => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    return { left: pane.scrollLeft, top: pane.scrollTop, hand: getComputedStyle(pane).touchAction };
  });
  expect(now.top).toBeGreaterThan(100); // it scrolled down
  expect(now.left).toBe(0); // and not a pixel sideways
  expect(now.hand).not.toBe('none'); // nothing of the pane's own scrolling was taken away
});

test('a file that says .pdf and is not one says so where the pages would be', async ({ page }) => {
  await boot(page, { 'broken.pdf': 'data:application/pdf;base64,bm90IGEgUERGIGF0IGFsbA==' }, 'broken.pdf');
  await expect(page.locator('.pdf-unreadable')).toHaveText('“broken.pdf” could not be opened.', { timeout: 15000 });
  expect(await page.locator('.pdf-page').count()).toBe(0);
});

/** Two fingers, apart or together, as the pane sees them. */
async function pinch(page: Page, factor: number, atX?: number): Promise<void> {
  await page.locator('#preview-pane').evaluate((pane, [by, x]: [number, number | undefined]) => {
    const box = pane.getBoundingClientRect();
    const middleY = box.top + box.height / 2;
    const middleX = x ?? box.left + box.width / 2;
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
  }, [factor, atX] as [number, number | undefined]);
}

test('a page pushed sideways moves, and does not drag the app with it', async ({ page }) => {
  // Reported as a restricting feeling in every direction. A zoomed page
  // meets its horizontal edge every few centimetres, and at the edge the
  // drawer swipe took the drag -- pushing a page to see its margin slid
  // the whole app aside. A pannable table already owns both directions
  // (src/drawers.ts); the pages say so the same way.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await dragZoom(page, 240); // well past the pane's width
  await page.waitForTimeout(500);
  const reach = await page.evaluate(() => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    return pane.scrollWidth - pane.clientWidth;
  });
  expect(reach).toBeGreaterThan(50);
  await page.evaluate(() => { (document.querySelector('#preview-pane') as HTMLElement).scrollLeft = 0; });
  // a finger pushing the page to the right, from its left edge
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 420 }] });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120 + 12 * step, y: 420 }] });
    await page.waitForTimeout(16);
  }
  const held = await page.evaluate(() => getComputedStyle(document.querySelector('.workspace') as HTMLElement).transform);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
  // the app stayed where it was, drawer and all
  expect(held === 'none' || held === 'matrix(1, 0, 0, 1, 0, 0)').toBeTruthy();
  await expect(page.locator('body')).not.toHaveClass(/files-open/);
});

test('zooming back out of a corner does not jump to the middle first', async ({ page }) => {
  // Reported: "double tap to zoom out when I'm at a corner of a page
  // centers it first before going out". The motion scales the new layout
  // back into the old view, and at a corner the scroll it is measured
  // against cannot be placed -- so the page was centred before the motion
  // had started, and the reader saw the jump.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await dragZoom(page, 240);
  await page.waitForTimeout(600);
  // into the top left corner of the page
  await page.evaluate(() => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    pane.scrollLeft = 0;
    pane.scrollTop = 0;
  });
  await page.waitForTimeout(400);
  const corner = async (): Promise<{ x: number; y: number }> => {
    const box = await pageBox(page, 1).boundingBox();
    return { x: box?.x ?? 0, y: box?.y ?? 0 };
  };
  const was = await corner();
  // a double tap near that corner, and the very next frame after it
  await pageBox(page, 1).evaluate((sheet) => {
    const box = sheet.getBoundingClientRect();
    const x = box.left + 60;
    const y = box.top + 120;
    const fire = (type: string): void => {
      sheet.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    fire('pointerdown'); fire('pointerup'); fire('pointerdown'); fire('pointerup');
  });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const first = await corner();
  // the first frame of the motion still shows the reader's own view
  expect(Math.abs(first.x - was.x)).toBeLessThan(24);
  expect(Math.abs(first.y - was.y)).toBeLessThan(24);
});

test('below the page width, a double tap comes back to it', async ({ page }) => {
  // Reported: "when the zoom is less than default, double tap should zoom
  // to default rather than zooming in".
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const fit = await widthOf(page, 1);
  await dragZoom(page, -150); // up is out: the pages shrink past their own width
  await page.waitForTimeout(500);
  const small = await widthOf(page, 1);
  expect(small).toBeLessThan(fit * 0.9);
  await pageBox(page, 1).evaluate((sheet) => {
    const box = sheet.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const fire = (type: string): void => {
      sheet.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    fire('pointerdown'); fire('pointerup'); fire('pointerdown'); fire('pointerup');
  });
  await page.waitForTimeout(600);
  expect(await widthOf(page, 1)).toBeCloseTo(fit, -1); // the page's own width, not past it
});

test('a thumb that lands a little to one side still zooms', async ({ page }) => {
  // Reported: "single finger zoom, I think it didn't work once for me".
  // Measured here, the second tap of the gesture had to land within 24px of
  // the first -- a tap 20px away zoomed and one 30px away did nothing --
  // which is less than a thumb moves between two taps. The platform's own
  // double tap allows 100dp.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const fit = await widthOf(page, 1);
  await dragZoom(page, 120, 40); // down is in, and 40px to one side
  await page.waitForTimeout(400);
  expect(await widthOf(page, 1)).toBeGreaterThan(fit * 1.3);
});

test('the page stays under the fingers, across as well as down', async ({ page }) => {
  // Reported: zooming shifts the page sideways a little. It did. The point
  // to hold was taken as a fraction of the *column*, and the column is the
  // page plus padding, with the page centred in what is left -- neither of
  // which grows with the zoom. So the fraction named a different place on
  // the page at every size, and the page crept sideways under the fingers.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  const spot = async (x: number): Promise<number> => page.evaluate((at) => {
    const box = document.querySelector('.pdf-page[data-page="1"]') as HTMLElement;
    const rect = box.getBoundingClientRect();
    return (at - rect.left) / rect.width;
  }, x);
  // off to one side, where the error is largest; the middle hides it
  const held = 100;
  const before = await spot(held);
  await pinch(page, 2.5, held);
  await page.waitForTimeout(400);
  const after = await spot(held);
  const width = await widthOf(page, 1);
  expect(Math.abs(after - before) * width).toBeLessThan(2);
});

/** The second tap of a double tap, held and dragged: Google's own
 *  one-finger zoom, down to zoom in. */
async function dragZoom(page: Page, by: number, apart = 0): Promise<void> {
  // Dispatched on the page itself, as a thumb lands on it: the tap handler
  // sits on the column and the zoom handlers on the pane above it.
  // `apart` moves the second tap sideways, the way a thumb does.
  await page.locator('.pdf-page[data-page="1"]').evaluate((sheet, [dy, dx]: [number, number]) => {
    const box = sheet.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = Math.max(box.top + 40, Math.min(box.bottom - 40, box.top + box.height / 2));
    const fire = (type: string, atX: number, atY: number): void => {
      sheet.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: atX, clientY: atY, bubbles: true, cancelable: true }));
    };
    fire('pointerdown', x, y);
    fire('pointerup', x, y);           // the first tap
    fire('pointerdown', x + dx, y);    // the second, held, a thumb's width over
    for (let step = 1; step <= 6; step += 1) fire('pointermove', x + dx, y + (dy * step) / 6);
    fire('pointerup', x + dx, y + dy);
  }, [by, apart] as [number, number]);
}

/** How many pixels the visible page is actually drawn with. */
async function rasterWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.pdf-page canvas') as HTMLCanvasElement | null;
    return canvas ? canvas.width : 0;
  });
}

/** What the reader is actually looking at, at a point on the screen: how
 *  many of the picture's own pixels there are per pixel of screen, taking
 *  the sharpest picture that covers the point. One means a picture drawn
 *  for exactly this size; less means it is being stretched. */
async function sharpnessAt(page: Page, x: number, y: number): Promise<number> {
  return page.evaluate(([px, py]) => {
    let best = 0;
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.pdf-page canvas')) {
      const box = canvas.getBoundingClientRect();
      if (px < box.left || px > box.right || py < box.top || py > box.bottom) continue;
      best = Math.max(best, canvas.width / Math.max(1, box.width) / (window.devicePixelRatio || 1));
    }
    return Math.round(best * 100) / 100;
  }, [x, y]);
}

/** Every pixel the app is holding for a page, over all its pictures. */
async function pixelsHeld(page: Page, number: number): Promise<number> {
  return page.evaluate((n) => [...document.querySelectorAll<HTMLCanvasElement>(`.pdf-page[data-page="${n}"] canvas`)]
    .reduce((total, canvas) => total + canvas.width * canvas.height, 0), number);
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

test('the counter rides with the floating buttons, pill and all', async ({ page }) => {
  // It is chrome, not part of the page: it belongs in the same floating
  // layer as the navbar pill and above it. So when a scrolling document
  // puts the pill away, the counter comes down into the space it left
  // rather than hanging in the middle of the page on its own.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  expect(await page.locator('.navbar-wrap .pdf-counter').count()).toBe(1);
  const offTheEdge = (): Promise<number> => page.evaluate(() => {
    const pill = document.querySelector('.pdf-counter')!.getBoundingClientRect();
    return Math.round(window.innerHeight - pill.bottom);
  });
  const bar = (): Promise<number> => page.evaluate(() => {
    const white = document.querySelector('.pill-white')!.getBoundingClientRect();
    return Math.round(window.innerHeight - white.bottom);
  });
  const above = await offTheEdge();
  expect(above).toBeGreaterThan(await bar()); // clear of the pill, above it
  const header = async (): Promise<number> => (await page.locator('.topbar').boundingBox())!.y;
  const headerWas = await header();
  await page.mouse.move(195, 400);
  for (let i = 0; i < 3; i += 1) { await page.mouse.wheel(0, 500); await page.waitForTimeout(300); }
  const moved = await page.evaluate(() => (document.querySelector('#preview-pane') as HTMLElement).scrollTop);
  expect(moved).toBeGreaterThan(200); // the reader really did travel
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.body.classList.contains('is-hidden-nav'))).toBe(true);
  const dropped = await offTheEdge();
  expect(dropped).toBeLessThan(above); // the counter followed the pill down
  expect(dropped).toBeGreaterThan(0); // and is still on the screen, not off it
  expect(await header()).toBe(headerWas); // while the document's only label stays

  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.body.classList.contains('is-hidden-nav'))).toBe(false);
  expect(await offTheEdge()).toBe(above); // and back above the pill with it
});
});

test('a page is drawn at the screen’s own pixels, inside the budget', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await expect(page.locator('.pdf-raster').first()).toBeVisible();
  const drawn = await page.locator('.pdf-raster').first().evaluate((canvas: HTMLCanvasElement) => ({
    // against the size it is actually shown at, which is the box it is
    // stretched into — it carries no CSS size of its own
    ratio: canvas.width / canvas.getBoundingClientRect().width,
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

test('the page in front of the reader is drawn before the pages behind them', async ({ page }) => {
  // The band of pages kept soft reaches eight screens either way, and it
  // used to be asked for in page order: a reader who jumped into the
  // middle of a document waited while the engine drew the eight screens
  // they had already gone past. The engine takes about a fortieth of a
  // second per page of his book before it draws anything, so that wait is
  // real: a second of it, measured on a flick of his 528-page book.
  await boot(page, { 'long.pdf': tinyPdf(40) }, 'long.pdf');
  await readThis(page, 'long.pdf');
  // Before the background has begun sketching the rest of the document:
  // this is about the order pages are asked of the engine in, and a page
  // already in the sketch book is not asked for at all.
  await page.waitForTimeout(300);
  // Everything drawn so far goes: this is about what comes next, and in
  // what order it arrives -- not what sits earliest in the document. A
  // whole band of pages can come back out of the sketch book on one
  // frame, and reading the column top down would always name the page
  // nearest its head.
  const first = await page.evaluate(async () => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    const sheets = [...document.querySelectorAll('.pdf-page')] as HTMLElement[];
    for (const canvas of document.querySelectorAll('.pdf-page canvas')) canvas.remove();
    const arrived: number[] = [];
    const watch = new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of change.addedNodes) {
          if (!(node instanceof HTMLCanvasElement)) continue;
          const sheet = node.closest('.pdf-page') as HTMLElement | null;
          const number = Number(sheet?.dataset.page);
          if (number) arrived.push(number);
        }
      }
    });
    watch.observe(document.querySelector('.pdf-doc')!, { childList: true, subtree: true });
    pane.scrollTop = sheets[29].offsetTop;
    pane.dispatchEvent(new Event('scroll'));
    const began = performance.now();
    while (!arrived.length && performance.now() - began < 10000) {
      await new Promise((done) => { requestAnimationFrame(() => done(null)); });
    }
    watch.disconnect();
    return arrived[0] ?? -1;
  });
  // the page under the reader's eyes, or one of its neighbours on the
  // screen -- not page 22, which is where the band above them begins
  expect(first).toBeGreaterThan(28);
});

test('the pages after the one being read are drawn before the pages before it', async ({ page }) => {
  // His order, in his words: the page you are on first, then up and down
  // from it. Up and down are not equal -- a document is read downwards --
  // so at the same distance the page after wins. What this replaced
  // ranked every page on the screen ahead of every page off it and then
  // went by pixels, which put the page above the reader ahead of the one
  // they were about to turn to.
  await keepMoving(page);
  await boot(page, { 'long.pdf': tinyPdf(40) }, 'long.pdf');
  await readThis(page, 'long.pdf');
  // The background must not have sketched these pages already: a page it
  // has been round is never asked of the engine again, and this is about
  // the order they are asked for in.
  await page.waitForTimeout(400);
  await letGo(page);
  const order = await page.evaluate(async () => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    const sheets = [...document.querySelectorAll('.pdf-page')] as HTMLElement[];
    for (const canvas of document.querySelectorAll('.pdf-page canvas')) canvas.remove();
    const drawn: number[] = [];
    const watch = new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of change.addedNodes) {
          if (!(node instanceof HTMLCanvasElement)) continue;
          const sheet = node.closest('.pdf-page') as HTMLElement | null;
          const number = Number(sheet?.dataset.page);
          if (number && !drawn.includes(number)) drawn.push(number);
        }
      }
    });
    watch.observe(document.querySelector('.pdf-doc')!, { childList: true, subtree: true });
    pane.scrollTop = sheets[29].offsetTop;
    pane.dispatchEvent(new Event('scroll'));
    await new Promise((done) => setTimeout(done, 2500));
    watch.disconnect();
    return drawn;
  });
  // the page being read, first
  expect(order[0]).toBe(30);
  // and the page after it before the page before it
  expect(order.indexOf(31)).toBeGreaterThan(-1);
  expect(order.indexOf(31)).toBeLessThan(order.indexOf(29) === -1 ? order.length : order.indexOf(29));
});

test('zoomed in, the page being read is sharpened before the pages around it', async ({ page }) => {
  // The other half of his order: a sharp tile is the dearest thing the
  // viewer draws, and the reader gets theirs first. Three pages are on
  // the screen here and all three want one; the queue hands them out
  // from the middle of the screen outwards, leaning downwards.
  await boot(page, { 'long.pdf': tinyPdf(40) }, 'long.pdf');
  await readThis(page, 'long.pdf');
  await page.waitForTimeout(600);
  for (let step = 0; step < 3; step += 1) {
    await page.locator('.pdf-toolbar-button[aria-label="Zoom in"]').click();
    await page.waitForTimeout(400);
  }
  // page 20 across the middle of the screen, 19 above it and 21 below
  await page.evaluate(() => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    const sheet = document.querySelector('.pdf-page[data-page="20"]') as HTMLElement;
    pane.scrollTop = sheet.offsetTop - pane.clientHeight * 0.35;
    pane.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(2500);
  const sharp = await page.evaluate(async () => {
    const order: number[] = [];
    const watch = new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of change.addedNodes) {
          if (!(node instanceof HTMLCanvasElement) || !node.classList.contains('pdf-detail')) continue;
          const sheet = node.closest('.pdf-page') as HTMLElement | null;
          const number = Number(sheet?.dataset.page);
          if (number && !order.includes(number)) order.push(number);
        }
      }
    });
    watch.observe(document.querySelector('.pdf-doc')!, { childList: true, subtree: true });
    // one more step of zoom: every tile on the screen is stale at once
    (document.querySelector('.pdf-toolbar-button[aria-label="Zoom in"]') as HTMLElement).click();
    await new Promise((done) => setTimeout(done, 3500));
    watch.disconnect();
    return order;
  });
  expect(sharp[0]).toBe(20); // the page being read
  if (sharp.includes(19) && sharp.includes(21)) expect(sharp.indexOf(21)).toBeLessThan(sharp.indexOf(19));
});

test('the pages left behind hand back what they were holding', async ({ page }) => {
  // The sweep looks at the band and at whatever was in the band last
  // time, and at nothing else: his book is 528 pages and walking all of
  // them on every frame of a scroll cost 1.4ms a frame. What must not
  // change is that a page left behind still gives its pictures back, and
  // that the page the reader lands on is drawn.
  await boot(page, { 'long.pdf': tinyPdf(40) }, 'long.pdf');
  await readThis(page, 'long.pdf');
  await page.waitForTimeout(800);
  const held = await page.evaluate(async () => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    const sheets = [...document.querySelectorAll('.pdf-page')] as HTMLElement[];
    // away down the document, a couple of screens at a time, the way a
    // reader gets there
    for (let step = 0; step < 12; step += 1) {
      pane.scrollTop += pane.clientHeight * 2;
      pane.dispatchEvent(new Event('scroll'));
      await new Promise((done) => setTimeout(done, 120));
    }
    await new Promise((done) => setTimeout(done, 2500));
    const middle = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      .find((el) => el.classList.contains('pdf-page')) as HTMLElement | undefined;
    return {
      first: sheets[0].querySelectorAll('canvas').length,
      second: sheets[1].querySelectorAll('canvas').length,
      here: middle?.querySelectorAll('canvas').length ?? 0,
      all: document.querySelectorAll('.pdf-page canvas').length,
      pages: [...document.querySelectorAll('.pdf-page')].filter((sheet) => sheet.querySelector('canvas')).length,
    };
  });
  expect(held.first).toBe(0); // long behind: nothing kept
  expect(held.second).toBe(0);
  expect(held.here).toBeGreaterThan(0); // and the page landed on is drawn
  expect(held.pages).toBeLessThan(24); // the band, not the document
});

test('the pages nobody has looked at yet are sketched in the background', async ({ page }) => {
  // His last ask for the reader: the soft pictures should be there
  // already rather than drawn as the pages go past. The band reaches
  // eight screens either way; everything beyond it is drawn while
  // nothing else is happening, outwards from wherever the reader is, and
  // kept at a hundred pixels a page.
  await boot(page, { 'long.pdf': tinyPdf(40) }, 'long.pdf');
  await readThis(page, 'long.pdf');
  await expect(page.locator('.pdf-doc')).toHaveAttribute('data-sketched', '40', { timeout: 60000 });
});

test('a page sketched already is up on the frame the reader lands on it', async ({ page }) => {
  // The point of keeping them: arriving at a page thirty down the
  // document is a canvas going back into a box, on the same frame the
  // scroll is heard, with nothing asked of the engine and nothing
  // waiting in a queue.
  await boot(page, { 'long.pdf': tinyPdf(40) }, 'long.pdf');
  await readThis(page, 'long.pdf');
  await expect(page.locator('.pdf-doc')).toHaveAttribute('data-sketched', '40', { timeout: 60000 });
  const there = await page.evaluate(async () => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    const sheets = [...document.querySelectorAll('.pdf-page')] as HTMLElement[];
    const target = sheets[29]; // never been on the screen, never been drawn into
    pane.scrollTop = target.offsetTop;
    pane.dispatchEvent(new Event('scroll'));
    // one frame: the band is re-planned on it, and that is all the time
    // a picture that has already been drawn needs
    await new Promise((done) => { requestAnimationFrame(() => done(null)); });
    return target.querySelectorAll('canvas').length;
  });
  expect(there).toBeGreaterThan(0);
});

test('while the reader is still moving, the soft pictures come before the sharp ones', async ({ page }) => {
  // In his words: prioritise the low quality ones when scrolling. A
  // sharp page is a fifth of a second of the thread and is drawn for a
  // place the reader has already left; a soft one is a fiftieth. So
  // while the view is moving every page's soft picture outranks any
  // page's sharp one, and the reader's own order -- this page, then
  // outwards -- comes back the moment they stop.
  await keepMoving(page);
  await boot(page, { 'long.pdf': tinyPdf(60) }, 'long.pdf');
  await readThis(page, 'long.pdf');
  // Before the background has sketched any of it: every page this flick
  // crosses has to be asked of the engine, which is the case the order is
  // there for.
  await page.waitForTimeout(400);
  await letGo(page);
  const seen = await page.evaluate(async () => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    const soft = new Set<number>();
    let sharp = 0;
    let softWhenSharp = -1;
    const watch = new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of change.addedNodes) {
          if (!(node instanceof HTMLCanvasElement)) continue;
          const sheet = node.closest('.pdf-page') as HTMLElement | null;
          const number = Number(sheet?.dataset.page);
          if (!number) continue;
          if (node.classList.contains('pdf-rough')) soft.add(number);
          else { sharp += 1; if (softWhenSharp < 0) softWhenSharp = soft.size; }
        }
      }
    });
    watch.observe(document.querySelector('.pdf-doc')!, { childList: true, subtree: true });
    // a flick: still moving, so the planning happens with the hand down
    for (let step = 0; step < 12; step += 1) {
      pane.scrollTop += pane.clientHeight * 2;
      pane.dispatchEvent(new Event('scroll'));
      await new Promise((done) => setTimeout(done, 30));
    }
    watch.disconnect(); // what follows is the reader having stopped
    const moving = { soft: soft.size, sharp, softWhenSharp };
    await new Promise((done) => setTimeout(done, 2000));
    const landed = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      .find((el) => el.classList.contains('pdf-page')) as HTMLElement | undefined;
    return { ...moving, sharpened: landed?.querySelectorAll('canvas.pdf-raster').length ?? 0 };
  });
  // The pages flying past went soft, a run of them, and the first
  // picture to land after the flick began was one of those -- not a
  // whole page at the screen's own pixels for somewhere already gone.
  // Measured on the old order, same flick: eight sharp pages drawn back
  // to back before a single soft one appeared.
  expect(seen.soft).toBeGreaterThan(6);
  expect(seen.softWhenSharp).toBeGreaterThan(0);
  expect(seen.soft).toBeGreaterThan(seen.sharp);
  // and when they stop, the page they stopped on is drawn properly
  expect(seen.sharpened).toBeGreaterThan(0);
});

test('a document kept as bytes in the store opens', async ({ page }) => {
  // Anything over a few megabytes lives in IndexedDB as the bytes it is;
  // only the index stays in localStorage. A 31 MB book turned into a data:
  // URL and back cost a third of a second of the main thread before the
  // engine saw a byte of it.
  await page.addInitScript(() => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/stored.pdf': 1 }, folders: ['Notes'] }));
    if (!localStorage.getItem('satr:tabs')) localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: '' }], active: 0 }));
  });
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.evaluate(async (pdf: string) => {
    const bytes = Uint8Array.from(atob(pdf.slice(pdf.indexOf(',') + 1)), (letter) => letter.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    await new Promise<void>((done) => {
      const open = indexedDB.open('satr', 1);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('files')) open.result.createObjectStore('files'); };
      open.onsuccess = () => {
        const deal = open.result.transaction('files', 'readwrite');
        deal.objectStore('files').put({ blob, mime: 'application/pdf' }, 'Notes/stored.pdf');
        deal.oncomplete = () => done();
      };
    });
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/stored.pdf' }], active: 0 }));
  }, PDF);
  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await readThis(page, 'stored.pdf');
  await expect(page.locator('.pdf-page')).toHaveCount(6);
});

test('the space between pages is the same at every zoom, pinch and all', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await readThis(page, 'handout.pdf');
  await page.waitForTimeout(600);
  /** The space between page one and page two, as the eye sees it. */
  const gap = (): Promise<number> => page.evaluate(() => {
    const one = document.querySelector('.pdf-page[data-page="1"]')!.getBoundingClientRect();
    const two = document.querySelector('.pdf-page[data-page="2"]')!.getBoundingClientRect();
    return Math.round((two.top - one.bottom) * 10) / 10;
  });
  const fingers = (apart: number, up = false): Promise<void> => page.locator('#preview-pane').evaluate((pane, [span, lift]: [number, boolean]) => {
    const box = pane.getBoundingClientRect();
    const midX = box.left + box.width / 2;
    const midY = box.top + box.height / 2;
    const fire = (type: string, id: number, y: number): void => {
      pane.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: midX, clientY: y, bubbles: true, cancelable: true }));
    };
    const kind = lift ? 'pointerup' : (span === 100 ? 'pointerdown' : 'pointermove');
    fire(kind, 1, midY - span / 2);
    fire(kind, 2, midY + span / 2);
  }, [apart, up] as [number, boolean]);

  const atRest = await gap();
  expect(atRest).toBeCloseTo(8, 0);
  await fingers(100);
  for (const span of [250, 400]) {
    await fingers(span);
    await page.waitForTimeout(120);
    // the pages are two and a half, then four times the size; the space
    // between them is the space it was
    expect(await gap()).toBeCloseTo(atRest, 0);
  }
  await fingers(400, true);
  await page.waitForTimeout(2500);
  expect(await gap()).toBeCloseTo(atRest, 0);
  expect(await widthOf(page, 1)).toBeGreaterThan(900); // it really did zoom
});

test.describe('a document far longer than the band that draws it', () => {
  test.use({ viewport: { width: 390, height: 700 } });
  const LONG = tinyPdf(30); // about twenty-five screens of pages

  /** Which pages have a picture in them, and how far down the document each
   *  page sits, counted in screens from where the reader is. */
  async function pictures(page: Page): Promise<{ screens: number; drawn: boolean }[]> {
    return page.evaluate(() => {
      const pane = document.querySelector('#preview-pane') as HTMLElement;
      return [...document.querySelectorAll('.pdf-page')].map((box) => ({
        screens: ((box as HTMLElement).offsetTop - pane.scrollTop) / pane.clientHeight,
        drawn: box.querySelector('canvas') !== null,
      }));
    });
  }
  const at = (rows: { screens: number; drawn: boolean }[], screens: number) =>
    rows.reduce((best, row) => (Math.abs(row.screens - screens) < Math.abs(best.screens - screens) ? row : best));

  test('is not drawn out of sight, but is put back from much further away', async ({ page }) => {
    // A finger on the glass for the whole of the first half of this test,
    // so what is drawn is the band and only the band.
    await keepMoving(page);
    await boot(page, { 'handout.pdf': LONG }, 'handout.pdf');
    await readThis(page, 'handout.pdf');
    // Long enough that the engine has plainly had the time and has not
    // taken it: ten screens down is out of the band's reach, and empty.
    await page.waitForTimeout(1500);
    const early = await pictures(page);
    expect(at(early, 0).drawn).toBe(true);
    expect(at(early, 10).drawn).toBe(false);
    // The hand comes off, the background goes round the document, and those
    // pages are in place without the reader having been near them.
    await letGo(page);
    await expect.poll(async () => Number((await page.locator('.pdf-doc').getAttribute('data-sketched')) ?? 0),
      { timeout: 15000 }).toBeGreaterThan(20);
    await page.waitForTimeout(300);
    const later = await pictures(page);
    expect(at(later, 10).drawn).toBe(true);
    // It has an edge of its own, though: the far end of a long document is
    // not held in the page boxes.
    expect(at(later, 22).drawn).toBe(false);
  });
});
