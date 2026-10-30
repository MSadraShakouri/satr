import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

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
  for (const label of ['Toggle sidebar', 'Sidebar options', 'Zoom out', 'Zoom in', 'Display options']) {
    await expect(control(page, label)).toBeVisible();
  }
  await expect(page.locator('.pdf-page-numbers')).toHaveText('of 8');
  // left group is the panel, right group is zoom and the page
  const order = await page.evaluate(() => [...document.querySelectorAll('.pdf-toolbar [aria-label], .pdf-toolbar input, .pdf-toolbar span')]
    .map((el) => el.getAttribute('aria-label') ?? el.className));
  expect(order).toEqual(['Toggle sidebar', 'Sidebar options', 'Find in document', 'Zoom out', 'Zoom in',
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
  expect(Math.round(strip.y)).toBe(Math.round(bar.y + bar.height)); // no seam
  expect(first.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1); // nothing behind either
});

test('the panel lies over the pages, with a thumbnail for every page', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await expect(page.locator('.pdf-sidebar-container')).toBeHidden();
  await control(page, 'Toggle sidebar').click();
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
  await control(page, 'Sidebar options').click();
  await page.locator('.menu-item', { hasText: /^Table of contents$/ }).click();
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

test('the options button is a chevron, and a view is ticked only while the panel is open', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  // Obsidian's pair: lucide-layout-list to toggle, lucide-chevron-down for
  // the options beside it. Two icons of equal weight read as two unrelated
  // switches; the chevron reads as "more of the button next to me".
  const paths = await page.evaluate(() => ['Toggle sidebar', 'Sidebar options'].map((label) =>
    document.querySelector(`.pdf-toolbar-button[aria-label="${label}"] svg`)!.innerHTML));
  expect(paths[0]).toContain('<rect'); // layout-list: two squares and four lines
  expect(paths[1]).toBe('<path d="m6 9 6 6 6-6"></path>'); // chevron-down, nothing else

  const ticks = async (): Promise<string[]> => {
    await control(page, 'Sidebar options').click();
    const out = await page.evaluate(() => [...document.querySelectorAll('.menu-item')]
      .filter((el) => el.querySelector('.mod-checked')).map((el) => el.textContent!.trim()));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    return out;
  };
  expect(await ticks()).toEqual([]); // panel shut: neither view is the one you are looking at
  await control(page, 'Toggle sidebar').click();
  await page.waitForTimeout(350);
  expect(await ticks()).toEqual(['Thumbnails']);
});

test('the strip and the panel ride the drawer, and the switcher comes up over them', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  await control(page, 'Toggle sidebar').click();
  await page.waitForTimeout(350);
  // the chrome lives inside .workspace, which is what the drawers translate
  const home = await page.evaluate(() => Math.round(document.querySelector('.pdf-toolbar')!.getBoundingClientRect().x));
  expect(home).toBe(0);
  await page.locator('#files').dispatchEvent('click');
  await page.waitForTimeout(700);
  const moved = await page.evaluate(() => ['.topbar', '.pdf-toolbar', '.pdf-sidebar-container']
    .map((sel) => Math.round(document.querySelector(sel)!.getBoundingClientRect().x)));
  expect(moved[0]).toBeGreaterThan(0);        // the header slid
  expect(moved[1]).toBe(moved[0]);            // and the strip went with it
  expect(moved[2]).toBe(moved[0]);            // and so did the panel

  await page.locator('#backdrop').dispatchEvent('click');
  await page.waitForTimeout(700);
  await control(page, 'Sidebar options').click();
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

test('the strip carries on the header\'s frosting instead of restarting it', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await ready(page);
  const look = await page.evaluate(() => {
    const bar = getComputedStyle(document.querySelector('.topbar')!);
    const strip = getComputedStyle(document.querySelector('.pdf-toolbar')!);
    return { blur: [bar.backdropFilter, strip.backdropFilter], tint: [bar.backgroundColor, strip.backgroundColor],
      gradient: strip.backgroundImage, border: strip.borderBottomWidth };
  });
  expect(look.blur[1]).toBe(look.blur[0]);   // the same glass
  expect(look.tint[1]).toBe(look.tint[0]);   // the same colour
  // --raised-background fades from solid to 65%; a second copy of it under
  // the first is a dark step at the seam, so the strip holds the colour the
  // header's fade ends on and adds no rule of its own.
  expect(look.gradient).toBe('none');
  expect(look.border).toBe('0px');

  // and the page really is visible through it: scrolled, the strip sits over
  // white paper and must lighten, not stay the colour of the app behind it.
  await page.mouse.move(195, 400);
  for (let i = 0; i < 6; i += 1) { await page.mouse.wheel(0, 200); await page.waitForTimeout(80); }
  await page.waitForTimeout(800);
  const shot = await page.screenshot();
  const read = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ink = canvas.getContext('2d')!;
    ink.drawImage(img, 0, 0);
    const grey = (y: number): number => ink.getImageData(700, y * 2, 1, 1).data[0];
    return { header: grey(58), strip: grey(70), page: grey(130) };
  }, shot.toString('base64'));
  expect(read.page).toBeGreaterThan(240);              // white paper under it all
  expect(read.strip).toBeGreaterThan(read.header);     // no dark step at the seam
  expect(read.strip).toBeGreaterThan(100);             // the paper shows through
});
