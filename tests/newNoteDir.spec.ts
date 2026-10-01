import { expect, test, type Page } from '@playwright/test';

// "New note" puts the note in the folder the writer is already working in —
// the folder of the note in front of them. Notes are kept in folders by
// subject, so a note written while reading "Physics/lecture 2" belongs beside
// it, not at the top of the vault.
async function boot(page: Page, files: Record<string, string>, active: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files, active }) => {
    const folders = ['Notes', 'Notes/Physics', 'Notes/Physics/2026'];
    const index = { files: {} as Record<string, number>, folders };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: active }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, { files, active });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  return page.evaluate(() => ({
    stored: (path: string) => localStorage.getItem(`satr:fs:file:${path}`) !== null,
  }));
}

/** The app's own way to a new note: the tab bar's + opens the new tab (it
 *  makes a tab, not a note — see newTab.spec.ts), and Create new note is on it. */
async function newNote(page: Page): Promise<void> {
  await page.locator('#nav-new').click();
  await page.locator('#empty-tab [data-act="new"]').click();
  await expect(page.locator('#app .cm-file-name')).toHaveText(/^Untitled/);
}

const exists = (page: Page, path: string) => page.evaluate((p) => localStorage.getItem(`satr:fs:file:${p}`) !== null, path);

test('the new note lands in the folder of the note being read', async ({ page }) => {
  await boot(page, { 'Notes/Physics/lecture.md': '# Lecture\n', 'Notes/Physics/other.md': 'x\n' }, 'Notes/Physics/lecture.md');
  await newNote(page);
  expect(await exists(page, 'Notes/Physics/Untitled.md')).toBe(true);
  // And nowhere else: not in the parent folder, not at the top of the vault.
  expect(await exists(page, 'Notes/Untitled.md')).toBe(false);
  expect(await exists(page, 'Untitled.md')).toBe(false);
  // It is open, its title is ready to be typed over, and it is a second tab.
  await expect(page.locator('#app .cm-file-name')).toHaveText('Untitled');
  expect(await page.evaluate(() => document.activeElement?.className ?? '')).toContain('cm-file-name');
  await expect(page.locator('.mobile-navbar-tabs-number')).toHaveText('2');
});

test('it follows the folder as deep as the note goes', async ({ page }) => {
  await boot(page, { 'Notes/Physics/2026/lecture.md': '# 2026\n' }, 'Notes/Physics/2026/lecture.md');
  await newNote(page);
  expect(await exists(page, 'Notes/Physics/2026/Untitled.md')).toBe(true);
  expect(await exists(page, 'Notes/Physics/Untitled.md')).toBe(false);
});

// The one folder that is not followed: the very top of the storage, which is
// the one place new notes have never gone. A note read from there (outside the
// space, or shared in from another app) leaves a new note in the space's own
// home, not beside itself.
test('a note at the very top of the storage is not a folder to write into', async ({ page }) => {
  await boot(page, { 'top.md': 'a root note\n', 'Notes/Physics/lecture.md': 'x\n' }, 'top.md');
  await newNote(page);
  expect(await exists(page, 'Notes/Untitled.md')).toBe(true);
  expect(await exists(page, 'Untitled.md')).toBe(false);
});

test('a note made on the new tab still lands where the reader was', async ({ page }) => {
  // The tab bar's + is the way to a new tab, and the new tab is where a note
  // can be made: stepping through it must not lose the folder of the note the
  // reader came from.
  await boot(page, { 'Notes/Physics/lecture.md': '# Lecture\n' }, 'Notes/Physics/lecture.md');
  await newNote(page);
  expect(await exists(page, 'Notes/Physics/Untitled.md')).toBe(true);
});

test('a name already taken in that folder steps aside', async ({ page }) => {
  await boot(page, {
    'Notes/Physics/lecture.md': '# Lecture\n',
    'Notes/Physics/Untitled.md': 'already here\n',
  }, 'Notes/Physics/lecture.md');
  await newNote(page);
  expect(await exists(page, 'Notes/Physics/Untitled 1.md')).toBe(true);
  // The empty note already there is untouched.
  expect(await page.evaluate(() => localStorage.getItem('satr:fs:file:Notes/Physics/Untitled.md'))).toBe('already here\n');
});
