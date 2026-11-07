import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// A file that is shown rather than read — a PDF, a picture, an HTML page —
// carries its name in the chrome. Since round 8 that chrome is a setting with
// four answers (Settings -> While scrolling), and the default takes the name
// and the controls away and floats the two buttons; tests/documentChrome.spec.ts
// pins that one. This file pins the two things that did not change with it:
// the answer "keep the header" really does keep it, and the phone's own clock
// follows the answer rather than the scroll — it stays for a document whatever
// that document's header is doing, because the name lives in the bar, and it
// leaves for a note, whose header does slide away.

const PDF = tinyPdf(8);
const LONG = `# note\n\n${'a line of the note\n\n'.repeat(120)}`;

async function boot(page: Page, files: Record<string, string>, open: string,
  settings: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(([seed, first, prefs]) => {
    const vault = seed as Record<string, string>;
    const names = Object.keys(vault);
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: Object.fromEntries(names.map((name) => [`Notes/${name}`, 1])),
      folders: ['Notes'],
    }));
    for (const name of names) localStorage.setItem(`satr:fs:file:Notes/${name}`, vault[name]);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: `Notes/${first as string}` }], active: 0 }));
    if (Object.keys(prefs as Record<string, unknown>).length) {
      localStorage.setItem('satr:settings', JSON.stringify({ version: 6, ...(prefs as Record<string, unknown>) }));
    }
  }, [files, open, settings] as [Record<string, string>, string, Record<string, unknown>]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

const hidden = (page: Page) => page.evaluate(() => document.body.classList.contains('is-hidden-nav'));
/** What the app last asked the phone for. The status bar itself belongs to
 *  Android (SystemBarsPlugin.java hides Type.statusBars()), and there is
 *  none of it in a browser -- the class is the app's own record of the
 *  request, set in the same breath as the request (syncStatusBar,
 *  src/main.ts). */
const statusBarAway = (page: Page) => page.evaluate(() => document.body.classList.contains('is-status-bar-away'));

/** Scroll the reading pane the way a reader does. A wheel over the pane,
 *  not an assignment to scrollTop: the bars answer to the reader's own
 *  movement, and a pane that has not been laid out yet ignores the
 *  assignment outright. */
async function scrollPane(page: Page, steps: number): Promise<void> {
  await page.mouse.move(195, 400);
  for (let i = 0; i < Math.abs(steps); i += 1) {
    await page.mouse.wheel(0, Math.sign(steps) * 500);
    await page.waitForTimeout(400);
  }
}

// This is the "Keep the header" answer (Settings -> While scrolling), not the
// default any more: the default takes the name and the controls away and keeps
// the two buttons (tests/documentChrome.spec.ts pins that). What is pinned
// here is what "keep" means -- the bar does not move a pixel however far the
// document is scrolled, and what a document always does is keep the phone's
// own clock, because a document's name is in that bar.
test('"keep the header" keeps it, however far the document is scrolled', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf', { documentChrome: 'stays' });
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  const header = async (): Promise<number> =>
    (await page.locator('.topbar').boundingBox())!.y;
  const was = await header();
  expect(await hidden(page)).toBe(false);
  await scrollPane(page, 3);
  // the pane really moved — otherwise this proves nothing
  expect(await page.evaluate(() => document.querySelector('.preview-pane')?.scrollTop ?? 0)).toBeGreaterThan(600);
  // the name of the document, and the toolbar under it, do not move
  expect(await header()).toBe(was);
  await expect(page.locator('#topbar-title')).toBeVisible();
  await expect(page.locator('.pdf-toolbar')).toBeVisible();
  // ...and the pill over the page does, the same as in a note
  expect(await hidden(page)).toBe(true);
  await scrollPane(page, -2);
  expect(await hidden(page)).toBe(false);
});

test('the phone\'s status bar stays when the header stays', async ({ page }) => {
  // Reported: the status bar vanishes on scroll while a pdf's header
  // stays. Scrolling took the clock away and left our header standing in
  // the space it had just left. The rule now: the native bars do what the
  // header does, and a document's header never leaves.
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  expect(await statusBarAway(page)).toBe(false);
  await scrollPane(page, 3);
  // The pill did go -- this is a scroll that moved the app's own bars.
  expect(await hidden(page)).toBe(true);
  expect(await statusBarAway(page), 'the clock is still there, because the header is').toBe(false);
});

