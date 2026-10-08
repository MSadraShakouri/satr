import { expect, test, type Page } from '@playwright/test';

// Closing tabs: the last one leaves the default (empty) tab, a card closed from
// the switcher leaves the switcher at once, and "Close all tabs" leaves one
// empty tab that the closed notes can be reopened from.

async function boot(page: Page, tabs: { path: string }[], active = 0) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ tabs, active }) => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/B.md': 1, 'Notes/C.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# Alpha\n\nfirst\n');
    localStorage.setItem('satr:fs:file:Notes/B.md', '# Beta\n\nsecond\n');
    localStorage.setItem('satr:fs:file:Notes/C.md', '# Gamma\n\nthird\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs, active }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, { tabs, active });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

async function openSwitcher(page: Page) {
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(1);
}

async function openTabMenu(page: Page) {
  await page.locator('.mobile-tab-switcher-menu-button').click();
}

const savedTabs = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('satr:tabs') ?? 'null'));

test('closing the last remaining tab leaves the default tab, and the note can be reopened', async ({ page }) => {
  await boot(page, [{ path: 'Notes/A.md' }]);
  await openSwitcher(page);
  await page.locator('.mobile-tab .close-button').click();
  await expect(page.locator('.mobile-tab')).toHaveCount(1);
  await expect(page.locator('.mobile-tab-title')).toHaveText('New tab');
  // The default tab is an empty tab, and it is what the app shows now.
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await savedTabs(page)).toEqual({ tabs: [{ path: '' }], active: 0 });
  // The closed note comes back from the menu.
  await openTabMenu(page);
  await page.getByRole('menuitem', { name: 'Reopen closed tab' }).click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
});

test('a card closed from the switcher is gone from it at once, active or not', async ({ page }) => {
  await boot(page, [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }, { path: 'Notes/C.md' }], 0);
  await openSwitcher(page);
  // The active card (A): its close used to leave the card on screen.
  await page.locator('.mobile-tab[data-index="0"] .close-button').click();
  await expect(page.locator('.mobile-tab')).toHaveCount(2);
  await expect(page.locator('.mobile-tab-title').first()).toHaveText('B');
  // The count in the bar follows.
  await expect(page.locator('.mobile-tab-switcher-count')).toHaveText('2 tabs');
});

test('Close all tabs leaves one empty tab, and every closed note can be reopened', async ({ page }) => {
  await boot(page, [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }], 1);
  await openSwitcher(page);
  await openTabMenu(page);
  await page.getByRole('menuitem', { name: 'Close all tabs' }).click();
  await expect(page.locator('.mobile-tab')).toHaveCount(1);
  await expect(page.locator('.mobile-tab-switcher-count')).toHaveText('1 tab');
  expect(await savedTabs(page)).toEqual({ tabs: [{ path: '' }], active: 0 });
  // Close all with only the empty tab left is refused.
  await openTabMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Close all tabs' })).toHaveClass(/is-disabled/);
});
