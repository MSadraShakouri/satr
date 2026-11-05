import { expect, test, type Page } from '@playwright/test';

// The outline is not drawn behind a shut drawer.
//
// Building the panel means walking a note's headings into a tree of rows and
// counting its words, and it ran on every tab switch, every save and every
// settings change whether or not anybody could see it. On a 120kB note that
// was 45-90ms of each switch (the `rest` stage of `note on screen`) spent
// drawing a thing behind a closed door. What must stay true: the panel can
// never show the wrong note. So this pins both halves -- the work is skipped
// while shut, and opening the drawer always arrives at this note.

const noteA = '# Alpha\n\n## Alpha one\n\ntext\n\n## Alpha two\n\ntext\n';
const noteB = '# Beta\n\n## Beta one\n\ntext\n\n## Beta two\n\ntext\n';

async function boot(page: Page): Promise<void> {
  await page.addInitScript(([a, b]) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/a.md': 1, 'Notes/b.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/a.md', a as string);
    localStorage.setItem('satr:fs:file:Notes/b.md', b as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/a.md' }, { path: 'Notes/b.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:demoShown', '1');
  }, [noteA, noteB]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.waitForTimeout(400);
}

const panel = (page: Page) => page.locator('#app #right-panel');
const rows = (page: Page) => panel(page).locator('.search-results .tree-item-self');

async function openOutline(page: Page): Promise<void> {
  await page.locator('#nav-more, #nav-tabs').first().waitFor();
  await page.evaluate(() => document.body.classList.contains('outline-open'));
  await page.keyboard.press('Control+Shift+f');
  await expect(page.locator('body')).toHaveClass(/outline-open/);
  await page.locator('#app #right-panel [data-scope="note"]').click();
  await page.waitForTimeout(200);
}

async function switchTab(page: Page, to: number): Promise<void> {
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await page.locator('.mobile-tab-card, .mobile-tab-title').nth(to).click();
  await page.waitForTimeout(600);
}

test('a switch behind a shut drawer does not rebuild the outline', async ({ page }) => {
  await boot(page);
  // Open it once so it holds this note's rows, then shut it: without that
  // the panel is empty anyway and the test would prove nothing.
  await openOutline(page);
  await expect(rows(page).filter({ hasText: 'Alpha one' })).toHaveCount(1);
  await page.locator('.backdrop').evaluate((el: HTMLElement) => el.click());
  await expect(page.locator('body')).not.toHaveClass(/outline-open/);
  await page.waitForTimeout(350); // the drawer finishes sliding

  await switchTab(page, 1);
  // textContent, not innerText: a hidden element's innerText is empty, which
  // would pass this test whether or not the rows had been built.
  const text = await panel(page).evaluate((el) => el.textContent ?? '');
  expect(text, 'the shut panel was left alone').toContain('Alpha one');
  expect(text, 'nothing was drawn for the new note').not.toContain('Beta one');
});

test('opening the drawer always arrives at the note on screen', async ({ page }) => {
  await boot(page);
  await switchTab(page, 1);
  await openOutline(page);
  await expect(rows(page).filter({ hasText: 'Beta one' })).toHaveCount(1);
  await expect(panel(page).locator('.drawer-note-name')).toHaveText('b');
  // And back again, with the drawer this time open the whole way.
  await switchTab(page, 0);
  await expect(rows(page).filter({ hasText: 'Alpha one' })).toHaveCount(1);
  await expect(panel(page).locator('.drawer-note-name')).toHaveText('a');
});
