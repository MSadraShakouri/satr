import { expect, test, type Page } from '@playwright/test';
import { typesetPdf } from './support/tinyPdf';

// A search over a folder covers the documents in it, not only the notes:
// a reader who keeps the lecturer's handout beside their own notes means
// both when they search the folder. The documents are taken in behind a
// button of their own, beside the subfolders one, and a document that has
// not been read yet joins the search when its text lands rather than
// holding every other result up.

const WORD = 'quenchwort'; // in one note and on one page of the document
// Four pages, and the word is on the third of them: a document says
// which page a hit is on, and the page a hit opens must be that one.
const DOC = typesetPdf([{ chapter: 'Isothermal' }, { chapter: 'Adiabatic' }, { chapter: `Isobaric ${WORD}` }, { chapter: 'Isochoric' }]);
const FILES: Record<string, string> = {
  'Notes/note.md': `a note with ${WORD} written in it\n`,
  'Notes/elsewhere.md': 'a note about something else entirely\n',
  'Notes/handout.pdf': DOC,
};

async function boot(page: Page, settings?: Record<string, unknown>): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files, settings: given }) => {
    const index = { files: {} as Record<string, number>, folders: ['Notes'] };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/note.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    if (given) localStorage.setItem('satr:settings', JSON.stringify(given));
  }, { files: FILES, settings });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

const panelOf = (page: Page) => page.locator('#app #right-panel');

async function searchAll(page: Page, query: string): Promise<void> {
  if (!(await page.locator('body').evaluate((body) => body.classList.contains('outline-open')))) {
    await page.keyboard.press('Control+Shift+f');
    await expect(page.locator('body')).toHaveClass(/outline-open/);
  }
  const panel = panelOf(page);
  await expect(panel).toBeVisible();
  await panel.locator('[data-scope="all"]').click();
  await expect(panel.locator('[data-scope="all"][aria-checked="true"]')).toBeVisible();
  await panel.locator('.vault-search').fill(query);
  // With nothing typed the panel lists every file in the space, so a row
  // being there is not yet an answer: wait for a render that has hits in
  // it (or says there are none).
  await expect(async () => {
    const hits = await panel.locator('.search-result-file-matched-text').count();
    const empty = await panel.locator('.pane-empty').count();
    expect(hits > 0 || empty > 0).toBe(true);
  }).toPass({ timeout: 10000 });
}

/** The panel searches a document the moment its text lands, which is a
 *  second render: wait for the row rather than for a timeout. */
const waitForDocument = async (page: Page): Promise<void> => {
  await expect(panelOf(page).locator('.search-result-file-match[data-path="Notes/handout.pdf"]')).toBeVisible({ timeout: 20000 });
};

const found = (page: Page): Promise<(string | null)[]> =>
  panelOf(page).locator('.search-result-file-title').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-note')));

test('a word on a page of a document is found by a search over the folder', async ({ page }) => {
  await boot(page);
  await searchAll(page, WORD);
  // The note is there at once -- it is text already in hand. The document
  // has to be read first, and arrives on its own.
  await expect(panelOf(page).locator('.search-result-file-title[data-note="Notes/note.md"]')).toBeVisible();
  await waitForDocument(page);
  expect(await found(page)).not.toContain('Notes/elsewhere.md');
});

test('with the documents button off, only the notes are searched', async ({ page }) => {
  await boot(page);
  await searchAll(page, WORD);
  const panel = panelOf(page);
  await waitForDocument(page);
  // The button beside the subfolders one, turned off.
  const button = panel.locator('[data-documents-toggle]');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.locator('.search-result-file-title[data-note="Notes/handout.pdf"]')).toHaveCount(0);
  await expect(panel.locator('.search-result-file-title[data-note="Notes/note.md"]')).toBeVisible();
  // And back on again, from what was already read: no second reading.
  await button.click();
  await expect(panel.locator('.search-result-file-title[data-note="Notes/handout.pdf"]')).toBeVisible({ timeout: 5000 });
});

test('neither button can be pressed while the search is this note alone', async ({ page }) => {
  await boot(page);
  await searchAll(page, WORD);
  const panel = panelOf(page);
  await panel.locator('[data-scope="note"]').click();
  await expect(panel.locator('[data-documents-toggle]')).toBeDisabled();
  await expect(panel.locator('[data-recursive-toggle]')).toBeDisabled();
});

test('a result in a document opens it at the page the words are on', async ({ page }) => {
  await boot(page);
  await searchAll(page, WORD);
  const panel = panelOf(page);
  await waitForDocument(page);
  // The hit itself, not the file's own row: the word is on page 2.
  await panel.locator('.search-result-file-match[data-path="Notes/handout.pdf"]').first().click();
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.pdf-counter')).toHaveText(/^\s*3\s*\/\s*4\s*$/, { timeout: 10000 });
});
