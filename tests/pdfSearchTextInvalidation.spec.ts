import { expect, test, type Page } from '@playwright/test';
import { typesetPdf } from './support/tinyPdf';

const OLD = typesetPdf([{ chapter: 'obsoletequasar' }, { chapter: 'old extra' }]);
const NEW = typesetPdf([{ chapter: 'newnebula' }]);
const BOOK = 'Notes/Private/book.pdf';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((old) => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/Private/book.pdf': 1, 'Notes/note.md': 1 }, folders: ['Notes', 'Notes/Private'] }));
    localStorage.setItem('satr:fs:file:Notes/Private/book.pdf', old);
    localStorage.setItem('satr:fs:file:Notes/note.md', 'note');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/note.md' }], active: 0 }));
    localStorage.setItem('satr:expanded:notes', JSON.stringify(['Notes', 'Notes/Private']));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, OLD);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('note');
}

async function searchPanel(page: Page) {
  await page.keyboard.press('Control+Shift+f');
  const panel = page.locator('#right-panel');
  await panel.locator('[data-scope="all"]').click();
  return panel;
}

for (const kind of ['file', 'folder'] as const) {
  test(`replacing a deleted ${kind} does not search the old PDF text`, async ({ page }) => {
    await seed(page);
    const initial = await page.evaluate(async (path) => window.__satr.load('/src/documentText.ts').textOf(path), BOOK);
    expect(initial, 'the original document text was cached').toContain('obsoletequasar');
    await page.locator('#files').click();
    const path = kind === 'file' ? BOOK : 'Notes/Private';
    await page.locator(`#file-panel .tree-item-self[data-path="${path}"]`).click({ button: 'right' });
    await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Delete' }).click();
    await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Delete' }).last().click();
    await expect.poll(() => page.evaluate(async (p) => window.__satr.load('/src/vault.ts').backend.stat(p), BOOK)).toBeNull();
    // Reuse the same path independently of the deletion UI.
    await page.evaluate(async ({ path, pdf }) => window.__satr.load('/src/vault.ts').backend.write(path, pdf), { path: BOOK, pdf: NEW });
    const panel = await searchPanel(page);
    await panel.locator('.vault-search').fill('newnebula');
    await expect(panel.locator(`.search-result-file-match[data-path="${BOOK}"]`), 'the replacement is searchable').toBeVisible({ timeout: 10000 });
    await panel.locator('.vault-search').fill('obsoletequasar');
    await expect(panel.locator('.pane-empty'), 'the old text is no longer a result').toHaveText('No results', { timeout: 10000 });
    await expect(panel.locator(`.search-result-file-match[data-path="${BOOK}"]`)).toHaveCount(0);
  });
}

test('forgetting an in-flight read cannot repopulate old text while a new read is pending', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const { backend } = window.__satr.load('/src/vault.ts');
    const original = backend.readBytes.bind(backend);
    let n = 0;
    backend.readBytes = async (path: string) => {
      const bytes = await original(path);
      if (path === 'Notes/Private/book.pdf') {
        n += 1;
        if (n === 1) await new Promise<void>((resolve) => { (window as any).releaseOld = resolve; });
        else if (n === 2) await new Promise<void>((resolve) => { (window as any).releaseNew = resolve; });
      }
      return bytes;
    };
    (window as any).oldRead = window.__satr.load('/src/documentText.ts').textOf('Notes/Private/book.pdf');
  });
  await page.waitForFunction(() => Boolean((window as any).releaseOld));
  await page.evaluate(async (pdf) => {
    const { backend } = window.__satr.load('/src/vault.ts');
    const text = window.__satr.load('/src/documentText.ts');
    await backend.write('Notes/Private/book.pdf', pdf);
    text.forgetText('Notes/Private/book.pdf');
    (window as any).newRead = text.textOf('Notes/Private/book.pdf');
    (window as any).releaseOld();
  }, NEW);
  await page.waitForFunction(() => Boolean((window as any).releaseNew));
  const interim = await page.evaluate(() => {
    const text = window.__satr.load('/src/documentText.ts');
    return { held: text.textHeld('Notes/Private/book.pdf'), same: text.textOf('Notes/Private/book.pdf') === (window as any).newRead };
  });
  await page.evaluate(() => (window as any).releaseNew());
  const result = await page.evaluate(async () => {
    const text = window.__satr.load('/src/documentText.ts');
    const value = await (window as any).newRead;
    return { value, held: text.textHeld('Notes/Private/book.pdf') };
  });
  expect(interim.held, 'the invalidated result did not become searchable again').toBeNull();
  expect(interim.same, 'the newer pending read remains shared').toBe(true);
  expect(result.value, 'the new read returns the replacement').toContain('newnebula');
  expect(result.held, 'the retained text belongs to the replacement').toContain('newnebula');
});

