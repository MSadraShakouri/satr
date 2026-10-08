import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** A real note, the same fixture the print tests use. */
const homework = await readFile(new URL('./fixtures/homework-12-2.md', import.meta.url), 'utf8');

// Folder export: the entrances are the file tree's own long-press menus — a
// folder row exports the folder, a text file row exports that one file, and a
// row that is neither (a .json, a picture) has no export entry at all. The
// page carries the folder's files in the folder's own order, which it
// remembers per folder, along with what is ticked and the collection's
// settings, and hands them to the ordinary export, one file to a page.
const FILES: Record<string, string> = {
  'Notes/Uni/Accounting/term 2.md': '# Term 2\n\nbeta\n',
  'Notes/Uni/Accounting/term 1.md': '# Term 1\n\nalpha\n',
  'Notes/Uni/Accounting/lab.md': '# Lab\n\ngamma\n',
  'Notes/Uni/Accounting/deep/extra.md': '# Extra\n\ndelta\n',
  'Notes/Uni/Accounting/data.json': '{"course":"accounting"}\n',
  'Notes/Math/algebra.md': '# Algebra\n\nnot in this folder\n',
};

async function boot(page: Page, options: { print?: boolean } = {}): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files, print }) => {
    if (print) window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; };
    const folders = [...new Set(Object.keys(files).flatMap((path) => {
      const parts = path.split('/');
      parts.pop();
      return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    }))];
    const index = { files: {} as Record<string, number>, folders };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/Math/algebra.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    // The tree is drawn from the remembered expansion, so the rows the tests
    // press are in it.
    localStorage.setItem('satr:expanded:notes', JSON.stringify(['Notes/Uni', 'Notes/Uni/Accounting']));
  }, { files: FILES, print: options.print ?? false });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

/** Open the drawer if it is closed. */
async function openDrawer(page: Page): Promise<void> {
  if (!(await page.locator('body').evaluate((body) => body.classList.contains('files-open')))) {
    await page.locator('#files').click();
    await expect(page.locator('body')).toHaveClass(/files-open/);
  }
}

/** A row's menu by right-click — the same contextmenu handler the finger's
 *  500ms hold ends up in. */
async function rowMenu(page: Page, path: string): Promise<void> {
  await openDrawer(page);
  await page.locator(`#file-panel .tree-item-self[data-path="${path}"]`).click({ button: 'right' });
  await expect(page.locator('.menu.mod-bottom-sheet')).toBeVisible();
}

/** A real long press: touchstart, hold past the 500ms, nothing moves. */
async function longPressRow(page: Page, path: string): Promise<void> {
  await openDrawer(page);
  await page.evaluate((target) => {
    const row = document.querySelector<HTMLElement>(`#file-panel .tree-item-self[data-path="${target}"]`)!;
    const box = row.getBoundingClientRect();
    const touch = new Touch({ identifier: 7, target: row, clientX: box.left + 24, clientY: box.top + 12 });
    row.dispatchEvent(new TouchEvent('touchstart', {
      touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true,
    }));
  }, path);
  await page.waitForTimeout(620);
  await expect(page.locator('.menu.mod-bottom-sheet')).toBeVisible();
}

/** The sheet's shape: each line its own group, groups split by separators. */
const menuOutline = (page: Page): Promise<string[]> =>
  page.locator('.menu.mod-bottom-sheet .menu-scroll').evaluate((scroll) =>
    [...scroll.children].filter((child) => !child.classList.contains('menu-title')).map((child) => child.classList.contains('menu-group')
      ? [...child.querySelectorAll<HTMLElement>('.menu-item-title')].map((title) => title.textContent ?? '').join(' | ')
      : '---'));

async function openExport(page: Page, folder: string): Promise<void> {
  await rowMenu(page, folder);
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Export folder as PDF' }).click();
  await expect(page.locator('#folder-export-screen')).toBeVisible();
}

const rows = (page: Page): Promise<string[]> =>
  page.locator('#folder-export-screen .folder-export-row').evaluateAll((els) =>
    els.map((el) => el.querySelector('.folder-export-name')?.textContent ?? ''));

const storedOrder = (page: Page, folder: string): Promise<string[]> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(`satr:folderExport:${key}`) ?? '{}').order ?? [], folder);

