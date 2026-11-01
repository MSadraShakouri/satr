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
/** The contents button opens the app's own outline panel: a document's
 *  contents are an outline, and the app has one place for those. */
const openContents = async (page: Page): Promise<void> => {
  await control(page, 'Table of contents').click();
  await expect(page.locator('body')).toHaveClass(/outline-open/);
  await page.waitForTimeout(600);
};
const contentsRows = (page: Page) => page.locator('#right-panel .tree-item-self');
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
  // No search icon up here: finding something in what is open is the job of
  // the magnifier at the bottom of the screen, in every kind of tab.
  expect(order).toEqual(['Thumbnails', 'Table of contents', 'Zoom out', 'Zoom in',
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

test('the contents button opens the app\'s outline panel, not one of its own', async ({ page }) => {
  // The viewer used to carry a second tree of its own, in a panel of its
  // own, that looked exactly like the app's outline and did the same
  // thing. One outline, one place: the button is still in Obsidian's own
  // spot on the strip and it opens the drawer the app already has.
  await boot(page, 'handout.pdf');
  await ready(page);
  await openContents(page);
  await expect(page.locator('#right-panel')).toContainText('handout.pdf');
  await expect(page.locator('#right-panel')).toContainText('8 pages');
  // this document has no bookmarks in it, and the panel says so
  await expect(page.locator('#right-panel')).toContainText('No table of contents');
  // and the viewer's own panel is not up, nor is there a second tree in
  // the page at all
  await expect(page.locator('.pdf-sidebar-container')).toBeHidden();
  await expect(page.locator('.pdf-outline-view')).toHaveCount(0);
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

test('a step of zoom travels, and the pages are drawn for where it lands', async ({ page }) => {
  // A tap on + used to swap one view for another with nothing in between.
  // Now the view the reader had is scaled into the one they asked for.
  // The layout is not what moves: it goes to its final size on the first
  // frame, so the sharp pictures are being drawn for the size the pages
  // are about to be rather than after they arrive.
  await boot(page, 'handout.pdf');
  await ready(page);
  const look = () => page.evaluate(() => {
    const first = document.querySelector('.pdf-page[data-page="1"]') as HTMLElement;
    return {
      shown: Math.round(first.getBoundingClientRect().width),
      laid: first.offsetWidth,
      moving: (document.querySelector('.pdf-doc') as HTMLElement).getAnimations().length,
      // The sharp picture for the size the pages have landed at. Drawing
      // it is the expensive half of a zoom, and it is deliberately not
      // done while they are moving.
      sharp: (first.querySelector('.pdf-detail') as HTMLCanvasElement | null)?.width ?? 0,
    };
  });
  const still = await look();
  await control(page, 'Zoom in').click();
  const frames = [];
  for (let i = 0; i < 4; i += 1) { frames.push(await look()); await page.waitForTimeout(45); }
  const landed = frames[0].laid;
  expect(landed).toBeGreaterThan(still.laid);
  for (const frame of frames) expect(frame.laid).toBe(landed); // the layout never travels
  expect(frames[0].shown).toBeLessThan(landed); // what is seen starts where it was
  expect(frames[0].moving).toBe(1);
  expect(new Set(frames.map((frame) => frame.shown)).size).toBeGreaterThan(2); // and passes through
  for (const frame of frames) expect(frame.sharp).toBe(0); // the move first, with the work held back

  await page.waitForTimeout(600);
  const rest = await look();
  expect(rest.shown).toBe(landed); // arriving exactly where the layout already was
  expect(rest.moving).toBe(0);
  expect(rest.sharp).toBeGreaterThan(landed); // and the work done the moment it lands
  // nothing is left on the element afterwards, so a pinch starts clean
  expect(await page.evaluate(() => (document.querySelector('.pdf-doc') as HTMLElement).style.transformOrigin)).toBe('');
});

test('a reader who does not want motion does not get it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, 'handout.pdf');
  await ready(page);
  const fit = await pageWidth(page);
  await control(page, 'Zoom in').click();
  await page.waitForTimeout(30);
  expect(await pageWidth(page)).toBeGreaterThan(fit); // there at once, no travelling
  expect(await page.evaluate(() => (document.querySelector('.pdf-doc') as HTMLElement).getAnimations().length)).toBe(0);
});

test('one find button, and it is the app\'s own', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  // The strip gave its magnifier up, so there is exactly one way in.
  await expect(page.locator('.pdf-toolbar [aria-label="Find in document"]')).toHaveCount(0);
  const pill = page.locator('#nav-find');
  await pill.click();
  await expect(page.locator('.pdf-findbar')).toBeVisible();
  // and what opens is the bar a note gets, not a second, lesser one
  await expect(page.locator('.pdf-findbar.document-search-container')).toHaveCount(1);
  await expect(page.locator('.pdf-findbar .search-input-container input')).toBeFocused();
  // the same button closes it again
  await pill.click();
  await expect(page.locator('.pdf-findbar')).toBeHidden();
  // and it never drops the reader into the editor on the way
  await expect(page.locator('.cm-editor')).toBeHidden();
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible();
});

test('the current match is the same highlight, deeper', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await page.locator('#nav-find').click();
  await page.locator('.pdf-findbar input').fill('Page');
  await expect(page.locator('.pdf-find-hit.is-current')).toHaveCount(1, { timeout: 15000 });
  const paint = await page.evaluate(() => {
    const read = (el: Element) => getComputedStyle(el);
    const one = read(document.querySelector('.pdf-find-hit:not(.is-current)')!);
    const now = read(document.querySelector('.pdf-find-hit.is-current')!);
    const alpha = (c: string) => Number((/rgba?\([^)]*?([\d.]+)\)/.exec(c) ?? [, '1'])[1]);
    return {
      restAlpha: alpha(one.backgroundColor), nowAlpha: alpha(now.backgroundColor),
      ring: now.boxShadow, rest: one.backgroundColor, now: now.backgroundColor,
      accent: getComputedStyle(document.body).getPropertyValue('--accent').trim(),
    };
  });
  // deeper than its neighbours...
  expect(paint.nowAlpha).toBeGreaterThan(paint.restAlpha);
  // ...and still the highlight, not the colour a selection is drawn in
  expect(paint.now).not.toBe(paint.accent);
  expect(paint.ring === 'none' || paint.ring === '').toBe(true);
});

