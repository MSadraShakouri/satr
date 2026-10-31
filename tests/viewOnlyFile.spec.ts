import { test, expect, type Page } from '@playwright/test';

// A file Satr cannot write back is shown, not edited: no pen, a ⋮ in its
// place, and a header carrying the name the note would have carried itself.
// Obsidian draws exactly this line — its markdown view is what adds the
// edit/read toggle, every other view inherits the ⋮ alone.

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAQklEQVR42u3OMQEAAAgDoC251a3gLWQgnbvKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4GlxsAAGnJP8tAAAAAElFTkSuQmCC';

async function boot(page: Page, files: Record<string, string>): Promise<void> {
  await page.addInitScript((seed: Record<string, string>) => {
    const paths = Object.keys(seed);
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: Object.fromEntries(paths.map((p) => [p, 1])), folders: ['Notes'] }));
    for (const p of paths) localStorage.setItem(`satr:fs:file:${p}`, seed[p]);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: paths.map((path) => ({ path })), active: 0 }));
  }, files);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

test('a picture: the pen goes, the ⋮ arrives, and the header says which file this is', async ({ page }) => {
  await boot(page, { 'Notes/photo.png': PNG });
  await expect(page.locator('#preview-toggle')).toBeHidden();
  await expect(page.locator('#file-actions')).toBeVisible();
  await expect(page.locator('#topbar-title')).toHaveText('photo.png');
  // the name is in the header, so neither view says it a second time
  expect(await page.locator('.inline-title:visible, .cm-file-title:visible').count()).toBe(0);
});

test('its menu offers what applies to a file and nothing a note would need', async ({ page }) => {
  await boot(page, { 'Notes/photo.png': PNG });
  await page.locator('#file-actions').click();
  const items = await page.locator('[role="menuitem"]').allInnerTexts();
  expect(items).toEqual(['Rename…', 'Move to…', 'Delete', 'Settings']);
});

test('the header hides and returns with the rest of the chrome', async ({ page }) => {
  await boot(page, { 'Notes/photo.png': PNG });
  await expect(page.locator('#topbar-title')).toBeVisible();
  expect(await page.locator('.topbar > #topbar-title').count(), 'the name travels with the bar').toBe(1);
  await page.evaluate(() => document.body.classList.add('is-hidden-nav'));
  await expect(page.locator('.topbar')).toHaveCSS('opacity', '0');
});

test('a note keeps the chrome it has always had', async ({ page }) => {
  await boot(page, { 'Notes/note.md': '# سلام\n\nمتن.\n' });
  await expect(page.locator('#preview-toggle')).toBeVisible();
  await expect(page.locator('#file-actions')).toBeHidden();
  await expect(page.locator('#topbar-title')).toBeHidden();
  await expect(page.locator('.cm-file-title')).toBeVisible();
});

// A file with no text of its own is read, never written. Two taps on it used
// to hand the editor its raw bytes — a page of PNG or PDF noise with no way
// back, since the tab then remembered the mode it was left in.
const twoTaps = async (page: Page): Promise<void> => {
  const pane = page.locator('#preview-pane');
  const box = (await pane.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.evaluate(({ x, y }) => {
    const pane = document.querySelector('#preview-pane')!;
    const touch = (): Touch => new Touch({ identifier: 1, target: pane, clientX: x, clientY: y });
    for (const _ of [0, 1]) {
      pane.dispatchEvent(new TouchEvent('touchstart', { touches: [touch()], changedTouches: [touch()], bubbles: true, cancelable: true }));
      pane.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch()], bubbles: true, cancelable: true }));
    }
  }, at);
  await page.waitForTimeout(120);
};

test('two taps on a picture do not open its bytes', async ({ page }) => {
  await boot(page, { 'Notes/photo.png': PNG });
  await expect(page.locator('#preview-pane img')).toBeVisible();
  await twoTaps(page);
  expect(await page.evaluate(() => document.body.dataset.mode)).toBe('preview');
  await expect(page.locator('#preview-pane img')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeHidden();
});

test('a file tapped twice does not come back raw on the next open', async ({ page }) => {
  // What the phone is in right now: tapped twice before this existed, the
  // mode kept in the file's own view record, and every open since landing
  // in the editor full of bytes.
  await boot(page, { 'Notes/photo.png': PNG });
  await twoTaps(page);
  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('#preview-pane img')).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.mode)).toBe('preview');
  // Whether anything was written at all is a race with the restore this
  // test does not care about -- what it is here for is that the mode is
  // never written as edit. Nothing written says that just as well.
  const saved = await page.evaluate(() => localStorage.getItem('satr:view:Notes/photo.png'));
  expect(saved ?? '').not.toContain('"mode":"edit"');
});
