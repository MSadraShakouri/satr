import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

test('launch prepares previously saved note cards before the first tabs press', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/B.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# Alpha\n\nFirst note.');
    localStorage.setItem('satr:fs:file:Notes/B.md', '# Beta\n\nSecond note with $x^2+y^2$.');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }], active: 0 }));
    localStorage.setItem('satr:demoShown', '1');
  });
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await page.locator('#nav-tabs').dispatchEvent('click');
  await expect(page.locator('.mobile-tab-switcher .mobile-tab-preview-page').nth(1)).toContainText('Second note');
  // The note card is persisted asynchronously; wait for the actual record,
  // not a sleep that could reload while the write is still in flight.
  await expect.poll(() => page.evaluate(async () => {
    const store = await (window as any).__satr.load('/src/webStore.ts');
    return !!(await store.getAside('tab-card/Notes/B.md'));
  })).toBe(true);
  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await expect(page.locator('.mobile-tab-switcher-parked .mobile-tab-preview-page').nth(1), 'idle launch laid out the persisted card').toContainText('Second note', { timeout: 10000 });
  await expect(page.locator('.mobile-tab-switcher'), 'preparation does not show the sheet').toHaveCount(0);
  await page.evaluate(() => { (window as any).__preparedNode = document.querySelector('.mobile-tab-switcher-parked .mobile-tab[data-index="1"] .md-section'); });
  await page.locator('#nav-tabs').dispatchEvent('click');
  await expect(page.locator('.mobile-tab-switcher .mobile-tab-preview-page').nth(1)).toContainText('Second note');
  expect(await page.evaluate(() => (window as any).__preparedNode === document.querySelector('.mobile-tab-switcher .mobile-tab[data-index="1"] .md-section')), 'the first press reuses the pre-laid-out card').toBe(true);
});
