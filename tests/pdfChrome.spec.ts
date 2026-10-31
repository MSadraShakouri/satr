import { test, expect, type Page } from '@playwright/test';
import { tinyPdf, typesetPdf } from './support/tinyPdf';

// Obsidian's PDF chrome: a strip of controls across the top and a panel
// that slides in over the pages. Its own class names, its own control
// order, and the two panel widths its phone layout uses.

test.use({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2 });

const PDF = tinyPdf(8);
const NOTE = '# a note\n\nwith a line in it\n';

async function boot(page: Page, open: string): Promise<void> {
  await page.addInitScript(([pdf, note, first]) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: { 'Notes/handout.pdf': 1, 'Notes/note.md': 1 }, folders: ['Notes'],
    }));
    localStorage.setItem('satr:fs:file:Notes/handout.pdf', pdf as string);
    localStorage.setItem('satr:fs:file:Notes/note.md', note as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: `Notes/${first as string}` }], active: 0 }));
  }, [PDF, NOTE, open] as [string, string, string]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}
const ready = async (page: Page): Promise<void> => {
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(600);
};
const control = (page: Page, label: string) => page.locator(`.pdf-toolbar-button[aria-label="${label}"]`);
const pageWidth = async (page: Page): Promise<number> =>
  Math.round((await page.locator('.pdf-page[data-page="1"]').boundingBox())!.width);

test('a document gets the strip of controls, in Obsidian\'s own order', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await expect(page.locator('.pdf-toolbar')).toBeVisible();
  for (const label of ['Thumbnails', 'Table of contents', 'Zoom out', 'Zoom in', 'Display options']) {
    await expect(control(page, label)).toBeVisible();
  }
  await expect(page.locator('.pdf-page-numbers')).toHaveText('of 8');
  // left group is the panel, right group is zoom and the page
  const order = await page.evaluate(() => [...document.querySelectorAll('.pdf-toolbar [aria-label], .pdf-toolbar input, .pdf-toolbar span')]
    .map((el) => el.getAttribute('aria-label') ?? el.className));
  expect(order).toEqual(['Thumbnails', 'Table of contents', 'Find in document', 'Zoom out', 'Zoom in',
    'Display options', 'Page', 'pdf-page-numbers']);

  await boot(page, 'note.md');
  await expect(page.locator('.pdf-toolbar')).toHaveCount(0); // a note has no document chrome
});

test('the strip sits under the file\'s header, and the pages under both', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const bar = (await page.locator('.topbar').boundingBox())!;
  const strip = (await page.locator('.pdf-toolbar').boundingBox())!;
  const first = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!;
  // The strip is the header's second line, inside it: a seam is not possible
  // because there is only one element painting the glass.
  expect(await page.evaluate(() => document.querySelector('.pdf-toolbar')!.parentElement!.className)).toBe('topbar');
  expect(Math.round(strip.y + strip.height)).toBe(Math.round(bar.y + bar.height));
  expect(first.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1); // nothing behind either
});

test('the panel lies over the pages, with a thumbnail for every page', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await expect(page.locator('.pdf-sidebar-container')).toBeHidden();
  await control(page, 'Thumbnails').click();
  await expect(page.locator('.pdf-sidebar-container')).toBeVisible();
  await expect(page.locator('.thumbnail')).toHaveCount(8);
  await expect(page.locator('.thumbnail[data-loaded]')).toHaveCount(8, { timeout: 20000 });
  // over the pages, not beside them: the column did not move
  const panel = (await page.locator('.pdf-sidebar-container').boundingBox())!;
  const first = (await page.locator('.pdf-page[data-page="1"]').boundingBox())!;
  expect(Math.round(panel.width)).toBe(140); // the phone width Obsidian uses
  expect(first.x).toBeLessThan(panel.x + panel.width);
  // the page being read is the one marked
  await expect(page.locator('.thumbnail[data-page="1"]')).toHaveClass(/selected/);
  // and tapping one goes there and gets out of the way
  await page.locator('.thumbnail[data-page="6"]').click();
  await page.waitForTimeout(600);
  await expect(page.locator('.pdf-sidebar-container')).toBeHidden();
  await expect(page.locator('.pdf-counter')).toHaveText('6 / 8');
});

test('the panel\'s second view is the table of contents', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await control(page, 'Table of contents').click();
  await expect(page.locator('.pdf-outline-view')).toBeVisible();
  await expect(page.locator('.pdf-thumbnail-view')).toBeHidden();
  // Obsidian widens the panel for it: 275px against the thumbnails' 140px
  expect(Math.round((await page.locator('.pdf-sidebar-container').boundingBox())!.width)).toBe(275);
  // this document has no bookmarks in it, and it says so rather than sitting empty
  await expect(page.locator('.pdf-outline-empty')).toHaveText('No table of contents');
});

