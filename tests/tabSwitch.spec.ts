import { expect, test, type Page } from '@playwright/test';
import type { EditorView } from '@codemirror/view';

declare global { interface Window { appView: EditorView } }

// Two notes in two tabs, costing very different amounts per source line: a
// list of long items wraps to about 120px a line on a phone, short
// paragraphs to about 49px. A reader who is two thirds down the long one,
// switches to the other note and comes back, has to come back to the line
// they were on — not to the end of the note, which is where they went when
// the second note's figure was used to guess the first one's length.

const LONG = [
  '## main',
  '',
  ...Array.from({ length: 40 }, (_, i) =>
    `- [ ] item ${i + 1}: a line of the kind this list is made of, long enough to wrap four or five times on a phone, with a parenthetical aside at the end of it (needs testing, and a note about what was tried before)`),
  '',
  '## claimed fixes, needs testing',
  '',
  ...Array.from({ length: 4 }, (_, i) => `- [ ] claimed ${i + 1}: another long line, of the same kind as the ones above it, wrapping several times over`),
  '',
  '## deferred for later',
  '',
  ...Array.from({ length: 8 }, (_, i) => `- [ ] deferred ${i + 1}: and these too are long lines that wrap, because that is what this note is made of`),
  '',
].join('\n');
const SHORT = Array.from({ length: 120 }, (_, i) => `## بخش ${i + 1}\n\nیک پاراگراف کوتاه.\n`).join('\n');
/** Inside the first list, two thirds of the way down the long note. */
const TARGET = 33;

async function boot(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ long, short }) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/B.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', long as string);
    localStorage.setItem('satr:fs:file:Notes/B.md', short as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }], active: 0 }));
    localStorage.setItem('satr:view:Notes/A.md', JSON.stringify({ mode: 'preview', line: 0 }));
    localStorage.setItem('satr:view:Notes/B.md', JSON.stringify({ mode: 'preview', line: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, { long: LONG, short: SHORT });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await page.evaluate(() => document.getElementById('boot-snapshot')?.remove());
  await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    window.appView = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    await document.fonts.ready;
  });
  await page.waitForTimeout(600);
}

async function switchTo(page: Page, name: string, settle = 900): Promise<void> {
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await page.locator('.mobile-tab-title').getByText(name, { exact: true }).click();
  await expect(page.locator('#app .cm-file-name')).toHaveText(name);
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
  await page.waitForTimeout(settle);
}

/** The reader's own flick, to the section written on this source line. */
async function readerTo(page: Page, line: number): Promise<void> {
  await page.evaluate((line) => {
    const pane = document.querySelector<HTMLElement>('.preview-pane')!;
    pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); // a reader at the wheel ends any hold
    const el = document.querySelector<HTMLElement>(`#preview [data-line="${line}"]`);
    if (!el) throw new Error(`no anchor for line ${line}`);
    pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top - 120;
  }, line);
  await page.waitForTimeout(700);
}

/** Where the reader is, and whether the pane has run out of note. */
const where = (page: Page) => page.evaluate(async () => {
  const { previewScroll, typingTop } = await window.__satr.load('/src/scrollSync.ts');
  const pane = document.querySelector<HTMLElement>('.preview-pane')!;
  const band = pane.getBoundingClientRect().top + 120;
  let at = '';
  for (const el of document.querySelectorAll<HTMLElement>('#preview [data-line]')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.bottom > band) { at = (el.textContent ?? '').trim().slice(0, 24); break; }
  }
  const max = pane.scrollHeight - pane.clientHeight;
  return {
    line: previewScroll(pane, document.querySelector('#preview')!, typingTop(window.appView)) ?? -1,
    top: pane.scrollTop, max, bottom: pane.scrollTop >= max - 4, at,
    saved: JSON.parse(localStorage.getItem('satr:view:Notes/A.md') ?? 'null') as { line: number } | null,
  };
});

test('a note comes back to the line it was left on, not to the end of itself', async ({ page }) => {
  await boot(page);
  await readerTo(page, TARGET);
  const before = await where(page);
  expect(before.line, JSON.stringify(before)).toBeCloseTo(TARGET, 0);

  await switchTo(page, 'B');
  await readerTo(page, 200); // the other note is read too, well down
  await switchTo(page, 'A');

  const after = await where(page);
  // It used to land here: the note was measured in the other note's lines,
  // came out 3990px tall against a real 9775px, and the reader — sent to a
  // line two thirds down — was clamped to the end of it and pinned there as
  // it grew back to its real length.
  expect(after.bottom, JSON.stringify(after)).toBe(false);
  expect(Math.abs(after.line - TARGET), JSON.stringify(after)).toBeLessThan(1.2);
  // And the misreading is not written down as the place the note was left
  // at, where it would outlive the app.
  expect(Math.abs((after.saved?.line ?? -1) - TARGET), JSON.stringify(after)).toBeLessThan(1.2);
});

test('switching away and back twice, with no time to settle in between', async ({ page }) => {
  await boot(page);
  await readerTo(page, TARGET);
  for (const name of ['B', 'A', 'B', 'A']) await switchTo(page, name, 60);
  await page.waitForTimeout(1500);
  const after = await where(page);
  expect(after.bottom, JSON.stringify(after)).toBe(false);
  expect(Math.abs(after.line - TARGET), JSON.stringify(after)).toBeLessThan(1.2);
});

test('the place is held while the note settles, and let go the moment the reader scrolls', async ({ page }) => {
  await boot(page);
  await readerTo(page, TARGET);
  await switchTo(page, 'B');
  // Back to A, and the reader takes over before the note has finished
  // arriving: the hold now survives the page changing length under it, so
  // what it must not do is survive the reader.
  await switchTo(page, 'A', 120);
  const chosen = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.preview-pane')!;
    pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    pane.scrollTop = Math.max(0, pane.scrollTop - 1200); // a flick back up the note
    return pane.scrollTop;
  });
  await page.waitForTimeout(1800);
  const after = await where(page);
  expect(Math.abs(after.top - chosen), JSON.stringify({ chosen, ...after })).toBeLessThan(60);
});
