import { expect, test, type Page } from '@playwright/test';
import { vaultText } from './support/vaultText';

// The heading button continues the note instead of starting it again.
//
// His line: "have something for headers and maybe have something to repeat
// the same header as the last one". Every section of a lecture is an H2, and
// the button always began at H1 and walked up, so each new section cost five
// presses that said nothing. One press now writes the level last used above
// the line; pressing again still walks the levels, which is how one gets
// changed.

async function boot(page: Page, text: string): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((body) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/note.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/note.md', body as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/note.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:demoShown', '1');
  }, text);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

/**
 * Put the caret on a line by its text, then press the toolbar's heading.
 * The keyboard toolbar only shows while the keys are up, which never happens
 * in a headless browser, so the button is clicked the way selectionBar.spec
 * does it -- through the element, not the pointer.
 */
async function headingOn(page: Page, lineText: string, presses = 1): Promise<void> {
  await page.locator('.cm-content .cm-line', { hasText: lineText }).first().click();
  for (let i = 0; i < presses; i += 1) {
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('#edit-toolbar-list button[data-command="heading"]')!.click());
    await page.waitForTimeout(120);
  }
}

/**
 * The markdown as the vault holds it, line by line -- the live preview hides
 * the hashes, and "## Doppler" contains "# Doppler", so whole lines are the
 * only honest way to ask which level was written.
 */
async function lines(page: Page): Promise<string[]> {
  await page.waitForTimeout(1400); // the save debounce
  return ((await vaultText(page, 'Notes/note.md')) ?? '').split('\n');
}

test('one press continues at the level last used above', async ({ page }) => {
  await boot(page, '# Lecture\n\n## Waves\n\nsomething\n\nDoppler\n');
  await headingOn(page, 'Doppler');
  expect(await lines(page)).toContain('## Doppler');
});

test('pressing again still walks the levels up', async ({ page }) => {
  await boot(page, '# Lecture\n\n## Waves\n\nsomething\n\nDoppler\n');
  await headingOn(page, 'Doppler', 2);
  expect(await lines(page)).toContain('### Doppler');
});

test('with nothing above it, a line starts at one', async ({ page }) => {
  await boot(page, 'Opening line\n\nmore\n');
  await headingOn(page, 'Opening line');
  expect(await lines(page)).toContain('# Opening line');
});

test('a hash inside fenced code is not a heading above', async ({ page }) => {
  // Half the code anyone writes has a `#` comment in it, and the level
  // above must not be read out of one.
  await boot(page, '### Setup\n\n```bash\n# install everything\n#### deep comment\n```\n\nNext part\n');
  await headingOn(page, 'Next part');
  expect(await lines(page)).toContain('### Next part');
});

test('a heading line still cycles from its own level', async ({ page }) => {
  await boot(page, '# Lecture\n\n## Waves\n\nsomething\n');
  await headingOn(page, 'Waves');
  expect(await lines(page)).toContain('### Waves');
});
