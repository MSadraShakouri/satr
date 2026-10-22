import { expect, test, type Page } from '@playwright/test';

// Verify the global "Include subfolders" toggle: when OFF, the All-notes
// searches (right sidebar and new-tab page) only see direct children of the
// space root / walked folder — name matches and content hits alike.
const FILES: Record<string, string> = {
  'Notes/top.md': 'hello from the top — needle here\n',
  'Notes/sub/deep.md': 'hello from deep — needle here\n',
  'Notes/sub/other.md': 'another deep file with needle\n',
  'Notes/loose.md': 'a loose top file, no match\n',
};

async function boot(page: Page, files: Record<string, string>, active: string, settings?: Record<string, unknown>) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files, active, settings }) => {
    const folders = [...new Set(Object.keys(files).flatMap((path) => {
      const parts = path.split('/');
      parts.pop();
      return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    }))];
    const index = { files: {} as Record<string, number>, folders };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: active }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    if (settings) localStorage.setItem('satr:settings', JSON.stringify(settings));
  }, { files, active, settings });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

async function ensureRightDrawer(page: Page): Promise<void> {
  if (!(await page.locator('body').evaluate((b) => b.classList.contains('outline-open')))) {
    await page.keyboard.press('Control+Shift+f');
    await expect(page.locator('body')).toHaveClass(/outline-open/);
  }
  // #boot-snapshot may still be present (contains a second #right-panel copy)
  await expect(page.locator('#app #right-panel')).toBeVisible();
}

async function ensureLeftDrawer(page: Page): Promise<void> {
  if (!(await page.locator('body').evaluate((b) => b.classList.contains('files-open')))) {
    await page.locator('#files').click();
    await expect(page.locator('body')).toHaveClass(/files-open/);
  }
}

async function openAllSearch(page: Page, query: string): Promise<void> {
  await ensureRightDrawer(page);
  const panel = page.locator('#app #right-panel');
  // Scope pill: ensure All notes is selected
  const all = panel.locator('[data-scope="all"]');
  await expect(all).toBeVisible();
  await all.click();
  await expect(panel.locator('[data-scope="all"][aria-checked="true"]')).toBeVisible();
  const input = panel.locator('.vault-search');
  await expect(input).toBeVisible();
  await input.fill(query);
  // Wait for results to settle; the panel shows a summary when done.
  await expect(panel.locator('.search-summary')).not.toHaveText('', { timeout: 5000 });
}

test('recursive on finds deep notes, off finds only top-level', async ({ page }) => {
  // Default: recursiveSearch true (or missing → true)
  await boot(page, FILES, 'Notes/top.md');
  await openAllSearch(page, 'needle');
  const panel = page.locator('#app #right-panel');
  await expect(panel.locator('.search-result-file-title')).toHaveCount(3);
  const pathsOn = await panel.locator('.search-result-file-title').evaluateAll((els) => els.map((el) => el.getAttribute('data-note')));
  expect(pathsOn).toContain('Notes/sub/deep.md');
  expect(pathsOn).toContain('Notes/sub/other.md');
  expect(pathsOn).toContain('Notes/top.md');

  // Flip OFF via localStorage and refresh
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('satr:settings') ?? '{}');
    s.recursiveSearch = false;
    localStorage.setItem('satr:settings', JSON.stringify(s));
  });
  await page.reload();
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await openAllSearch(page, 'needle');
  await expect(panel.locator('.search-result-file-title')).toHaveCount(1);
  const pathsOff = await panel.locator('.search-result-file-title').evaluateAll((els) => els.map((el) => el.getAttribute('data-note')));
  expect(pathsOff).toEqual(['Notes/top.md']);
});

test('name/folder finder is also shallow when toggle is off', async ({ page }) => {
  const withFolderName: Record<string, string> = {
    'Notes/top.md': 'content\n',
    'Notes/Physics/lecture.md': 'content\n',
    'Notes/sub/PhysicsNote.md': 'content\n',
  };
  await boot(page, withFolderName, 'Notes/top.md', { recursiveSearch: false, version: 4 });
  await openAllSearch(page, 'Physics');
  const panel = page.locator('#app #right-panel');
  // Only top-level name matches; deep folder/name should not appear.
  const titles = await panel.locator('.search-result-file-title').evaluateAll((els) => els.map((el) => el.getAttribute('data-note')));
  expect(titles).not.toContain('Notes/sub/PhysicsNote.md');
  // The folder itself should not be listed when it only exists under a subfolder with no top-level notes
  await expect(panel.locator('[data-folder="Notes/sub"]')).toHaveCount(0);
});

