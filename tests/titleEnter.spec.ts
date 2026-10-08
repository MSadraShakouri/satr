import { expect, test, type Page } from '@playwright/test';

// The title's ✓ (Enter): commit the name and go to the note's first line,
// with the editor focused in the same key event (so the keyboard stays up).

async function boot(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', 'first line\n\nsecond line\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
}

test('Enter in the title hands the focus to the note, and nothing closes', async ({ page }) => {
  await boot(page);
  const title = page.locator('#app .cm-file-name');
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  // The editor has the focus (so the keyboard stays), and the title has let go.
  await expect.poll(() => page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    return EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!.hasFocus;
  })).toBe(true);
  await expect(title).not.toBeFocused();
  // Nothing was closed: the note is still the one open.
  await expect(title).toHaveText('A');
});
