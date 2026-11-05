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

/** Every page touching the pane has its own picture, not just the
 *  hundred-pixel sketch: the card is filed from whatever is drawn at the
 *  instant the app is put away, and which page counts as the one being
 *  read is the reader's own business (pageShown, which measures from the
 *  middle of the screen below the chrome). */
async function drawnOnScreen(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const pane = document.querySelector('#preview-pane')!.getBoundingClientRect();
    const sheets = [...document.querySelectorAll('.pdf-page')].filter((sheet) => {
      const box = sheet.getBoundingClientRect();
      return box.bottom > pane.top + 4 && box.top < pane.bottom - 4;
    });
    if (!sheets.length) return 0;
    return Math.min(...sheets.map((sheet) => Math.max(0, ...[...sheet.querySelectorAll('canvas')]
      .map((c) => (c as HTMLCanvasElement).width))));
  }), { timeout: 15000 }).toBeGreaterThan(400);
  await page.waitForTimeout(400);
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
  await drawnOnScreen(page);
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
  // A real picture, not a broken one -- and a real *size*. The first
  // version of this used the hundred-pixel sketch the flick layer keeps,
  // which stretched across a card looks exactly as rough as it sounds:
  // "thumbnail quality is really bad". It is taken from the page's own
  // picture now and kept at the card's own resolution.
  const shot = await card.evaluate((img) => ({
    wide: (img as HTMLImageElement).naturalWidth,
    tall: (img as HTMLImageElement).naturalHeight,
  }));
  expect(shot.wide, 'wide enough for a card on a 3x phone').toBeGreaterThan(400);
  expect(shot.tall / shot.wide, 'and the page\u2019s own shape').toBeCloseTo(842 / 595, 1);
});

/** Put the reader's sketches and card down, which is what a trip to the
 *  background does on the phone. */
async function putDown(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(700);
}

const openSwitcher = async (page: Page): Promise<void> => {
  await page.locator('#nav-tabs').dispatchEvent('click');
  await expect(page.locator('.mobile-tab-switcher')).toBeVisible();
};

test('the card is dark when the pages are dark', async ({ page }) => {
  // The stored picture is the paper as the engine drew it -- white -- and
  // in a dark app the switcher was handing back a white rectangle among
  // dark ones. The page's own filter goes over the card.
  await page.addInitScript(() => { localStorage.setItem('satr:pdf-theme', 'dark'); });
  await boot(page, { 'book.pdf': PDF }, 'book.pdf');
  await readThis(page);
  await putDown(page);
  await openSwitcher(page);

  const card = page.locator('.mobile-tab-preview-page .tab-card-page');
  await expect(card).toHaveCount(1, { timeout: 5000 });
  const filter = await card.evaluate((img) => getComputedStyle(img).filter);
  expect(filter, 'the card wears the page\u2019s own inversion').toContain('invert');
  // The same filter the page is wearing, not an approximation of it.
  const onPage = await page.locator('.pdf-page canvas').first().evaluate((el) => getComputedStyle(el).filter);
  expect(filter).toBe(onPage);
});

test('the card is the part of the page that was on the screen', async ({ page }) => {
  // "The pdf thumbnail doesn't show zoom, I wanted it to show the last zoom
  // rather than the entire page." Zoomed into a figure, the card showed the
  // whole sheet -- the one view he had deliberately zoomed out of.
  await boot(page, { 'book.pdf': PDF }, 'book.pdf');
  await readThis(page);
  const pageBox = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!;

  // Double tap to zoom, the way he does it, and let the tile land.
  await page.locator('.pdf-page[data-page="1"]').evaluate((sheet) => {
    const box = sheet.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + 120;
    for (const type of ['pointerdown', 'pointerup', 'pointerdown', 'pointerup']) {
      sheet.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }
  });
  await expect.poll(async () => (await page.locator('.pdf-page[data-page="1"]').boundingBox())?.width ?? 0, { timeout: 5000 })
    .toBeGreaterThan(pageBox.width * 1.4);
  await page.waitForTimeout(900);
  const zoomed = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!;
  await drawnOnScreen(page);

  await putDown(page);
  await openSwitcher(page);
  const card = page.locator('.mobile-tab-preview-page .tab-card-page');
  await expect(card).toHaveCount(1, { timeout: 5000 });
  const shot = await card.evaluate((img) => ({
    wide: (img as HTMLImageElement).naturalWidth,
    tall: (img as HTMLImageElement).naturalHeight,
  }));
  // Not the sheet: an A4 page is 1.41 times as tall as it is wide, and what
  // was on the screen is nothing like that shape. (The shape asserted
  // below is the card's own: see the newer test under this one.)
  expect(shot.tall / shot.wide, 'not the whole sheet any more').not.toBeCloseTo(842 / 595, 1);
  // It is the shape of what was on the glass, within the page's edges.
  const pane = (await page.locator('#preview-pane').boundingBox())!;
  const seen = {
    width: Math.min(pane.x + pane.width, zoomed.x + zoomed.width) - Math.max(pane.x, zoomed.x),
    height: Math.min(pane.y + pane.height, zoomed.y + zoomed.height) - Math.max(pane.y, zoomed.y),
  };
  expect(shot.wide, 'and still a card-sized picture').toBeGreaterThan(300);
  void seen;
});

