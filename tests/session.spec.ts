import { expect, test, type Page } from '@playwright/test';
import type { EditorView } from '@codemirror/view';

declare global { interface Window { appView: EditorView; releaseTestFonts?: () => void } }
const longNote = Array.from({ length: 180 }, (_, i) => `Paragraph ${i + 1}: A reading position must survive changing tabs, closing this tab, and restarting the editor.`).join('\n\n');

async function boot(page: Page, long = false, mode: 'edit' | 'preview' = 'edit') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ text, mode }) => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/B.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', text);
    localStorage.setItem('satr:fs:file:Notes/B.md', 'Beta');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }], active: 0 }));
    localStorage.setItem('satr:view:Notes/A.md', JSON.stringify({ mode, line: 0 }));
  }, { text: long ? longNote : 'Alpha', mode });
  await page.goto('/');
  await attach(page);
}
async function attach(page: Page) {
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await page.evaluate(async () => {
    const path = '/node_modules/@codemirror/view/dist/index.js';
    const { EditorView } = await import(path);
    window.appView = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  });
}
async function switchTo(page: Page, name: string) {
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await page.locator('.mobile-tab-title').getByText(name, { exact: true }).click();
  await expect(page.locator('#app .cm-file-name')).toHaveText(name);
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
}
async function text(page: Page) { return page.evaluate(() => window.appView.state.doc.toString()); }
async function append(page: Page, value: string) {
  await page.evaluate(() => window.appView.focus());
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(value);
}
async function undo(page: Page) {
  await page.evaluate(() => window.appView.focus());
  await page.keyboard.press('Control+z');
}
async function redo(page: Page) {
  await page.evaluate(() => window.appView.focus());
  await page.keyboard.press('Control+Shift+z');
}
async function closeA(page: Page) {
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await page.locator('.mobile-tab').filter({ has: page.locator('.mobile-tab-title', { hasText: /^A$/ }) }).getByRole('button', { name: 'Close tab' }).click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
}
async function reopen(page: Page) {
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await page.locator('.mobile-tab-switcher-menu-button').click();
  await page.getByRole('menuitem', { name: 'Reopen closed tab', exact: true }).click();
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
}
async function position(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/scrollSync.ts'; const { editorScroll, previewScroll } = await import(path);
    return document.body.dataset.mode === 'preview'
      ? previewScroll(document.querySelector('.preview-pane')!, document.querySelector('#preview')!)
      : editorScroll(window.appView);
  });
}
async function scrollTo(page: Page, line: number) {
  await page.evaluate(async (line) => {
    const path = '/src/scrollSync.ts'; const { applyEditorScroll, applyPreviewScroll } = await import(path);
    const pane = document.body.dataset.mode === 'preview' ? document.querySelector<HTMLElement>('.preview-pane')! : window.appView.scrollDOM;
    pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); // genuine reader intent releases the restore hold
    if (document.body.dataset.mode === 'preview') applyPreviewScroll(pane, document.querySelector('#preview')!, line);
    else applyEditorScroll(window.appView, line);
    for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, line);
  await expect.poll(async () => Math.abs(await position(page) - line)).toBeLessThan(0.1);
}

test('independent undo/redo histories survive tab switches and focus changes', async ({ page }) => {
  await boot(page);
  await append(page, '-one');
  await switchTo(page, 'B');
  await append(page, '-two');
  await switchTo(page, 'A');
  expect(await text(page)).toBe('Alpha-one');
  await undo(page);
  expect(await text(page)).toBe('Alpha');
  await switchTo(page, 'B');
  expect(await text(page)).toBe('Beta-two');
  await undo(page);
  expect(await text(page)).toBe('Beta');
  await switchTo(page, 'A');
  await redo(page);
  expect(await text(page)).toBe('Alpha-one');
  await page.locator('#nav-menu').click();
  await page.keyboard.press('Escape');
  await undo(page);
  expect(await text(page)).toBe('Alpha');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('satr:tabs')!));
  expect(saved.tabs).toEqual([{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }]);
});

test('closing a tab or restarting ends history, not saved file content', async ({ page }) => {
  await boot(page);
  await append(page, '-saved');
  await closeA(page);
  await reopen(page);
  expect(await text(page)).toBe('Alpha-saved');
  await undo(page);
  expect(await text(page)).toBe('Alpha-saved');
  await append(page, '-restart');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('satr:fs:file:Notes/A.md'))).toBe('Alpha-saved-restart');
  await page.reload(); await attach(page);
  await undo(page);
  expect(await text(page)).toBe('Alpha-saved-restart');
});

