import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __printedHtml?: string;
  }
}

/** HTML a writer put in a note: that it arrives whole, that the styling
 *  written with it is obeyed, that none of it can reach past the note, and
 *  that nothing in it can run. */

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

const STYLED = `<style>
@import url("https://example.com/remote.css");
body { background-color: rgb(9, 9, 9); }
.cm-file-name { color: rgb(1, 2, 3); }
.title-page { display: flex; flex-direction: column; align-items: center; }
.title-page h1 { font-size: 2.8rem; color: #1a1a2e; }
</style>

<div class="title-page">

<h1>Course notes</h1>

</div>
`;

const RICH = `<p style="color: rgb(1, 2, 3)" id="inline">styled by hand</p>

<svg id="badge" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="rgb(4, 5, 6)"></circle></svg>

<script>document.title = 'taken over';</script>

<img id="sneak" src="x" onerror="document.title = 'taken over'">
`;

test("a note's own stylesheet styles that note, and outranks the app", async ({ page }) => {
  await boot(page, STYLED);
  const box = page.locator('#preview-pane .title-page');
  await expect(box).toHaveCSS('display', 'flex');
  // The app styles headings with .preview-pane h1; the note's .title-page h1
  // is the more particular selector once it is scoped, so the writer wins.
  const h1 = page.locator('#preview-pane .title-page h1');
  await expect(h1).toHaveCSS('color', 'rgb(26, 26, 46)');
  const wanted = await page.evaluate(() => `${2.8 * parseFloat(getComputedStyle(document.documentElement).fontSize)}px`);
  await expect(h1).toHaveCSS('font-size', wanted);
});

test("a note's stylesheet stops at the note", async ({ page }) => {
  await boot(page, STYLED);
  const reach = await page.evaluate(() => ({
    // body in a note means the note's own root, so the rule lands on the
    // article and nowhere near the window the app lives in.
    article: getComputedStyle(document.querySelector('#preview')!).backgroundColor,
    appBody: getComputedStyle(document.body).backgroundColor,
    // A rule aimed at the app's own furniture simply never matches.
    fileName: getComputedStyle(document.querySelector('.cm-file-name')!).color,
    // Nothing in a note reaches the network.
    imports: (document.querySelector('#preview style')?.textContent ?? '').includes('@import'),
  }));
  expect(reach.article).toBe('rgb(9, 9, 9)');
  expect(reach.appBody).not.toBe('rgb(9, 9, 9)');
  expect(reach.fileName).not.toBe('rgb(1, 2, 3)');
  expect(reach.imports).toBe(false);
});

test('a note may draw, and may not run', async ({ page }) => {
  await boot(page, RICH);
  await expect(page.locator('#preview-pane #inline')).toHaveCSS('color', 'rgb(1, 2, 3)');
  await expect(page.locator('#preview-pane #badge circle')).toHaveCount(1);
  expect(await page.locator('#preview-pane #badge').evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(40);
  // Neither of the two ways of running code survives the sweep.
  await expect(page.locator('#preview-pane script')).toHaveCount(0);
  expect(await page.locator('#preview-pane #sneak').getAttribute('onerror')).toBeNull();
  await page.waitForTimeout(150);
  expect(await page.title()).not.toBe('taken over');
});

test("a note's styling travels to the export", async ({ page }) => {
  // The export renders the same markup through src/print.css in a frame, so
  // the page a writer designed has to look the same there — the whole point
  // of writing one.
  await page.addInitScript(() => {
    window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; };
  });
  await page.goto('/');
  const printed = await page.evaluate(async (markdown) => {
    const { exportPdf } = await window.__satr.load('/src/exportPdf.ts');
    await exportPdf('Title page', markdown);
    return window.__printedHtml;
  }, STYLED);
  expect(printed, 'export must reach the print dialog').toBeTruthy();
  await page.setContent(printed!);
  const h1 = page.locator('.title-page h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveCSS('color', 'rgb(26, 26, 46)');
  await expect(page.locator('.title-page')).toHaveCSS('display', 'flex');
});

test('a block a note wrote in HTML reads the same way in both views', async ({ page }) => {
  // The direction of a raw HTML block used to live on the section wrapper
  // the renderer puts around it. The PDF unwraps those wrappers, so a
  // Persian cover page that read right to left on screen printed left to
  // right — the trailing full stop jumping to the far side of the line.
  // The element itself carries the answer now, and the two views agree.
  const note = `<div class="cover">\n\n<div class="line">\nاین جزوه بر اساس مطالب تدریس‌شده در کلاس گردآوری شده است.\n</div>\n\n</div>\n`;
  await page.addInitScript(() => {
    window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; };
  });
  await boot(page, note);
  await expect(page.locator('#preview .line')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#preview .line')).toHaveCSS('direction', 'rtl');

  const printed = await page.evaluate(async (markdown) => {
    const { exportPdf } = await window.__satr.load('/src/exportPdf.ts');
    await exportPdf('Cover', markdown);
    return window.__printedHtml;
  }, note);
  await page.setContent(printed!);
  await expect(page.locator('.pagedjs_page .line')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.pagedjs_page .line')).toHaveCSS('direction', 'rtl');
});