test('the page box says where you are and takes you where you ask', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const box = page.locator('.pdf-page-input');
  await expect(box).toHaveValue('1');
  await box.fill('5');
  await box.press('Enter');
  await page.waitForTimeout(600);
  await expect(page.locator('.pdf-counter')).toHaveText('5 / 8');
  await expect(box).toHaveValue('5');
  // and it follows the reader back
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, -4000);
  await page.waitForTimeout(800);
  await expect(box).toHaveValue('1');
});

test('zoom out and zoom in step the page', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const fit = await pageWidth(page);
  await control(page, 'Zoom in').click();
  await page.waitForTimeout(500);
  const bigger = await pageWidth(page);
  expect(bigger).toBeGreaterThan(fit);
  await control(page, 'Zoom out').click();
  await page.waitForTimeout(500);
  expect(await pageWidth(page)).toBe(fit); // a step out undoes a step in
});

test('find marks every match and walks them', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await expect(page.locator('.pdf-findbar')).toBeHidden();
  await control(page, 'Find in document').click();
  await expect(page.locator('.pdf-findbar')).toBeVisible();
  // every page of this document says "Page", so there is one hit per page
  await page.locator('.pdf-findbar input').fill('Page');
  await expect(page.locator('.pdf-find-results-count')).toHaveText('1 of 8', { timeout: 15000 });
  await expect(page.locator('.pdf-find-hit')).toHaveCount(8);
  await expect(page.locator('.pdf-find-hit.is-current')).toHaveCount(1);
  // and a mark is actually painted: the colours here are Satr's own, and a
  // name borrowed from the app being mimicked would leave a box of nothing
  const paint = await page.evaluate(() => {
    const el = document.querySelector('.pdf-find-hit')!;
    const seen = getComputedStyle(el);
    return { fill: seen.backgroundColor, wide: Math.round(el.getBoundingClientRect().width) };
  });
  expect(paint.fill).not.toBe('rgba(0, 0, 0, 0)');
  expect(paint.wide).toBeGreaterThan(4);
  // the arrows walk them, and the document follows
  await control(page, 'Next match').click();
  await expect(page.locator('.pdf-find-results-count')).toHaveText('2 of 8');
  await page.waitForTimeout(500);
  await expect(page.locator('.pdf-counter')).toHaveText('2 / 8');
  // a word that is not there says so rather than going quiet
  await page.locator('.pdf-findbar input').fill('zzzzz');
  await expect(page.locator('.pdf-find-results-count')).toHaveText('No matches', { timeout: 15000 });
  await expect(page.locator('.pdf-find-hit')).toHaveCount(0);
  // and closing it puts the page back the way it was
  await control(page, 'Close find').click();
  await expect(page.locator('.pdf-findbar')).toBeHidden();
  await expect(page.locator('.pdf-toolbar')).toBeVisible();
});

test('the two left buttons are two buttons, each saying whether its view is up', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const lit = () => page.evaluate(() => ['Thumbnails', 'Table of contents'].map((label) =>
    document.querySelector(`.pdf-toolbar-button[aria-label="${label}"]`)!.classList.contains('is-active')));
  expect(await lit()).toEqual([false, false]); // panel shut: neither view is up

  await control(page, 'Thumbnails').click();
  await page.waitForTimeout(350);
  await expect(page.locator('.pdf-thumbnail-view')).toBeVisible();
  expect(await lit()).toEqual([true, false]);

  // the other button swaps the view rather than shutting anything
  await control(page, 'Table of contents').click();
  await page.waitForTimeout(350);
  await expect(page.locator('.pdf-outline-view')).toBeVisible();
  expect(await lit()).toEqual([false, true]);

  // and the button for the view already up puts it away
  await control(page, 'Table of contents').click();
  await page.waitForTimeout(350);
  await expect(page.locator('.pdf-sidebar-container')).toBeHidden();
  expect(await lit()).toEqual([false, false]);
});

test('the contents are read from the document, when the document has any', async ({ page }) => {
  // Every browser's print-to-PDF writes no outline dictionary at all, so a
  // file exported from a note app has nothing for a viewer to show. Given a
  // document that does carry one, this panel shows it.
  await page.addInitScript((pdf) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/book.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/book.pdf', pdf as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/book.pdf' }], active: 0 }));
  }, tinyPdf(4, [], ['Opening', 'Middle', 'The end']));
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await ready(page);
  await control(page, 'Table of contents').click();
  await expect(page.locator('.pdf-outline-view .tree-item-self')).toHaveCount(3);
  await expect(page.locator('.pdf-outline-view')).toContainText('Opening');
  await expect(page.locator('.pdf-outline-view')).toContainText('The end');
  await expect(page.locator('.pdf-outline-empty')).toHaveCount(0);
});