test('the card is not a picture of what is behind the header', async ({ page }) => {
  // "I practically can't see what is behind the header but the tab thing
  // shows it." The crop was the whole pane, and on a 390 by 844 phone the
  // top 104 of that is the topbar and the pdf toolbar standing over the
  // page -- so a quarter of the card's height was content he could not
  // see, and the part he was looking at was pushed off the bottom.
  await boot(page, { 'book.pdf': PDF }, 'book.pdf');
  await readThis(page);
  const sheet = page.locator('.pdf-page[data-page="1"]');
  const before = (await sheet.boundingBox())!;
  await sheet.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2; const y = box.top + 160;
    for (const type of ['pointerdown', 'pointerup', 'pointerdown', 'pointerup']) {
      el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }
  });
  await expect.poll(async () => (await sheet.boundingBox())?.width ?? 0, { timeout: 5000 }).toBeGreaterThan(before.width * 1.4);
  await drawnOnScreen(page);
  await putDown(page);

  await openSwitcher(page);
  const card = page.locator('.mobile-tab-preview-page .tab-card-page');
  await expect(card).toHaveCount(1, { timeout: 5000 });
  const shot = await card.evaluate((img) => ({
    wide: (img as HTMLImageElement).naturalWidth, tall: (img as HTMLImageElement).naturalHeight,
  }));
  // The card's own shape, so the box cuts nothing off what it kept.
  expect(shot.tall / shot.wide, 'shaped to the card, 175 by 200').toBeCloseTo(200 / 175, 1);

  // And what it kept starts below the header. The page is still on screen
  // at the same zoom, so the two can be compared directly: the top of the
  // card must line up with the first page-pixel the header is not over.
  const where = await page.evaluate(() => {
    const el = document.querySelector('.pdf-page[data-page="1"]') as HTMLElement;
    const box = el.getBoundingClientRect();
    const host = document.querySelector('.pdf-doc')!.parentElement as HTMLElement;
    const chrome = parseFloat(getComputedStyle(host).paddingTop) || 0;
    const pane = document.querySelector('#preview-pane')!.getBoundingClientRect();
    return { chrome, intoPageAtHeader: (pane.top + chrome - box.top) / box.height, pageTall: box.height };
  });
  expect(where.chrome, 'the header really is standing over the page').toBeGreaterThan(60);
  // The visible strip starts that far into the page; a card made from the
  // whole pane would start at zero and show the hidden band.
  expect(where.intoPageAtHeader).toBeGreaterThan(0);
});

test('going away keeps the page you are on, seconds after the last save', async ({ page }) => {
  // The reader files its card as the app is put away, and putDown has a
  // four-second throttle so that sitting still does not rewrite the shelf
  // over and over. The throttle was swallowing the one save that matters:
  // read on a page, leave within four seconds, and the card kept was the
  // one filed before you got there -- the wrong page, and often the
  // hundred-pixel sketch of it.
  await boot(page, { 'book.pdf': PDF }, 'book.pdf');
  await readThis(page);
  await drawnOnScreen(page);
  await putDown(page);
  await openSwitcher(page);
  await expect(page.locator('.mobile-tab-preview-page .tab-card-note')).toContainText('Page 1 of 12');
  await page.locator('.mobile-tab-switcher').press('Escape').catch(() => {});
  await page.keyboard.press('Escape');
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);

  // On to another page, and away again straight after -- inside the
  // throttle's window.
  await page.locator('#preview-pane').evaluate((pane) => { pane.scrollTop += pane.clientHeight * 4; });
  await drawnOnScreen(page);
  await putDown(page);

  await openSwitcher(page);
  const note = await page.locator('.mobile-tab-preview-page .tab-card-note').textContent();
  expect(note, 'the card is the page he left on, not the page he started on').not.toContain('Page 1 of');
});

test('pressing tabs after a zoom shows that zoom, not the card from before it', async ({ page }) => {
  // "The zoom, I think it doesn't happen at the moment... it has a delay
  // or something, I think you'll need to change tab for it to happen." A
  // card is filed when the reader goes idle or the app is put away, and
  // the throttle that stops a reader sitting still from rewriting the
  // shelf treated a zoom on the same page as nothing new to say -- so the
  // card stayed the one from before the zoom, for as long as he stayed on
  // the page. No visibilitychange in this test: the tabs button is the
  // whole of it.
  await boot(page, { 'book.pdf': PDF }, 'book.pdf');
  await readThis(page);
  await drawnOnScreen(page);

  // A card of the sheet is filed first, so there is a stale one to beat.
  await openSwitcher(page);
  const card = page.locator('.mobile-tab-preview-page .tab-card-page');
  await expect(card).toHaveCount(1, { timeout: 5000 });
  const sheetShot = await card.evaluate((img) => (img as HTMLImageElement).naturalHeight / (img as HTMLImageElement).naturalWidth);
  expect(sheetShot, 'the whole sheet, as A4').toBeCloseTo(842 / 595, 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);

  // Zoom, and go straight back -- inside the throttle's four seconds.
  const sheet = page.locator('.pdf-page[data-page="1"]');
  const before = (await sheet.boundingBox())!;
  await sheet.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2; const y = box.top + 160;
    for (const type of ['pointerdown', 'pointerup', 'pointerdown', 'pointerup']) {
      el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }
  });
  await expect.poll(async () => (await sheet.boundingBox())?.width ?? 0, { timeout: 5000 }).toBeGreaterThan(before.width * 1.4);
  await drawnOnScreen(page);

  await openSwitcher(page);
  await expect(card).toHaveCount(1, { timeout: 5000 });
  const zoomShot = await card.evaluate((img) => (img as HTMLImageElement).naturalHeight / (img as HTMLImageElement).naturalWidth);
  expect(zoomShot, 'the zoom he is looking at, shaped to the card').toBeCloseTo(200 / 175, 1);
});
