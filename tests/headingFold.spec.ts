import { expect, test, type Page } from '@playwright/test';

// Folding a heading, and the reader's place while it happens. The report:
// "title collapse and opens has an issue, if at the end of a page and opening
// the title, it brings you to the end of the page." A fold takes height out of
// the page; at the foot of a note the height used to be taken from the
// reader's place — the scroll had nothing below it to give, so the browser
// clamped it and every line slid down. Opening a section was worse: CodeMirror
// pins the view to the document's foot whenever the height changes while the
// reader stands at the bottom, so opening the last title ran them to the new
// end of the page. Both are measured here, in both views, by where the reader
// is looking — the line at the top of the pane and the heading under the
// finger — and not by a scroll number alone.
async function boot(page: Page, files: Record<string, string>, active: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ files, active }) => {
    const folders = new Set<string>();
    for (const path of Object.keys(files)) {
      const parts = path.split('/');
      parts.pop();
      parts.forEach((_, i) => folders.add(parts.slice(0, i + 1).join('/')));
    }
    const index = { files: {} as Record<string, number>, folders: [...folders] };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: active }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, { files, active });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

const para = (n: number) => Array.from({ length: n }, (_, i) => `پاراگراف ${i} با چند کلمه تا آخر صفحه برسد و بلند باشد.`).join('\n\n');
// The note ends with a heading whose section is shorter than the screen, so at
// the foot of the note the heading itself is under the finger.
const NOTE = `# یک\n\n${para(10)}\n\n## دو\n\n${para(14)}\n\n### آخر\n\n${para(2)}\n`;

interface Place { top: number; max: number; slack: string; heading: string | null; headingTop: number | null; watch: string | null }

const editorPlace = (page: Page) => page.evaluate((): Place => {
  const scroller = document.querySelector('#app .cm-scroller') as HTMLElement;
  const content = document.querySelector('#app .cm-content') as HTMLElement;
  const lines = [...document.querySelectorAll('#app .cm-line')] as HTMLElement[];
  const first = lines.find((el) => el.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top + 1);
  const heads = [...document.querySelectorAll('#app .cm-line.cm-heading-fold')] as HTMLElement[];
  const last = heads[heads.length - 1];
  return {
    top: Math.round(scroller.scrollTop),
    max: Math.round(scroller.scrollHeight - scroller.clientHeight),
    slack: content.style.getPropertyValue('--fold-slack'),
    heading: last ? (last.textContent ?? '').slice(0, 6) : null,
    headingTop: last ? Math.round(last.getBoundingClientRect().top) : null,
    watch: first ? `${(first.textContent ?? '').slice(0, 10)}@${Math.round(first.getBoundingClientRect().top)}` : null,
  };
});

const previewPlace = (page: Page) => page.evaluate((): Place => {
  const pane = document.querySelector('#app .preview-pane') as HTMLElement;
  const article = document.querySelector('#app #preview') as HTMLElement;
  const blocks = [...document.querySelectorAll('#app .preview-pane .md-section > *')] as HTMLElement[];
  const first = blocks.find((el) => el.getBoundingClientRect().bottom > pane.getBoundingClientRect().top + 1);
  const heads = [...document.querySelectorAll('#app .preview-pane .md-section > .has-fold')] as HTMLElement[];
  const last = heads[heads.length - 1];
  return {
    top: Math.round(pane.scrollTop),
    max: Math.round(pane.scrollHeight - pane.clientHeight),
    slack: article.style.getPropertyValue('--fold-slack'),
    heading: last ? (last.textContent ?? '').slice(0, 6) : null,
    headingTop: last ? Math.round(last.getBoundingClientRect().top) : null,
    watch: first ? `${(first.textContent ?? '').slice(0, 10)}@${Math.round(first.getBoundingClientRect().top)}` : null,
  };
});

/** The pane `watch`es the same line, in the same place: the reader is looking
 *  at what they were looking at. */
function samePlace(before: Place, after: Place, where: string) {
  expect(after.watch, `${where}: the top of the pane`).toBe(before.watch);
  // The same heading, in the same place — its text grows the fold's "…".
  expect(after.heading?.replace('…', ''), `${where}: the heading under the finger`).toBe(before.heading?.replace('…', ''));
  expect(after.headingTop, `${where}: where the heading sits (was ${before.headingTop})`).toBe(before.headingTop);
  expect(Math.abs(after.top - before.top), `${where}: the scroll (${before.top} → ${after.top})`).toBeLessThan(3);
}