test('a note\'s status bar leaves with its header, and comes back with it', async ({ page }) => {
  // The other half: a note's header slides up and out, so the clock goes
  // with it and the reader gets the whole screen. This is the behaviour
  // that was always right and must not be lost in fixing the other one.
  await boot(page, { 'note.md': LONG }, 'note.md');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('.preview-pane article')).toBeVisible();
  expect(await statusBarAway(page)).toBe(false);
  await scrollPane(page, 3);
  expect(await hidden(page)).toBe(true);
  expect(await statusBarAway(page)).toBe(true);
  await scrollPane(page, -2);
  expect(await hidden(page)).toBe(false);
  expect(await statusBarAway(page)).toBe(false);
});

test('opening a document while the bars are away brings the status bar back with the header', async ({ page }) => {
  // The rule is asked again whenever the open file changes, because which
  // file is open is what decides whether the header hides at all: scroll a
  // note until the clock is gone, open a pdf, and the pdf's header arrives
  // -- so the clock has to arrive with it.
  await boot(page, { 'note.md': LONG, 'handout.pdf': PDF }, 'note.md');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('.preview-pane article')).toBeVisible();
  await scrollPane(page, 3);
  expect(await statusBarAway(page)).toBe(true);
  await page.locator('#files').dispatchEvent('click');
  await page.locator('.nav-file-title', { hasText: 'handout.pdf' }).click();
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('body')).toHaveClass(/is-named-file/);
  expect(await statusBarAway(page), 'the document brought the clock back with its header').toBe(false);
});

test('a note still hides the pill in reading view, not only in source', async ({ page }) => {
  await boot(page, { 'note.md': LONG }, 'note.md');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('.preview-pane article')).toBeVisible();
  expect(await hidden(page)).toBe(false);
  await scrollPane(page, 3);
  expect(await hidden(page)).toBe(true);
});

test('opening a shown file brings the chrome back', async ({ page }) => {
  await boot(page, { 'note.md': LONG, 'handout.pdf': PDF }, 'note.md');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('.preview-pane article')).toBeVisible();
  await scrollPane(page, 3);
  expect(await hidden(page)).toBe(true);
  // the open file changes: the header is back, and nothing in the document
  // will ever report a scroll that could bring it back later.
  // The navbar has slid away by now, which is exactly the condition under
  // test, so reach the control the handler is bound to rather than the
  // place on screen where it used to be.
  await page.locator('#files').dispatchEvent('click');
  await page.locator('.nav-file-title', { hasText: 'handout.pdf' }).click();
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  expect(await hidden(page)).toBe(false);
});

test('a document starts below the header, not behind it', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  const bar = await page.locator('.topbar').boundingBox();
  const first = await page.locator('.pdf-page[data-page="1"]').boundingBox();
  expect(bar).not.toBeNull();
  expect(first).not.toBeNull();
  // the page's own top edge is at or below the bar's bottom edge
  expect(first!.y).toBeGreaterThanOrEqual((bar!.y + bar!.height) - 1);
});

test('the chrome is a bar when it carries the name, and nothing when it does not', async ({ page }) => {
  // The bar's surface is painted by a layer of its own (.topbar::before), not
  // by the bar: it slides up by the controls' height when a document is read,
  // as a transform, so the name above it does not move and nothing lays out
  // every frame. Reading .topbar's own background therefore says transparent
  // whatever the chrome is doing -- the glass is on the layer.
  const surface = () => page.evaluate(() => {
    const el = document.querySelector('.topbar');
    return el ? getComputedStyle(el, '::before').backgroundColor : '';
  });
  await boot(page, { 'note.md': LONG, 'handout.pdf': PDF }, 'note.md');
  // a note draws its own title, so the chrome stays out of the way
  expect(await surface()).toBe('rgba(0, 0, 0, 0)');
  await page.locator('#files').click();
  await page.locator('.nav-file-title', { hasText: 'handout.pdf' }).click();
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('body')).toHaveClass(/is-named-file/);
  expect(await surface()).not.toBe('rgba(0, 0, 0, 0)');
});

test('a new tab opened from a document takes the document\'s chrome away with it', async ({ page }) => {
  await boot(page, { 'handout.pdf': PDF }, 'handout.pdf');
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('body')).toHaveClass(/is-named-file/);
  await expect(page.locator('.pdf-toolbar')).toBeVisible();

  // The teardown used to live in the reading view's own render, and a new
  // tab never renders one: the header, the strip and the thumbnails stayed
  // on screen over the empty tab, still naming a file that was not open.
  await page.locator('#nav-new').dispatchEvent('click');
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  await expect(page.locator('.pdf-toolbar')).toHaveCount(0);
  await expect(page.locator('.pdf-sidebar-container')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/is-pdf-chrome/);
  await expect(page.locator('body')).not.toHaveClass(/is-named-file/);
  await expect(page.locator('#topbar-title')).toHaveText('');
});
