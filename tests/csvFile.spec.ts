// A .csv read as a table, and edited as the characters it is.
//
// Asked for: "add csv support too like Markor". Markor converts the file to a
// Markdown table and renders that (format/csv/CsvTextConverter.java), so a
// cell can hold Markdown; its editor colours the columns
// (CsvSyntaxHighlighter) and its preview does not. Same here, with the
// editor's own code palette doing the colouring.
import { expect, test, type Page } from '@playwright/test';

const NOTE = [
  'Name,Mark,Note',
  'Ali,18,"well written, nearly finished"',
  'Sara,20,**top of the year**',
  'Reza,14,',
].join('\n');

async function boot(page: Page, text = NOTE, path = 'Notes/marks.csv'): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ text, path }) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { [path]: 1 }, folders: ['Notes'] }));
    localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path }], active: 0 }));
  }, { text, path });
  await page.goto('/');
  await expect(page.locator('#app .cm-content')).toBeVisible();
  await page.waitForTimeout(300);
}

async function read(page: Page): Promise<void> {
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane table').first()).toBeVisible();
  await page.waitForTimeout(200);
}

test('the file is read as a table, with its first row as the header', async ({ page }) => {
  await boot(page);
  await read(page);
  const table = page.locator('#preview-pane table');
  await expect(table.locator('th')).toHaveText(['Name', 'Mark', 'Note']);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  // a quoted field holds the delimiter without becoming two cells
  await expect(rows.nth(0).locator('td')).toHaveText(['Ali', '18', 'well written, nearly finished']);
  // Markor's reason for going through Markdown: a cell can hold Markdown
  await expect(rows.nth(1).locator('td strong')).toHaveText('top of the year');
  // an empty cell is empty, not a stand-in character
  expect((await rows.nth(2).locator('td').nth(2).textContent())?.trim()).toBe('');
});

test('the table is not coloured — only the editor is', async ({ page }) => {
  await boot(page);
  // the title the editor draws is the content's first child, so the header
  // row is the first .cm-line rather than the first child of anything
  const editor = await page.evaluate(() => (Array.from(document.querySelectorAll('#app .cm-content .cm-line')[0].querySelectorAll('span')) as HTMLElement[])
    .filter((span) => span.className.startsWith('cm-csv-col'))
    .map((span) => [span.textContent, getComputedStyle(span).color]));
  expect(editor.length, 'the header line is painted column by column').toBeGreaterThanOrEqual(3);
  await read(page);
  const cells = await page.evaluate(() => (Array.from(document.querySelectorAll('#preview-pane table td, #preview-pane table th')) as HTMLElement[])
    .map((cell) => getComputedStyle(cell).color));
  expect(new Set(cells).size, `one colour for the whole table, found ${new Set(cells).size}`).toBe(1);
  expect(cells[0], 'and it is the text colour, not a column colour').not.toBe(editor[0][1]);
});

test('each column keeps its own colour, and the colours come round', async ({ page }) => {
  // nine columns: the eighth and ninth start the palette again
  const wide = ['a,b,c,d,e,f,g,h,i', '1,2,3,4,5,6,7,8,9'].join('\n');
  await boot(page, wide, 'Notes/wide.csv');
  const columns = await page.evaluate(() => (Array.from(document.querySelectorAll('#app .cm-content .cm-line')) as HTMLElement[])
    .slice(0, 2)
    .map((line) => (Array.from(line.querySelectorAll('span')) as HTMLElement[])
      .filter((span) => span.className.startsWith('cm-csv-col'))
      .map((span) => ({ text: span.textContent ?? '', colour: getComputedStyle(span).color }))));
  expect(columns[0], 'nine fields painted').toHaveLength(9);
  // the delimiter travels with the field it introduces, as Markor paints it
  expect(columns[0][1].text).toBe(',b');
  // the same column, two rows apart, is the same colour
  for (let i = 0; i < 9; i += 1) {
    expect(columns[1][i].colour, `column ${i} is one colour down the file`).toBe(columns[0][i].colour);
  }
  // seven colours, then round again
  const palette = columns[0].map((field) => field.colour);
  expect(new Set(palette.slice(0, 7)).size, 'seven colours, all different').toBe(7);
  expect(palette[7], 'the eighth column starts the palette again').toBe(palette[0]);
  expect(palette[8]).toBe(palette[1]);
});

