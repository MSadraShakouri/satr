import { expect, test, type Page } from '@playwright/test';

// The title's ✓ (Enter, or a blur): the open note's file moves to the new name.
//
// On the device every `await` in that road is a round trip across the Capacitor
// bridge, and the road used to hold the whole editor read-only while it ran —
// so the note died under the reader's finger for the length of the move, which
// is what "the ✓ is slow" was. These tests make the moves slow on purpose (the
// backend is the same object the app uses — tests/support/expose.ts hands out
// the app's own modules, so wrapping a method here wraps it for the app too)
// and then look at the note while the file is moving.

const NOTE = 'Notes/A.md';

async function boot(page: Page, body = 'first line\n\nsecond line\n') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((body) => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', body);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, body);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
}

/** Watch the app's own backend: every call is written down, and the named ones
 *  are made slow (a bridge round trip on the device, near zero in the browser —
 *  which is why none of this was ever slow on the web). */
async function slowBackend(page: Page, slow: Record<string, number>) {
  await page.evaluate(async (slow) => {
    const { backend } = await (window as unknown as { __satr: { load(p: string): Promise<Record<string, never>> } })
      .__satr.load('/src/vault.ts') as unknown as { backend: Record<string, (...args: unknown[]) => Promise<unknown>> };
    const w = window as unknown as { __calls: string[] };
    w.__calls = [];
    for (const key of ['list', 'read', 'readText', 'write', 'mkdir', 'rename', 'remove', 'stat', 'readDataUrl']) {
      const original = backend[key].bind(backend);
      backend[key] = async (...args: unknown[]) => {
        w.__calls.push(`${key}:${String(args[0])}`);
        if (slow[key]) await new Promise((done) => setTimeout(done, slow[key]));
        return original(...args);
      };
    }
  }, slow);
}

const calls = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);

/** The note as the finger finds it: CodeMirror's own read-only state, and the
 *  contenteditable the browser (and so the keyboard) reads. */
async function editorState(page: Page) {
  return page.evaluate(async () => {
    const { EditorView } = await (window as unknown as { __satr: { load(p: string): Promise<Record<string, never>> } })
      .__satr.load('/node_modules/@codemirror/view/dist/index.js') as unknown as {
        EditorView: { findFromDOM(el: HTMLElement): { state: { readOnly: boolean }; contentDOM: HTMLElement } };
      };
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    return { readOnly: view.state.readOnly, editable: view.contentDOM.contentEditable, focused: view.hasFocus };
  });
}

const fileText = (page: Page, path: string): Promise<string | null> =>
  page.evaluate((path) => localStorage.getItem(`satr:fs:file:${path}`), path);

/** Type a new name into the title and commit it with the ✓ (Enter). */
async function rename(page: Page, name: string) {
  const title = page.locator('#app .cm-file-name');
  await title.click();
  await title.evaluate((el) => { el.focus(); window.getSelection()?.selectAllChildren(el); });
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
}

test('the note stays the reader\'s while its file moves: typing lands, and the ✓ does not take it away', async ({ page }) => {
  await boot(page);
  await slowBackend(page, { rename: 600 });
  await rename(page, 'B');
  // The moment the disk is being asked to move the file — mid-move.
  await expect.poll(() => calls(page)).toContain(`rename:${NOTE}`);
  const mid = await editorState(page);
  expect(mid.readOnly, 'the note was read-only while its file moved').toBe(false);
  expect(mid.editable, 'the note could not take a keystroke while its file moved').toBe('true');
  expect(mid.focused, 'the ✓ did not hand the note the caret').toBe(true);
  // And it really is taking what is typed: at the top, where the ✓ left the caret.
  await page.keyboard.type('typed while the file moved ');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('satr:tabs'))).toContain('Notes/B.md');
  await expect.poll(() => fileText(page, 'Notes/B.md')).toContain('typed while the file moved');
  expect(await fileText(page, NOTE), 'the old name came back to life').toBe(null);
});

test('a note whose file is not on disk is written under its new name, not refused', async ({ page }) => {
  await boot(page);
  // The file is gone (deleted by another app while the note sat open).
  await page.evaluate(async () => {
    const { backend } = await (window as unknown as { __satr: { load(p: string): Promise<Record<string, never>> } })
      .__satr.load('/src/vault.ts') as unknown as { backend: { remove(p: string): Promise<void> } };
    await backend.remove('Notes/A.md');
  });
  await rename(page, 'B');
  await expect.poll(() => fileText(page, 'Notes/B.md')).toBe('first line\n\nsecond line\n');
  expect(await fileText(page, NOTE)).toBe(null);
});

test('the rename asks the disk for what it needs — and nothing else', async ({ page }) => {
  await boot(page);
  await slowBackend(page, {});
  await rename(page, 'B');
  await expect.poll(() => calls(page)).toContain('rename:Notes/A.md');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('satr:tabs'))).toContain('Notes/B.md');
  await page.waitForTimeout(300); // whatever the move started in the background
  const done = await calls(page);
  expect(done.filter((c) => c === 'rename:Notes/A.md'), 'the file moves once').toHaveLength(1);
  // Asking whether the file is there before moving it is a round trip the
  // rename itself answers (it refuses a name that is taken).
  expect(done, 'the move checked the file was there first').not.toContain(`stat:${NOTE}`);
  // The note was not edited, so nothing had to be written — and what the disk
  // holds afterwards is what was written before the move, not something to read
  // back over the bridge.
  expect(done, 'the move read the note back').not.toContain('read:Notes/B.md');
  expect(done.filter((c) => c.startsWith('write:')), 'a clean note was written before moving').toHaveLength(0);
  expect(await fileText(page, NOTE)).toBe(null);
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
});

test('a second ✓ while the file is still moving lands on the same note', async ({ page }) => {
  await boot(page);
  await slowBackend(page, { rename: 600 });
  await rename(page, 'B');
  await expect.poll(() => calls(page)).toContain('rename:Notes/A.md');
  await rename(page, 'C'); // the reader taps ✓ again, thinking nothing happened
  await expect.poll(() => page.evaluate(() => localStorage.getItem('satr:tabs'))).toContain('Notes/C.md');
  await expect.poll(() => calls(page)).toContain('rename:Notes/B.md');
  await page.waitForTimeout(400);
  expect(await fileText(page, 'Notes/B.md'), 'the first name was left behind').toBe(null);
  expect(await fileText(page, 'Notes/C.md')).toBe('first line\n\nsecond line\n');
  await expect(page.locator('#app .cm-file-name')).toHaveText('C');
});
