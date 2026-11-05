import { expect, test, type Page } from '@playwright/test';

// Where the fold arrow is.
//
// His line: "make it like obsidian where it next to it closes it and remove
// the current > button next to the name". The arrow used to sit at the far
// end of the heading line, past the words, where it read as punctuation and
// where a right-handed thumb reaching for it covered the title. Obsidian
// puts it before the heading, hanging in the page's own margin, and that is
// what this pins: the leading side folds, the trailing end does not, the
// heading text has not moved, and tapping the words still only places the
// caret.

const NOTE = '# Lecture one\n\nA paragraph of the note.\n\n## Waves\n\nAnother paragraph under it.\n';

async function boot(page: Page, text = NOTE): Promise<void> {
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
  await page.waitForTimeout(300);
}

const EDITOR_HEAD = '#app .cm-line.cm-heading-fold';
const PREVIEW_HEAD = '#app .preview-pane .md-section > .has-fold';

const headBox = async (page: Page, selector: string) =>
  (await page.locator(selector).first().boundingBox())!;

const isFolded = (page: Page, selector: string): Promise<boolean> =>
  page.locator(selector).first().evaluate((el) => el.classList.contains('is-folded'));

async function toReading(page: Page): Promise<void> {
  await page.locator('#preview-toggle').click();
  await page.waitForTimeout(700);
}

test('the leading side of the heading folds it, writing', async ({ page }) => {
  await boot(page);
  const box = await headBox(page, EDITOR_HEAD);
  await page.mouse.click(box.x + 10, box.y + box.height - 10);
  await page.waitForTimeout(400);
  expect(await isFolded(page, EDITOR_HEAD), 'the editor heading folded').toBe(true);
});

test('the leading side of the heading folds it, reading', async ({ page }) => {
  // A fresh note: a fold made in one view shows in the other, so this must
  // not inherit the fold from the test above.
  await boot(page);
  await toReading(page);
  const box = await headBox(page, PREVIEW_HEAD);
  expect(await isFolded(page, PREVIEW_HEAD), 'nothing is folded yet').toBe(false);
  await page.mouse.click(box.x + 10, box.y + 10);
  await page.waitForTimeout(400);
  expect(await isFolded(page, PREVIEW_HEAD), 'the reading view folded too').toBe(true);
});

test('the far end of the heading no longer folds anything', async ({ page }) => {
  await boot(page);
  const box = await headBox(page, EDITOR_HEAD);
  // Where the old chevron was. A tap there is a tap in the empty space after
  // a title: it places the caret and nothing else.
  await page.mouse.click(box.x + box.width - 10, box.y + box.height - 10);
  await page.waitForTimeout(400);
  expect(await isFolded(page, EDITOR_HEAD)).toBe(false);

  await toReading(page);
  const pbox = await headBox(page, PREVIEW_HEAD);
  await page.mouse.click(pbox.x + pbox.width - 10, pbox.y + 10);
  await page.waitForTimeout(400);
  expect(await isFolded(page, PREVIEW_HEAD)).toBe(false);
});

test('the heading text stays where it was, level with the paragraphs', async ({ page }) => {
  await boot(page);
  const where = await page.evaluate(() => {
    const range = (el: Element) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect().left;
    };
    const lines = [...document.querySelectorAll('.cm-content .cm-line')] as HTMLElement[];
    const heading = lines.find((l) => l.textContent?.includes('Lecture one'))!;
    const paragraph = lines.find((l) => l.textContent?.includes('A paragraph'))!;
    return { heading: range(heading), paragraph: range(paragraph), folds: heading.classList.contains('cm-heading-fold') };
  });
  expect(where.folds, 'the heading is a foldable one').toBe(true);
  // The arrow hangs in the margin; it must not have pushed the title inwards.
  expect(Math.abs(where.heading - where.paragraph), 'the title is not indented').toBeLessThan(2);
});

test('tapping the words of a heading only places the caret', async ({ page }) => {
  await boot(page);
  const word = page.locator('.cm-content .cm-line', { hasText: 'Lecture one' }).first();
  await word.click({ position: { x: 60, y: 24 } });
  await page.waitForTimeout(400);
  expect(await isFolded(page, EDITOR_HEAD)).toBe(false);
  expect(await page.locator('.cm-content').evaluate((el) => el.contains(document.getSelection()?.anchorNode ?? null))).toBe(true);
});
