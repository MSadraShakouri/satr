import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

async function switchTo(page: Page, index: number): Promise<void> {
  await page.locator('#nav-tabs').dispatchEvent('click');
  await expect(page.locator('.mobile-tab-switcher')).toBeVisible();
  await page.locator('.mobile-tab-title').nth(index).click();
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
}

test('a different note with the same length and hash must not reuse its old reading view', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:fs:index', JSON.stringify({files:{'a.md':1,'b.md':1},folders:[]}));
    localStorage.setItem('satr:fs:file:a.md','aaB');
    localStorage.setItem('satr:fs:file:b.md','other note');
    localStorage.setItem('satr:tabs', JSON.stringify({tabs:[{path:'a.md'},{path:'b.md'}],active:0}));
    localStorage.setItem('satr:demoShown','1');
  });
  await page.goto('/'); await expect(page.locator('#app .cm-file-name')).toHaveText('a');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview')).toContainText('aaB');
  await switchTo(page, 1); await expect(page.locator('#app .cm-file-name')).toHaveText('b');
  // Simulate an independent edit to the file while its tab is inactive.
  await page.evaluate(async () => { const vault = window.__satr.load('/src/vault.ts'); await vault.backend.write('a.md','aba'); });
  await switchTo(page, 0); await expect(page.locator('#app .cm-file-name')).toHaveText('a');
  const editorText = await page.evaluate(() => {
    const { EditorView } = window.__satr.load('/node_modules/@codemirror/view/');
    return EditorView.findFromDOM(document.querySelector('#app .cm-editor')!)!.state.doc.toString();
  });
  expect(editorText, 'the newly read file is already in the editor').toBe('aba');
  await expect(page.locator('#preview')).toContainText('aba');
  await expect(page.locator('#preview')).not.toContainText('aaB');
});