test('find marks every match and walks them', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await expect(page.locator('.pdf-findbar')).toBeHidden();
  // The app's own find button, the one a note uses, opens a document's find.
  await page.locator('#nav-find').click();
  await expect(page.locator('.pdf-findbar')).toBeVisible();
  // every page of this document says "Page", so there is one hit per page
  await page.locator('.pdf-findbar input').fill('Page');
  await expect(page.locator('.document-search-count')).toHaveText('1 / 8', { timeout: 15000 });
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
  await page.locator('.pdf-findbar [aria-label="Next match"]').click();
  await expect(page.locator('.document-search-count')).toHaveText('2 / 8');
  await page.waitForTimeout(500);
  await expect(page.locator('.pdf-counter')).toHaveText('2 / 8');
  // a word that is not there says so rather than going quiet
  await page.locator('.pdf-findbar input').fill('zzzzz');
  // the count a note's bar shows for a word that is not there, and the
  // field goes red behind it
  await expect(page.locator('.document-search-count')).toHaveText('0 / 0', { timeout: 15000 });
  await expect(page.locator('.pdf-find-hit')).toHaveCount(0);
  // and closing it puts the page back the way it was
  await page.locator('.pdf-findbar [aria-label="Close find"]').click();
  await expect(page.locator('.pdf-findbar')).toBeHidden();
  await expect(page.locator('.pdf-toolbar')).toBeVisible();
});

