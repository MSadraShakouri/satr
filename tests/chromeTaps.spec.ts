import { expect, test, type Page } from '@playwright/test';

// "Tapping on source to preview button makes it blue (normal browser
// selection blue) which is undesired, everything like this should be
// disabled." Android's WebView paints its own highlight over a tapped
// control and offers to select the label on a press and hold. The app turns
// both off for its chrome — and only for its chrome: a note is there to be
// selected, links inside it included.
const FILES: Record<string, string> = {
  'Notes/note.md': '# Note\n\nA line with [a link](https://example.com) in it.\n',
};

async function boot(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files }) => {
    const index = { files: {} as Record<string, number>, folders: ['Notes'] };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/note.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, { files: FILES });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await page.evaluate(() => document.querySelector('#boot-snapshot')?.remove());
}

const styleOf = (page: Page, selector: string) => page.evaluate((sel) => {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) return null;
  const style = getComputedStyle(el);
  return {
    tapHighlight: style.getPropertyValue('-webkit-tap-highlight-color').replace(/\s/g, ''),
    userSelect: style.userSelect || style.webkitUserSelect,
  };
}, selector);

test('a control neither flashes nor offers its label for selection', async ({ page }) => {
  await boot(page);
  for (const control of ['#preview-toggle', '#files', '#nav-find']) {
    const style = await styleOf(page, control);
    expect(style, `${control} is in the app`).not.toBeNull();
    expect(style!.tapHighlight, `${control} must not flash`).toBe('rgba(0,0,0,0)');
    expect(style!.userSelect, `${control}'s label is not text to select`).toBe('none');
  }
});

test('the note keeps its selection, links and all', async ({ page }) => {
  await boot(page);
  expect((await styleOf(page, '#app .cm-content'))!.userSelect).not.toBe('none');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#app #preview a')).toBeVisible();
  const link = await styleOf(page, '#app #preview a');
  expect(link!.userSelect, 'a paragraph with a link in it is still selectable').not.toBe('none');
});
