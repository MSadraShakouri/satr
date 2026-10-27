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