test('the thumbnails button says whether its panel is up, and the contents button hands over', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const lit = () => page.evaluate(() =>
    document.querySelector('.pdf-toolbar-button[aria-label="Thumbnails"]')!.classList.contains('is-active'));
  expect(await lit()).toBe(false); // panel shut

  await control(page, 'Thumbnails').click();
  await page.waitForTimeout(350);
  await expect(page.locator('.pdf-thumbnail-view')).toBeVisible();
  expect(await lit()).toBe(true);

  // the contents are the app's panel, so the viewer's own goes away as it
  // opens: two panels over each other is nobody's idea of a reading view
  await openContents(page);
  await expect(page.locator('.pdf-sidebar-container')).toBeHidden();
  expect(await lit()).toBe(false);

  // the drawer is over the strip while it is open, the way every drawer in
  // the app is: it is put away by the backdrop, not by the button again
  await page.locator('#backdrop').dispatchEvent('click');
  await page.waitForTimeout(700);

  // and the button that owns a panel puts it away again
  await control(page, 'Thumbnails').click();
  await page.waitForTimeout(350);
  expect(await lit()).toBe(true);
  await control(page, 'Thumbnails').click();
  await page.waitForTimeout(350);
  await expect(page.locator('.pdf-sidebar-container')).toBeHidden();
  expect(await lit()).toBe(false);
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
  await openContents(page);
  await expect(contentsRows(page)).toHaveCount(3, { timeout: 15000 });
  await expect(page.locator('#right-panel')).toContainText('Opening');
  await expect(page.locator('#right-panel')).toContainText('The end');
  await expect(page.locator('#right-panel')).not.toContainText('No table of contents');
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
  await openContents(page);
  const rows = contentsRows(page);
  await expect(rows).toHaveCount(5, { timeout: 15000 });
  await expect(rows.nth(0)).toContainText('Chapter One');
  await expect(rows.nth(1)).toContainText('Why it happened');
  await expect(rows.nth(2)).toContainText('What came next');
  await expect(rows.nth(3)).toContainText('Chapter Two');
  // the body text is not in it, however many lines of it there are
  await expect(page.locator('#right-panel')).not.toContainText('the body of the page');
});

test('a derived heading is indented under the one above it and names its page', async ({ page }) => {
  await bootTypeset(page, typesetPdf([
    { chapter: 'Chapter One', section: 'Why it happened' },
    { section: 'What came next' },
    { chapter: 'Chapter Two', section: 'The argument' },
  ]));
  await openContents(page);
  const rows = contentsRows(page);
  await expect(rows).toHaveCount(5, { timeout: 15000 });
  // The chapters sit flush and the sections sit in from them, the way the
  // panel nests a note's headings -- a document's contents are the same
  // tree as a note's outline, because they are the same panel.
  const lefts = await rows.evaluateAll((list) =>
    list.map((row) => Math.round(row.getBoundingClientRect().left)));
  expect(lefts.map((left) => left - lefts[0])).toEqual([0, 17, 17, 0, 17]);
  // and an English document leaves the tree the way round it already is
  await expect(page.locator('#right-panel .outline-tree')).toHaveAttribute('dir', 'ltr');
  // a row goes to the page its heading is on
  await rows.nth(3).click();
  await page.waitForTimeout(900);
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
  await openContents(page);
  const rows = contentsRows(page);
  await expect(rows).toHaveCount(2, { timeout: 15000 });
  // exactly the two headings: no equation, and no page number either —
  // a line of nothing but figures is not a heading whatever size it is set
  const titles = await rows.locator('.tree-item-inner').allInnerTexts();
  expect(titles).toEqual(['Counting', 'Permutations']);
});

test('the text of a page is not its contents, however it is set', async ({ page }) => {
  // A document set in two sizes: ordinary prose a size above the rest of
  // the page, which is what a long quotation or an imported section comes
  // out as. Every one of those lines is larger than the body and short
  // enough to be a title, so all sixty of them used to arrive in the
  // contents and bury the six real headings.
  const pdf = typesetPdf(Array.from({ length: 6 }, (_, i) => ({ chapter: `Part ${i + 1}`, aside: 10 })));
  await bootTypeset(page, pdf);
  await openContents(page);
  await expect(contentsRows(page)).toHaveCount(6, { timeout: 15000 });
  const titles = await page.locator('#right-panel .tree-item-inner').allInnerTexts();
  expect(titles).toEqual(['Part 1', 'Part 2', 'Part 3', 'Part 4', 'Part 5', 'Part 6']);
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
  await openContents(page);
  const rows = contentsRows(page);
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
  await openContents(page);
  const rows = contentsRows(page);
  await expect(rows).toHaveCount(3, { timeout: 15000 });
  await expect(rows.first()).toContainText('جلسه اول');
  await expect(page.locator('#right-panel .outline-tree')).toHaveAttribute('dir', 'rtl');
  // the tree indents from the right, so a row's title starts well in from
  // the right edge of the panel rather than at its left
  const row = (await rows.first().boundingBox())!;
  const inner = (await rows.first().locator('.tree-item-inner').boundingBox())!;
  expect(inner.x + inner.width).toBeLessThanOrEqual(row.x + row.width + 1);
});

