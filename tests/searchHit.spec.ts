import { expect, test, type Page } from '@playwright/test';

// Choosing a search result. Landing on a hit used to *select* it: on a phone
// that raises the selection bar and puts handles over the line the reader only
// asked to look at. The hit is shown now — the caret lands after it, so typing
// continues where the reader was reading, and the ring (the find bar's own
// match highlight) says where it is, for a few seconds or until the reader
// types, taps or selects anything.
const FILES: Record<string, string> = {
  'Notes/Physics/lecture 1.md': '# Physics\n\nthe needlep is in this one\n',
  'Notes/Math/lecture 1.md': '# Math\n\nanother needlep, in another folder\n',
};

async function boot(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files }) => {
    const index = { files: {} as Record<string, number>, folders: ['Notes', 'Notes/Physics', 'Notes/Math'] };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/Physics/lecture 1.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, { files: FILES });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

/** Open the sidebar's search on the all-notes scope and take the first hit
 *  whose note is not the one already open (the hit may be in either file). */
async function openHit(page: Page) {
  await page.keyboard.press('Control+Shift+f');
  const panel = page.locator('#right-panel');
  await panel.locator('[data-scope="all"]').click();
  await panel.locator('.vault-search').fill('needlep');
  const hit = panel.locator('.search-result-file-match[data-path="Notes/Math/lecture 1.md"]');
  await expect(hit).toBeVisible();
  await hit.click();
}

const read = (page: Page) => page.evaluate(async () => {
  const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
  const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
  const { from, to, anchor, head } = view.state.selection.main;
  return { text: view.state.doc.toString(), from, to, anchor, head };
});

test('a result is shown with a ring, and the caret lands after it', async ({ page }) => {
  await boot(page);
  await openHit(page);
  await expect(page.locator('#app .cm-file-name')).toHaveText('lecture 1');
  await expect(page.locator('#app .cm-search-flash')).toHaveCount(1);
  const state = await read(page);
  const at = state.text.indexOf('needlep');
  expect(at).toBeGreaterThan(-1);
  // Not selected: a caret, after the hit.
  expect(state.from).toBe(at + 'needlep'.length);
  expect(state.to).toBe(state.from);
  expect(state.anchor).toBe(state.from);
  expect(state.head).toBe(state.from);
  // And the ring leaves on its own, a few seconds later.
  await expect(page.locator('#app .cm-search-flash')).toHaveCount(0, { timeout: 6000 });
});

test('typing takes the ring away at once', async ({ page }) => {
  await boot(page);
  await openHit(page);
  await expect(page.locator('#app .cm-search-flash')).toHaveCount(1);
  await page.locator('#app .cm-content').press('x');
  await expect(page.locator('#app .cm-search-flash')).toHaveCount(0);
});
