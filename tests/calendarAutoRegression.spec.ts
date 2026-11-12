import { expect, test } from '@playwright/test';

test('the Persian Auto calendar is selected and the first tap switches to Gregorian', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:settings', JSON.stringify({ version: 6, timestampLocale: 'fa', timestampCalendar: 'auto' }));
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__satr));
  await page.evaluate(async () => {
    const timestamps = await window.__satr.load('/src/timestamps.ts');
    timestamps.setTimestampStyle('fa', 'auto');
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    const { insertTimestamp } = await window.__satr.load('/src/commands.ts');
    insertTimestamp(view);
  });
  const sheet = page.locator('.timestamp-picker');
  await expect(sheet).toBeVisible();
  const actualCalendar = await page.evaluate(() => new Intl.DateTimeFormat('fa').resolvedOptions().calendar);
  expect(actualCalendar).toBe('persian');
  const persianTitle = await sheet.locator('.timestamp-picker-month').textContent();
  await expect(sheet.locator('[data-stamp-cal-option].is-active')).toHaveAttribute('data-stamp-cal-option', 'persian');
  await sheet.locator('[data-stamp-cal]').click();
  await expect(sheet.locator('[data-stamp-cal-option].is-active')).toHaveAttribute('data-stamp-cal-option', 'gregory');
  await expect(sheet.locator('.timestamp-picker-month')).not.toHaveText(persianTitle!);
  await sheet.locator('[data-stamp-cal]').click();
  await expect(sheet.locator('[data-stamp-cal-option].is-active')).toHaveAttribute('data-stamp-cal-option', 'persian');
  await expect(sheet.locator('.timestamp-picker-month')).toHaveText(persianTitle!);
});