test('the punctuation is the file’s own: semicolons, tabs, pipes', async ({ page }) => {
  await boot(page, 'City;People\nTehran;9.5\nAmsterdam;0.9', 'Notes/semi.csv');
  await read(page);
  await expect(page.locator('#preview-pane table th')).toHaveText(['City', 'People']);
  await expect(page.locator('#preview-pane tbody tr').nth(0).locator('td')).toHaveText(['Tehran', '9.5']);
});

test('a .tsv takes its delimiter from its name, not from its first comma', async ({ page }) => {
  // the first line holds a comma before its first tab: sniffing the line
  // alone would read the whole file as comma-separated
  await boot(page, 'Surname, given\tMark\nShakouri, Sadra\t20', 'Notes/names.tsv');
  await read(page);
  await expect(page.locator('#preview-pane table th')).toHaveText(['Surname, given', 'Mark']);
  await expect(page.locator('#preview-pane tbody td')).toHaveText(['Shakouri, Sadra', '20']);
});

test('nothing is lost: a pipe, a line break in a cell, a long row', async ({ page }) => {
  const awkward = [
    'a,b',
    '"x|y","first',
    'second"',
    'p,q,r',
  ].join('\n');
  await boot(page, awkward, 'Notes/awkward.csv');
  await read(page);
  const rows = page.locator('#preview-pane tbody tr');
  // the pipe survives as a pipe rather than closing the cell
  await expect(rows.nth(0).locator('td').nth(0)).toHaveText('x|y');
  // a cell written across two lines keeps the break
  await expect(rows.nth(0).locator('td').nth(1).locator('br')).toHaveCount(1);
  // a row longer than the header widens the table instead of losing its end
  await expect(page.locator('#preview-pane table th')).toHaveCount(3);
  await expect(rows.nth(1).locator('td')).toHaveText(['p', 'q', 'r']);
});

test('the parser itself', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const csv = await window.__satr.load('/src/csv.ts');
    const shape = (text: string, name = '') => csv.csvShape(text, name);
    return {
      comma: shape('a,b;c'),
      semi: shape('a;b,c'),
      tsv: shape('a,b\tc', 'x.tsv'),
      apostrophe: shape("it's,fine"),
      quoted: shape('"a","b"'),
      rows: csv.parseCsv('a,"b,c"\n\n"d""e",f\n', { delimiter: ',', quote: '"' }),
      empty: csv.csvToMarkdown('', { delimiter: ',', quote: '"' }),
      table: csv.csvToMarkdown('h1,h2\nv1,v2', { delimiter: ',', quote: '"' }),
      untouched: csv.asMarkdown('note.md', 'a,b\nc,d'),
    };
  });
  expect(result.comma.delimiter, 'the first candidate in the line wins').toBe(',');
  expect(result.semi.delimiter).toBe(';');
  expect(result.tsv.delimiter, 'a .tsv is tab-separated whatever its first line holds').toBe('\t');
  expect(result.apostrophe.quote, "an apostrophe inside a word is not a quote character").toBe('"');
  expect(result.quoted.quote).toBe('"');
  expect(result.rows, 'a blank line is not a row; a doubled quote is one quote').toEqual([['a', 'b,c'], ['d"e', 'f']]);
  expect(result.empty, 'an empty file is an empty table').toBe('');
  expect(result.table).toBe('| h1 | h2 |\n| --- | --- |\n| v1 | v2 |');
  expect(result.untouched, 'anything that is not a CSV is handed over as it is').toBe('a,b\nc,d');
});
