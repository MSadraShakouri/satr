import { expect, test, type Page } from '@playwright/test';

// "Reveal current file" is a verb: one tap takes the file panel to the note —
// the space that holds it, or All files at its folder — and nothing else ever
// moves the panel. Opening a note only moves the mark.
type Space = { id: string; name: string; path: string };

async function seed(
  page: Page,
  files: Record<string, string>,
  spaces: Space[],
  active: string,
  extra: { scope?: string; walk?: string; tabs?: string[] } = {},
): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files, spaces, active, extra }) => {
    const folders = new Set<string>();
    for (const path of Object.keys(files)) {
      const parts = path.split('/');
      parts.pop();
      parts.forEach((_, i) => folders.add(parts.slice(0, i + 1).join('/')));
    }
    const index = { files: {} as Record<string, number>, folders: [...folders] };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    const paths = extra.tabs ?? [active];
    localStorage.setItem('satr:tabs', JSON.stringify({
      tabs: paths.map((path) => ({ path })),
      active: Math.max(0, paths.indexOf(active)),
    }));
    localStorage.setItem('satr:spaces', JSON.stringify(spaces));
    if (extra.scope) localStorage.setItem('satr:scope', extra.scope); else localStorage.removeItem('satr:scope');
    if (extra.walk) localStorage.setItem('satr:walk-dir', extra.walk); else localStorage.removeItem('satr:walk-dir');
    localStorage.removeItem('satr:follow-active'); // the old switch's key is dead
  }, { files, spaces, active, extra });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

const FILES = {
  'Notes/top.md': '# top\n',
  'Notes/A/B/C/deep.md': '# deep\n',
  'Notes/A/side.md': '# side\n',
  'Work/plan.md': '# plan\n',
  'Loose/loose.md': '# loose\n',
};
const NOTES: Space[] = [{ id: 'notes', name: 'Notes', path: 'Notes' }];
const BOTH: Space[] = [...NOTES, { id: 'work', name: 'Work', path: 'Work' }];

async function openDrawer(page: Page): Promise<void> {
  await page.locator('#files').first().click();
  await expect(page.locator('body')).toHaveClass(/files-open/);
  await page.waitForTimeout(400);
}
const locate = (page: Page) => page.locator('#file-panel [data-act="locate"]');

test('the tree never opens itself; the button opens it down to the note', async ({ page }) => {
  await seed(page, FILES, NOTES, 'Notes/A/B/C/deep.md', { scope: 'notes' });
  await openDrawer(page);
  // Nothing was opened for the reader.
  await expect(page.locator('#file-panel [data-path="Notes/A"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#file-panel [data-path="Notes/A/B/C/deep.md"]')).toHaveCount(0);

  await locate(page).click();
  const row = page.locator('#file-panel [data-path="Notes/A/B/C/deep.md"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/is-active/);
  await expect(row).toBeInViewport();
  for (const folder of ['Notes/A', 'Notes/A/B', 'Notes/A/B/C']) {
    await expect(page.locator(`#file-panel [data-path="${folder}"]`), folder).toHaveAttribute('aria-expanded', 'true');
  }
});

test('a note in another space takes the panel to that space', async ({ page }) => {
  await seed(page, FILES, BOTH, 'Work/plan.md', { scope: 'notes' });
  await openDrawer(page);
  await expect(page.locator('#file-panel .workspace-drawer-vault-name')).toHaveText('Notes');

  await locate(page).click();
  await expect(page.locator('#file-panel .workspace-drawer-vault-name')).toHaveText('Work');
  const row = page.locator('#file-panel [data-path="Work/plan.md"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/is-active/);
  await expect(row).toBeInViewport();
});

test('a note in no space lands in All files at its folder', async ({ page }) => {
  await seed(page, FILES, BOTH, 'Loose/loose.md', { scope: 'notes' });
  await openDrawer(page);
  await expect(page.locator('#file-panel')).not.toHaveClass(/mod-walker/);

  await locate(page).click();
  await expect(page.locator('#file-panel')).toHaveClass(/mod-walker/);
  await expect(page.locator('#file-panel .workspace-drawer-header-info')).toHaveText('/Loose');
  const row = page.locator('#file-panel [data-path="Loose/loose.md"]');
  await expect(row).toHaveClass(/is-active/);
  await expect(row).toBeInViewport();
});

test('with no note open there is nothing to reveal', async ({ page }) => {
  await seed(page, FILES, NOTES, 'Notes/top.md', { scope: 'notes' });
  await page.locator('#nav-new').click();
  await openDrawer(page);
  await expect(locate(page)).toBeDisabled();
});

test('changing notes moves nothing — not the tree, not the walker', async ({ page }) => {
  // All files: the walker's folder is also the search root and the new-note
  // folder, so following a tab must never move it.
  await seed(page, FILES, BOTH, 'Notes/A/B/C/deep.md', {
    scope: 'all', walk: 'Notes', tabs: ['Notes/A/B/C/deep.md', 'Work/plan.md'],
  });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('satr:walk-dir'))).toBe('Notes');
  await openDrawer(page);
  await page.locator('#backdrop').click({ position: { x: 380, y: 400 } });
  await expect(page.locator('body')).not.toHaveClass(/files-open/);
  await page.locator('#nav-forward').click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('plan');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => localStorage.getItem('satr:walk-dir'))).toBe('Notes');
});