test('renaming a folder and reusing its old path searches each PDF as it is now', async ({ page }) => {
  await seed(page);
  await page.evaluate(async (path) => window.__satr.load('/src/documentText.ts').textOf(path), BOOK);
  await page.locator('#files').click();
  const folder = page.locator('#file-panel .tree-item-self[data-path="Notes/Private"]');
  await folder.click({ button: 'right' });
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Rename…' }).click();
  await expect(folder).toHaveClass(/is-being-renamed/);
  await page.keyboard.type('Archived');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(async () => window.__satr.load('/src/vault.ts').backend.stat('Notes/Archived/book.pdf'))).not.toBeNull();
  await page.evaluate(async (pdf) => window.__satr.load('/src/vault.ts').backend.write('Notes/Private/book.pdf', pdf), NEW);
  const panel = await searchPanel(page);
  await panel.locator('.vault-search').fill('newnebula');
  await expect(panel.locator(`.search-result-file-match[data-path="${BOOK}"]`), 'the new original path contains the new text').toBeVisible({ timeout: 10000 });
  await panel.locator('.vault-search').fill('obsoletequasar');
  await expect(panel.locator('.search-result-file-match[data-path="Notes/Archived/book.pdf"]'), 'the moved path contains the old text').toBeVisible({ timeout: 10000 });
  await expect(panel.locator(`.search-result-file-match[data-path="${BOOK}"]`), 'the old path no longer contains old text').toHaveCount(0);
});

test('subtree invalidation preserves a sibling with a similar prefix', async ({ page }) => {
  await seed(page);
  const state = await page.evaluate(async (pdf) => {
    const { backend } = window.__satr.load('/src/vault.ts');
    const text = window.__satr.load('/src/documentText.ts');
    await backend.write('Notes/Private2/book.pdf', pdf);
    await text.textOf('Notes/Private/book.pdf');
    await text.textOf('Notes/Private2/book.pdf');
    text.forgetTextWithin('Notes/Private');
    return { removed: text.textHeld('Notes/Private/book.pdf'), sibling: text.textHeld('Notes/Private2/book.pdf') };
  }, NEW);
  expect(state.removed, 'the deleted subtree is forgotten').toBeNull();
  expect(state.sibling, 'the similarly named sibling remains').toContain('newnebula');
});

test('renaming into a formerly cached destination invalidates that destination', async ({ page }) => {
  await seed(page);
  await page.evaluate(async (pdf) => {
    const { backend } = window.__satr.load('/src/vault.ts');
    const text = window.__satr.load('/src/documentText.ts');
    await backend.write('Notes/Private/target.pdf', pdf);
    await text.textOf('Notes/Private/target.pdf');
    // An independent removal leaves the session cache intact.
    await backend.remove('Notes/Private/target.pdf');
  }, NEW);
  await page.locator('#files').click();
  const source = page.locator(`#file-panel .tree-item-self[data-path="${BOOK}"]`);
  await source.click({ button: 'right' });
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Rename…' }).click();
  await expect(source).toHaveClass(/is-being-renamed/);
  await page.keyboard.type('target.pdf');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(async () => window.__satr.load('/src/vault.ts').backend.stat('Notes/Private/target.pdf'))).not.toBeNull();
  const panel = await searchPanel(page);
  await panel.locator('.vault-search').fill('obsoletequasar');
  await expect(panel.locator('.search-result-file-match[data-path="Notes/Private/target.pdf"]'), 'the destination shows its new contents').toBeVisible({ timeout: 10000 });
  await panel.locator('.vault-search').fill('newnebula');
  await expect(panel.locator('.pane-empty'), 'the destination no longer shows its earlier contents').toHaveText('No results', { timeout: 10000 });
});
