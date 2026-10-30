import { expect, test, type Page } from '@playwright/test';
import { tinyPdfBytes } from './support/tinyPdf';

// Taking a file off the device and into the vault, in the browser.
//
// Nothing in the web app could make a file that is not a note, so a PDF, a
// picture or a spreadsheet could only be tried by building the APK. The new
// tab offers to import one, and what comes in is an ordinary file of the
// vault afterwards: in the tree, under a name of its own, opened the way any
// other file opens. The app in the APK is never offered this — Android hands
// it files itself (src/importFile.ts).

/** A browser with a vault but nothing open: the new tab. */
async function emptyTab(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/kept.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/kept.md', '# a note that was already here\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/kept.md' }, { path: '' }], active: 1 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  });
  await page.goto('/');
  // the class, not the text: the page is in the DOM either way, and reading
  // its title would pass just as well with a note open over the top of it
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
}

/** Tap Import a file and hand the chooser what it asks for. */
async function importThese(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#empty-tab [data-act="import"]').click();
  await (await chooser).setFiles(files);
}

/** The vault's own list of what it has. */
const vaultFiles = (page: Page) => page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem('satr:fs:index') ?? '{"files":{}}') as { files: Record<string, number> };
  return Object.keys(index.files ?? {}).sort();
});

test('a PDF from the device becomes a file of the vault, and opens as its pages', async ({ page }) => {
  await emptyTab(page);
  await importThese(page, [{ name: 'handout.pdf', mimeType: 'application/pdf', buffer: tinyPdfBytes(6) }]);
  // it opened, and it is a document rather than text about one
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });
  await expect.poll(() => page.locator('.pdf-page canvas').count(), { timeout: 15000 }).toBeGreaterThan(0);
  await expect(page.locator('.pdf-counter')).toHaveText('1 / 6');
  // and it is a file of the vault now, in the folder that was being looked at
  expect(await vaultFiles(page)).toEqual(['Notes/handout.pdf', 'Notes/kept.md']);
  // it survives a reload, which is the whole difference between importing a
  // file and merely looking at one
  await page.reload();
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });
});

test('a text file comes in as text, not as bytes', async ({ page }) => {
  await emptyTab(page);
  await importThese(page, [{ name: 'lecture.md', mimeType: 'text/markdown', buffer: Buffer.from('# Lecture one\n\nسلام\n', 'utf8') }]);
  await expect(page.locator('#app .cm-file-name')).toHaveText('lecture');
  await expect(page.locator('.cm-content')).toContainText('Lecture one');
  // the Persian survived the round trip through storage
  await expect(page.locator('.cm-content')).toContainText('سلام');
});

test('importing a name the vault already has keeps both', async ({ page }) => {
  await emptyTab(page);
  await importThese(page, [{ name: 'kept.md', mimeType: 'text/markdown', buffer: Buffer.from('the second one\n', 'utf8') }]);
  await expect(page.locator('#app .cm-file-name')).toHaveText('kept 1');
  expect(await vaultFiles(page)).toEqual(['Notes/kept 1.md', 'Notes/kept.md']);
  // the file that was already there is untouched
  expect(await page.evaluate(async () => {
    const { backend } = await (window as unknown as { __satr: { load(p: string): Promise<Record<string, never>> } })
      .__satr.load('/src/vault.ts') as unknown as { backend: { read(p: string): Promise<string | null> } };
    return backend.read('Notes/kept.md');
  })).toContain('already here');
});

test('several at once all arrive', async ({ page }) => {
  await emptyTab(page);
  await importThese(page, [
    { name: 'one.md', mimeType: 'text/markdown', buffer: Buffer.from('first\n', 'utf8') },
    { name: 'two.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n', 'utf8') },
    { name: 'three.pdf', mimeType: 'application/pdf', buffer: tinyPdfBytes(2) },
  ]);
  await expect.poll(() => vaultFiles(page)).toEqual(['Notes/kept.md', 'Notes/one.md', 'Notes/three.pdf', 'Notes/two.csv']);
});
