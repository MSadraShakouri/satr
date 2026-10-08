import { expect, test, type Page } from '@playwright/test';

// Starting tabs: "On launch" keeps the last tabs or adds an empty one, and
// "New tab after being away" adds an empty tab when Satr comes back after the
// chosen time. Both live in Settings → Tabs.

const AWAY_KEY = 'satr:awayAt';

async function boot(page: Page, settings: Record<string, unknown>, awayAt?: number) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ settings, awayAt }) => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/B.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# Alpha\n\nfirst\n');
    localStorage.setItem('satr:fs:file:Notes/B.md', '# Beta\n\nsecond\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }], active: 1 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:settings', JSON.stringify({ version: 3, ...settings }));
    if (awayAt !== undefined) localStorage.setItem('satr:awayAt', String(awayAt));
  }, { settings, awayAt });
  await page.goto('/');
  await expect(page.locator('#nav-tabs .mobile-navbar-tabs-number')).toBeVisible();
}

const tabCount = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('satr:tabs') ?? '{"tabs":[]}') as { tabs: unknown[] }).tabs.length);

test('On launch: restore last tabs is the default, and the last tabs come back as they were', async ({ page }) => {
  await boot(page, {});
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  expect(await tabCount(page)).toBe(2);
});

test('On launch: an empty tab is added after the last tabs, and it is the one shown', async ({ page }) => {
  await boot(page, { launchTabs: 'empty' });
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await tabCount(page)).toBe(3);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('satr:tabs')!).tabs.map((t: { path: string }) => t.path))).toEqual(['Notes/A.md', 'Notes/B.md', '']);
});

test('after being away past the chosen time, the app comes back with a new empty tab', async ({ page }) => {
  await boot(page, { launchTabs: 'empty', newTabAfterMinutes: 5 }, Date.now() - 6 * 60_000);
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await tabCount(page)).toBe(3);
  // One absence gives one new tab: the mark is gone.
  expect(await page.evaluate((key) => localStorage.getItem(key), AWAY_KEY)).toBeNull();
});

test('a shorter absence than the chosen time opens nothing new', async ({ page }) => {
  await boot(page, { newTabAfterMinutes: 5 }, Date.now() - 60_000);
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  expect(await tabCount(page)).toBe(2);
});

test('Never (the default) opens nothing new however long the absence', async ({ page }) => {
  await boot(page, {}, Date.now() - 10 * 24 * 60 * 60_000);
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  expect(await tabCount(page)).toBe(2);
});

test('coming back to the visible app after being away adds the empty tab too', async ({ page }) => {
  await boot(page, { newTabAfterMinutes: 15 });
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  // The away time belongs to the empty-tab launch, so that is the choice in force.
  await page.evaluate(() => localStorage.setItem('satr:settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('satr:settings')!), launchTabs: 'empty' })));
  // Away: the app goes to the background (the same event the app listens for).
  await page.evaluate((key) => {
    localStorage.setItem(key, String(Date.now() - 20 * 60_000));
    document.dispatchEvent(new Event('visibilitychange'));
  }, AWAY_KEY);
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await tabCount(page)).toBe(3);
});

test('the Tabs settings save their choices', async ({ page }) => {
  await boot(page, {});
  await page.evaluate(async () => {
    const { openSettings } = await window.__satr.load('/src/settings.ts');
    openSettings({ apply: () => {}, tools: () => [] });
  });
  await expect(page.locator('.settings-screen')).toBeVisible();
  await page.locator('[data-select="launchTabs"]').selectOption('empty');
  await page.locator('[data-select="newTabAfterMinutes"]').selectOption('30');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('satr:settings')!));
  expect(saved.launchTabs).toBe('empty');
  expect(saved.newTabAfterMinutes).toBe(30);
});

test('Restore last tabs: a long absence or a refresh adds no tab, and the away time is not shown', async ({ page }) => {
  await boot(page, { launchTabs: 'last', newTabAfterMinutes: 5 }, Date.now() - 6 * 60_000);
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  expect(await tabCount(page)).toBe(2);
  await expect(page.locator('body')).not.toHaveClass(/is-empty-tab/);
  expect(await page.evaluate((key) => localStorage.getItem(key), AWAY_KEY)).toBeNull();
  await page.evaluate(async () => {
    const { openSettings } = await window.__satr.load('/src/settings.ts');
    openSettings({ apply: () => {}, tools: () => [] });
  });
  await expect(page.locator('.settings-screen')).toBeVisible();
  await expect(page.locator('[data-away-row]')).toBeHidden();
  await page.locator('[data-select="launchTabs"]').selectOption('empty');
  await expect(page.locator('[data-away-row]')).toBeVisible();
});
