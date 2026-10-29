import { expect, test, type Page } from '@playwright/test';

// A name being typed is on screen while it is being typed.
//
// The rename field is the row itself, made editable in place. A row at the
// bottom of the file list is exactly where the keyboard comes up — so the
// field took the caret and then disappeared behind the keys, and the name was
// typed blind. Folder or file, it made no difference: it was wherever the
// list ended.
//
// The list is given a keyboard's worth of room underneath while the rename is
// live, and the row is carried back above the visible edge whenever that edge
// moves (src/leftSidebar.ts).

const FILES: Record<string, string> = {};
for (let n = 1; n <= 30; n += 1) FILES[`Notes/note ${String(n).padStart(2, '0')}.md`] = `# note ${n}\n`;
const LAST = 'Notes/note 30.md';

async function boot(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((files) => {
    const index = { files: {} as Record<string, number>, folders: ['Notes'] };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/note 01.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, FILES);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('note 01');
  if (!(await page.locator('body').evaluate((body) => body.classList.contains('files-open')))) {
    await page.locator('#files').click();
    await expect(page.locator('body')).toHaveClass(/files-open/);
  }
}

async function renameFromMenu(page: Page, path: string): Promise<void> {
  const row = page.locator(`#file-panel .tree-item-self[data-path="${path}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.click({ button: 'right' });
  await expect(page.locator('.menu.mod-bottom-sheet')).toBeVisible();
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Rename…' }).click();
  await expect(row).toHaveClass(/is-being-renamed/);
}

/** The on-screen keyboard, as Android's Chrome serves it to this app: the
 *  visual viewport shrinks to `height`, the layout viewport does not move. */
const keyboardUp = (page: Page, height: number) => page.evaluate((left) => {
  const viewport = window.visualViewport!;
  Object.defineProperty(viewport, 'height', { configurable: true, get: () => left });
  viewport.dispatchEvent(new Event('resize'));
}, height);

/** How far the row hangs below what can be seen, in pixels. */
const hidden = (page: Page, path: string): Promise<number> => page.evaluate((target) => {
  const row = document.querySelector<HTMLElement>(`#file-panel .tree-item-self[data-path="${target}"]`)!;
  const viewport = window.visualViewport;
  const edge = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
  return Math.round(row.getBoundingClientRect().bottom - edge);
}, path);

test('the last row in the list is visible while its name is being typed', async ({ page }) => {
  await boot(page);
  await renameFromMenu(page, LAST);
  expect(await hidden(page, LAST)).toBeLessThanOrEqual(0);
  // The keyboard comes up after the field has the caret, and it comes up
  // over the page: the layout viewport keeps its height and nothing in it
  // moves of its own accord — only the visual viewport shrinks. That is the
  // case the browser does not handle for us, so it is the case tested.
  await keyboardUp(page, 380);
  await expect.poll(() => hidden(page, LAST)).toBeLessThanOrEqual(0);
  // The room under the list is only there while the rename is.
  await page.keyboard.press('Escape');
  await expect(page.locator(`#file-panel .tree-item-self[data-path="${LAST}"]`)).not.toHaveClass(/is-being-renamed/);
  expect(await page.locator('#file-panel .nav-files-container')
    .evaluate((list) => list.style.paddingBottom)).toBe('');
});

test('the name itself is what gets the caret, and Enter still moves the file', async ({ page }) => {
  await boot(page);
  await renameFromMenu(page, LAST);
  await page.keyboard.type('last one');
  await page.keyboard.press('Enter');
  await expect(page.locator('#file-panel .tree-item-self[data-path="Notes/last one.md"]')).toHaveCount(1);
  await expect(page.locator(`#file-panel .tree-item-self[data-path="${LAST}"]`)).toHaveCount(0);
});
