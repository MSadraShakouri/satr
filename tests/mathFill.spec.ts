import { test, expect, type Page } from '@playwright/test';

// A note's words go up now; its formulas are drawn after, nearest the screen
// first.
//
// "Opening is slow for big files... do the current expected screen and then
// go upwards and downwards... but I still want the entire thing to load at
// the end." Measured on 128kB of his own notes, the reading view took
// 3317ms, of which nearly all was KaTeX drawing 5538 formulas before a
// single word could be seen.

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(120000);

/** A note long enough that its far end is nowhere near the screen. */
function longNote(sections: number): string {
  const out: string[] = ['# A long note\n'];
  for (let i = 1; i <= sections; i += 1) {
    out.push(`\n## Section ${i}\n`);
    out.push(`Some words before the formula of section ${i}, long enough to take a line or two of a phone's screen.\n`);
    out.push(`$$ \\frac{a_{${i}}}{b_{${i}}} = \\sum_{k=1}^{${i}} \\sqrt{k} $$\n`);
    out.push(`And an inline one, $x_{${i}}^2 + y_{${i}}^2$, in a sentence.\n`);
  }
  return out.join('');
}

async function boot(page: Page, note: string): Promise<void> {
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'long.md': 1 }, folders: [] }));
    localStorage.setItem('satr:fs:file:long.md', text as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'long.md' }], active: 0 }));
    localStorage.setItem('satr:demoShown', '1');
  }, note);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached', timeout: 60000 });
  await page.waitForTimeout(500);
}

/** Formulas still to be drawn. (A drawn one can be several .katex pieces:
 *  display math is laid out in units, so counting those counts pieces.) */
const waiting = (page: Page): Promise<number> => page.locator('#preview [data-satr-math]').count();
const drawn = async (page: Page): Promise<number> => 240 - (await waiting(page));

test('the words are all there before the formulas are', async ({ page }) => {
  await boot(page, longNote(120));
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview .md-section').first()).toBeVisible();

  // Every section, every heading, every word: the note is whole from the
  // first frame, which is what scrolling, folding and the outline read.
  expect(await page.locator('#preview .md-section').count(), 'all 121 sections are there').toBeGreaterThan(120);
  expect(await page.locator('#preview h2').count()).toBe(120);

  // What the first paint cost, from the log rather than from a race: this
  // note is small enough that the rest is finished a few frames later.
  const facts = await page.evaluate(async () => {
    const log = await (window as unknown as { __satr: { load(p: string): Promise<{ lines(): { text: string; facts?: Record<string, unknown> }[] }> } }).__satr.load('/src/log.ts');
    return log.lines().filter((l) => l.text === 'reading view built').pop()?.facts ?? null;
  });
  expect(facts, 'the line is there').not.toBeNull();
  expect(facts!.formulas, 'the note has 240 formulas').toBe(240);
  expect(Number(facts!.waiting), 'and most were still to be drawn when the words went up').toBeGreaterThan(100);
  expect(await page.locator('#preview .katex').count(), 'what is drawn is real KaTeX').toBeGreaterThan(0);
});

test('nothing on screen is ever a placeholder', async ({ page }) => {
  await boot(page, longNote(120));
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview .md-section').first()).toBeVisible();
  // The band drawn before the first paint reaches past the bottom of the
  // screen, so a formula is never seen arriving late where the reader is
  // looking.
  const onGlass = await page.evaluate(() => {
    const pane = document.querySelector('#preview-pane')!.getBoundingClientRect();
    return [...document.querySelectorAll('#preview [data-satr-math]')]
      .filter((el) => { const box = el.getBoundingClientRect(); return box.bottom > pane.top && box.top < pane.bottom; })
      .length;
  });
  expect(onGlass, 'no undrawn formula is on the screen').toBe(0);
});

test('scrolling draws ahead of the reader', async ({ page }) => {
  await boot(page, longNote(120));
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview .md-section').first()).toBeVisible();
  const atFirst = await drawn(page);

  await page.evaluate(() => { document.querySelector('#preview-pane')!.scrollTop = 4000; });
  await page.waitForTimeout(400);
  expect(await drawn(page), 'the formulas where the reader now is were drawn for them').toBeGreaterThan(atFirst);
  const onGlass = await page.evaluate(() => {
    const pane = document.querySelector('#preview-pane')!.getBoundingClientRect();
    return [...document.querySelectorAll('#preview [data-satr-math]')]
      .filter((el) => { const box = el.getBoundingClientRect(); return box.bottom > pane.top && box.top < pane.bottom; })
      .length;
  });
  expect(onGlass, 'and the new screen has no placeholders on it either').toBe(0);
});

test('the whole note is drawn in the end', async ({ page }) => {
  await boot(page, longNote(120));
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview .md-section').first()).toBeVisible();
  // "I still want the entire thing to load at the end": left alone, with
  // nobody scrolling, it finishes the note by itself.
  await expect.poll(() => waiting(page), { timeout: 30000, message: 'every placeholder is eventually drawn' }).toBe(0);
  expect(await page.locator('#preview .math-display').count(), 'all 120 display formulas, drawn').toBe(120);
});
