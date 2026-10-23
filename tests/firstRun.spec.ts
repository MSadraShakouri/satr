import { expect, test, type Page } from '@playwright/test';

// A fresh install must leave the writer's folders exactly as it found them.
// What used to happen: the app opened a note called "Untitled" that had no
// file behind it, and the first thing the writer did — tapping +, closing the
// tab, opening another note — went through leaveCurrent() → saveNow(), which
// wrote the empty note into their notes folder. An install they only looked
// at left a stray note behind.

const files = (page: Page) => page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.startsWith('satr:fs:file:')).map((k) => k.replace('satr:fs:file:', '')).sort());

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
  expect(await page.evaluate(() => localStorage.getItem('satr:fs:file:Notes/demo.md'))).toContain('mine');
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

test('the tour is one tap away on the new-tab page', async ({ page }) => {
  await returningBrowser(page);
  await page.locator('#empty-tab [data-act="demo"]').click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('demo');
  await expect(page.locator('.cm-content')).toContainText('Satr demo');
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

test('the tour row opens your own copy once you have one', async ({ page }) => {
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
  // And the row on the new-tab page comes back to their copy, not the tour.
  await page.locator('#nav-tabs').click();
  await page.locator('.close-button').first().click();
  await page.keyboard.press('Escape'); // the switcher stays open over the page
  await page.locator('#empty-tab [data-act="demo"]').click();
  await expect(page.locator('.cm-content')).toContainText('My own notes on the demo');
});
