import { expect, test, type Page } from '@playwright/test';

// The new tab: what the phone's + opens (a tab, not a note), where its actions
// sit on a phone's screen, and where its Search goes.
const FILES: Record<string, string> = {
  'Notes/Physics/lecture 1.md': '# Physics\n\nthe needlep is in this one\n',
  'Notes/Math/lecture 1.md': '# Math\n\nanother needlep, in another folder\n',
  'Notes/alpha.md': '# Alpha\n\nnothing here\n',
  'Notes/beta.md': '# Beta\n\nnothing here\n',
  'Notes/gamma.md': '# Gamma\n\nnothing here\n',
  'Notes/delta.md': '# Delta\n\nnothing here\n',
  'Notes/epsilon.md': '# Epsilon\n\nnothing here\n',
};

async function boot(page: Page, recents: boolean, height = 844) {
  await page.setViewportSize({ width: 390, height });
  await page.addInitScript(({ files, recents }) => {
    const index = { files: {} as Record<string, number>, folders: ['Notes', 'Notes/Physics', 'Notes/Math'] };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/alpha.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    if (recents) localStorage.setItem('satr:recent', JSON.stringify(Object.keys(files)));
  }, { files: FILES, recents });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

const fileCount = (page: Page): Promise<number> =>
  page.evaluate(() => Object.keys((JSON.parse(localStorage.getItem('satr:fs:index')!) as { files: Record<string, number> }).files).length);

test('the + opens a tab, and nothing is created by it', async ({ page }) => {
  await boot(page, false);
  const before = await fileCount(page);
  await page.locator('#nav-new').click();
  await expect(page.locator('#empty-tab')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await fileCount(page)).toBe(before);
  await expect(page.locator('.mobile-navbar-tabs-number')).toHaveText('2');
  // Its own actions are the way to a note from here.
  await expect(page.locator('#empty-tab [data-act="new"]')).toBeVisible();
});

test('the new tab sits in the middle of the screen', async ({ page }) => {
  await boot(page, false);
  await page.locator('#nav-new').click();
  await expect(page.locator('#empty-tab')).toBeVisible();
  const box = (await page.locator('#empty-tab .empty-state-container').boundingBox())!;
  const view = page.viewportSize()!;
  // The block is centred (the panel's own 60px/100px padding gives the centre
  // a 20px bite towards the top, which is where the navbar is).
  expect(Math.abs((box.y + box.height / 2) - view.height / 2)).toBeLessThanOrEqual(30);
});

test('a long list of recent notes never clips the actions off the top', async ({ page }) => {
  await boot(page, true, 420);
  await page.locator('#nav-new').click();
  await expect(page.locator('#empty-tab')).toBeVisible();
  const box = (await page.locator('#empty-tab .empty-state-container').boundingBox())!;
  // Centring a column that is taller than its scroll container loses the top:
  // the block was pushed up against the screen's edge. It keeps the panel's
  // own padding above it now — a deliberate start, not a clipped one — and the
  // panel scrolls to the rest of the list.
  expect(box.y).toBeGreaterThanOrEqual(40);
  const scrolls = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('#empty-tab')!;
    return el.scrollHeight > el.clientHeight;
  });
  expect(scrolls).toBe(true);
});

test('the new tab has its own search: a big field, not the sidebar', async ({ page }) => {
  await boot(page, false);
  await page.locator('#nav-new').click();
  const field = page.locator('#empty-tab .empty-state-search-field');
  await expect(field).toBeVisible();
  // The icon is at the field's start, and it is a button: pressing it focuses
  // the field (there is nowhere else for a search in the new tab to go).
  await expect(page.locator('#empty-tab .empty-state-search-icon')).toBeVisible();
  await page.locator('#empty-tab .empty-state-search-icon').click();
  await expect(field).toBeFocused();
  // Searching happens in the page: the right sidebar is not opened, and does
  // not cover the new tab.
  await expect(page.locator('#right-panel')).not.toHaveClass(/is-open/);
  expect(await page.evaluate(() => document.body.classList.contains('outline-open'))).toBe(false);
});

test('the new tab’s search looks through the whole scope and shows where each hit is', async ({ page }) => {
  await boot(page, false);
  await page.locator('#nav-new').click();
  await page.locator('#empty-tab .empty-state-search-field').fill('needlep');
  const hits = page.locator('#empty-tab .empty-state-hit');
  await expect(hits).toHaveCount(2);
  // Name, folder and the matching line — the two notes are in different
  // folders, which is the whole point of the folder after the name.
  await expect(hits.first().locator('.empty-state-hit-line')).toContainText('needlep');
  const rows = await hits.evaluateAll((els) => els.map((el) => ({
    title: el.querySelector('.empty-state-recent-name')?.textContent ?? '',
    folder: el.querySelector('.search-result-file-path')?.textContent ?? '',
  })));
  // Shortened the way the drawers' paths are: the folder the note lives in
  // keeps its name and the ones above it are cut to their shortest unique
  // prefix — here `Notes` alone is unique at one letter, and Physics and Math
  // part at their first.
  expect([...rows].sort((a, b) => a.folder.localeCompare(b.folder))).toEqual([
    { title: 'lecture 1', folder: 'N/Math' },
    { title: 'lecture 1', folder: 'N/Physics' },
  ]);
});

