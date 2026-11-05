import { test, expect, type Page } from '@playwright/test';

// The new-tab page's "recent" list is the notes the reader chose to open.
// It used to be written by showFile(), which also runs for every tab the
// machinery lands on by itself: closing a tab recorded whatever was beside
// it, switching tabs recorded the next one, a folder opened as a block
// recorded its first note, and starting the app recorded where you left off.

test.use({ viewport: { width: 390, height: 700 } });

const FILES = ['Notes/one.md', 'Notes/two.md', 'Notes/three.md', 'Notes/Sub/a.md', 'Notes/Sub/b.md'];

async function boot(page: Page, open: string[], active = 0): Promise<void> {
  await page.addInitScript(([list, tabs, at]) => {
    const files: Record<string, number> = {};
    for (const p of list as string[]) { files[p] = 1; localStorage.setItem(`satr:fs:file:${p}`, `# ${p}\n\nbody\n`); }
    localStorage.setItem('satr:fs:index', JSON.stringify({ files, folders: ['Notes', 'Notes/Sub'] }));
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: (tabs as string[]).map((p) => ({ path: p })), active: at as number }));
    localStorage.setItem('satr:expanded:notes', JSON.stringify(['Notes', 'Notes/Sub']));
  }, [FILES, open, active] as [string[], string[], number]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.waitForTimeout(250);
}

const recent = (page: Page): Promise<string[]> => page.evaluate(() => JSON.parse(localStorage.getItem('satr:recent') ?? '[]'));
const clear = (page: Page): Promise<void> => page.evaluate(() => { localStorage.setItem('satr:recent', '[]'); });

async function longPressRow(page: Page, path: string): Promise<void> {
  if (!(await page.locator('body').evaluate((body) => body.classList.contains('files-open')))) {
    await page.locator('#files').click();
    await expect(page.locator('body')).toHaveClass(/files-open/);
  }
  await page.evaluate((target) => {
    const row = document.querySelector<HTMLElement>(`#file-panel .tree-item-self[data-path="${target}"]`)!;
    const box = row.getBoundingClientRect();
    const touch = new Touch({ identifier: 9, target: row, clientX: box.left + 24, clientY: box.top + 12 });
    row.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true }));
  }, path);
  await expect(page.locator('.menu.mod-bottom-sheet')).toBeVisible();
}

test('closing a tab does not make a recent of the one beside it', async ({ page }) => {
  await boot(page, ['Notes/one.md', 'Notes/two.md', 'Notes/three.md'], 0);
  await clear(page);
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(1);
  await page.locator('.close-button[data-close="0"]').click();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => document.querySelector('.cm-file-name')?.textContent)).toContain('two');
  expect(await recent(page), 'two.md was never opened by anyone').toEqual([]);
});

test('switching tabs does not make a recent either', async ({ page }) => {
  await boot(page, ['Notes/one.md', 'Notes/two.md'], 0);
  await clear(page);
  await page.locator('#nav-forward').click();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => document.querySelector('.cm-file-name')?.textContent)).toContain('two');
  expect(await recent(page)).toEqual([]);
});

test('a folder opened as a block does not make recents of its notes', async ({ page }) => {
  await boot(page, ['Notes/one.md']);
  await clear(page);
  await longPressRow(page, 'Notes/Sub');
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Replace tabs with this folder' }).click();
  await page.waitForTimeout(800);
  expect(await recent(page)).toEqual([]);
});

test('opening a note from the file tree does make a recent', async ({ page }) => {
  await boot(page, ['Notes/one.md']);
  await clear(page);
  await page.locator('#files').click();
  await page.locator('#file-panel .tree-item-self[data-path="Notes/three.md"]').click();
  await page.waitForTimeout(700);
  expect(await recent(page)).toEqual(['Notes/three.md']);
});

test('a note just made is a recent', async ({ page }) => {
  await boot(page, ['Notes/one.md']);
  await clear(page);
  await longPressRow(page, 'Notes/Sub');
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'New note' }).first().click();
  await page.waitForTimeout(800);
  const list = await recent(page);
  expect(list.length, 'the new note is the recent one').toBe(1);
  expect(list[0]).toContain('Notes/Sub/');
});

test('starting the app again does not rewrite the list', async ({ page }) => {
  await boot(page, ['Notes/one.md']);
  await page.evaluate(() => { localStorage.setItem('satr:recent', JSON.stringify(['Notes/three.md', 'Notes/two.md'])); });
  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.waitForTimeout(500);
  expect(await recent(page), 'the open tab did not jump to the top of it').toEqual(['Notes/three.md', 'Notes/two.md']);
});

test('reopening a file that is already open moves it up the list', async ({ page }) => {
  // His: "if I reopen an already open file the recent part of it doesn't get
  // updated in the empty tabs part". openFile returns early when the file is
  // the open one, or is open in another tab, and the list was written past
  // both of those returns -- so the file he reaches for most often sank
  // down the list while the ones he opened once stayed at the top.
  await boot(page, ['Notes/one.md', 'Notes/two.md'], 0);
  await clear(page);
  await page.evaluate(() => { localStorage.setItem('satr:recent', JSON.stringify(['Notes/three.md', 'Notes/one.md'])); });

  // one.md is open in a tab, and is not the tab on screen. Asked for by
  // name from the file tree.
  await page.locator('#files').click();
  await expect(page.locator('body')).toHaveClass(/files-open/);
  await page.locator('#file-panel .tree-item-self[data-path="Notes/two.md"]').click();
  await expect.poll(async () => (await recent(page))[0], { timeout: 5000 }).toBe('Notes/two.md');

  await page.locator('#files').click();
  await page.locator('#file-panel .tree-item-self[data-path="Notes/one.md"]').click();
  expect(await recent(page), 'the one he went back to is at the top, once').toEqual(['Notes/one.md', 'Notes/two.md', 'Notes/three.md']);

  // And the file already on screen, asked for again, is still an ask.
  await page.locator('#files').click();
  await page.locator('#file-panel .tree-item-self[data-path="Notes/one.md"]').click();
  expect((await recent(page))[0]).toBe('Notes/one.md');
  expect((await recent(page)).filter((p) => p === 'Notes/one.md'), 'and only once').toHaveLength(1);
});

test('picking a tab out of the switcher is a file you chose', async ({ page }) => {
  // His: "if you open it via another method (already open tab...) it
  // doesn't update the list". Switching tabs by the arrows, or landing on
  // one because another closed, is the machinery moving and stays silent;
  // reaching into the switcher and pressing a card is a file he picked by
  // name, exactly like a row in the tree.
  await boot(page, ['Notes/one.md', 'Notes/two.md', 'Notes/three.md'], 0);
  await clear(page);
  await page.locator('#nav-tabs').dispatchEvent('click');
  await expect(page.locator('.mobile-tab-switcher')).toBeVisible();
  await page.locator('.mobile-tab-title').getByText('three', { exact: false }).first().click();
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
  expect((await recent(page))[0], 'the tab he reached for').toBe('Notes/three.md');

  // The arrows are still the machinery, and still say nothing.
  await clear(page);
  await page.locator('#nav-back').click();
  await page.waitForTimeout(250);
  expect(await recent(page), 'stepping through tabs records nothing').toEqual([]);
});
