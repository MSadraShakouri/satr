import { test, expect, type Page } from '@playwright/test';

/** HTML a writer put in a note. The reading view renders one section per
 *  block, each in a <div> of its own, which is how a tap in the preview finds
 *  its line in the source — but a container written with air inside it is
 *  more than one block, and its children must still end up inside it. */

const TITLE_PAGE = `<div class="title-page">

<h1>Course notes</h1>

<div class="subtitle">
written by<br>
<strong>the author</strong>
</div>

<div class="divider-line"></div>

</div>
`;

const PLAIN = `First paragraph.

Second paragraph.

Third paragraph.
`;

async function boot(page: Page, note: string): Promise<void> {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/html.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/html.md', text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/html.md' }], active: 0 }));
  }, note);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('html');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
  await page.waitForTimeout(250);
}

test('a container written with blank lines keeps its children', async ({ page }) => {
  await boot(page, TITLE_PAGE);
  const box = page.locator('#preview-pane .title-page');
  await expect(box).toHaveCount(1);
  // The heading and both boxes are inside the container, not strewn after it.
  await expect(box.locator('h1')).toHaveText('Course notes');
  await expect(box.locator('.subtitle strong')).toHaveText('the author');
  await expect(box.locator('.divider-line')).toHaveCount(1);
  // And the container is a box with a size, not an empty one.
  expect(await box.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBeGreaterThan(40);
});

test('ordinary blocks are still one section each', async ({ page }) => {
  await boot(page, PLAIN);
  // Three paragraphs, three sections, each tagged with its own source line:
  // joining blocks happens only where a tag is open.
  const lines = await page.locator('#preview-pane .md-section').evaluateAll((all) => all.map((el) => (el as HTMLElement).dataset.line));
  expect(lines).toEqual(['0', '2', '4']);
});
