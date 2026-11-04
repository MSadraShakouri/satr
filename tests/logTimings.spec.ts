import { expect, test, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// The five things the author has called slow, each one measured where it
// happens: launch, opening a file, opening a document, switching tabs, and
// the source-to-preview switch.
//
// These tests do not say anything is fast. They say the number is there, that
// it is attached to the thing it measured, and that it is of the right order
// against a clock Playwright kept itself -- because the whole point is to
// stop guessing where the time goes, and a stopwatch nobody checked is just
// another guess.

interface Line { at: number; area: string; kind: string; text: string; facts?: Record<string, number | string | boolean>; ms?: number }

declare global {
  interface Window { __satr: { load(path: string): { lines(): Line[]; setDetail(v: string): void; forget(): void } } }
}

const NOTE = `# A note\n\n${'words and more words. '.repeat(400)}\n`;

async function boot(page: Page, files: Record<string, string>, first: string): Promise<void> {
  await page.addInitScript(([seed, open]) => {
    const vault = seed as Record<string, string>;
    const names = Object.keys(vault);
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: Object.fromEntries(names.map((name) => [`Notes/${name}`, 1])),
      folders: ['Notes'],
    }));
    for (const name of names) localStorage.setItem(`satr:fs:file:Notes/${name}`, vault[name]);
    if (!localStorage.getItem('satr:tabs')) {
      localStorage.setItem('satr:tabs', JSON.stringify({
        tabs: names.map((name) => ({ path: `Notes/${name}` })),
        active: names.indexOf(open as string),
      }));
    }
  }, [files, first] as [Record<string, string>, string]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

const read = (page: Page): Promise<Line[]> => page.evaluate(() => window.__satr.load('/src/log.ts').lines());
const find = (lines: Line[], area: string, text: string): Line | undefined => lines.find((l) => l.area === area && l.text === text);

test('a launch says where its time went, from zero', async ({ page }) => {
  const began = Date.now();
  await boot(page, { 'A.md': NOTE }, 'A.md');
  const wall = Date.now() - began;
  const lines = await read(page);

  const cold = find(lines, 'launch', 'cold start');
  const places = find(lines, 'launch', 'reading places read');
  const first = find(lines, 'launch', 'first file on screen');
  const ready = find(lines, 'launch', 'ready to read');
  expect(cold, 'the launch is in the log').toBeTruthy();
  expect(places?.ms, 'the view store read is timed').toBeGreaterThanOrEqual(0);
  expect(first?.ms, 'the first file is timed').toBeGreaterThanOrEqual(0);
  expect(ready?.ms, 'and so is the whole of it').toBeGreaterThanOrEqual(0);

  // In order, and the whole is at least the sum of the parts it contains.
  expect(cold!.at).toBeLessThanOrEqual(places!.at);
  expect(places!.at).toBeLessThanOrEqual(first!.at);
  expect(first!.at).toBeLessThanOrEqual(ready!.at);
  expect(ready!.ms!).toBeGreaterThanOrEqual(places!.ms! + first!.ms! - 1);
  // And against a clock this test kept itself, rather than only against
  // itself: the app cannot claim a launch longer than the page took to open.
  expect(ready!.ms!).toBeLessThan(wall + 1000);
  // The clock on a line is time since the page began loading, so the very
  // first line is near the start rather than near zero-of-its-own.
  expect(cold!.at).toBeLessThan(wall + 1000);
});

test('opening a note says how many bytes it was and what the read cost', async ({ page }) => {
  await boot(page, { 'A.md': NOTE }, 'A.md');
  const line = find(await read(page), 'file', 'read');
  expect(line, 'the read is in the log').toBeTruthy();
  expect(line!.facts?.path).toBe('Notes/A.md');
  expect(line!.facts?.bytes, 'carrying the size of the thing read').toBe(NOTE.length);
  expect(line!.ms).toBeGreaterThanOrEqual(0);
});

test('the source to preview switch is one measurement, and it holds the build inside it', async ({ page }) => {
  await boot(page, { 'A.md': NOTE }, 'A.md');
  await page.evaluate(() => window.__satr.load('/src/log.ts').forget());
  await page.locator('#preview-toggle').dispatchEvent('click');
  await expect(page.locator('#preview-pane')).toBeVisible();

  const lines = await read(page);
  const switched = find(lines, 'tabs', 'edit to preview');
  const built = find(lines, 'file', 'reading view built');
  expect(switched, 'the switch the author calls slow is measured').toBeTruthy();
  expect(built, 'and so is the reading view it has to build').toBeTruthy();
  expect(built!.facts?.chars, 'which says how much there was to build').toBe(NOTE.length);
  // The build happens inside the switch, so the switch cannot be the shorter
  // of the two -- that is what makes this one number and not two guesses.
  expect(switched!.ms!).toBeGreaterThanOrEqual(built!.ms!);
});

test('a tab switch is measured, and says which tab it went to', async ({ page }) => {
  await boot(page, { 'A.md': NOTE, 'B.md': '# B\n\nshort\n' }, 'A.md');
  await page.evaluate(() => window.__satr.load('/src/log.ts').forget());
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await page.locator('.mobile-tab-title').getByText('B', { exact: true }).click();
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);

  const lines = await read(page);
  const switched = find(lines, 'tabs', 'switch');
  expect(switched, 'the switch is in the log').toBeTruthy();
  expect(switched!.facts?.to).toBe('B.md');
  expect(switched!.ms).toBeGreaterThanOrEqual(0);
  // The read it had to do is inside it, and is its own line.
  const readLine = lines.filter((l) => l.area === 'file' && l.text === 'read').pop();
  expect(readLine!.facts?.path).toBe('Notes/B.md');
});

test('opening a document separates the engine coming up from the file being parsed', async ({ page }) => {
  await boot(page, { 'handout.pdf': tinyPdf(6) }, 'handout.pdf');
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });

  const lines = await read(page);
  const bytes = find(lines, 'pdf', 'bytes read');
  const engine = find(lines, 'pdf', 'engine ready');
  const parsed = find(lines, 'pdf', 'document parsed');

  expect(bytes, 'the bytes are read, and that is timed').toBeTruthy();
  expect(Number(bytes!.facts?.bytes)).toBeGreaterThan(400);
  // The two halves of "pdf opening is very slow" are told apart: the wasm
  // engine is paid for once a run, the document every single open.
  expect(engine, 'the engine coming up is its own line').toBeTruthy();
  expect(parsed, 'and the document being parsed is another').toBeTruthy();
  expect(parsed!.facts?.pages).toBe(6);
  expect(parsed!.ms).toBeGreaterThanOrEqual(0);
  expect(bytes!.at).toBeLessThanOrEqual(parsed!.at);
});