test('the folder row’s own menu carries the export, on its own line', async ({ page }) => {
  await boot(page);
  await longPressRow(page, 'Notes/Uni/Accounting');
  expect(await menuOutline(page)).toEqual([
    'New note | New folder',
    '---',
    'Rename… | Move to…',
    '---',
    'Use as a space',
    '---',
    'Open all notes in tabs | Replace tabs with this folder',
    '---',
    'Export folder as PDF…',
    '---',
    'Delete',
  ]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu.mod-bottom-sheet')).toHaveCount(0);
});

test('the gear opens Settings; holding it opens nothing', async ({ page }) => {
  await boot(page);
  await openDrawer(page);
  await page.locator('#settings-button').click();
  await expect(page.locator('.settings-screen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.settings-screen')).toBeHidden();

  const gear = page.locator('#settings-button');
  await gear.dispatchEvent('pointerdown', { pointerId: 1, clientX: 40, clientY: 400, isPrimary: true, button: 0 });
  await page.waitForTimeout(600);
  await gear.dispatchEvent('pointerup', { pointerId: 1, clientX: 40, clientY: 400, isPrimary: true, button: 0 });
  await page.waitForTimeout(50);
  // The hold is gone with the old entrance: no page, no sheet, no Settings.
  await expect(page.locator('#folder-export-screen')).toBeHidden();
  await expect(page.locator('.menu.mod-bottom-sheet')).toHaveCount(0);
  await expect(page.locator('.settings-screen')).toBeHidden();
});

test('a folder row’s entry opens the folder: its own files, subfolders off', async ({ page }) => {
  await boot(page);
  await openExport(page, 'Notes/Uni/Accounting');
  await expect(page.locator('.folder-export-title')).toHaveText('Accounting');
  // deep/extra.md is left out: subfolders default to off.
  expect(await rows(page)).toEqual(['lab', 'term 1', 'term 2']);
  await expect(page.locator('#folder-export-screen .folder-export-summary')).toHaveText('3 of 3 files');
  // And the file-name heading defaults to off for a fresh folder.
  await expect(page.locator('#folder-export-screen [data-toggle="includeSubfolders"]')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#folder-export-screen [data-toggle="heading"]')).toHaveAttribute('aria-checked', 'false');
  // Sort A–Z is gone.
  await expect(page.locator('#folder-export-screen [data-act="sort"]')).toHaveCount(0);
  await page.locator('#folder-export-screen .folder-export-close').click();
  await expect(page.locator('#folder-export-screen')).toBeHidden();
});

test('a text file row exports that one file, from disk', async ({ page }) => {
  await boot(page, { print: true });
  await rowMenu(page, 'Notes/Uni/Accounting/term 1.md');
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Export file as PDF' }).click();
  await expect.poll(() => page.evaluate(() => window.__printedHtml ?? ''), { timeout: 20000 }).toContain('alpha');
  const html = await page.evaluate(() => window.__printedHtml ?? '');
  expect(html, 'the file that was pressed, not its folder').not.toContain('beta');
  expect(html).not.toContain('gamma');
  await expect(page.locator('#folder-export-screen')).toBeHidden(); // no page opened
});

test('a file that is not a note gets no export entry', async ({ page }) => {
  await boot(page);
  await rowMenu(page, 'Notes/Uni/Accounting/data.json');
  expect(await menuOutline(page)).toEqual(['Rename… | Move to…', '---', 'Delete']);
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu.mod-bottom-sheet')).toHaveCount(0);
});

test('a file is ticked out, remembered, and the order is the writer’s', async ({ page }) => {
  await boot(page);
  await openExport(page, 'Notes/Uni/Accounting');

  // Untick lab: out of the export, still in the list, keeping its place.
  await page.locator('#folder-export-screen .folder-export-row', { hasText: 'lab' }).locator('.folder-export-check').click();
  await expect(page.locator('#folder-export-screen .folder-export-summary')).toHaveText('2 of 3 files');
  await expect(page.locator('#folder-export-screen .folder-export-row', { hasText: 'lab' })).toHaveClass(/is-excluded/);

  // term 1 to the top: its own submenu, the chevron on the right of the row.
  await page.locator('#folder-export-screen .folder-export-row', { hasText: 'term 1' }).locator('.folder-export-menu').click();
  const sheet = page.locator('.menu.mod-bottom-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.menu-title')).toHaveText('term 1');
  // The row is second of three, so both moves have something to do.
  await expect(sheet.locator('.menu-item', { hasText: 'Move to top' })).not.toHaveClass(/is-disabled/);
  await sheet.locator('.menu-item', { hasText: 'Move to top' }).click();
  await expect(page.locator('.menu.mod-bottom-sheet')).toHaveCount(0);
  expect(await rows(page)).toEqual(['term 1', 'lab', 'term 2']);

  // The first row's own menu: “Move to top” is the one with nothing to do, and
  // the include toggle lives in the same menu, ticked while the file is in.
  await page.locator('#folder-export-screen .folder-export-row', { hasText: 'term 1' }).locator('.folder-export-menu').click();
  await expect(page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Move to top' })).toHaveClass(/is-disabled/);
  await expect(page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Don’t include' })).toHaveClass(/mod-selected/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu.mod-bottom-sheet')).toHaveCount(0);

  // The folder remembers: closed and reopened, the same list.
  await page.locator('#folder-export-screen .folder-export-close').click();
  await openExport(page, 'Notes/Uni/Accounting');
  expect(await rows(page)).toEqual(['term 1', 'lab', 'term 2']);
  await expect(page.locator('#folder-export-screen .folder-export-row', { hasText: 'lab' })).toHaveClass(/is-excluded/);
  await expect(page.locator('#folder-export-screen .folder-export-summary')).toHaveText('2 of 3 files');
  expect(await storedOrder(page, 'Notes/Uni/Accounting')).toEqual([
    'Notes/Uni/Accounting/term 1.md', 'Notes/Uni/Accounting/lab.md', 'Notes/Uni/Accounting/term 2.md',
  ]);
});

test('the drag handle moves a row, and the move is what is remembered', async ({ page }) => {
  await boot(page);
  await openExport(page, 'Notes/Uni/Accounting');
  const handle = page.locator('#folder-export-screen .folder-export-row', { hasText: 'term 2' }).locator('.folder-export-handle');
  const target = await page.locator('#folder-export-screen .folder-export-row', { hasText: 'lab' }).boundingBox();
  const from = await handle.boundingBox();
  expect(from).not.toBeNull();
  expect(target).not.toBeNull();
  await handle.dispatchEvent('pointerdown', { pointerId: 2, clientX: from!.x + 10, clientY: from!.y + 10, isPrimary: true, button: 0 });
  await page.locator('#folder-export-screen .folder-export-list').dispatchEvent('pointermove', { pointerId: 2, clientX: from!.x + 10, clientY: target!.y + 2 });
  await page.locator('#folder-export-screen .folder-export-list').dispatchEvent('pointerup', { pointerId: 2, clientX: from!.x + 10, clientY: target!.y + 2 });
  expect(await rows(page)).toEqual(['term 2', 'lab', 'term 1']);
  expect(await storedOrder(page, 'Notes/Uni/Accounting')).toEqual([
    'Notes/Uni/Accounting/term 2.md', 'Notes/Uni/Accounting/lab.md', 'Notes/Uni/Accounting/term 1.md',
  ]);
});

test('the settings panel: subfolders from the page, and per folder', async ({ page }) => {
  await boot(page);
  await openExport(page, 'Notes/Uni/Accounting');
  expect(await rows(page)).toEqual(['lab', 'term 1', 'term 2']); // deep/ is off by default
  // Subfolders on: deep/extra.md arrives, with its folder named under it.
  await page.locator('#folder-export-screen [data-toggle="includeSubfolders"]').click();
  expect(await rows(page)).toEqual(['extra', 'lab', 'term 1', 'term 2']);
  await expect(page.locator('#folder-export-screen .folder-export-row', { hasText: 'extra' }).locator('.folder-export-sub')).toHaveText('deep');
  // The collection's layout is remembered for this folder, not for the other.
  await page.locator('#folder-export-screen [data-setting="columns"]').selectOption('2');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('satr:folderExport:Notes/Uni/Accounting') ?? '{}'));
  expect(stored.includeSubfolders).toBe(true);
  expect(stored.columns).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('satr:folderExport:Notes'))).toBeNull();

  // The picker walks up and takes another folder: Uni holds no notes of its
  // own, and says so; with subfolders on, its four.
  await page.locator('#folder-export-screen .folder-export-path').click();
  await expect(page.locator('.folder-export-title')).toHaveText('Choose a folder');
  await page.locator('#folder-export-screen .folder-export-row[data-pick="Notes/Uni"]').click();
  await page.locator('#folder-export-screen .folder-export-row.is-choose').click();
  await expect(page.locator('.folder-export-title')).toHaveText('Uni');
  await expect(page.locator('#folder-export-screen .folder-export-summary')).toHaveText('No notes in this folder');
  await page.locator('#folder-export-screen [data-toggle="includeSubfolders"]').click();
  expect(await rows(page)).toEqual(['extra', 'lab', 'term 1', 'term 2']);
});

