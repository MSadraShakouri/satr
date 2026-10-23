import { expect, test, type Page } from '@playwright/test';

// Searching inside a note, from the reader's side. The find bar is part of
// the editor, so it takes its own height out of the text area, and two
// reports came out of that: "search in normal mode isn't 1/3, I think it
// counts the search bar too" and "closing and opening it brings [the note]
// up and down which is undesired". The third thing pinned here is where the
// reader is left when the bar closes: at a caret after the match, not inside
// a selection with the selection bar over the line they were reading.
const LINES = Array.from({ length: 80 }, (_, i) => (i === 40 ? 'line 41 has the needlep in it' : `line ${i + 1} of the note, ordinary text`));
const FILES: Record<string, string> = { 'Notes/long.md': `${LINES.join('\n')}\n` };
/** Where 'needlep' starts in the note. */
const MATCH = FILES['Notes/long.md'].indexOf('needlep');
const HEIGHT = 844;

async function boot(page: Page) {
  await page.setViewportSize({ width: 390, height: HEIGHT });
  await page.addInitScript(({ files }) => {
    const index = { files: {} as Record<string, number>, folders: ['Notes'] };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/long.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, { files: FILES });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await page.evaluate(() => document.querySelector('#boot-snapshot')?.remove());
  await page.locator('#app .cm-content').click();
  await page.waitForTimeout(250);
}

/** Screen y of one position in the note. A .cm-line is no good for this: the
 *  editor only renders the lines around the viewport, so the first one in the
 *  DOM is a different line before and after a scroll. */
const yOf = (page: Page, pos: number) => page.evaluate(async (at: number) => {
  const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
  const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
  return view.coordsAtPos(at)?.top ?? null;
}, pos);

const selection = (page: Page) => page.evaluate(async () => {
  const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
  const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
  const { from, to, head } = view.state.selection.main;
  return { from, to, head, text: view.state.sliceDoc(from, to) };
});

async function find(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+f');
  await expect(page.locator('#app .document-search-container')).toBeVisible();
  await page.locator('#app .document-search-input input').fill(query);
  await expect(page.locator('#app .obsidian-search-match-highlight')).toBeVisible();
  await page.waitForTimeout(350);
}

test('a hit lands a third down the screen, with the bar counted', async ({ page }) => {
  await boot(page);
  await find(page, 'needlep');
  const ring = (await page.locator('#app .obsidian-search-match-highlight').boundingBox())!;
  const bar = (await page.locator('#app .document-search-container').boundingBox())!;
  expect(bar.height, 'the bar takes real height out of the screen').toBeGreaterThan(60);
  // A third of the screen, not a third of what is left under the bar: that
  // put the hit at 42% — as good as the middle, where the keyboard's edge is.
  expect(ring.y).toBeGreaterThan(HEIGHT / 3 - 30);
  expect(ring.y).toBeLessThan(HEIGHT / 3 + 30);
});

test('the note stays where it is when the bar opens and closes', async ({ page }) => {
  await boot(page);
  const before = await yOf(page, 200);
  await page.keyboard.press('Control+f');
  await expect(page.locator('#app .document-search-container')).toBeVisible();
  await page.waitForTimeout(250);
  const opened = await yOf(page, 200);
  expect(before).not.toBeNull();
  expect(Math.abs(opened! - before!), 'opening the bar must not move the note').toBeLessThanOrEqual(1);

  // And with a hit on screen, closing holds that line rather than the top one.
  await page.locator('#app .document-search-input input').fill('needlep');
  await expect(page.locator('#app .obsidian-search-match-highlight')).toBeVisible();
  await page.waitForTimeout(350);
  const hit = await yOf(page, MATCH);
  await page.keyboard.press('Escape');
  await expect(page.locator('#app .document-search-container')).toHaveCount(0);
  await page.waitForTimeout(250);
  const closed = await yOf(page, MATCH);
  expect(Math.abs(closed! - hit!), 'closing the bar must not move the note').toBeLessThanOrEqual(1);
});

test('closing the bar leaves a caret after the match, not a selection', async ({ page }) => {
  await boot(page);
  await find(page, 'needlep');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app .document-search-container')).toHaveCount(0);
  const sel = await selection(page);
  expect(sel.text, 'nothing is selected: no selection bar, no handles').toBe('');
  expect(sel.head, 'the caret sits where the reader can carry on typing').toBe(MATCH + 'needlep'.length);
});
