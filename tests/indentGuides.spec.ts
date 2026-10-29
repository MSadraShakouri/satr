import { test, expect, type Page } from '@playwright/test';

// A faint line at each level of indentation, inside code and nowhere else.
// Obsidian's rule — a tab or a full group of spaces is one level — with the
// group taken from the file's own indentation, so fours and twos both get
// one marker per level instead of one being halved and the other doubled.

const PY = `def outer():
    if True:
        for i in range(3):
            print(i)
    return 1
`;
const NOTE = `# یادداشت

- یک
  - دو
    - سه

\`\`\`js
function a() {
  if (x) {
    return [
      1,
    ];
  }
}
\`\`\`

متن.
`;

async function boot(page: Page, name: string, body: string): Promise<void> {
  await page.addInitScript(([file, text]) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { [`Notes/${file}`]: 1 }, folders: ['Notes'] }));
    localStorage.setItem(`satr:fs:file:Notes/${file}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: `Notes/${file}` }], active: 0 }));
  }, [name, body]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('.cm-content')).toBeVisible();
}

const guidesPerLine = (page: Page): Promise<number[]> => page.evaluate(() => [...document.querySelectorAll('.cm-line')]
  .map((line) => line.querySelectorAll('.cm-indent').length));

test('a file indented in fours gets one marker a level', async ({ page }) => {
  await boot(page, 'deep.py', PY);
  await expect.poll(() => guidesPerLine(page)).toEqual([0, 1, 2, 3, 1, 0]);
});

test('in a note the markers are the fence’s, and the list keeps its own look', async ({ page }) => {
  await boot(page, 'note.md', NOTE);
  const perLine = await guidesPerLine(page);
  // the fence, indented in twos: one marker a level all the way down and back
  expect(perLine.slice(7, 14)).toEqual([0, 1, 2, 3, 2, 1, 0]);
  // the heading, the three list items and the prose: none
  expect([perLine[0], perLine[2], perLine[3], perLine[4], perLine.at(-2)]).toEqual([0, 0, 0, 0, 0]);
});

test('a note with no code has no markers at all', async ({ page }) => {
  await boot(page, 'plain.md', '# سلام\n\n    چهار فاصله\n\nمتن.\n');
  expect((await guidesPerLine(page)).every((n) => n === 0)).toBe(true);
});
