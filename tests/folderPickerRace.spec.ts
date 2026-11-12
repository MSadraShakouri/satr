import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });
for (const [phase, returnToRoot] of [['list', false], ['mkdir', false], ['mkdir', true]] as const) {
  test(`making a folder stays rooted at its request and does not undo later navigation: delayed ${phase}, return ${returnToRoot}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app')).toBeVisible();
    await page.evaluate((phase) => {
      const { backend } = window.__satr.load('/src/vault.ts');
      const { walkToFolder } = window.__satr.load('/src/dirPicker.ts');
      const originalList = backend.list.bind(backend), originalMkdir = backend.mkdir.bind(backend);
      const state = { armed: false, waiting: false, made: [] as string[], release: () => {} };
      (window as any).__folderRace = state;
      const hold = async () => {
        state.armed = false; state.waiting = true;
        await new Promise<void>(resolve => { state.release = resolve; });
      };
      backend.list = async (dir: string) => {
        if (state.armed && phase === 'list' && dir === '') await hold();
        return dir === '' ? [{ kind: 'folder', name: 'B', path: 'B', mtime: 1 }] : [];
      };
      backend.mkdir = async (path: string) => {
        state.made.push(path);
        if (state.armed && phase === 'mkdir') await hold();
      };
      void walkToFolder({ start: '', ceiling: '', title: 'Destination', confirm: 'Choose', label: (d: string) => d || 'Root' }).then((v: string | null) => {
        (state as any).result = v; backend.list = originalList; backend.mkdir = originalMkdir;
      });
    }, phase);
    await expect(page.locator('.dir-walk [data-into="B"]')).toBeVisible();
    await page.locator('.dir-walk [data-add]').click();
    await page.locator('.dir-walk-input').fill('New');
    await page.evaluate(() => { (window as any).__folderRace.armed = true; });
    await page.locator('.dir-walk-input').press('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).__folderRace.waiting)).toBe(true);
    await page.locator('.dir-walk [data-into="B"]').click();
    await expect(page.locator('.dir-walk-here')).toHaveText('B');
    if (returnToRoot) {
      await page.locator('.dir-walk [data-up]').click();
      await expect(page.locator('.dir-walk-here')).toHaveText('Root');
    }
    await page.evaluate(() => (window as any).__folderRace.release());
    await expect.poll(() => page.evaluate(() => (window as any).__folderRace.made)).toEqual(['New']);
    // Let the resumed async function reach its rendering step.
    await page.waitForTimeout(100);
    await expect(page.locator('.dir-walk-here')).toHaveText(returnToRoot ? 'Root' : 'B');
    await page.locator('.dir-walk [data-confirm]').click();
    await expect.poll(() => page.evaluate(() => (window as any).__folderRace.result)).toBe(returnToRoot ? '' : 'B');
  });
}
