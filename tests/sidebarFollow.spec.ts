import { expect, test, type Page } from '@playwright/test';

// "Obsidian has a setting where in the left sidebar it always shows the file
// you're in (always focuses on that, regardless of how deep the user is in a
// folder, always shows the file rather than keeping a random dir, Obsidian has
// the option at the bottom near new file and stuff)."
//
// So: the tree opens itself down to the note being read — however deep it sits
// — and marks it, every time the note changes; the switch lives with the
// drawer's other buttons at the foot of the list; and it is on for a reader who
// has never touched it, the way Obsidian's setting starts.

type Space = { id: string; name: string; path: string };

async function seed(
  page: Page,
  files: Record<string, string>,
  spaces: Space[],
  active: string,
  extra: { scope?: string; walk?: string } = {},
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
    if (!extra.preserve) {
      localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: active }], active: 0 }));
      localStorage.setItem('satr:spaces', JSON.stringify(spaces));
      if (extra.scope) localStorage.setItem('satr:scope', extra.scope); else localStorage.removeItem('satr:scope');
      if (extra.walk) localStorage.setItem('satr:walk-dir', extra.walk); else localStorage.removeItem('satr:walk-dir');
    }
  }, { files, spaces, active, extra });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

const FILES = {
  'Notes/top.md': '# top\n',
  'Notes/A/B/C/deep.md': '# deep\n',
  'Notes/A/side.md': '# side\n',
};
const NOTES: Space[] = [{ id: 'notes', name: 'Notes', path: 'Notes' }];

async function openDrawer(page: Page, path: string) {
  await page.locator('#files').first().click();
  await expect(page.locator('body')).toHaveClass(/files-open/);
  await page.waitForTimeout(700);
  return page.locator(`#file-panel [data-path="${path}"]`);
}

test('the tree opens down to the note being read, however deep it sits', async ({ page }) => {
  await seed(page, FILES, NOTES, 'Notes/A/B/C/deep.md');
  const active = await openDrawer(page, 'Notes/A/B/C/deep.md');
  await expect(active).toHaveClass(/is-active/);
  await expect(active).toBeInViewport();
  // Every folder above it was opened, without the reader opening anything.
  for (const folder of ['Notes/A', 'Notes/A/B', 'Notes/A/B/C']) {
    await expect(page.locator(`#file-panel [data-path="${folder}"]`), folder).toHaveAttribute('aria-expanded', 'true');
  }
  // A note of no interest was never opened.
  await expect(page.locator('#file-panel [data-path="Notes/A/side.md"]')).toBeVisible();
});

test('in “All files” the walker keeps the folder the reader put it in', async ({ page }) => {
  // "All files" is a walker: walking the storage is what that scope is for, so
  // showing the note never moves it. The note is marked when the reader walks
  // to the folder it is in — and nothing is moved for them.
  await seed(page, FILES, NOTES, 'Notes/A/B/C/deep.md', { scope: 'all', walk: 'Notes' });
  await page.locator('#files').first().click();
  await expect(page.locator('body')).toHaveClass(/files-open/);
  await page.waitForTimeout(700);
  await expect(page.locator('#file-panel')).toHaveClass(/mod-walker/);
  expect((await page.locator('#file-panel .workspace-drawer-header-info').textContent())?.trim()).toBe('/Notes');
  await expect(page.locator('#file-panel [data-path="Notes/A/B/C/deep.md"]')).toHaveCount(0);
  await expect(page.locator('#file-panel .tree-item-self.is-active')).toHaveCount(0);

  for (const folder of ['Notes/A', 'Notes/A/B', 'Notes/A/B/C']) {
    await page.locator(`#file-panel [data-path="${folder}"]`).click();
    await page.waitForTimeout(150);
  }
  await expect(page.locator('#file-panel [data-path="Notes/A/B/C/deep.md"]')).toHaveClass(/is-active/);
});

test('the switch is in the drawer’s own row of buttons, on by default, one tap off', async ({ page }) => {
  await seed(page, FILES, NOTES, 'Notes/A/B/C/deep.md');
  await page.locator('#files').first().click();
  await expect(page.locator('body')).toHaveClass(/files-open/);
  const follow = page.locator('#file-panel [data-act="follow"]');
  await expect(follow).toHaveAttribute('aria-label', 'Always show the current file');
  await expect(follow).toHaveAttribute('aria-pressed', 'true'); // on, untouched
  await expect(page.locator('#file-panel .nav-buttons-container [data-act="follow"]')).toHaveCount(1);

  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('satr:follow-active'))).toBe('0');

  // Off means the reader's own arrangement is left alone: they close the note's
  // folder and it stays closed — across the drawer, and across a restart.
  await page.locator('#file-panel [data-path="Notes/A"]').click();
  await expect(page.locator('#file-panel [data-path="Notes/A"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#file-panel [data-path="Notes/A/B/C/deep.md"]')).toBeHidden(); // the closed folder took it with it
  await page.reload();
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await page.locator('#files').first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('#file-panel [data-act="follow"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#file-panel [data-path="Notes/A"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#file-panel [data-path="Notes/A/B/C/deep.md"]')).toBeHidden();

  // And one tap brings it back, with the note opened down to again.
  await page.locator('#file-panel [data-act="follow"]').click();
  await expect(page.locator('#file-panel [data-path="Notes/A/B/C/deep.md"]')).toHaveClass(/is-active/);
});