async function wheelToFoot(page: Page, scroller: string) {
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, 6000);
  await page.waitForTimeout(700);
  expect(await page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  }, scroller), 'the pane is at the foot of the note').toBe(true);
}

const chevronBox = async (page: Page, selector: string) => {
  const heads = page.locator(selector);
  return (await heads.nth((await heads.count()) - 1).boundingBox())!;
};

test('the reader keeps their place when a section is folded and opened at the foot of a note', async ({ page }) => {
  await boot(page, { 'Notes/L.md': NOTE }, 'Notes/L.md');
  await wheelToFoot(page, '#app .cm-scroller');
  const before = await editorPlace(page);
  expect(before.slack, 'nothing has borrowed room yet').toBe('');

  const box = await chevronBox(page, '#app .cm-line.cm-heading-fold');
  await page.mouse.click(box.x + 16, box.y + 16);
  await page.waitForTimeout(600);
  const folded = await editorPlace(page);
  expect(before.heading).toContain('آخر');
  expect(folded.heading, 'the chevron is still there, now folded').toContain('آخر…');
  samePlace(before, folded, 'folding the last title');
  // The height the fold took is lent back to the page, and only that much: it
  // is what lets the reader's place be kept at all (src/foldSlack.ts).
  expect(parseFloat(folded.slack), 'the room the fold took').toBeGreaterThan(100);

  const box2 = await chevronBox(page, '#app .cm-line.cm-heading-fold');
  await page.mouse.click(box2.x + 16, box2.y + 16);
  await page.waitForTimeout(600);
  const opened = await editorPlace(page);
  expect(opened.heading).not.toContain('…');
  samePlace(before, opened, 'opening the last title again');
  expect(opened.slack, 'the room is given back once the section fills it').toBe('');
  // And the note is whole again: the last line is reachable at the foot.
  expect(opened.max).toBe(before.max);
});

test('the room lent to a fold is given back as soon as the reader scrolls clear of it', async ({ page }) => {
  await boot(page, { 'Notes/L.md': NOTE }, 'Notes/L.md');
  await wheelToFoot(page, '#app .cm-scroller');
  const box = await chevronBox(page, '#app .cm-line.cm-heading-fold');
  await page.mouse.click(box.x + 16, box.y + 16);
  await page.waitForTimeout(500);
  const folded = await editorPlace(page);
  expect(parseFloat(folded.slack)).toBeGreaterThan(100);

  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(500);
  const back = await editorPlace(page);
  expect(back.slack, 'the reader is clear of the room').toBe('');
  expect(back.watch, 'the scroll they asked for is the one they got').not.toBe(folded.watch);
  expect(back.top).toBeLessThan(folded.top - 300);
});

test('a fold away from the foot leaves the page alone', async ({ page }) => {
  await boot(page, { 'Notes/L.md': NOTE }, 'Notes/L.md');
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, 900); // the first heading is on screen, nothing at the foot
  await page.waitForTimeout(500);
  const before = await editorPlace(page);
  const head = page.locator('#app .cm-line.cm-heading-fold').first();
  const box = (await head.boundingBox())!;
  await page.mouse.click(box.x + 16, box.y + 16);
  await page.waitForTimeout(500);
  const after = await editorPlace(page);
  samePlace(before, after, 'folding a section in the middle of the note');
  expect(after.slack, 'no room was needed').toBe('');
});

test('the reading view keeps the reader’s place across the same fold and open', async ({ page }) => {
  await boot(page, { 'Notes/L.md': NOTE }, 'Notes/L.md');
  await page.locator('#preview-toggle').click();
  await page.waitForTimeout(700);
  await wheelToFoot(page, '#app .preview-pane');
  const before = await previewPlace(page);
  expect(before.slack).toBe('');

  const box = await chevronBox(page, '#app .preview-pane .md-section > .has-fold');
  await page.mouse.click(box.x + 16, box.y + 12);
  await page.waitForTimeout(600);
  const folded = await previewPlace(page);
  samePlace(before, folded, 'folding the last title in the reading view');
  expect(parseFloat(folded.slack), 'the room the fold took').toBeGreaterThan(0);

  const box2 = await chevronBox(page, '#app .preview-pane .md-section > .has-fold');
  await page.mouse.click(box2.x + 16, box2.y + 12);
  await page.waitForTimeout(600);
  const opened = await previewPlace(page);
  samePlace(before, opened, 'opening the last title again in the reading view');
  expect(opened.slack, 'the room is given back').toBe('');
});