for (const mode of ['edit', 'preview'] as const) {
  test(`${mode}: last reading position survives switch, tab closure and app restart`, async ({ page }) => {
    await boot(page, true, mode);
    await scrollTo(page, 72.35);
    const before = await position(page);
    // Switch before the 400ms debounce; leaving must flush the position.
    await switchTo(page, 'B');
    await switchTo(page, 'A');
    await expect.poll(async () => Math.abs(await position(page) - before)).toBeLessThan(0.3);
    await closeA(page); await reopen(page);
    await expect.poll(async () => Math.abs(await position(page) - before)).toBeLessThan(0.3);
    await scrollTo(page, 120.6);
    const latest = await position(page);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload(); await attach(page);
    await expect(page.locator('body')).toHaveAttribute('data-mode', mode);
    await expect.poll(async () => Math.abs(await position(page) - latest)).toBeLessThan(0.3);
  });
}

test('late restore callbacks cannot move the next tab or override reader intent', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await boot(page, true);
  await scrollTo(page, 95.4); await switchTo(page, 'B');
  await page.evaluate(() => {
    const pending = new Promise<void>((resolve) => { window.releaseTestFonts = resolve; });
    Object.defineProperty(document.fonts, 'ready', { configurable: true, get: () => pending });
  });
  await switchTo(page, 'A'); // its second restore is now deliberately delayed
  await switchTo(page, 'B');
  await page.evaluate(() => window.releaseTestFonts!());
  await expect.poll(() => position(page)).toBe(0);
  expect(await text(page)).toBe('Beta');
  await page.evaluate(() => {
    const pending = new Promise<void>((resolve) => { window.releaseTestFonts = resolve; });
    Object.defineProperty(document.fonts, 'ready', { configurable: true, get: () => pending });
  });
  await switchTo(page, 'A');
  await scrollTo(page, 150.2);
  await page.evaluate(() => window.releaseTestFonts!());
  await expect.poll(async () => Math.abs(await position(page) - 150.2)).toBeLessThan(0.3);
  expect(errors).toEqual([]);
});


test('URI bookmarks use source identity, not grant ids or duplicate file names', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/viewMemory.ts';
    const { writeViewMemory, readViewMemory, viewMemoryKey } = await import(path);
    const first = { path: 'satr-open://first-grant/Note.md', sourceId: 'stable-source-one' };
    const reopened = { path: 'satr-open://new-grant/Note.md', sourceId: 'stable-source-one' };
    const other = { path: 'satr-open://other-grant/Note.md', sourceId: 'stable-source-two' };
    writeViewMemory(first, { mode: 'preview', line: 88.75, cursor: [7, 7] });
    const temporary = { path: 'satr-open://shared/Text', temporary: true };
    writeViewMemory(temporary, { mode: 'edit', line: 12 });
    localStorage.setItem(viewMemoryKey({ path: 'broken.md' }), '{');
    localStorage.setItem(viewMemoryKey({ path: 'invalid.md' }), JSON.stringify({ mode: 'edit', line: -5, cursor: [-1, 3], folds: [-1, 2, 'bad'] }));
    return {
      sameKey: viewMemoryKey(first) === viewMemoryKey(reopened),
      reopened: readViewMemory(reopened), other: readViewMemory(other),
      temporary: readViewMemory(temporary), persistedTemporary: localStorage.getItem(viewMemoryKey(temporary)),
      broken: readViewMemory({ path: 'broken.md' }), invalid: readViewMemory({ path: 'invalid.md' }),
    };
  });
  expect(result.sameKey).toBe(true);
  expect(result.reopened).toMatchObject({ mode: 'preview', line: 88.75, cursor: [7, 7] });
  expect(result.other).toBeNull();
  expect(result.temporary).toEqual({ mode: 'edit', line: 12 });
  expect(result.persistedTemporary).toBeNull();
  expect(result.broken).toBeNull();
  expect(result.invalid).toMatchObject({ mode: 'edit', line: 0, folds: [2] });
  expect(result.invalid.cursor).toBeUndefined();
  await page.reload();
  expect(await page.evaluate(async () => {
    const path = '/src/viewMemory.ts'; const { readViewMemory } = await import(path);
    return readViewMemory({ path: 'satr-open://third-grant/Note.md', sourceId: 'stable-source-one' })?.line;
  })).toBe(88.75);
});


test('external reloads preserve earlier undo, but closing an inactive tab discards it', async ({ page }) => {
  await boot(page);
  await append(page, '-local');
  await switchTo(page, 'B');
  await page.evaluate(async () => {
    const path = '/src/vault.ts'; const { backend } = await import(path);
    await backend.write('Notes/A.md', 'Alpha-external');
  });
  await switchTo(page, 'A');
  expect(await text(page)).toBe('Alpha-external');
  await undo(page); expect(await text(page)).toBe('Alpha-local');
  await undo(page); expect(await text(page)).toBe('Alpha');
  await switchTo(page, 'B');
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await page.locator('.mobile-tab').filter({ has: page.locator('.mobile-tab-title', { hasText: /^A$/ }) }).getByRole('button', { name: 'Close tab' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
  await reopen(page);
  await redo(page);
  expect(await text(page)).toBe('Alpha');
});