test('opening a new-tab result goes to the hit, with the find bar’s ring on it', async ({ page }) => {
  await boot(page, false);
  await page.locator('#nav-new').click();
  await page.locator('#empty-tab .empty-state-search-field').fill('needlep');
  await page.locator('#empty-tab .empty-state-hit').first().click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('lecture 1');
  // Shown, not selected: the caret sits after the hit and the hit wears the
  // ring (editor.flashRange), as a sidebar result does.
  const caret = await page.evaluate(() => {
    const el = document.querySelector('#app .cm-content')!;
    return (el as HTMLElement).ownerDocument.defaultView!.getSelection()?.focusOffset ?? -1;
  });
  expect(caret).toBeGreaterThan(0);
  await expect(page.locator('.obsidian-search-match-highlight')).toHaveCount(1);
});

test('a query that matches nothing says so, and clearing it brings the actions back', async ({ page }) => {
  await boot(page, false);
  await page.locator('#nav-new').click();
  const field = page.locator('#empty-tab .empty-state-search-field');
  await field.fill('nothingmatchesthis');
  await expect(page.locator('#empty-tab .pane-empty')).toHaveText('No results');
  await expect(page.locator('#empty-tab [data-act="new"]')).toBeHidden();
  await field.fill('');
  await expect(page.locator('#empty-tab [data-act="new"]')).toBeVisible();
  await expect(page.locator('#empty-tab .empty-state-results')).toBeHidden();
});

// The bottom row's magnifier has one meaning per state: with a note open it
// finds in the note, and in a new tab — where there is no note to find in — it
// is the *search*, focusing the field that is already in the page. (Reported:
// "search icon in bottom row doesn't exist in site" — it was hidden while the
// tab was empty, and the new tab's own field was the only way in.)
test('in a new tab the bottom magnifier is the search, and it focuses the field', async ({ page }) => {
  await boot(page, false);
  const find = page.locator('#nav-find');
  await expect(find).toBeVisible(); // a note is open: find in note
  await expect(find).toHaveAttribute('aria-label', 'Find in note');
  await page.locator('#nav-new').click();
  await expect(find).toBeVisible(); // still there, meaning something else
  await expect(find).toHaveAttribute('aria-label', 'Search notes');
  await find.click();
  await expect(page.locator('#empty-tab .empty-state-search-field')).toBeFocused();
  // Still the page's own search: no sidebar.
  expect(await page.evaluate(() => document.body.classList.contains('outline-open'))).toBe(false);
});

test('with a note open the same button still finds in the note', async ({ page }) => {
  await boot(page, false);
  await page.locator('#nav-find').click();
  const field = page.locator('.document-search-input input');
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
});

// The search is a finder too: a note's own name, and the folders above it, are
// matched as well as the text inside them ("one search act as both grep and
// find"). Both groups come from the note list the search already has.
test('a new-tab search matches names and folders, above the line hits', async ({ page }) => {
  await boot(page, false);
  await page.locator('#nav-new').click();
  await page.locator('#empty-tab .empty-state-search-field').fill('alpha');
  const groups = page.locator('#empty-tab .empty-state-group');
  await expect(groups).toHaveCount(2); // files and folders, then the lines
  await expect(groups.first().locator('.empty-state-group-title')).toHaveText('Files and folders');
  await expect(groups.nth(1).locator('.empty-state-group-title')).toHaveText('In notes');
  const named = groups.first().locator('.empty-state-hit');
  await expect(named).toHaveCount(1);
  await expect(named.first().locator('.empty-state-recent-name')).toHaveText('alpha');
  // And a folder by its name.
  await page.locator('#empty-tab .empty-state-search-field').fill('Physics');
  const folderRow = page.locator('#empty-tab [data-hit-folder]');
  await expect(folderRow).toHaveCount(1);
  await expect(folderRow.locator('.empty-state-recent-name')).toHaveText('Physics');
});

test('a name row opens the note, and a folder row opens the folder', async ({ page }) => {
  await boot(page, false);
  await page.locator('#nav-new').click();
  await page.locator('#empty-tab .empty-state-search-field').fill('alpha');
  await page.locator('#empty-tab [data-hit-note]').first().click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('alpha');

  await page.locator('#nav-new').click();
  await page.locator('#empty-tab .empty-state-search-field').fill('Physics');
  await page.locator('#empty-tab [data-hit-folder]').click();
  // The file panel, opened at that folder: the row is on screen and expanded.
  await expect(page.locator('body')).toHaveClass(/files-open/);
  await expect(page.locator('#file-panel .tree-item-self[data-path="Notes/Physics"]')).toBeVisible();
});

// A folder row's second line is the path *above* it, not the folder again: the
// name is already on the row (a folder called Accounting read
// "Accounting  N/U/Se/Accounting" for one build of this).
test('a folder row says its name once, then where it sits', async ({ page }) => {
  await boot(page, false);
  await page.locator('#nav-new').click();
  await page.locator('#empty-tab .empty-state-search-field').fill('Physics');
  const row = page.locator('#empty-tab [data-hit-folder]');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.empty-state-recent-name')).toHaveText('Physics');
  await expect(row.locator('.search-result-file-path')).toHaveText('Notes');
});