/** A document with no bookmarks in it, opened on its own. */
async function bootTypeset(page: Page, pdf: string): Promise<void> {
  await page.addInitScript((bytes) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/export.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/export.pdf', bytes as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/export.pdf' }], active: 0 }));
  }, pdf);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await ready(page);
}

test('a document with no bookmarks gets a contents list read off its type', async ({ page }) => {
  // The case that matters: nothing a browser prints carries an outline, so
  // every PDF this app and Markor export arrives without one. The headings
  // are still on the pages, set larger than the body.
  await bootTypeset(page, typesetPdf([
    { chapter: 'Chapter One', section: 'Why it happened' },
    { section: 'What came next' },
    { chapter: 'Chapter Two', section: 'The argument' },
    {},
  ]));
  await control(page, 'Table of contents').click();
  const rows = page.locator('.pdf-outline-view .tree-item-self');
  await expect(rows).toHaveCount(5, { timeout: 15000 });
  await expect(rows.nth(0)).toContainText('Chapter One');
  await expect(rows.nth(1)).toContainText('Why it happened');
  await expect(rows.nth(2)).toContainText('What came next');
  await expect(rows.nth(3)).toContainText('Chapter Two');
  await expect(page.locator('.pdf-outline-empty')).toHaveCount(0);
  // the body text is not in it, however many lines of it there are
  await expect(page.locator('.pdf-outline-view')).not.toContainText('the body of the page');
});

test('a derived heading is indented under the one above it and names its page', async ({ page }) => {
  await bootTypeset(page, typesetPdf([
    { chapter: 'Chapter One', section: 'Why it happened' },
    { section: 'What came next' },
    { chapter: 'Chapter Two', section: 'The argument' },
  ]));
  await control(page, 'Table of contents').click();
  const rows = page.locator('.pdf-outline-view .tree-item-self');
  await expect(rows).toHaveCount(5, { timeout: 15000 });
  // The chapters sit flush and the sections sit in from them, nested the
  // way the right sidebar's outline nests its headings: a child row starts
  // 13px in from its parent — 8 of margin, 4 of padding, and the 1px guide
  // line between them.
  const lefts = await rows.evaluateAll((list) =>
    list.map((row) => Math.round(row.getBoundingClientRect().left)));
  expect(lefts.map((left) => left - lefts[0])).toEqual([0, 13, 13, 0, 13]);
  // and an English document leaves the tree the way round it already is
  await expect(page.locator('.pdf-outline-view')).toHaveAttribute('dir', 'ltr');
  // each one knows the page it is on, and goes there
  await expect(rows.nth(3).locator('.tree-item-flair')).toHaveText('3');
  await rows.nth(3).click();
  await page.waitForTimeout(700);
  await expect(page.locator('.pdf-counter')).toHaveText('3 / 3');
});

test('a formula is not a heading, however large it is set', async ({ page }) => {
  // Satr prints display maths at more than the size of the body text, so
  // on a page of lecture notes every equation used to arrive in the
  // contents and bury the headings — 92 entries off a seven-page handout
  // that has six. Maths and code never vote and are never a heading, the
  // same rule the note itself is read by (src/direction.ts).
  await bootTypeset(page, typesetPdf([
    { chapter: 'Counting', formula: 'n! / (r! (n-r)!)', digits: '1' },
    { section: 'Permutations', formula: '5 x 4 x 3 = 60', digits: '2' },
  ]));
  await control(page, 'Table of contents').click();
  const rows = page.locator('.pdf-outline-view .tree-item-self');
  await expect(rows).toHaveCount(2, { timeout: 15000 });
  // exactly the two headings: no equation, and no page number either —
  // a line of nothing but figures is not a heading whatever size it is set
  const titles = await rows.locator('.tree-item-inner').allInnerTexts();
  expect(titles).toEqual(['Counting', 'Permutations']);
});

