import { expect, test, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// One search, in two places. The magnifier in the bar at the bottom and
// the search field in the panel are not two searches of the same thing:
// a word typed in either shows in the other, and clearing either quiets
// both. In his words -- "type in either, both show it".

const NOTE = 'a note with the word needle written in it\nand a second line\n';
const DOC = tinyPdf(4);

async function boot(page: Page, open: 'note.md' | 'handout.pdf'): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ note, doc, first }) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: { 'Notes/note.md': 1, 'Notes/handout.pdf': 1 }, folders: ['Notes'],
    }));
    localStorage.setItem('satr:fs:file:Notes/note.md', note);
    localStorage.setItem('satr:fs:file:Notes/handout.pdf', doc);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: `Notes/${first}` }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, { note: NOTE, doc: DOC, first: open });
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

const panelOf = (page: Page) => page.locator('#app #right-panel');
async function openPanel(page: Page): Promise<void> {
  if (!(await page.locator('body').evaluate((body) => body.classList.contains('outline-open')))) {
    await page.keyboard.press('Control+Shift+f');
    await expect(page.locator('body')).toHaveClass(/outline-open/);
  }
  await expect(panelOf(page)).toBeVisible();
}
// The drawer is a sheet over the note on a phone, so the bar is behind
// it while the panel is open. What the bar holds is still what the bar
// holds: these read it rather than reaching for it.
/** The note's own find bar, opened the way the reader opens it. */
async function openNoteFind(page: Page): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('.document-search-input input')).toBeVisible();
}

test('a word typed into a note\'s find bar shows in the search panel', async ({ page }) => {
  await boot(page, 'note.md');
  await openNoteFind(page);
  await page.locator('.document-search-input input').fill('needle');
  await openPanel(page);
  await expect(panelOf(page).locator('.vault-search')).toHaveValue('needle', { timeout: 5000 });
});

test('a word typed into the panel shows in the note\'s find bar, and clearing it puts the bar away', async ({ page }) => {
  await boot(page, 'note.md');
  await openNoteFind(page);
  await openPanel(page);
  const field = panelOf(page).locator('.vault-search');
  await field.fill('second');
  await expect(page.locator('.document-search-input input')).toHaveValue('second', { timeout: 5000 });
  // Clear either, both go quiet: the bar is not merely emptied, it goes.
  await field.fill('');
  await expect(page.locator('.document-search-container')).toHaveCount(0, { timeout: 5000 });
});

test('the panel raises the note\'s find bar without taking the keyboard', async ({ page }) => {
  await boot(page, 'note.md');
  await openPanel(page);
  const field = panelOf(page).locator('.vault-search');
  await field.fill('needle');
  await expect(page.locator('.document-search-input input')).toHaveValue('needle', { timeout: 5000 });
  // The reader is typing in the panel: the bar is shown, not focused.
  await expect(field).toBeFocused();
});

test('a word typed into the panel brings up the document\'s find bar showing it', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 20000 });
  await openPanel(page);
  const field = panelOf(page).locator('.vault-search');
  await field.fill('Page');
  const bar = page.locator('.pdf-findbar');
  await expect(bar).not.toHaveClass(/mod-hidden/, { timeout: 5000 });
  await expect(bar.locator('input')).toHaveValue('Page');
  // The panel keeps the keyboard: the bar is shown, not focused.
  await expect(field).toBeFocused();
  await field.fill('');
  await expect(bar).toHaveClass(/mod-hidden/, { timeout: 5000 });
});

test('a word typed into the document\'s find bar shows in the panel', async ({ page }) => {
  await boot(page, 'handout.pdf');
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 20000 });
  // The bar first, while the navbar is still on the screen: the drawer
  // is a sheet over everything else.
  await page.locator('#nav-find').click();
  const bar = page.locator('.pdf-findbar input');
  await expect(bar).toBeVisible();
  await bar.fill('Page');
  await page.waitForTimeout(600); // the bar searches the document on a pause
  await openPanel(page);
  await expect(panelOf(page).locator('.vault-search')).toHaveValue('Page', { timeout: 10000 });
});