test('header toggle lives next to Search title, disabled in This-note', async ({ page }) => {
  await boot(page, FILES, 'Notes/top.md');
  await ensureRightDrawer(page);
  const panel = page.locator('#app #right-panel');
  const toggle = panel.locator('[data-recursive-toggle]');
  const header = panel.locator('.workspace-drawer-header');
  // Placement: the button is inside the header, to the right of the title's container.
  await expect(header.locator('.workspace-drawer-header-left')).toBeVisible();
  await expect(toggle).toBeVisible();
  await expect(header.locator('[data-recursive-toggle]')).toBeVisible();
  // Check it is a sibling of .workspace-drawer-header-left inside .workspace-drawer-header
  const isSibling = await page.evaluate(() => {
    const header = document.querySelector('#right-panel .workspace-drawer-header')!;
    const left = header.querySelector('.workspace-drawer-header-left');
    const btn = header.querySelector('[data-recursive-toggle]');
    return left?.parentElement === header && btn?.parentElement === header;
  });
  expect(isSibling).toBe(true);

  // In This-note scope, the control is disabled (visible but not interactive)
  await panel.locator('[data-scope="note"]').click();
  await expect(toggle).toBeDisabled();
  // In All-notes scope, it is enabled
  await panel.locator('[data-scope="all"]').click();
  await expect(toggle).toBeEnabled();
});

test('header toggle flips the global flag and re-renders search', async ({ page }) => {
  await boot(page, FILES, 'Notes/top.md', { recursiveSearch: true, version: 4 });
  await openAllSearch(page, 'needle');
  const panel = page.locator('#app #right-panel');
  const toggle = panel.locator('[data-recursive-toggle]');
  await expect(panel.locator('.search-result-file-title')).toHaveCount(3);
  expect(await toggle.getAttribute('aria-pressed')).toBe('true');
  expect(await toggle.evaluate((el) => el.classList.contains('is-active'))).toBe(true);

  await toggle.click();
  // The toggle should now be off
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // Storage persisted
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('satr:settings') as string).recursiveSearch);
  expect(stored).toBe(false);
  // Search results updated to shallow
  await expect(panel.locator('.search-result-file-title')).toHaveCount(1);

  // Toggle back
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.search-result-file-title')).toHaveCount(3);
});

test('Settings mirror controls the same flag', async ({ page }) => {
  await boot(page, FILES, 'Notes/top.md', { recursiveSearch: true, version: 4 });
  // Open Settings via the gear (needs left drawer open, as in folderExport.spec)
  await ensureLeftDrawer(page);
  await page.locator('#settings-button').click();
  const sheet = page.locator('.settings-screen');
  await expect(sheet).toBeVisible();
  const toggle = sheet.locator('[data-toggle="recursiveSearch"]');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  // Persisted
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('satr:settings') as string).recursiveSearch);
  expect(stored).toBe(false);
  await page.locator('.settings-back').click();
  await expect(sheet).not.toBeVisible();
  // New tab empty search also respects the flag
  await page.locator('#nav-new').click();
  await expect(page.locator('#empty-tab .empty-state-search-field')).toBeVisible();
  await page.locator('#empty-tab .empty-state-search-field').fill('needle');
  await expect(page.locator('#empty-tab .empty-state-hit')).toHaveCount(1);
  await expect(page.locator('#empty-tab .empty-state-hit')).toContainText('top');
});

test('new-tab search is shallow when toggle is off', async ({ page }) => {
  await boot(page, FILES, 'Notes/top.md', { recursiveSearch: false, version: 4 });
  await page.locator('#nav-new').click();
  await expect(page.locator('#empty-tab .empty-state-search-field')).toBeVisible();
  await page.locator('#empty-tab .empty-state-search-field').fill('needle');
  await expect(page.locator('#empty-tab .empty-state-hit')).toHaveCount(1);
  await expect(page.locator('#empty-tab .empty-state-hit').first()).toContainText('top');

  // Flip on via header and verify empty-tab reflects it without reopening
  await ensureRightDrawer(page);
  const panel = page.locator('#app #right-panel');
  // Must be in All notes scope for toggle to be enabled
  await panel.locator('[data-scope="all"]').click();
  await expect(panel.locator('[data-recursive-toggle]')).toBeEnabled();
  await panel.locator('[data-recursive-toggle]').click();
  // Close drawer so empty-tab is fully visible again
  await page.keyboard.press('Escape');
  // The satr:settings-changed event should have re-run the query
  await expect(page.locator('#empty-tab .empty-state-hit')).toHaveCount(3);
});

test('subfolders off searches the open note\'s folder — not the space root, not below it', async ({ page }) => {
  const files: Record<string, string> = {
    'Notes/top.md': 'needle at the space root\n',
    'Notes/sub/deep.md': "needle in the open note's own folder\n",
    'Notes/sub/other.md': 'another needle in the same folder\n',
    'Notes/sub/under/below.md': 'needle a level below\n',
  };
  await boot(page, files, 'Notes/sub/deep.md', { recursiveSearch: false, version: 4 });
  await openAllSearch(page, 'needle');
  const panel = page.locator('#app #right-panel');
  const paths = await panel.locator('.search-result-file-title').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-note')));
  expect(paths.sort()).toEqual(['Notes/sub/deep.md', 'Notes/sub/other.md']);
});
