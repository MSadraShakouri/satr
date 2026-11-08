import { expect, test, type Page } from '@playwright/test';
import { vaultText } from './support/vaultText';

const deep = 'Notes/Extremely-long-first-ancestor/Another-very-long-parent/Yet-another-lengthy-folder/CurrentFolder';
const files: Record<string, string> = {
  'Notes/Source/note.md': 'original',
  'Notes/Source/Child/inside.md': 'nested',
  'Notes/Destination/already.md': 'untouched',
  'Notes/Destination/note.md': 'existing',
  [`${deep}/deep.md`]: 'deep',
  'Notes/کتاب/جزوه.md': 'persian',
  'Outside/target.md': 'outside',
};
async function boot(page: Page, active = 'Notes/Source/note.md', all = false) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files, active, all }) => {
    const folders = [...new Set(Object.keys(files).flatMap((path) => {
      const parts = path.split('/'); parts.pop();
      return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    }))];
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: Object.fromEntries(Object.keys(files).map(p => [p, 1])), folders }));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: active }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    if (all) { localStorage.setItem('satr:scope', 'all'); localStorage.setItem('satr:walk-dir', 'Notes'); }
    localStorage.setItem('satr:demoShown', '1');
  }, { files, active, all });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}
async function move(page: Page, path: string) {
  await page.locator('#files').click();
  const row = page.locator(`#file-panel .tree-item-self[data-path="${path}"]`);
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page.locator('.menu:not(.is-closing) .menu-item', { hasText: 'Move to…' }).click();
  await expect(page.locator('.dir-walk')).toBeVisible();
}

test('the last folder stays visible in a long path', async ({ page }) => {
  await boot(page, `${deep}/deep.md`);
  await page.locator('#nav-new').click();
  await page.locator('#empty-tab [data-act="where"]').click();
  const measured = await page.locator('.dir-walk-here').evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n: Node | null, last: Node | null = null;
    while ((n = walker.nextNode())) if (n.textContent?.includes('CurrentFolder')) last = n;
    if (!last) return { visible: false, text: el.textContent, x: -1, right: -1 };
    const r = document.createRange(); r.selectNodeContents(last);
    const rect = r.getBoundingClientRect(); const box = el.getBoundingClientRect();
    return { visible: rect.left >= box.left - 1 && rect.right <= box.right + 1, text: el.textContent, x: Math.round(rect.left), right: Math.round(box.right) };
  });
  console.log('LONG PATH', JSON.stringify(measured));
  expect(measured.visible, 'the current folder fits within the visible path').toBe(true);
  await expect(page.locator('.dir-walk-here')).toContainText('CurrentFolder');
});

test('files are dimmed context, not destinations', async ({ page }) => {
  await boot(page);
  await page.locator('#nav-new').click();
  await page.locator('#empty-tab [data-act="where"]').click();
  const file = page.locator('.dir-walk-file', { hasText: 'note.md' });
  await expect(file).toHaveAttribute('aria-disabled', 'true');
  const color = await file.locator('.menu-item-title').evaluate((el) => getComputedStyle(el).color);
  const folderColor = await page.locator('.dir-walk [data-into]').first().locator('.menu-item-title').evaluate((el) => getComputedStyle(el).color);
  console.log('PICKER FILE COLOR', color, 'FOLDER COLOR', folderColor);
  expect(color).not.toBe(folderColor);
  await file.click();
  await expect(page.locator('.dir-walk-here')).toContainText('Source');
});