test('the smallest heading a note can be printed with is still found', async ({ page }) => {
  // print.css sets h4 at 1.1 times the body. A cut at 1.12 — which is
  // where this started — threw that whole level away: 27 headings came
  // back as 20. (h5 and h6 are set at 1em, the body's own size, and
  // nothing can find those.)
  await bootTypeset(page, typesetPdf([
    { chapter: 'Integrals', minor: 'A worked example' },
    { minor: 'Another one' },
  ]));
  await control(page, 'Table of contents').click();
  const rows = page.locator('.pdf-outline-view .tree-item-self');
  await expect(rows).toHaveCount(3, { timeout: 15000 });
  await expect(rows.nth(1)).toContainText('A worked example');
  await expect(rows.nth(2)).toContainText('Another one');
});

test('a document written in Persian turns the whole tree around', async ({ page }) => {
  // The right sidebar's outline takes the note's own direction and mirrors
  // itself: the indent and its guide line come in from the right, and the
  // flair goes to the left. A document's contents are the same tree, so
  // they answer to the same rule (src/rightSidebar.ts, src/direction.ts).
  await bootTypeset(page, tinyPdf(4, [], ['جلسه اول', 'جلسه دوم', 'جلسه سوم']));
  await control(page, 'Table of contents').click();
  const rows = page.locator('.pdf-outline-view .tree-item-self');
  await expect(rows).toHaveCount(3, { timeout: 15000 });
  await expect(rows.first()).toContainText('جلسه اول');
  await expect(page.locator('.pdf-outline-view')).toHaveAttribute('dir', 'rtl');
  // the number is on the left of the row and the title runs to the right edge
  const flair = (await rows.first().locator('.tree-item-flair').boundingBox())!;
  const inner = (await rows.first().locator('.tree-item-inner').boundingBox())!;
  expect(flair.x).toBeLessThan(inner.x);
});

test('a document with nothing set larger than its body still says so', async ({ page }) => {
  // One size all the way down: there is no heading to find, and the panel
  // says that rather than inventing a list out of the body text.
  await bootTypeset(page, typesetPdf([{}, {}, {}]));
  await control(page, 'Table of contents').click();
  await expect(page.locator('.pdf-outline-empty')).toHaveText('No table of contents', { timeout: 15000 });
});

test('the thumbnails do not slide sideways under a thumb', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await control(page, 'Thumbnails').click();
  await page.waitForTimeout(400);
  const pan = await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('.pdf-thumbnail-view')!;
    view.scrollLeft = 200;
    return { left: view.scrollLeft, overflowX: getComputedStyle(view).overflowX };
  });
  expect(pan.overflowX).toBe('hidden');
  expect(pan.left).toBe(0);
});

test('the strip and the panel ride the drawer, and the switcher comes up over them', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await control(page, 'Thumbnails').click();
  await page.waitForTimeout(350);
  const where = () => page.evaluate(() => ['.topbar', '.pdf-toolbar', '.pdf-sidebar-container']
    .map((sel) => Math.round(document.querySelector(sel)!.getBoundingClientRect().x)));
  const home = await where();
  await page.locator('#files').dispatchEvent('click');
  await page.waitForTimeout(700);
  const moved = await where();
  const slid = moved[0] - home[0];
  expect(slid).toBeGreaterThan(0);                   // the header slid
  expect(moved[1] - home[1]).toBe(slid);             // the strip is part of it
  expect(moved[2] - home[2]).toBe(slid);             // and the panel went too

  await page.locator('#backdrop').dispatchEvent('click');
  await page.waitForTimeout(700);
  await control(page, 'Display options').click();
  await page.waitForTimeout(350);
  // the sheet used to open underneath the panel, which left half of it
  // unreachable: the panel sat at z-index 100 and the sheet at 41.
  const top = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('.menu')!;
    const at = menu.getBoundingClientRect();
    const hit = document.elementsFromPoint(at.x + at.width / 2, at.y + 20)[0];
    return { inMenu: !!hit.closest('.menu'), what: hit.className };
  });
  expect(top.inMenu).toBe(true); // nothing of the panel is in front of it
});

test('the header and the strip are one pane of glass', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const look = await page.evaluate(() => {
    const strip = getComputedStyle(document.querySelector('.pdf-toolbar')!);
    const bar = getComputedStyle(document.querySelector('.topbar')!);
    return { stripTint: strip.backgroundColor, stripBlur: strip.backdropFilter,
      barTint: bar.backgroundColor, barBlur: bar.backdropFilter,
      height: Math.round(document.querySelector('.topbar')!.getBoundingClientRect().height) };
  });
  // the strip paints nothing of its own: one surface, so no line can appear
  // between them whatever is behind
  expect(look.stripTint).toBe('rgba(0, 0, 0, 0)');
  expect(look.stripBlur).toBe('none');
  expect(look.barBlur).not.toBe('none');
  expect(look.height).toBe(104); // 12 + 44 + 8 + 40, the strip included
});
