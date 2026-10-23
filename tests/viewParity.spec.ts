import { test, expect, type Page } from '@playwright/test';

/** Source mode and the reading view put a block in the same place: a list, a
 *  task and a quote start at the same x in both, at every level, and a row
 *  that wraps comes back to the same x too. The numbers themselves live in
 *  one place — LIST_GUTTER_CH / LIST_INDENT_EM / QUOTE_STEP_PX in
 *  src/livePreview.ts, the matching rules in src/style.css — and this spec is
 *  what holds the two views to them. */

const NOTE = `Paragraph before, long enough that it has to wrap onto a second row of its own.

- BULLETONE item written long enough that it has to wrap onto a second row of the pane
- BULLETTWO
  - NESTEDBULLET item written long enough that it has to wrap onto a second row of the pane

1. NUMBERONE item written long enough that it has to wrap onto a second row of the pane
2. NUMBERTWO

- [ ] TASKUNDONE item written long enough that it has to wrap onto a second row of the pane
- [x] TASKDONE item written long enough that it has to wrap onto a second row of the pane

> QUOTEONE line written long enough that it has to wrap onto a second row of the pane

> > NESTEDQUOTE line written long enough that it has to wrap onto a second row of the pane
`;

/** Every word measured, and what it is. */
const WORDS = ['BULLETONE', 'NESTEDBULLET', 'NUMBERONE', 'TASKUNDONE', 'TASKDONE', 'QUOTEONE', 'NESTEDQUOTE'] as const;
type Word = (typeof WORDS)[number];
type Spot = { row1: number; row2: number | null; rows: number };

async function boot(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/parity.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/parity.md', text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/parity.md' }], active: 0 }));
  }, NOTE);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('parity');
  // The start-up cover is a styled copy of the note: measuring while it is up
  // measures the copy, not the editor (src/snapshot.ts).
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.waitForTimeout(300);
}

/** Where each word starts in a pane, and where its wrapped row starts. */
function measure(page: Page, pane: string): Promise<Record<Word, Spot>> {
  return page.evaluate(({ pane, words }) => {
    const root = document.querySelector(pane) as HTMLElement;
    const base = root.getBoundingClientRect();
    const found: Record<string, Spot> = {};
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (const word of words) {
        const at = text.indexOf(word);
        if (at < 0 || found[word]) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, text.length);
        const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 1);
        if (!rects.length) continue;
        // One row can report more than one rect (a space hanging at the end
        // of a row is its own), so a row is a top, and where it starts is the
        // leftmost of the rects sitting on it.
        const byRow = new Map<number, number>();
        for (const rect of rects) {
          const top = Math.round(rect.top);
          byRow.set(top, Math.min(byRow.get(top) ?? Infinity, rect.left));
        }
        const starts = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, left]) => Math.round(left - base.left));
        found[word] = { row1: starts[0], row2: starts[1] ?? null, rows: starts.length };
      }
    }
    return found;
  }, { pane, words: WORDS as unknown as string[] }) as Promise<Record<Word, Spot>>;
}

test('a list, a task and a quote start at the same x in both views', async ({ page }) => {
  await boot(page);
  const editor = await measure(page, '#editor-pane .cm-content');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
  await page.waitForTimeout(600);
  const reading = await measure(page, '#preview-pane');

  for (const word of WORDS) {
    expect(editor[word], `${word} in source mode`).toBeTruthy();
    expect(reading[word], `${word} in the reading view`).toBeTruthy();
    // the first row starts in the same place...
    expect(Math.abs(editor[word].row1 - reading[word].row1), `${word}: x ${editor[word].row1} in source mode, ${reading[word].row1} in the reading view`).toBeLessThanOrEqual(1);
    // ...and so does the row it wraps onto
    expect(editor[word].rows, `${word} wraps in source mode`).toBeGreaterThan(1);
    expect(reading[word].rows, `${word} wraps in the reading view`).toBeGreaterThan(1);
    expect(Math.abs((editor[word].row2 ?? -1) - (reading[word].row2 ?? -2)), `${word}: wrapped row at ${editor[word].row2} in source mode, ${reading[word].row2} in the reading view`).toBeLessThanOrEqual(1);
  }
});

test('a task lines up with a bullet, and a level steps the same way in both views', async ({ page }) => {
  await boot(page);
  const editor = await measure(page, '#editor-pane .cm-content');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
  await page.waitForTimeout(600);
  const reading = await measure(page, '#preview-pane');

  for (const [view, spots] of [['source mode', editor], ['the reading view', reading]] as const) {
    // a checkbox hangs in the strip: its text starts where a bullet's does
    expect(Math.abs(spots.TASKUNDONE.row1 - spots.BULLETONE.row1), `task vs bullet in ${view}`).toBeLessThanOrEqual(1);
    expect(Math.abs(spots.TASKDONE.row1 - spots.BULLETONE.row1), `done task vs bullet in ${view}`).toBeLessThanOrEqual(1);
    // a number's text starts there too, whatever the number is
    expect(Math.abs(spots.NUMBERONE.row1 - spots.BULLETONE.row1), `number vs bullet in ${view}`).toBeLessThanOrEqual(1);
    // one level of nesting is one step, the same step in both views
    expect(spots.NESTEDBULLET.row1 - spots.BULLETONE.row1, `one list level in ${view}`).toBeGreaterThan(30);
    expect(spots.NESTEDQUOTE.row1 - spots.QUOTEONE.row1, `one quote level in ${view}`).toBeGreaterThan(20);
  }
  expect(editor.NESTEDBULLET.row1 - editor.BULLETONE.row1).toBe(reading.NESTEDBULLET.row1 - reading.BULLETONE.row1);
  expect(editor.NESTEDQUOTE.row1 - editor.QUOTEONE.row1).toBe(reading.NESTEDQUOTE.row1 - reading.QUOTEONE.row1);
});

/** The text of each measured word's row, up to where the row breaks. */
function firstRows(page: Page, pane: string): Promise<Record<Word, string>> {
  return page.evaluate(({ pane, words }) => {
    const root = document.querySelector(pane) as HTMLElement;
    const found: Record<string, string> = {};
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (const word of words) {
        const at = text.indexOf(word);
        if (at < 0 || found[word]) continue;
        const topOf = (i: number): number => {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          return Math.round(range.getBoundingClientRect().top);
        };
        const first = topOf(at);
        let fits = at;
        for (let i = at + 1; i < text.length; i += 1) {
          if (topOf(i) !== first) break;
          fits = i;
        }
        found[word] = text.slice(at, fits + 1).trimEnd();
      }
    }
    return found;
  }, { pane, words: WORDS as unknown as string[] }) as Promise<Record<Word, string>>;
}

test('a row breaks at the same word in both views', async ({ page }) => {
  // CodeMirror's wrapped mode asks for `white-space: break-spaces`, which
  // makes the space after the last word of a row have to fit on that row:
  // source mode dropped a word the reading view kept. style.css puts the
  // lines back on `pre-wrap`, where the space hangs as it does in HTML.
  await boot(page);
  const editor = await firstRows(page, '#editor-pane .cm-content');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
  await page.waitForTimeout(600);
  const reading = await firstRows(page, '#preview-pane');
  for (const word of WORDS) {
    expect(editor[word], `${word} breaks at the same word`).toBe(reading[word]);
  }
});