test('folder export: every file begins on a page of its own', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; };
  });
  await page.goto('/');
  const html = await page.evaluate(async (homework) => {
    const { exportFolder } = await window.__satr.load('/src/exportPdf.ts');
    const options = { columns: 1, direction: 'ltr', mathAlign: 'center' } as const;
    // Real notes: several paragraphs each, as a note is written.
    const long = `${homework}\n\n${homework}`;
    await exportFolder('Term', [
      { name: 'One', markdown: long, path: '', options },
      { name: 'Two', markdown: '# Two\n\nsecond file here', path: '', options },
      { name: 'Three', markdown: '# Three\n\nthird file here', path: '', options },
    ], { columns: 1, heading: true, pageNumbers: 'none' });
    return window.__printedHtml;
  }, homework);
  expect(html, 'the browser path must print the export frame').toBeTruthy();
  await page.setContent(html!.replace(/<script[\s\S]*?<\/script>/gi, ''));
  await page.evaluate(() => document.fonts.ready);
  const pages = await page.locator('.pagedjs_page_content').evaluateAll((cols) =>
    cols.map((col) => (col.textContent ?? '').replace(/\s+/g, ' ').trim()));
  // Three files, and the first one is long enough to fill a page: the heading
  // of a file opens the page it begins on, and no page carries two files.
  expect(pages.length).toBeGreaterThanOrEqual(4);
  expect(pages[0]).toContain('One');
  const two = pages.findIndex((text) => text.includes('Two'));
  const three = pages.findIndex((text) => text.includes('Three'));
  expect(two).toBeGreaterThan(0);
  expect(three).toBeGreaterThan(two);
  expect(pages[two]!.startsWith('Two'), 'the file’s own heading opens its page').toBe(true);
  expect(pages[three]!.startsWith('Three')).toBe(true);
  expect(pages[two]!).not.toContain('alpha beta gamma');
  expect(pages[three]!).not.toContain('second file here');
  expect(pages[two - 1]).not.toContain('second file here');
});

