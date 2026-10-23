import { expect, test } from '@playwright/test';

// A file handed over by another app opens in its own tab, and handing the
// same file over again opens a second one: the app receives a token for the
// document, not a name, and a file manager is free to vary that token
// (src/openWith.ts, tests/openWith.spec.ts). Two tabs then carry the same
// name. The card says which of them came from outside the vault.
//
// The road itself is native-only, so what is pinned here is the telling
// apart: the switcher is rendered from cards, as the app renders it.

test('a handed-over file is named as one in the switcher', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { openTabSwitcher } = await window.__satr.load('/src/tabs.ts');
    openTabSwitcher({
      tabs: () => [
        { title: 'shopping list', active: true, empty: false, external: false },
        { title: 'shopping list', active: false, empty: false, external: true },
      ],
      preview: () => Promise.resolve(''),
      select: () => {},
      close: () => Promise.resolve(),
      newTab: () => {},
      canReopen: () => false,
      reopen: () => {},
      closeOthers: () => {},
      closeAll: () => Promise.resolve(),
      move: () => {},
    });
  });
  const cards = page.locator('.mobile-tab');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator('.mobile-tab-title')).toHaveText('shopping list');
  await expect(cards.nth(0).locator('.mobile-tab-source')).toHaveCount(0);
  await expect(cards.nth(1).locator('.mobile-tab-title')).toHaveText('shopping list');
  await expect(cards.nth(1).locator('.mobile-tab-source')).toHaveText('from another app');
});
