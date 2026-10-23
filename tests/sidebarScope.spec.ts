import { expect, test, type Page } from '@playwright/test';

// "Switching between single file and all files in right sidebar moves some
// elements down, undesired." The line under the name held a note's words and
// characters and had nothing to say about a space, so it collapsed when the
// scope changed and took the search field, the scope switch and the results
// down with it — while the note count the space does have appeared lower, in
// the summary line, pushing them back the other way.
const FILES: Record<string, string> = {
  'Notes/first.md': '# First\n\nsome words in the first note\n',
  'Notes/second.md': '# Second\n\nand some more here\n',
  'Notes/third.md': '# Third\n\nthe third one\n',
};

async function boot(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files }) => {
    const index = { files: {} as Record<string, number>, folders: ['Notes'] };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/first.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, { files: FILES });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await page.evaluate(() => document.querySelector('#boot-snapshot')?.remove());
  await page.keyboard.press('Control+Shift+f');
  await expect(page.locator('#app #right-panel')).toBeVisible();
  await page.waitForTimeout(250);
}

/** Where each part of the panel sits, and what the count line says. */
const shape = (page: Page) => page.locator('#app #right-panel').evaluate((root) => {
  const y = (sel: string): number | null => {
    const el = root.querySelector<HTMLElement>(sel);
    return el ? Math.round(el.getBoundingClientRect().top) : null;
  };
  return {
    title: y('.drawer-view-name'),
    name: y('.drawer-note-name'),
    count: y('.drawer-note-count'),
    field: y('.search-input-container'),
    scope: y('.search-scope'),
    results: y('.search-results'),
    countText: root.querySelector('.drawer-note-count')?.textContent ?? '',
  };
});

async function setScope(page: Page, scope: 'note' | 'all'): Promise<void> {
  const panel = page.locator('#app #right-panel');
  await panel.locator(`[data-scope="${scope}"]`).click();
  await expect(panel.locator(`[data-scope="${scope}"][aria-checked="true"]`)).toBeVisible();
  await page.waitForTimeout(400);
}

test('the panel keeps its shape when the scope changes', async ({ page }) => {
  await boot(page);
  await setScope(page, 'note');
  const note = await shape(page);
  await setScope(page, 'all');
  const all = await shape(page);
  await setScope(page, 'note');
  const back = await shape(page);

  for (const part of ['title', 'name', 'count', 'field', 'scope', 'results'] as const) {
    expect(note[part], `${part} is somewhere`).not.toBeNull();
    expect(all[part], `${part} must not move when the scope changes`).toBe(note[part]);
    expect(back[part], `${part} must not move on the way back either`).toBe(note[part]);
  }
});

test('the line under the name measures whatever the panel is showing', async ({ page }) => {
  await boot(page);
  await setScope(page, 'note');
  expect((await shape(page)).countText).toMatch(/^\d+ words?, \d+ characters?$/);
  await setScope(page, 'all');
  expect((await shape(page)).countText).toBe('3 notes');
  // The summary line is left to say what a search found, and says nothing
  // until there is a search.
  await expect(page.locator('#app #right-panel .search-summary')).toHaveText('');
  await page.locator('#app #right-panel .vault-search').fill('words');
  await expect(page.locator('#app #right-panel .search-summary')).toHaveText(/result/);
});
