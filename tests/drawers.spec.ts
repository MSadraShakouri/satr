import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
});

test('opening files keeps the note shifted after the animation', async ({ page }) => {
  await page.locator('#files').click();
  await expect(page.locator('body')).toHaveClass(/files-open/);
  const shifted = await page.evaluate(() => document.querySelector('.workspace')!.getBoundingClientRect().left);
  expect(shifted).toBeGreaterThan(40);
  // The old CSS 0.45s ease on .workspace was the slide-back. Wait past it.
  await page.waitForTimeout(500);
  const later = await page.evaluate(() => document.querySelector('.workspace')!.getBoundingClientRect().left);
  expect(later, JSON.stringify({ shifted, later })).toBeGreaterThan(40);
  expect(Math.abs(later - shifted), JSON.stringify({ shifted, later })).toBeLessThan(2);
});
