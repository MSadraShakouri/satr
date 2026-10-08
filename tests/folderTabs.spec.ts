import { expect, test, type Page } from '@playwright/test';

// A folder's long-press menu opens its notes as tabs: "Open all notes in tabs"
// adds them in alphabetical order after the current tab (a note already open
// moves into that order, it is never opened twice); "Replace tabs with this
// folder" closes the other tabs first, and they can be reopened.

const FILES: Record<string, string> = {
  'Notes/Uni/Accounting/term 2.md': '# Term 2\n\nbeta\n',
  'Notes/Uni/Accounting/term 1.md': '# Term 1\n\nalpha\n',
  'Notes/Uni/Accounting/lab.md': '# Lab\n\ngamma\n',
  'Notes/Uni/Accounting/deep/extra.md': '# Extra\n\ndelta\n',
  'Notes/Math/algebra.md': '# Algebra\n\nnot in this folder\n',
};

async function boot(page: Page, tabs: { path: string }[], active: number): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files, tabs, active }) => {
    const folders = [...new Set(Object.keys(files).flatMap((path) => {
      const parts = path.split('/');
      parts.pop();
      return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    }))];
    const index = { files: {} as Record<string, number>, folders };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs, active }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:expanded:notes', JSON.stringify(['Notes/Uni', 'Notes/Uni/Accounting']));
  }, { files: FILES, tabs, active });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

/** A real long press on a folder row, as the finger's 500ms hold. */
async function longPressRow(page: Page, path: string): Promise<void> {
  if (!(await page.locator('body').evaluate((body) => body.classList.contains('files-open')))) {
    await page.locator('#files').click();
    await expect(page.locator('body')).toHaveClass(/files-open/);
  }
  await page.evaluate((target) => {
    const row = document.querySelector<HTMLElement>(`#file-panel .tree-item-self[data-path="${target}"]`)!;
    const box = row.getBoundingClientRect();
    const touch = new Touch({ identifier: 9, target: row, clientX: box.left + 24, clientY: box.top + 12 });
    row.dispatchEvent(new TouchEvent('touchstart', {
      touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true,
    }));
  }, path);
  await page.waitForTimeout(620);
  await expect(page.locator('.menu.mod-bottom-sheet')).toBeVisible();
}

async function tabTitles(page: Page): Promise<string[]> {
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(1);
  const titles = await page.locator('.mobile-tab-title').allTextContents();
  await page.locator('.mobile-tab-switcher [data-act="done"]').click();
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
  return titles;
}

const ACCOUNTING = 'Notes/Uni/Accounting';

test('Open all notes in tabs: the folder’s notes, alphabetically, after the current tab', async ({ page }) => {
  await boot(page, [{ path: 'Notes/Math/algebra.md' }], 0);
  await longPressRow(page, ACCOUNTING);
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Open all notes in tabs' }).click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('lab');
  // Only the folder's own notes: the subfolder's extra.md stays out.
  expect(await tabTitles(page)).toEqual(['algebra', 'lab', 'term 1', 'term 2']);
});

test('a note already open moves into the folder’s order, and is not opened twice', async ({ page }) => {
  await boot(page, [{ path: 'Notes/Math/algebra.md' }, { path: 'Notes/Uni/Accounting/term 2.md' }], 0);
  await longPressRow(page, ACCOUNTING);
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Open all notes in tabs' }).click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('lab');
  expect(await tabTitles(page)).toEqual(['algebra', 'lab', 'term 1', 'term 2']);
});

test('Replace tabs with this folder closes the others, and they can be reopened', async ({ page }) => {
  await boot(page, [{ path: 'Notes/Math/algebra.md' }, { path: 'Notes/Uni/Accounting/term 2.md' }], 0);
  await longPressRow(page, ACCOUNTING);
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Replace tabs with this folder' }).click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('lab');
  expect(await tabTitles(page)).toEqual(['lab', 'term 1', 'term 2']);
  // The tab that was closed comes back.
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await page.locator('.mobile-tab-switcher-menu-button').click();
  await page.getByRole('menuitem', { name: 'Reopen closed tab' }).click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('algebra');
});
