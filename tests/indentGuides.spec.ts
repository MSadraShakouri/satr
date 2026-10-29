import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

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

test('the markers are in the same columns when the block is read', async ({ page }) => {
  // The reading view draws them from the same two functions the editor draws
  // them from (indentStep + indentGroups), so the block keeps its shape when
  // the note is read rather than written.
  await boot(page, 'note.md', NOTE);
  const source = await page.evaluate(() => [...document.querySelectorAll('#app .cm-content .cm-line')]
    .filter((line) => line.querySelector('.cm-indent'))
    .map((line) => {
      // A code line in a note is padded to look like a block, so its text
      // begins inside its own box; the reading view's <pre> pads the same
      // way. Both are measured from where the code itself starts.
      const origin = line.getBoundingClientRect().left + parseFloat(getComputedStyle(line).paddingInlineStart);
      return [...line.querySelectorAll('.cm-indent')]
        .map((guide) => Math.round(guide.getBoundingClientRect().left - origin));
    }));
  expect(source).toEqual([[0], [0, 14], [0, 14, 28], [0, 14], [0]]);
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane pre code')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const code = document.querySelector('#preview-pane pre code') as HTMLElement;
    const origin = code.getBoundingClientRect().left;
    const rows = new Map<number, number[]>();
    for (const guide of [...code.querySelectorAll('.indent')] as HTMLElement[]) {
      const box = guide.getBoundingClientRect();
      const row = Math.round(box.top);
      rows.set(row, [...(rows.get(row) ?? []), Math.round(box.left - origin)]);
    }
    return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, columns]) => columns);
  })).toEqual(source);
});

test('a note with no code has no markers at all', async ({ page }) => {
  await boot(page, 'plain.md', '# سلام\n\n    چهار فاصله\n\nمتن.\n');
  expect((await guidesPerLine(page)).every((n) => n === 0)).toBe(true);
});

// A phone's screen is rarely a whole number of device pixels per CSS pixel
// (2.625 and 2.75 are the common ones). A border is painted at its true
// fractional width and a gradient's band is snapped out to whole pixels, so
// the two kinds of marker can come out different weights on the same screen
// even though both are declared 1px. The editor's band is tuned to the
// border; this holds it there.
test.describe('on a screen whose pixels are not whole', () => {
  test.use({ deviceScaleFactor: 2.75, viewport: { width: 390, height: 800 } });

  const LIST = `- one
  - two
    - three
`;
  /**
   * How many device pixels each marker in one 90px strip is painted across.
   *
   * A marker is a thin line of its own colour standing in open background;
   * a letter's edge is the same grey but has the letter's own dark pixels
   * beside it, so runs that touch anything dark are not markers.
   */
  const markerWidths = async (page: Page, y: number, from: number): Promise<number[]> => {
    const dpr = 2.75;
    const shot = await page.screenshot();
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    const row = Math.round(y * dpr);
    const grey = (x: number): number => {
      const i = (row * info.width + x) * info.channels;
      return (data[i] + data[i + 1] + data[i + 2]) / 3;
    };
    const widths: number[] = [];
    let run: number[] = [];
    for (let x = Math.round(from * dpr); x < Math.round((from + 90) * dpr); x += 1) {
      const here = grey(x);
      if (here < 248) { run.push(here); continue; }
      const marker = run.length > 0 && run.length <= 4 && Math.min(...run) > 200;
      if (marker) widths.push(run.filter((g) => Math.abs(g - 224) <= 2).length);
      run = [];
    }
    return widths;
  };

  test('the marker beside a list is the same line in both views', async ({ page }) => {
    await boot(page, 'list.md', LIST);
    // the strip between where the line box starts and where its text does,
    // which is where both markers for that item are drawn
    const inSource = await page.evaluate(() => {
      const line = [...document.querySelectorAll('.cm-content .cm-line')].find((l) => l.textContent?.includes('three'))!;
      const box = line.getBoundingClientRect();
      return { y: box.top + box.height / 2, from: box.left + 2 };
    });
    const source = await markerWidths(page, inSource.y, inSource.from);
    await page.locator('#preview-toggle').click();
    await expect(page.locator('#preview-pane li')).not.toHaveCount(0);
    const inRead = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#preview-pane li')]
        .filter((li) => li.textContent?.includes('three') && !li.querySelector('li'));
      const box = items[items.length - 1].getBoundingClientRect();
      return { y: box.top + box.height / 2, from: box.left - 92 };
    });
    const read = await markerWidths(page, inRead.y, inRead.from);
    // two markers on that row in either view, each the same line as the other
    expect(read).toHaveLength(2);
    expect(source).toEqual(read);
  });
});
