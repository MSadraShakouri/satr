import { expect, test, type Page } from '@playwright/test';

// "Obsidian has a setting where in the left sidebar it always shows the file
// you're in (always focuses on that, regardless of how deep the user is in a
// folder, always shows the file rather than keeping a random dir, Obsidian has
// the option at the bottom near new file and stuff)."
//
// So: in a space the tree opens itself down to the note, however deep it sits;
// in "All files" the walker changes to the note's parent folder. Both mark and
// scroll to the note whenever it changes. The switch lives with the drawer's
// footer buttons and starts on for a reader who has never touched it.

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
  }, { files, spaces, active, extra });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

const FILES = {
  'Notes/top.md': '# top\n',
  'Notes/A/B/C/deep.md': '# deep\n',
  'Notes/A/side.md': '# side\n',
  'Notes/X/Y/other.md': '# other\n',
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

test('in default “All files” mode, following tracks the note and can be turned off', async ({ page }) => {
  const deep = 'Notes/A/B/C/deep.md';
  const other = 'Notes/X/Y/other.md';
  // A fresh Android install has no saved spaces, so it starts in All files.
  await seed(page, FILES, [], deep, { walk: 'Notes', tabs: [deep, other] });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('satr:walk-dir'))).toBe('Notes/A/B/C');

  const active = await openDrawer(page, deep);
  await expect(page.locator('#file-panel')).toHaveClass(/mod-walker/);
  await expect(page.locator('#file-panel .workspace-drawer-header-info')).toHaveText('/Notes/A/B/C');
  await expect(active).toHaveClass(/is-active/);
  await expect(active).toBeInViewport();

  // Changing tabs while following moves the walker to the newly active note.
  await page.locator('#backdrop').click({ position: { x: 380, y: 400 } });
  await expect(page.locator('body')).not.toHaveClass(/files-open/);
  await page.locator('#nav-forward').click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('other');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('satr:walk-dir'))).toBe('Notes/X/Y');

  // When off, switching to a note elsewhere leaves the walker's chosen folder
  // alone. Turning it back on immediately focuses the current note again.
  await openDrawer(page, other);
  const follow = page.locator('#file-panel [data-act="follow"]');
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  for (const parent of ['Notes/X', 'Notes']) {
    await page.locator(`#file-panel .tree-item-self[data-kind="parent"][data-path="${parent}"]`).click();
    await expect(page.locator('#file-panel .workspace-drawer-header-info')).toHaveText(`/${parent}`);
  }
  await page.locator('#backdrop').click({ position: { x: 380, y: 400 } });
  await expect(page.locator('body')).not.toHaveClass(/files-open/);
  await page.locator('#nav-back').click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('deep');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('satr:walk-dir'))).toBe('Notes');

  await openDrawer(page, deep);
  const followAgain = page.locator('#file-panel [data-act="follow"]');
  await expect(followAgain).toHaveAttribute('aria-pressed', 'false');
  await followAgain.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('satr:walk-dir'))).toBe('Notes/A/B/C');
  const refocused = page.locator(`#file-panel [data-path="${deep}"]`);
  await expect(refocused).toHaveClass(/is-active/);
  await expect(refocused).toBeInViewport();
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
