import { expect, test, type Page } from '@playwright/test';

// Opening a note that is already open from the new (empty) tab: the app goes to
// that tab, and the empty tab it was opened from is closed, not left behind.

async function boot(page: Page, tabs: { path: string }[], active: number) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ tabs, active }) => {
    if (localStorage.getItem('satr:fs:index')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/B.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', 'alpha\n');
    localStorage.setItem('satr:fs:file:Notes/B.md', 'beta\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs, active }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, { tabs, active });
  await page.goto('/');
}

const tabCount = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('satr:tabs')!).tabs.length as number);
const tabPaths = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('satr:tabs')!).tabs.map((t: { path: string }) => t.path) as string[]);

test('picking an open note from the new tab goes to that tab and closes the new tab', async ({ page }) => {
  await boot(page, [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }, { path: '' }], 2);
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  await page.getByRole('button', { name: 'Go to file' }).click();
  await page.locator('[data-path="Notes/A.md"]').first().click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await expect.poll(() => tabCount(page)).toBe(2);
  expect(await tabPaths(page)).toEqual(['Notes/A.md', 'Notes/B.md']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('satr:tabs')!).active)).toBe(0);
});