test('a document with nothing set larger than its body still says so', async ({ page }) => {
  // One size all the way down: there is no heading to find, and the panel
  // says that rather than inventing a list out of the body text.
  await bootTypeset(page, typesetPdf([{}, {}, {}]));
  await openContents(page);
  await expect(page.locator('#right-panel')).toContainText('No table of contents', { timeout: 20000 });
  await expect(contentsRows(page)).toHaveCount(0);
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

test('a match is one band a line, at the height of the line', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await page.locator('#nav-find').click();
  // A phrase, not a word: the engine hands a match back as a box per run of
  // glyphs, so a phrase comes back in pieces. Drawn as they come, they are a
  // ragged skyline of blocks at several heights.
  await page.locator('.pdf-findbar input').fill('Page 1');
  await expect(page.locator('.document-search-count')).toHaveText('1 / 1', { timeout: 15000 });
  await expect(page.locator('.pdf-find-hit')).toHaveCount(1);
  const band = await page.locator('.pdf-find-hit').first().evaluate((el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    const sheet = (document.querySelector('.pdf-page[data-page="1"]') as HTMLElement).getBoundingClientRect();
    // the text is set in 36pt on an 842pt page, and the box the engine
    // gives for it is the font's own, 0.040 of the page tall
    return { high: box.height / sheet.height };
  });
  // grown past the letters, so it reads as a stroke rather than a hug...
  expect(band.high).toBeGreaterThan(0.048);
  // ...and not so far that two lines of a paragraph would touch
  expect(band.high).toBeLessThan(0.07);
});

test('the field you type into can be told from the bar it sits on', async ({ page }) => {
  for (const mode of ['light', 'dark'] as const) {
    await page.addInitScript((theme) => localStorage.setItem('satr:theme', theme as string), mode);
    await boot(page, 'handout.pdf');
    await ready(page);
    await page.locator('#nav-find').click();
    await expect(page.locator('.pdf-findbar')).toBeVisible();
    const paint = await page.evaluate(() => {
      const field = document.querySelector('.pdf-findbar input')!;
      const bar = document.querySelector('.pdf-findbar')!;
      return { field: getComputedStyle(field).backgroundColor, bar: getComputedStyle(bar).backgroundColor };
    });
    // It was the colour of its own bar behind a hairline: white on white in
    // the light theme, where it could not be found at all, and three shades
    // of nearly black in the dark one. A field is filled, as the panel's is.
    expect(paint.field, mode).not.toBe(paint.bar);
  }
});

test('a Persian query lays the bar out the way a note\'s does', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await page.locator('#nav-find').click();
  await page.locator('.pdf-findbar input').fill('صفحه');
  await page.waitForTimeout(600);
  const bar = await page.evaluate(() => {
    const count = document.querySelector('.document-search-count') as HTMLElement;
    const field = document.querySelector('.pdf-findbar input') as HTMLInputElement;
    const box = field.getBoundingClientRect();
    const seen = count.getBoundingClientRect();
    return {
      rtlClass: document.querySelector('.pdf-findbar')!.classList.contains('mod-rtl-query'),
      countDir: count.dir, text: count.textContent,
      // the room the field keeps for the count, on the side the count is on
      padStart: getComputedStyle(field).paddingInlineStart,
      countLeftOfMiddle: seen.left + seen.width / 2 < box.left + box.width / 2,
    };
  });
  // The document's bar was the odd one out: the count stayed on the right
  // in English digits while the text it counts ran the other way, and the
  // field kept its 72px of room on the wrong edge.
  expect(bar.rtlClass).toBe(true);
  expect(bar.countDir).toBe('rtl');
  expect(bar.countLeftOfMiddle).toBe(true);
  expect(bar.padStart).toBe('16px');
  expect(bar.text).toMatch(/[۰-۹]/);
});
