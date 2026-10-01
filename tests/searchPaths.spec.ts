import { expect, test, type Page } from '@playwright/test';

// Search results carry the folder a note lives in. Names are reused across
// folders — "جلسه ۲" in every subject, "index", "notes" — and a list of
// identical titles tells the writer nothing about which one to open. The path
// is relative to what is being searched, so a space's own tree stays short,
// and a note sitting directly in the searched folder says nothing: there is
// nothing to tell it apart from.
const FILES: Record<string, string> = {
  'Notes/Physics/lecture 1.md': '# Physics\n\nthe needlep is in this one\n',
  'Notes/Math/lecture 1.md': '# Math\n\nanother needlep, in another folder\n',
  'Notes/Physics/solo.md': '# Solo\n\nno match here\n',
  'Notes/loose.md': 'a space-root note, with needlep in it\n',
  'top.md': 'a storage-root note, with needlep in it\n',
};

async function boot(page: Page, files: Record<string, string>, active: string, scope?: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files, active, scope }) => {
    const index = { files: {} as Record<string, number>, folders: ['Notes', 'Notes/Physics', 'Notes/Math'] };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: active }], active: 0 }));
    // The web build's first-run space is Notes (src/spaces.ts): the default
    // scope, which is what the folder is shown relative to.
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    if (scope) localStorage.setItem('satr:scope', scope);
  }, { files, active, scope });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

/** The search panel, open on the all-notes scope, with a query typed in and
 *  the results settled. */
async function searchAll(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+Shift+f');
  const panel = page.locator('#right-panel');
  await panel.locator('[data-scope="all"]').click();
  await panel.locator('.vault-search').fill(query);
  await expect(panel.locator('.search-summary')).toContainText('result');
}

/** Each result row: where it is, and the folder it says it is in. */
async function foldersOf(page: Page): Promise<Record<string, string>> {
  const rows = await page.locator('#right-panel .search-result-file-title').evaluateAll((els) => els.map((el) => ({
    path: el.getAttribute('data-note') ?? '',
    folder: el.querySelector('.search-result-file-path')?.textContent ?? '',
  })));
  return Object.fromEntries(rows.map((r) => [r.path, r.folder]));
}

test('a search result says which folder it is in, and the folders tell the twins apart', async ({ page }) => {
  await boot(page, FILES, 'Notes/Physics/lecture 1.md');
  await searchAll(page, 'needlep');
  await expect(page.locator('#right-panel .search-result-file-title')).toHaveCount(3);
  const folderOf = await foldersOf(page);
  expect(folderOf).toEqual({
    'Notes/Physics/lecture 1.md': 'Physics', // relative to the space being searched
    'Notes/Math/lecture 1.md': 'Math',
    'Notes/loose.md': '', // directly in the space root: nothing to say
  });
  // The point of it: the two notes of the same name are told apart by the row
  // itself, without opening either.
  const twins = Object.entries(folderOf).filter(([path]) => path.endsWith('lecture 1.md'));
  expect(new Set(twins.map(([, folder]) => folder)).size).toBe(2);
});

test('in All files the folder is the whole path from the storage root', async ({ page }) => {
  await boot(page, FILES, 'Notes/Physics/lecture 1.md', 'all');
  await searchAll(page, 'needlep');
  await expect(page.locator('#right-panel .search-result-file-title')).toHaveCount(4);
  const folderOf = await foldersOf(page);
  expect(folderOf['Notes/Physics/lecture 1.md']).toBe('Notes/Physics');
  expect(folderOf['Notes/Math/lecture 1.md']).toBe('Notes/Math');
  expect(folderOf['Notes/loose.md']).toBe('Notes');
  expect(folderOf['top.md']).toBe('');
});

test('the outline of one note shows no folder at all', async ({ page }) => {
  await boot(page, FILES, 'Notes/Physics/lecture 1.md');
  await page.keyboard.press('Control+Shift+f');
  const panel = page.locator('#right-panel');
  await panel.locator('[data-scope="note"]').click();
  await expect(panel.locator('.search-result-file-path')).toHaveCount(0);
});
