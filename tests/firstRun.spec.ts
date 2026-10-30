import { expect, test, type Page } from '@playwright/test';

// A fresh install must leave the writer's folders exactly as it found them.
// What used to happen: the app opened a note called "Untitled" that had no
// file behind it, and the first thing the writer did — tapping +, closing the
// tab, opening another note — went through leaveCurrent() → saveNow(), which
// wrote the empty note into their notes folder. An install they only looked
// at left a stray note behind.

// Which files the vault has. The index is what says so: contents live in
// IndexedDB now (src/webStore.ts), and localStorage only ever holds one on
// its way there.
const files = (page: Page) => page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem('satr:fs:index') ?? '{"files":{}}') as { files: Record<string, number> };
  return Object.keys(index.files ?? {}).sort();
});

/** What is actually inside a file of the browser vault. */
const contentOf = (page: Page, path: string) => page.evaluate(async (want) => {
  const { backend } = await (window as unknown as { __satr: { load(p: string): Promise<Record<string, never>> } })
    .__satr.load('/src/vault.ts') as unknown as { backend: { read(p: string): Promise<string | null> } };
  return backend.read(want);
}, path);

/** A browser that has never run Satr. */
async function freshBrowser(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
}

/** A browser that has seen the tour already — the app's own case too, where
 *  the demo is never opened at launch. */
async function returningBrowser(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('satr:demoShown', '1'));
  await page.goto('/');
}

test('the very first run opens the tour, and writes nothing', async ({ page }) => {
  await freshBrowser(page);
  await expect(page.locator('#app .cm-file-name')).toHaveText('demo');
  await expect(page.locator('.cm-content')).toContainText('Satr demo');
  expect(await files(page)).toEqual([]);
});

test('looking at the tour and leaving it writes nothing', async ({ page }) => {
  await freshBrowser(page);
  await expect(page.locator('#app .cm-file-name')).toHaveText('demo');
  // The two ways out of the note that used to commit it to disk.
  await page.locator('#nav-new').click();
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await files(page)).toEqual([]);
  await page.locator('#nav-tabs').click();
  await page.locator('.close-button').first().click();
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await files(page)).toEqual([]);
});

test('writing in the tour makes it a note of your own', async ({ page }) => {
  await freshBrowser(page);
  await page.locator('.cm-content').click();
  await page.keyboard.type('mine');
  await expect.poll(() => files(page)).toEqual(['Notes/demo.md']);
  expect(await contentOf(page, 'Notes/demo.md')).toContain('mine');
});

test('a space with nothing in it opens the new-tab page, not a note', async ({ page }) => {
  await returningBrowser(page);
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  await expect(page.locator('.empty-state-title')).toHaveText('No file is open');
  expect(await files(page)).toEqual([]);
  // And it stays that way: the page is not a note, so there is nothing to save.
  await page.locator('#nav-tabs').click();
  await page.keyboard.press('Escape');
  expect(await files(page)).toEqual([]);
});

test('the tour stays put when you come back to its tab', async ({ page }) => {
  await freshBrowser(page);
  await expect(page.locator('#app .cm-file-name')).toHaveText('demo');
  // A note of their own in a second tab, then back to the first: the tour has
  // no file behind it, and must not vanish with it.
  await page.locator('#nav-new').click();
  await page.locator('#empty-tab [data-act="new"]').click();
  await expect(page.locator('#app .cm-file-name')).toHaveText(/^Untitled/);
  await page.locator('#nav-tabs').click();
  await page.locator('.mobile-tab').first().click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('demo');
  await expect(page.locator('.cm-content')).toContainText('Satr demo');
  expect(await files(page)).toEqual(['Notes/Untitled.md']);
});

test('your own copy of the tour is a note like any other', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/demo.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/demo.md', '# My own notes on the demo\n');
  });
  await page.goto('/');
  // It is a note like any other now: the launch opens it, not the shipped tour.
  await expect(page.locator('#app .cm-file-name')).toHaveText('demo');
  await expect(page.locator('.cm-content')).toContainText('My own notes on the demo');
  await expect(page.locator('.cm-content')).not.toContainText('Writing in two directions');
});

test('the new-tab page does not offer the tour', async ({ page }) => {
  await returningBrowser(page);
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  await expect(page.locator('#empty-tab [data-act="demo"]')).toHaveCount(0);
  await expect(page.locator('#empty-tab [data-act="new"]')).toBeVisible();
  await expect(page.locator('#empty-tab [data-act="files"]')).toBeVisible();
});
