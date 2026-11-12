import { expect, test } from '@playwright/test';

test('document header choices survive saving and loading', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__satr));
  const results = await page.evaluate(async () => {
    const settings = await window.__satr.load('/src/settings.ts');
    return ['stays', 'controls', 'all', 'split'].map((choice) => {
      const item = settings.loadSettings();
      item.documentChrome = choice;
      settings.saveSettings(item);
      return settings.loadSettings().documentChrome;
    });
  });
  expect(results).toEqual(['stays', 'controls', 'all', 'split']);
});

test('the previous settings version migrates once, while version six keeps its choice', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__satr));
  const results = await page.evaluate(async () => {
    const settings = await window.__satr.load('/src/settings.ts');
    localStorage.setItem('satr:settings', JSON.stringify({ version: 5, documentChrome: 'all' }));
    const old = settings.loadSettings();
    settings.saveSettings(old);
    const again = settings.loadSettings();
    localStorage.setItem('satr:settings', JSON.stringify({ version: 6, documentChrome: 'controls' }));
    const current = settings.loadSettings();
    return { old: old.documentChrome, again: again.documentChrome, current: current.documentChrome };
  });
  expect(results).toEqual({ old: 'split', again: 'split', current: 'controls' });
});
