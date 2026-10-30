import { expect, test, type Page } from '@playwright/test';
import { vaultText } from './support/vaultText';

// A picture is not text.
//
// Opening a picture — from the folder tree, or handed over by another app —
// used to read its bytes as text and put them in the editor: on the web the
// file's own data: URL (the whole picture, base64 and all) as an editable note;
// on the phone one replacement character per byte, a megabyte of them per
// megabyte of photo, read twice and decoded before anything appeared. That is
// the slowness, and on the phone it was the whole app: nothing else could be
// done while that string sat in CodeMirror.
//
// A picture tab now holds no text at all. The reading view shows the picture,
// the tab is read-only, and the file is never written over — the editor is
// empty, so a save would have written nothing over a photo.
//
// (The road from another app is native-only: `supportsIncomingFiles()` is false
// in a browser, so what the incoming screen does with a picture is checked on
// the device. Its decision — never read a picture as text — is the same one
// these tests pin for the road that exists on the web.)

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const NOTE = 'Notes/A.md';
const PIC = 'Notes/pic.png';
const BODY = 'first line\n\nsecond line\n';

async function boot(page: Page, tabs: { path: string }[] = [{ path: NOTE }], active = 0): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ png, body, tabs, active }) => {
    if (localStorage.getItem('satr:fs:index')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/pic.png': 2 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', body);
    localStorage.setItem('satr:fs:file:Notes/pic.png', png);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs, active }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, { png: PNG, body: BODY, tabs, active });
  await page.goto('/');
  // A plain file keeps its whole name as the title (only notes drop .md).
  await expect(page.locator('#app .cm-file-name')).toHaveText(/^(A|pic\.png)$/);
}

/** Every call the app's own backend makes (the same object it runs on). */
async function spyBackend(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { backend } = await (window as unknown as { __satr: { load(p: string): Promise<Record<string, never>> } })
      .__satr.load('/src/vault.ts') as unknown as { backend: Record<string, (...args: unknown[]) => Promise<unknown>> };
    const w = window as unknown as { __calls: string[] };
    w.__calls = [];
    for (const key of ['list', 'read', 'readText', 'write', 'mkdir', 'rename', 'remove', 'stat', 'readDataUrl']) {
      const original = backend[key].bind(backend);
      backend[key] = async (...args: unknown[]) => {
        w.__calls.push(`${key}:${String(args[0])}`);
        return original(...args);
      };
    }
  });
}
const calls = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);

/** What the editor is actually holding, and how the tab is dressed. */
async function viewState(page: Page) {
  return page.evaluate(async () => {
    const { EditorView } = await (window as unknown as { __satr: { load(p: string): Promise<Record<string, never>> } })
      .__satr.load('/node_modules/@codemirror/view/dist/index.js') as unknown as {
        EditorView: { findFromDOM(el: HTMLElement): { state: { doc: { length: number }; readOnly: boolean }; contentDOM: HTMLElement } };
      };
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    return {
      length: view.state.doc.length,
      readOnly: view.state.readOnly,
      editable: view.contentDOM.contentEditable,
      mode: document.body.dataset.mode,
    };
  });
}

/** Pick a file in the folder tree (opening the drawer first, as a finger does).
 *  The row is waited for: the drawer settles over a fifth of a second, and the
 *  tree is drawn again once it is open. */
async function openFromTree(page: Page, path: string): Promise<void> {
  if (!(await page.locator('body').evaluate((body) => body.classList.contains('files-open')))) {
    await page.locator('#files').click();
    await expect(page.locator('body')).toHaveClass(/files-open/);
  }
  const row = page.locator(`#file-panel .tree-item-self[data-path="${path}"]`);
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('body')).not.toHaveClass(/files-open/);
}

const stored = (page: Page, path: string): Promise<string | null> => vaultText(page, path);

test('a picture opens as the picture: the editor holds none of it, the reading view shows it', async ({ page }) => {
  await boot(page);
  await spyBackend(page);
  await openFromTree(page, PIC);
  await expect(page.locator('#app .cm-file-name')).toHaveText('pic.png');
  await expect(page.locator('#app #preview .md-image-preview img')).toHaveAttribute('src', PNG);
  const state = await viewState(page);
  expect(state.length, 'the picture was put in the editor as text').toBe(0);
  expect(state.mode, 'a picture opens in the reading view').toBe('preview');
  expect(state.readOnly, 'a picture tab is not an editable note').toBe(true);
  expect(state.editable).toBe('false');
  const done = await calls(page);
  expect(done.filter((c) => c.endsWith(PIC) && (c.startsWith('read:') || c.startsWith('readText:'))),
    'the picture was read as text').toEqual([]);
  expect(done, 'the picture was written over').not.toContain(`write:${PIC}`);
  expect(done, 'the picture itself was never read').toContain(`readDataUrl:${PIC}`);
});

test('a picture tab is the picture at launch too', async ({ page }) => {
  await boot(page, [{ path: PIC }, { path: NOTE }], 0);
  await expect(page.locator('#app .cm-file-name')).toHaveText('pic.png');
  await expect(page.locator('#app #preview .md-image-preview img')).toHaveAttribute('src', PNG);
  const state = await viewState(page);
  expect(state.length, 'the last tab opened with the picture in the editor').toBe(0);
  expect(state.mode).toBe('preview');
  expect(state.readOnly).toBe(true);
});

test('leaving the picture and coming back never writes it over', async ({ page }) => {
  await boot(page);
  await openFromTree(page, PIC);
  await expect(page.locator('#app #preview .md-image-preview img')).toHaveAttribute('src', PNG);
  // Nothing can be typed into it, and there is nothing for a save to write.
  await page.evaluate(() => document.querySelector<HTMLElement>('#app .cm-content')!.focus());
  await page.keyboard.type('corrupted');
  expect((await viewState(page)).length).toBe(0);
  // The note is still a note, and still editable.
  await openFromTree(page, NOTE);
  await page.locator('#app .cm-content').click();
  await page.keyboard.type('typed ');
  await expect.poll(() => stored(page, NOTE)).toContain('typed ');
  // Back to the picture: it is the picture again, and the file is untouched.
  await openFromTree(page, PIC);
  await expect(page.locator('#app #preview .md-image-preview img')).toHaveAttribute('src', PNG);
  await page.waitForTimeout(900); // past the autosave's beat
  expect(await stored(page, PIC), 'the picture file was written over').toBe(PNG);
});