test('move walks within a space and waits for confirmation', async ({ page }) => {
  await boot(page);
  await move(page, 'Notes/Source');
  await expect(page.locator('.dir-walk-confirm')).toBeDisabled();
  await expect(page.locator('.dir-walk-up'), 'cannot leave the space').toHaveCount(0);
  await expect(page.locator('.dir-walk [data-into="Notes/Source"]'), 'cannot enter the folder being moved').toHaveCount(0);
  await page.locator('.dir-walk [data-into="Notes/Destination"]').click();
  await expect(page.locator('.dir-walk-here')).toContainText('Destination');
  expect(await vaultText(page, 'Notes/Source/note.md')).toBe('original');
  await page.keyboard.press('Escape');
  await expect(page.locator('.dir-walk')).toHaveCount(0);
  expect(await vaultText(page, 'Notes/Source/note.md')).toBe('original');
  expect(await vaultText(page, 'Notes/Destination/Source/note.md')).toBeNull();
  await page.locator('#file-panel .tree-item-self[data-path="Notes/Source"]').click({ button: 'right' });
  await page.locator('.menu:not(.is-closing) .menu-item', { hasText: 'Move to…' }).click();
  await page.locator('.dir-walk [data-into="Notes/Destination"]').click();
  await page.locator('.dir-walk-confirm').click();
  await expect.poll(() => vaultText(page, 'Notes/Destination/Source/note.md')).toBe('original');
  expect(await vaultText(page, 'Notes/Source/note.md')).toBeNull();
  expect(await vaultText(page, 'Notes/Destination/Source/Child/inside.md')).toBe('nested');
});

test('a file can move to a newly made folder', async ({ page }) => {
  await boot(page);
  await page.locator('#files').click();
  await page.locator('#file-panel .tree-item-self[data-path="Notes/Source"]').click();
  await page.locator('#file-panel .tree-item-self[data-path="Notes/Source/note.md"]').click({ button: 'right' });
  await page.locator('.menu:not(.is-closing) .menu-item', { hasText: 'Move to…' }).click();
  await expect(page.locator('.dir-walk-confirm')).toBeDisabled();
  await page.locator('.dir-walk-add').click();
  await page.locator('.dir-walk-input').fill('Fresh');
  await page.locator('.dir-walk-input').press('Enter');
  await expect(page.locator('.dir-walk-here')).toContainText('Fresh');
  await page.locator('.dir-walk-confirm').click();
  await expect.poll(() => vaultText(page, 'Notes/Source/Fresh/note.md')).toBe('original');
  expect(await vaultText(page, 'Notes/Source/note.md')).toBeNull();
});

test('All files move can walk above the original folder', async ({ page }) => {
  await boot(page, 'Notes/Source/note.md', true);
  await move(page, 'Notes/Source');
  await page.locator('.dir-walk-up').click();
  await expect(page.locator('.dir-walk-here')).toContainText('the vault');
  await page.locator('.dir-walk [data-into="Outside"]').click();
  await page.locator('.dir-walk-confirm').click();
  await expect.poll(() => vaultText(page, 'Outside/Source/note.md')).toBe('original');
});

test('a move to an existing name does not overwrite either file', async ({ page }) => {
  await boot(page);
  await page.locator('#files').click();
  await page.locator('#file-panel .tree-item-self[data-path="Notes/Source"]').click();
  await page.locator('#file-panel .tree-item-self[data-path="Notes/Source/note.md"]').click({ button: 'right' });
  await page.locator('.menu:not(.is-closing) .menu-item', { hasText: 'Move to…' }).click();
  await page.locator('.dir-walk-up').click();
  await page.locator('.dir-walk [data-into="Notes/Destination"]').click();
  await page.locator('.dir-walk-confirm').click();
  await expect(page.locator('#file-panel .nav-hint')).toContainText('Something with that name already exists');
  expect(await vaultText(page, 'Notes/Source/note.md')).toBe('original');
  expect(await vaultText(page, 'Notes/Destination/note.md')).toBe('existing');
});

test('Persian current folder is visible and its file is context', async ({ page }) => {
  await boot(page, 'Notes/کتاب/جزوه.md');
  await page.locator('#nav-new').click();
  await page.locator('#empty-tab [data-act="where"]').click();
  await expect(page.locator('.dir-walk-current')).toHaveText('کتاب');
  await expect(page.locator('.dir-walk-file')).toContainText('جزوه.md');
  await expect(page.locator('.dir-walk-up')).toBeVisible();
});
