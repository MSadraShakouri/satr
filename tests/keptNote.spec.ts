import { test, expect, type Page } from '@playwright/test';

// The note you came from.
//
// Switching away threw the reading view away and switching back built the
// whole thing again -- markdown, html, layout, and every formula near the
// screen -- to arrive at a note that had not changed a character. On 130kB
// of his notes that was 711ms, and the formulas had to be drawn again.
//
// Now the built view goes with the tab, and comes back whole: same path,
// same text (by length and hash), same pixel. 197ms, with every formula
// already on it.

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(120000);

function longNote(sections: number): string {
  const out: string[] = ['# Term notes\n'];
  for (let i = 1; i <= sections; i += 1) {
    out.push(`\n## Section ${i}\n`);
    out.push(`Words for section ${i}, enough of them to take a line or two of a phone's screen and give the note a length worth scrolling.\n`);
    out.push(`An inline formula $x_{${i}}^2 + y_{${i}}^2$ in a sentence.\n`);
    out.push('\n$$\n');
    out.push(`\\frac{a_{${i}}}{b_{${i}}} = \\sum_{k=1}^{${i}} \\sqrt{k}\n`);
    out.push('$$\n');
  }
  return out.join('');
}

interface Line { area: string; text: string; ms?: number; facts?: Record<string, string | number | boolean> }
const logLines = (page: Page): Promise<Line[]> => page.evaluate(() =>
  JSON.parse(JSON.stringify((window as never as { __satr: { load(m: string): { lines(): Line[] } } }).__satr.load('/src/log.ts').lines())) as Line[]);

async function boot(page: Page, notes = 2): Promise<void> {
  const paths = Array.from({ length: notes }, (_, i) => `term${i + 1}.md`);
  await page.addInitScript(([list, note]) => {
    const files: Record<string, number> = {};
    (list as string[]).forEach((path) => {
      files[path] = 1;
      localStorage.setItem(`satr:fs:file:${path}`, `# ${path}\n${note as string}`);
    });
    localStorage.setItem('satr:fs:index', JSON.stringify({ files, folders: [] }));
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: (list as string[]).map((path) => ({ path })), active: 0 }));
    localStorage.setItem('satr:demoShown', '1');
  }, [paths, longNote(90)] as [string[], string]);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/, { timeout: 30000 });
  await page.waitForTimeout(800);
}

/** Into the reading view, and wait for every formula to be drawn. */
async function readIt(page: Page): Promise<void> {
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview .md-section').first()).toBeVisible({ timeout: 30000 });
  await expect.poll(() => page.locator('#preview [data-satr-math]').count(), { timeout: 30000 }).toBe(0);
}

/** The phone's way between tabs: the switcher, then the other tab's card. */
async function switchTo(page: Page, nth: number): Promise<void> {
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(1);
  await page.locator('.mobile-tab-card, .mobile-tab-title').nth(nth).click();
  await page.waitForTimeout(1200);
}

test('the note comes back as it was left, without being built again', async ({ page }) => {
  await boot(page);
  await readIt(page);
  const formulas = await page.locator('#preview .math-display').count();
  expect(formulas).toBe(90);
  await page.evaluate(() => { (document.querySelector('#preview-pane') as HTMLElement).scrollTop = 6000; });
  await page.waitForTimeout(600);
  const left = await page.evaluate(() => (document.querySelector('#preview-pane') as HTMLElement).scrollTop);
  const length = await page.evaluate(() => (document.querySelector('#preview') as HTMLElement).scrollHeight);

  await switchTo(page, 1);
  await switchTo(page, 0);
  await expect(page.locator('#preview .md-section').first()).toBeVisible({ timeout: 30000 });

  const lines = await logLines(page);
  const last = lines.filter((l) => l.text === 'reading view kept' || l.text === 'reading view built').pop();
  expect(last?.text, 'the view came back rather than being built').toBe('reading view kept');
  expect(last?.facts?.waiting, 'and nothing was left to draw').toBe(0);
  // Every formula is still drawn, and the reader is where they were.
  expect(await page.locator('#preview .math-display').count()).toBe(formulas);
  expect(await page.locator('#preview [data-satr-math]').count()).toBe(0);
  const back = await page.evaluate(() => (document.querySelector('#preview-pane') as HTMLElement).scrollTop);
  expect(Math.abs(back - left), `left at ${left}, came back to ${back}`).toBeLessThan(60);
  // And it is the same note: the heights a note was last drawn at are the
  // browser's memory of where it put them, which a note taken off the page
  // loses -- they are written down on the way out and must not be stamped
  // over by anybody's estimate on the way back in. On 130kB of his notes
  // the difference was a note 171166px long coming back 115646px long.
  const again = await page.evaluate(() => (document.querySelector('#preview') as HTMLElement).scrollHeight);
  expect(Math.abs(again - length) / length, `${length}px long, came back ${again}px`).toBeLessThan(0.02);
});

test('a note edited since its view was built is built again', async ({ page }) => {
  await boot(page);
  await readIt(page);
  // Type into it without going back to the reading view, then leave: what
  // is on the pile is a view of the text as it was, not as it is.
  await page.locator('#preview-toggle').click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('a new first word ');
  await page.waitForTimeout(500);
  await switchTo(page, 1);
  await switchTo(page, 0);
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview .md-section').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(600);
  const lines = await logLines(page);
  const last = lines.filter((l) => l.text === 'reading view kept' || l.text === 'reading view built').pop();
  expect(last?.text, 'a stale view is not handed back').toBe('reading view built');
  await expect(page.locator('#preview')).toContainText('a new first word');
});

test('the pile holds the two newest notes and no more', async ({ page }) => {
  await boot(page, 3);
  const views = async (): Promise<string[]> => (await logLines(page))
    .filter((l) => l.text === 'reading view kept' || l.text === 'reading view built')
    .map((l) => `${l.text} ${l.facts?.path ?? ''}`.trim());

  await readIt(page);            // term1 read, then left: the pile is [1]
  await switchTo(page, 1);
  await readIt(page);            // term2 read, then left: [2, 1]
  await switchTo(page, 2);
  await readIt(page);            // term3 read, then left: [3, 2] -- 1 is out
  await switchTo(page, 0);
  await expect(page.locator('#preview .md-section').first()).toBeVisible({ timeout: 30000 });
  const afterOldest = await views();
  expect(afterOldest[afterOldest.length - 1], 'the oldest note fell off the pile').toContain('reading view built');

  await switchTo(page, 2);       // term3 is still on it
  await expect(page.locator('#preview .md-section').first()).toBeVisible({ timeout: 30000 });
  const afterNewest = await views();
  expect(afterNewest[afterNewest.length - 1], 'the newest note was still there').toContain('reading view kept');
});