declare global {
  interface Window { __printedHtml?: string; __hidKeyboard?: number }
}

// The bottom bar's down chevron: the keyboard goes away, the caret does not.
// The app asks the platform (SatrSystemBars.hideKeyboard → Android's
// InputMethodManager), which hides the keyboard over the focused note; only a
// browser, which has no keyboard for the page to put away, lets the editor go.
test('the down chevron hides the keyboard without dropping the caret', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.__hidKeyboard = 0;
    window.Capacitor = {
      PluginHeaders: [{ name: 'SatrSystemBars', methods: [
        { name: 'get', rtype: 'promise' }, { name: 'hideKeyboard', rtype: 'promise' },
        { name: 'setStyle', rtype: 'promise' }, { name: 'hide', rtype: 'promise' }, { name: 'show', rtype: 'promise' },
        { name: 'addListener', rtype: 'promise' },
      ] }],
      nativePromise: (plugin: string, method: string) => {
        if (plugin === 'SatrSystemBars' && method === 'hideKeyboard') { window.__hidKeyboard += 1; return Promise.resolve(); }
        if (plugin === 'SatrSystemBars') return Promise.resolve({ top: 0, right: 0, bottom: 0, left: 0, fontScale: 1 });
        return Promise.resolve();
      },
    };
  });
  await page.addInitScript(({ files }) => {
    const folders = ['Notes'];
    const index = { files: {} as Record<string, number>, folders };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/one.md' }], active: 0 }));
  }, { files: { 'Notes/one.md': 'hello\n\nworld\n' } });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await page.evaluate(() => { window.Capacitor.isNativePlatform = () => true; });

  await page.locator('#app .cm-content').click();
  await expect(page.locator('#app .cm-content')).toBeFocused();
  const caret = await page.evaluate(() => (document.querySelector('#app .cm-content') as HTMLElement).contains(document.getSelection()?.anchorNode ?? null));
  expect(caret, 'the caret is in the note').toBe(true);

  // The down chevron lets the note go, as in the older versions: the caret goes with it.
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-act="hide-keyboard"]')!.click());
  await expect(page.locator('#app .cm-content')).not.toBeFocused();
});
