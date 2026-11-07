import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// The header over a document gets out of the way while it is being read.
//
// "Maybe hide the bottom part (or both parts) of the pdf header when
// scrolling, have option for it, right now the top bar and bottom pill take
// a noticeable space of screen." The pill already left with the navigation
// bar; the header did not, because a document's header is its only label.
// So it is a setting. The answer he picked after seeing four of them drawn
// (Round 8, variant A) is now the default and is pinned first below: the name
// and the controls leave together, the two buttons -- files and the file menu
// -- stay on the glass, and a tap only ever brings the header back.
//
// The thing that must not happen is the pages moving. The header floats
// over the pane, so taking it away uncovers pages that are already there --
// and that is pinned below, because a column that jumps under a scrolling
// thumb is worse than a header nobody asked to keep.

test.use({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2 });

const PDF = tinyPdf(8);

async function boot(page: Page, chrome?: 'stays' | 'controls' | 'split' | 'all', document = PDF): Promise<void> {
  await page.addInitScript(([pdf, choice]) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/handout.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/handout.pdf', pdf as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/handout.pdf' }], active: 0 }));
    localStorage.setItem('satr:demoShown', '1');
    if (choice) localStorage.setItem('satr:settings', JSON.stringify({ documentChrome: choice }));
  }, [document, chrome ?? ''] as [string, string]);
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
const titleInk = (page: Page): Promise<string> =>
  page.locator('#topbar-title').evaluate((el) => getComputedStyle(el).opacity);
/** The two buttons, as the reader finds them: on the glass and takers of taps. */
const twoButtons = (page: Page): Promise<{ files: boolean; more: boolean; tappable: boolean }> =>
  page.evaluate(() => {
    const files = document.querySelector('#files') as HTMLElement;
    const more = document.querySelector('#file-actions') as HTMLElement;
    const seen = (el: HTMLElement): boolean => {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      if (getComputedStyle(el).visibility === 'hidden') return false;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    };
    return { files: seen(files), more: seen(more), tappable: getComputedStyle(files).pointerEvents !== 'none' };
  });

test('by default the name and the controls go, and the two buttons stay', async ({ page }) => {
  await boot(page);
  const whole = await glassEdge(page);
  expect(whole, 'the glass covers both rows to begin with').toBeGreaterThan(90);
  expect(await controlsInk(page)).toBe('1');
  expect(await titleInk(page)).toBe('1');

  await readDown(page);
  expect(await away(page), 'the bars went away').toBe(true);
  expect(await controlsInk(page), 'the controls faded out').toBe('0');
  expect(await titleInk(page), 'and the name went with them').toBe('0');

  // The point of the answer he picked: the two buttons are still there, still
  // on top of the page, and still answering taps with the header gone.
  const two = await twoButtons(page);
  expect(two.files, 'files is still on the glass').toBe(true);
  expect(two.more, 'and so is the file menu').toBe(true);
  expect(two.tappable, 'and it still takes the taps meant for it').toBe(true);

  // The glass is drawn behind the two rows and leaves with both of them, so
  // nothing of the bar is left between them but the buttons themselves.
  const lifted = await page.locator('.topbar').evaluate((el) =>
    Math.round(new DOMMatrix(getComputedStyle(el, '::before').transform).m42));
  // Where the controls row sits when the header is whole: its own height plus
  // everything above it, which is the name and the room it keeps.
  const room = await page.evaluate(() => {
    const toolbar = document.querySelector('.pdf-toolbar') as HTMLElement;
    return Math.round(toolbar.offsetTop + toolbar.offsetHeight);
  });
  expect(-lifted, 'the glass rose by the name and the controls together').toBe(room);
});

test('a tap brings the whole header back, and never hides it', async ({ page }) => {
  await boot(page);
  await readDown(page);
  expect(await away(page)).toBe(true);

  // A tap on the page itself: the finger that stopped, not the scroll.
  await page.mouse.click(195, 500);
  await page.waitForTimeout(600);
  expect(await away(page), 'the bars are back').toBe(false);
  expect(await controlsInk(page)).toBe('1');
  expect(await titleInk(page)).toBe('1');

  // And a second tap on the page leaves it all alone: a tap only restores.
  await page.mouse.click(195, 500);
  await page.waitForTimeout(600);
  expect(await away(page), 'a tap never takes the header away').toBe(false);
  expect(await controlsInk(page)).toBe('1');
  expect(await titleInk(page)).toBe('1');
});

test('a tap on the file menu still opens it with the header gone', async ({ page }) => {
  await boot(page);
  await readDown(page);
  expect(await away(page)).toBe(true);
  await page.locator('#file-actions').click();
  await expect(page.locator('.menu')).toHaveCount(1);
  await expect(page.locator('.menu-item', { hasText: 'Rotation' })).toHaveCount(1);
});

test('a one-page document never loses its header', async ({ page }) => {
  await boot(page, undefined, tinyPdf(1));
  await page.mouse.move(195, 400);
  for (let i = 0; i < 3; i += 1) { await page.mouse.wheel(0, 500); await page.waitForTimeout(300); }
  await page.waitForTimeout(500);
  // Nothing can scroll, so nothing can ask the header to go -- which is the
  // trap this answer was picked for.
  expect(await away(page), 'there is nothing to scroll, so nothing went').toBe(false);
  expect(await controlsInk(page)).toBe('1');
  expect(await titleInk(page)).toBe('1');
  await page.mouse.click(195, 500);
  await page.waitForTimeout(400);
  expect(await titleInk(page), 'and a tap does not hide it either').toBe('1');
});

test('a note keeps the header it had', async ({ page }) => {
  // The rule is a document's, and `is-pdf-chrome` is what every one of its
  // rules hangs on. A note never sets it, so the setting cannot reach a note:
  // its header slides away whole, exactly as it did before this round.
  await page.addInitScript((pdf) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/handout.pdf': 1, 'Notes/plain.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/handout.pdf', pdf as string);
    localStorage.setItem('satr:fs:file:Notes/plain.md', '# Plain\n\n' + 'a line of the note\n\n'.repeat(200));
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/plain.md' }], active: 0 }));
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:settings', JSON.stringify({ documentChrome: 'split' }));
  }, PDF);
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.body.classList.contains('is-pdf-chrome')),
    'a note is not a document').toBe(false);

  await readDown(page);
  expect(await away(page), "the note's own rule still takes its header away").toBe(true);
  // Whole, not in halves: the note's bar moves as one, which is what it did
  // before and what this round must not change.
  const moved = await page.locator('.topbar').evaluate((el) => getComputedStyle(el).transform);
  expect(moved, 'the whole header left, as it always did').not.toBe('none');
  expect(await titleInk(page), 'there is no document name in it to keep').toBe('1');
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
