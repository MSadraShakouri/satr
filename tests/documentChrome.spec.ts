import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// The header over a document gets out of the way while it is being read.
//
// "Maybe hide the bottom part (or both parts) of the pdf header when
// scrolling, have option for it, right now the top bar and bottom pill take
// a noticeable space of screen." The pill already left with the navigation
// bar; the header did not, because a document's header is its only label.
// So it is a setting with three answers, and the default takes the row of
// buttons and keeps the name.
//
// The thing that must not happen is the pages moving. The header floats
// over the pane, so taking it away uncovers pages that are already there --
// and that is pinned below, because a column that jumps under a scrolling
// thumb is worse than a header nobody asked to keep.

test.use({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2 });

const PDF = tinyPdf(8);

async function boot(page: Page, chrome?: 'stays' | 'controls' | 'all'): Promise<void> {
  await page.addInitScript(([pdf, choice]) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/handout.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/handout.pdf', pdf as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/handout.pdf' }], active: 0 }));
    localStorage.setItem('satr:demoShown', '1');
    if (choice) localStorage.setItem('satr:settings', JSON.stringify({ documentChrome: choice }));
  }, [PDF, chrome ?? ''] as [string, string]);
  await page.goto('/');
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(600);
}

/** Scroll the document the way a reader does, and let the bars settle. */
async function readDown(page: Page): Promise<void> {
  await page.mouse.move(195, 400);
  for (let i = 0; i < 3; i += 1) { await page.mouse.wheel(0, 500); await page.waitForTimeout(300); }
  await page.waitForTimeout(500);
}

const toolbarHeight = (page: Page): Promise<number> =>
  page.locator('.pdf-toolbar').evaluate((el) => el.getBoundingClientRect().height);
const headerInk = (page: Page): Promise<string> =>
  page.locator('.topbar').evaluate((el) => getComputedStyle(el).opacity);
const away = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.body.classList.contains('is-hidden-nav'));

test('by default the controls go and the name stays', async ({ page }) => {
  await boot(page);
  expect(await toolbarHeight(page), 'the controls are there to begin with').toBeGreaterThan(20);
  await readDown(page);
  expect(await away(page), 'the bars went away').toBe(true);
  expect(await toolbarHeight(page), 'the controls folded away').toBeLessThan(2);
  expect(await headerInk(page), 'the name stayed').toBe('1');

  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(500);
  expect(await toolbarHeight(page), 'and come back on the way up').toBeGreaterThan(20);
});

test('"hide the whole header" takes the name with it', async ({ page }) => {
  await boot(page, 'all');
  await readDown(page);
  expect(await headerInk(page)).toBe('0');
  expect(await page.locator('.topbar').evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
});

test('"keep the header" leaves it exactly as it was', async ({ page }) => {
  await boot(page, 'stays');
  const was = await toolbarHeight(page);
  await readDown(page);
  expect(await away(page), 'the navigation bar still goes').toBe(true);
  expect(await toolbarHeight(page), 'but the controls stay').toBeCloseTo(was, 0);
  expect(await headerInk(page)).toBe('1');
});

test('the pages do not move when the header goes', async ({ page }) => {
  await boot(page);
  await readDown(page);
  // Where the column stands, and where a page is on the glass, across the
  // moment the chrome leaves: the header floats over the pane, so uncovering
  // it must not shift anything by so much as a pixel.
  const place = async () => page.evaluate(() => {
    const pane = document.querySelector('#preview-pane') as HTMLElement;
    const page1 = document.querySelector('.pdf-page') as HTMLElement;
    return { top: Math.round(pane.scrollTop), y: Math.round(page1.getBoundingClientRect().top) };
  });
  const before = await place();
  await page.waitForTimeout(400); // the fold-away animation finishes
  const after = await place();
  expect(after.top, 'the column stayed where it was').toBe(before.top);
  expect(Math.abs(after.y - before.y), 'and the page on the glass did not jump').toBeLessThan(2);
});
