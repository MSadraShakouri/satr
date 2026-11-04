import { expect, test, type Page } from '@playwright/test';

// The app stopping in the middle of starting, twice. Nothing inside a launch
// loop can see it: every run believes it is the first, and the reader is
// left with a splash screen over and over. Settings is not reachable from a
// launch that never finishes, so the way out cannot live there.

declare global {
  interface Window {
    __satr: { load(path: string): {
      lines(): { area: string; text: string; facts?: Record<string, unknown> }[];
      recordKeys(): string[];
    } };
  }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

/** `began` is how many launches began and never finished before this one. */
async function boot(page: Page, began: number | null): Promise<void> {
  await page.addInitScript((times: number | null) => {
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n\nwords\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    // Where a file was left: the thing a reset is allowed to throw away.
    localStorage.setItem('satr:place:Notes/A.md', JSON.stringify({ top: 400 }));
    localStorage.setItem('satr:view:Notes/A.md', JSON.stringify({ mode: 'preview' }));
    if (times !== null) localStorage.setItem('satr:launching', JSON.stringify({ times, path: 'Notes/A.md' }));
  }, began);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

// Where files were left, from the store itself: the localStorage keys seeded
// above are an older version's copies, and the store adopts them at boot.
const places = (page: Page) => page.evaluate(() => window.__satr.load('/src/viewStore.ts').recordKeys());

const warnings = (page: Page) => page.evaluate(() =>
  window.__satr.load('/src/log.ts').lines().filter((line) => line.area === 'launch').map((line) => line.text));

test('two launches that never finished: the app opens on nothing and says why', async ({ page }) => {
  await boot(page, 2);
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  await expect(page.locator('.empty-state-note')).toContainText('did not finish starting twice');
  await expect(page.locator('.empty-state-note'), 'and names the file it was opening').toContainText('A.md');
  expect(await places(page), 'where files were left is forgotten').toEqual([]);
  expect(await warnings(page)).toContain('started on an empty tab after a bad start');
});

test('one is not a loop: the file still opens', async ({ page }) => {
  await boot(page, 1);
  await expect(page.locator('.cm-file-name')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/is-empty-tab/);
  expect(await places(page), 'and nothing is thrown away').not.toEqual([]);
  // Said in the log all the same, so a single bad start is not invisible.
  expect(await warnings(page)).toContain('the last launch did not finish');
});

test('a launch that arrives lifts its own mark', async ({ page }) => {
  await boot(page, null);
  await expect(page.locator('.cm-file-name')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('satr:launching')), 'nothing left behind for the next launch').toBeNull();
  expect(await warnings(page)).not.toContain('the last launch did not finish');
});

test('the explanation is said once, not every time a tab is empty', async ({ page }) => {
  await boot(page, 2);
  await expect(page.locator('.empty-state-note')).toBeVisible();
  // Opening the file that was blamed is the end of it: coming back to an
  // empty tab afterwards is an ordinary empty tab.
  await page.getByRole('button', { name: 'Go to file' }).click();
  await page.locator('[data-path="Notes/A.md"]').first().click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await page.locator('#nav-tabs').evaluate((el) => (el as HTMLElement).click());
  await page.locator('.mobile-tab-switcher [data-act="new"]').click();
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  await expect(page.locator('.empty-state-note')).toHaveCount(0);
});
