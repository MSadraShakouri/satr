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

/** How far down the glass's bottom edge is right now, animation included. */
const glassEdge = (page: Page): Promise<number> =>
  page.locator('.topbar').evaluate((el) => {
    const shift = new DOMMatrix(getComputedStyle(el, '::before').transform).m42;
    return Math.round(el.getBoundingClientRect().height + shift);
  });
const controlsInk = (page: Page): Promise<string> =>
  page.locator('.pdf-toolbar').evaluate((el) => getComputedStyle(el).opacity);
const headerInk = (page: Page): Promise<string> =>
  page.locator('.topbar').evaluate((el) => getComputedStyle(el).opacity);
const away = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.body.classList.contains('is-hidden-nav'));

test('by default the controls go and the name stays', async ({ page }) => {
  await boot(page);
  const whole = await glassEdge(page);
  expect(whole, 'the glass covers both rows to begin with').toBeGreaterThan(90);
  expect(await controlsInk(page)).toBe('1');

  await readDown(page);
  expect(await away(page), 'the bars went away').toBe(true);
  expect(await controlsInk(page), 'the controls faded out').toBe('0');
  expect(await headerInk(page), 'the name stayed').toBe('1');
  // 48px of page uncovered: the controls row and the gap above it.
  expect(whole - (await glassEdge(page)), 'the glass pulled up by the row it shed').toBe(48);

  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(600);
  expect(await controlsInk(page), 'and come back on the way up').toBe('1');
  expect(await glassEdge(page)).toBe(whole);
});

test('the controls leave the way the rest of the app leaves', async ({ page }) => {
  await boot(page);
  // "The animation isn't smooth like other things in the app." It was a
  // height animation, which is a layout on every frame; the rest of the app
  // moves with transforms, which the compositor can do on its own. Both the
  // properties and the timing are the header's own now.
  const how = await page.evaluate(() => {
    const bar = getComputedStyle(document.querySelector('.pdf-toolbar')!);
    const glass = getComputedStyle(document.querySelector('.topbar')!, '::before');
    const header = getComputedStyle(document.querySelector('.topbar')!);
    return {
      moves: bar.transitionProperty, glassMoves: glass.transitionProperty,
      timing: bar.transitionTimingFunction, duration: bar.transitionDuration,
      headerTiming: header.transitionTimingFunction, headerDuration: header.transitionDuration,
    };
  });
  expect(how.moves, 'nothing that costs a layout is animated').toBe('opacity, transform');
  expect(how.glassMoves).toBe('transform');
  expect(how.duration, "the header's own: 0.2s fade, 0.3s move").toBe('0.2s, 0.3s');
  expect(how.timing).toBe('ease-in-out, ease-in-out');
  expect(how.duration).toBe(how.headerDuration);
  expect(how.timing).toBe(how.headerTiming);
});

test('hiding the controls does not relayout the page, frame after frame', async ({ page, context }) => {
  await boot(page);
  const client = await context.newCDPSession(page);
  await client.send('Performance.enable');
  const count = async (): Promise<number> => {
    const { metrics } = await client.send('Performance.getMetrics');
    return metrics.find((m) => m.name === 'LayoutCount')!.value;
  };
  const before = await count();
  // The hide on its own, with no scrolling to muddy the count: the class a
  // scroll would have set, and then the length of the animation.
  await page.evaluate(() => document.body.classList.add('is-hidden-nav'));
  await page.waitForTimeout(700);
  const spent = (await count()) - before;
  // Measured: the height animation this replaced cost 12 layouts and 2.1ms
  // of layout here, one per frame of the slide, on a desktop with nothing
  // else to do. A transform costs one.
  expect(spent, `layouts while the chrome left: ${spent}`).toBeLessThan(4);
});

test('"hide the whole header" takes the name with it', async ({ page }) => {
  await boot(page, 'all');
  await readDown(page);
  expect(await headerInk(page)).toBe('0');
  expect(await page.locator('.topbar').evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
});

test('"keep the header" leaves it exactly as it was', async ({ page }) => {
  await boot(page, 'stays');
  const was = await glassEdge(page);
  await readDown(page);
  expect(await away(page), 'the navigation bar still goes').toBe(true);
  expect(await glassEdge(page), 'but the glass stays').toBe(was);
  expect(await controlsInk(page), 'and so do the controls').toBe('1');
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
