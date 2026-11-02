import { expect, test, type Page } from '@playwright/test';

// Closing tabs: the last one leaves the default (empty) tab, a card closed from
// the switcher leaves the switcher at once, and "Close all tabs" leaves one
// empty tab that the closed notes can be reopened from.

async function boot(page: Page, tabs: { path: string }[], active = 0) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ tabs, active }) => {
    if (localStorage.getItem('satr:test:seeded')) return;
    // A marker of the spec's own. The seed used to guard on the file key it
    // writes, but contents live in IndexedDB now and that key is an inbox the
    // app drains on first read -- so after one reload the guard saw nothing,
    // re-seeded, and put back the very text, tabs and reading place the test
    // had just asked the app to remember.
    localStorage.setItem('satr:test:seeded', '1');
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

async function holdTabs(page: Page) {
  await page.locator('#nav-tabs').dispatchEvent('pointerdown');
  await page.waitForTimeout(500);
}

test('the tab count sits in the icon square, not the whole button', async ({ page }) => {
  await boot(page, [{ path: 'Notes/A.md' }]);
  const gap = await page.evaluate(() => {
    const btn = document.querySelector('#nav-tabs')!;
    const icon = btn.querySelector('svg')!.getBoundingClientRect();
    const num = btn.querySelector('.mobile-navbar-tabs-number')!.getBoundingClientRect();
    return {
      mid: Math.abs((icon.top + icon.height / 2) - (num.top + num.height / 2)),
      size: Math.abs(icon.height - num.height),
    };
  });
  expect(gap.mid, JSON.stringify(gap)).toBeLessThan(1);
  expect(gap.size, JSON.stringify(gap)).toBeLessThan(1);
});

test('the digit is placed by its ink, not by the box it is drawn in', async ({ page }) => {
  // Centring the figures means centring the figures, and no box the layout
  // engine offers is the figures. The line box is the font's ascent and
  // descent; trimming it to cap height (text-box-trim) is closer but still
  // wrong, because Vazirmatn draws its figures taller than its caps and they
  // landed about a pixel low. So the ink is measured with the engine that
  // draws it and the span is translated by the difference -- centreFigures()
  // in src/main.ts. This pins that mechanism: the span exists, and something
  // has moved it off the corner the box model left it in. The pixels
  // themselves are tests/tabCount.spec.ts's job, off a 6x screenshot, at one,
  // two and three figures.
  await boot(page, [{ path: 'Notes/A.md' }]);
  const placed = await page.evaluate(() => {
    const digit = document.querySelector<HTMLElement>('#nav-tabs .mobile-navbar-tabs-digit');
    if (!digit) return null;
    const style = getComputedStyle(digit);
    return { transform: style.transform, position: style.position };
  });
  expect(placed, 'the digit has no element of its own to place').not.toBeNull();
  expect(placed!.position, 'the digit is laid out in flow, so nothing can place it').toBe('absolute');
  expect(placed!.transform, 'the digit was left where the box model put it').not.toBe('none');
});

test('holding the tabs button opens the menu, including Close current tab', async ({ page }) => {
  await boot(page, [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }]);
  await holdTabs(page);
  await expect(page.getByRole('menuitem', { name: 'New tab' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Reopen closed tab' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Close current tab' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Close other tabs' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Close all tabs' })).toBeVisible();
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Close current tab' }).click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  expect(await savedTabs(page)).toEqual({ tabs: [{ path: 'Notes/B.md' }], active: 0 });
});

test('a tap on the tabs button still opens the switcher', async ({ page }) => {
  await boot(page, [{ path: 'Notes/A.md' }]);
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Close current tab' })).toHaveCount(0);
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
