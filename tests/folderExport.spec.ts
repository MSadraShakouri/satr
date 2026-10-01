import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** A real note, the same fixture the print tests use. */
const homework = await readFile(new URL('./fixtures/homework-12-2.md', import.meta.url), 'utf8');

// Folder export: the settings gear in the left drawer, held, opens a page for
// the folder the drawer is showing. The page carries the folder's files in
// the folder's own order — which it remembers, per folder, along with what is
// ticked and the collection's settings — and hands them to the ordinary
// export, one file to a page.
const FILES: Record<string, string> = {
  'Notes/Uni/Accounting/term 2.md': '# Term 2\n\nbeta\n',
  'Notes/Uni/Accounting/term 1.md': '# Term 1\n\nalpha\n',
  'Notes/Uni/Accounting/lab.md': '# Lab\n\ngamma\n',
  'Notes/Uni/Accounting/Deep/extra.md': '# Extra\n\ndelta\n',
  'Notes/Math/algebra.md': '# Algebra\n\nnot in this folder\n',
};

async function boot(page: Page, options: { walker?: string } = {}): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files, walker }) => {
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
    if (walker !== undefined) {
      localStorage.setItem('satr:scope', 'all');
      localStorage.setItem('satr:walk-dir', walker);
    }
  }, { files: FILES, walker: options.walker });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

/** Open the drawer and press the gear for half a second, as a finger does. */
async function holdSettings(page: Page, ms = 560): Promise<void> {
  await page.locator('#files').click();
  const gear = page.locator('#settings-button');
  await expect(gear).toBeVisible();
  await gear.dispatchEvent('pointerdown', { pointerId: 1, clientX: 40, clientY: 400, isPrimary: true, button: 0 });
  await page.waitForTimeout(ms);
  await gear.dispatchEvent('pointerup', { pointerId: 1, clientX: 40, clientY: 400, isPrimary: true, button: 0 });
}

const rows = (page: Page): Promise<string[]> =>
  page.locator('#folder-export-screen .folder-export-row').evaluateAll((els) =>
    els.map((el) => el.querySelector('.folder-export-name')?.textContent ?? ''));

const storedOrder = (page: Page, folder: string): Promise<string[]> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(`satr:folderExport:${key}`) ?? '{}').order ?? [], folder);

test('the gear, held, opens the folder page; a tap still opens Settings', async ({ page }) => {
  await boot(page);
  await page.locator('#files').click();
  const gear = page.locator('#settings-button');
  await gear.click();
  await expect(page.locator('.settings-screen')).toBeVisible(); // a tap: Settings
  await page.keyboard.press('Escape');
  await expect(page.locator('#folder-export-screen')).toBeHidden();

  await holdSettings(page);
  await expect(page.locator('#folder-export-screen')).toBeVisible();
  await expect(page.locator('.folder-export-title')).toHaveText('Notes'); // the space's folder
  await expect(page.locator('#folder-export-screen .folder-export-row')).toHaveCount(5);
  await expect(page.locator('#folder-export-screen .folder-export-summary')).toHaveText('5 of 5 files');
  // Newest last by name, and each row is a file.
  expect(await rows(page)).toEqual(['algebra', 'extra', 'lab', 'term 1', 'term 2']);
  await page.locator('#folder-export-screen .folder-export-close').click();
  await expect(page.locator('#folder-export-screen')).toBeHidden();
});

test('a file is ticked out, remembered, and the order is the writer’s', async ({ page }) => {
  await boot(page);
  await holdSettings(page);

  // Untick lab: out of the export, still in the list, keeping its place.
  await page.locator('#folder-export-screen .folder-export-row', { hasText: 'lab' }).locator('.folder-export-check').click();
  await expect(page.locator('#folder-export-screen .folder-export-summary')).toHaveText('4 of 5 files');
  await expect(page.locator('#folder-export-screen .folder-export-row', { hasText: 'lab' })).toHaveClass(/is-excluded/);

  // Term 2 to the top: its own submenu, the chevron on the right of the row.
  await page.locator('#folder-export-screen .folder-export-row', { hasText: 'term 2' }).locator('.folder-export-menu').click();
  const sheet = page.locator('.menu.mod-bottom-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.menu-title')).toHaveText('term 2');
  // The row is last, so “Move to bottom” has nothing to do and says so.
  await expect(sheet.locator('.menu-item', { hasText: 'Move to bottom' })).toHaveClass(/is-disabled/);
  await sheet.locator('.menu-item', { hasText: 'Move to top' }).click();
  await expect(page.locator('.menu.mod-bottom-sheet')).toHaveCount(0);
  expect(await rows(page)).toEqual(['term 2', 'algebra', 'extra', 'lab', 'term 1']);

  // The first row's own menu now: “Move to top” is the one with nothing to do,
  // and the include toggle lives in the same menu, ticked while the file is in.
  await page.locator('#folder-export-screen .folder-export-row', { hasText: 'term 2' }).locator('.folder-export-menu').click();
  await expect(page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Move to top' })).toHaveClass(/is-disabled/);
  await expect(page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Don’t include' })).toHaveClass(/mod-selected/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu.mod-bottom-sheet')).toHaveCount(0);

  // The folder remembers: closed and reopened, the same list.
  await page.locator('#folder-export-screen .folder-export-close').click();
  await holdSettings(page);
  expect(await rows(page)).toEqual(['term 2', 'algebra', 'extra', 'lab', 'term 1']);
  await expect(page.locator('#folder-export-screen .folder-export-row', { hasText: 'lab' })).toHaveClass(/is-excluded/);
  await expect(page.locator('#folder-export-screen .folder-export-summary')).toHaveText('4 of 5 files');
  expect(await storedOrder(page, 'Notes')).toEqual([
    'Notes/Uni/Accounting/term 2.md', 'Notes/Math/algebra.md', 'Notes/Uni/Accounting/Deep/extra.md',
    'Notes/Uni/Accounting/lab.md', 'Notes/Uni/Accounting/term 1.md',
  ]);
});

