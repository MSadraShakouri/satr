import { test, expect } from '@playwright/test';

// "a backspace doesn't reduce a level because there's a space between stuff"
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('backspace after a heading marker takes a level off', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'h.md': 1 }, folders: [] }));
    localStorage.setItem('satr:fs:file:h.md', '### Title\n\nbody\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'h.md' }], active: 0 }));
    localStorage.setItem('satr:demoShown', '1');
  });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/, { timeout: 60000 });

  const firstLine = (): Promise<string> => page.evaluate(() => document.querySelectorAll('.cm-line')[0].textContent ?? '');
  const caretAfterMarker = async (hashes: number): Promise<void> => {
    await page.locator('.cm-line').first().click();
    await page.keyboard.press('Home');
    for (let i = 0; i < hashes + 1; i += 1) await page.keyboard.press('ArrowRight');
  };

  await caretAfterMarker(3);
  await page.keyboard.press('Backspace');
  expect(await firstLine()).toBe('## Title');

  await caretAfterMarker(2);
  await page.keyboard.press('Backspace');
  expect(await firstLine()).toBe('# Title');

  // The last level takes its space with it: a plain line, not " Title".
  await caretAfterMarker(1);
  await page.keyboard.press('Backspace');
  expect(await firstLine()).toBe('Title');

  // Anywhere else on the line it is still an ordinary delete.
  await page.locator('.cm-line').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  expect(await firstLine()).toBe('Titl');
});