test('the drag handle moves a row, and the move is what is remembered', async ({ page }) => {
  await boot(page);
  await holdSettings(page);
  const handle = page.locator('#folder-export-screen .folder-export-row', { hasText: 'extra' }).locator('.folder-export-handle');
  const target = await page.locator('#folder-export-screen .folder-export-row', { hasText: 'term 2' }).boundingBox();
  const from = await handle.boundingBox();
  expect(from).not.toBeNull();
  expect(target).not.toBeNull();
  await handle.dispatchEvent('pointerdown', { pointerId: 2, clientX: from!.x + 10, clientY: from!.y + 10, isPrimary: true, button: 0 });
  await page.locator('#folder-export-screen .folder-export-list').dispatchEvent('pointermove', { pointerId: 2, clientX: from!.x + 10, clientY: target!.y + target!.height - 2 });
  await page.locator('#folder-export-screen .folder-export-list').dispatchEvent('pointerup', { pointerId: 2, clientX: from!.x + 10, clientY: target!.y + target!.height - 2 });
  expect(await rows(page)).toEqual(['algebra', 'lab', 'term 1', 'term 2', 'extra']);
  expect(await storedOrder(page, 'Notes')).toEqual([
    'Notes/Math/algebra.md', 'Notes/Uni/Accounting/lab.md', 'Notes/Uni/Accounting/term 1.md',
    'Notes/Uni/Accounting/term 2.md', 'Notes/Uni/Accounting/Deep/extra.md',
  ]);
});

test('the settings panel: subfolders from the page, and per folder', async ({ page }) => {
  // The walker's folder: subfolders are a real choice here.
  await boot(page, { walker: 'Notes/Uni/Accounting' });
  await holdSettings(page);
  await expect(page.locator('.folder-export-title')).toHaveText('Accounting');
  expect(await rows(page)).toEqual(['extra', 'lab', 'term 1', 'term 2']); // Deep/extra is under it
  await expect(page.locator('#folder-export-screen .folder-export-row', { hasText: 'extra' }).locator('.folder-export-sub')).toHaveText('Deep');
  await page.locator('#folder-export-screen [data-toggle="includeSubfolders"]').click();
  expect(await rows(page)).toEqual(['lab', 'term 1', 'term 2']);
  // The collection's layout is remembered for this folder, not for the other.
  await page.locator('#folder-export-screen [data-setting="columns"]').selectOption('2');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('satr:folderExport:Notes/Uni/Accounting') ?? '{}'));
  expect(stored.includeSubfolders).toBe(false);
  expect(stored.columns).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('satr:folderExport:Notes'))).toBeNull();

  // The picker walks up and takes another folder.
  await page.locator('#folder-export-screen .folder-export-path').click();
  await expect(page.locator('.folder-export-title')).toHaveText('Choose a folder');
  await page.locator('#folder-export-screen .folder-export-row[data-pick="Notes/Uni"]').click();
  await page.locator('#folder-export-screen .folder-export-row.is-choose').click();
  await expect(page.locator('.folder-export-title')).toHaveText('Uni');
  expect(await rows(page)).toEqual(['extra', 'lab', 'term 1', 'term 2']);
});

test('folder export: every file begins on a page of its own', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; };
  });
  await page.goto('/');
  const html = await page.evaluate(async (homework) => {
    const { exportFolder } = await import('/src/exportPdf.ts');
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
  await page.setViewportSize({ width: 390, height: 844 });
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

  await page.evaluate(() => document.querySelector<HTMLElement>('[data-act="hide-keyboard"]')!.click());
  expect(await page.evaluate(() => window.__hidKeyboard)).toBe(1);
  await expect(page.locator('#app .cm-content')).toBeFocused(); // the caret stays

  // The web fallback: no platform to ask, so the editor is let go as before.
  await page.evaluate(() => { window.Capacitor.isNativePlatform = () => false; });
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-act="hide-keyboard"]')!.click());
  expect(await page.evaluate(() => window.__hidKeyboard)).toBe(1);
  await expect(page.locator('#app .cm-content')).not.toBeFocused();
});
