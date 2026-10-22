import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { PrintOptions } from '../src/printOptions';

const homework = await readFile(new URL('./fixtures/homework-12-2.md', import.meta.url), 'utf8');

async function print(page: Page, markdown: string, options: PrintOptions, pdfCss = '') {
  await page.addInitScript(() => {
    window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; };
  });
  await page.goto('/');
  const result = await page.evaluate(async ({ markdown, options, pdfCss }) => {
    localStorage.setItem('satr:settings', JSON.stringify({ version: 3, pdfPageNumbers: 'latin', pdfCss }));
    const path = '/src/exportPdf.ts';
    const { exportPdf } = await window.__satr.load(path);
    await exportPdf('Print layout regression', markdown, '', options);
    return window.__printedHtml;
  }, { markdown, options, pdfCss });
  expect(result).toBeTruthy();
  await page.setContent(result!);
  await page.evaluate(() => document.fonts.ready);
}

async function strandedHeadings(page: Page) {
  return page.locator('.pagedjs_page_content').evaluateAll((columns) => columns.flatMap((column) =>
    [...column.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((heading) => {
      const rest = document.createRange();
      rest.selectNodeContents(column);
      rest.setStartAfter(heading);
      const fragment = rest.cloneContents();
      fragment.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((el) => el.remove());
      return !fragment.textContent?.trim() && !fragment.querySelector('img,svg,math');
    }).map((heading) => heading.textContent)));
}

for (const options of [
  { columns: 1, direction: 'ltr', mathAlign: 'center' },
  { columns: 2, direction: 'ltr', mathAlign: 'center' },
  { columns: 2, direction: 'rtl', mathAlign: 'start' },
] as const) {
  test(`homework: ${options.columns} column(s), ${options.direction}, ${options.mathAlign} equations`, async ({ page }) => {
    await print(page, homework, options);
    expect(await strandedHeadings(page)).toEqual([]);
    await expect(page.locator('.pagedjs_page_content h3')).toHaveText(Array.from({ length: 40 }, (_, i) => `${i + 1}.`));
    await expect(page.locator('.pagedjs_page_content .math-display')).toHaveCount(64);
    await expect(page.locator('.katex-error')).toHaveCount(0);
    await expect(page.locator('html')).toHaveCSS('font-size', '15px');
    const content = await page.locator('.pagedjs_page_content').allTextContents();
    expect(content.join('').match(/head-to-tail\./g)?.length).toBe(2);
    // Every visible formula fits its column, not merely retained off-screen.
    const overflow = await page.locator('.pagedjs_page_content').evaluateAll((columns) => columns.flatMap((column) => {
      const box = column.getBoundingClientRect();
      return [...column.querySelectorAll('.katex-html .base')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.left < box.left - 2 || r.right > box.right + 2);
      }).map((el) => el.textContent);
    }));
    expect(overflow).toEqual([]);
    const math = page.locator('.math-display').first();
    await expect(math).toHaveCSS('text-align', options.mathAlign === 'center' ? 'center' : 'right');
    await expect(math.locator('.katex').first()).toHaveCSS('direction', 'ltr');

    if (options.columns === 2) {
      await expect(page.locator('.satr-print-sheet')).toHaveCount(4);
      await expect(page.locator('.satr-sheet-number')).toHaveText(['1', '2', '3', '4']);
      const positions = await page.locator('.satr-print-sheet').first().locator('.pagedjs_page').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
      expect(positions[0] < positions[1]).toBe(options.direction === 'ltr');
    }
    const pdf = await page.pdf({ preferCSSPageSize: true });
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBe(options.columns === 2 ? 4 : 8);
  });
}

test('headings stay with paragraphs, not just with another heading', async ({ page }) => {
  const markdown = 'Filler\n\n## Section\n\n### Subsection\n\n' + Array.from({ length: 7 }, (_, i) => `Body line ${i + 1}`).join('  \n');
  await print(page, markdown, { columns: 1, direction: 'auto', mathAlign: 'center' }, `
    @page { size: 400px 400px; margin: 40px; }
    p:first-child { height: 240px; margin: 0; }
    h2, h3 { margin: 0; padding: 0; border: 0; font-size: 15px; line-height: 20px; }
    p { margin: 0; line-height: 20px; }
  `);
  expect(await strandedHeadings(page)).toEqual([]);
  await expect(page.locator('h2')).toHaveCount(1);
  await expect(page.locator('h3')).toHaveCount(1);
  const body = (await page.locator('.pagedjs_page_content').allTextContents()).join('');
  for (let i = 1; i <= 7; i++) expect(body).toContain(`Body line ${i}`);
});

test('explicit page breaks start a new physical sheet in two-column mode', async ({ page }) => {
  await print(page, 'First sheet.\n\n\\pagebreak\n\nSecond sheet.', { columns: 2, direction: 'ltr', mathAlign: 'center' });
  await expect(page.locator('.satr-print-sheet')).toHaveCount(2);
  await expect(page.locator('.satr-print-sheet').nth(0)).toContainText('First sheet.');
  await expect(page.locator('.satr-print-sheet').nth(1)).toContainText('Second sheet.');
});

test('footnotes number across both columns of a sheet', async ({ page }) => {
  const lines = Array.from({ length: 34 }, (_, i) => `Line ${i + 1}${i === 0 ? '[^a]' : i === 33 ? '[^b]' : ''}`).join('  \n');
  await print(page, lines + '\n\n[^a]: First note.\n[^b]: Second note.', { columns: 2, direction: 'rtl', mathAlign: 'center' });
  await expect(page.locator('.satr-print-sheet')).toHaveCount(1);
  await expect(page.locator('.pagedjs_page')).toHaveCount(2);
  const calls = await page.locator('[data-footnote-call]').evaluateAll((els) => els.map((e) => e.getAttribute('data-number')));
  expect(calls).toEqual(['1', '2']);
  await expect(page.locator('.footnote-number')).toHaveText(['1.', '2.']);
});

// The writer's numbers are the writer's: a list that starts at 2 prints as 2,
// a Persian list keeps Persian digits, and a stray "4." is still the 4th item
// (the preview and the print agree, and neither normalises anything).
test('the printed list keeps the writer’s number', async ({ page }) => {
  const markdown = '2. second\n\nprose\n\n۲. دوم\n\nprose\n\n٣. ثالث\n\nprose\n\n4.';
  await print(page, markdown, { columns: 1, direction: 'ltr', mathAlign: 'center' });
  const lists = await page.locator('.pagedjs_page_content ol').evaluateAll((els) => els.map((el) => ({
    start: el.getAttribute('start'),
    persian: el.classList.contains('persian-ordered'),
    label: el.querySelector(':scope > li')?.getAttribute('data-persian-number') ?? null,
  })));
  expect(lists).toEqual([
    { start: '2', persian: false, label: null },
    { start: '2', persian: true, label: '۲' },
    // The marker is drawn exactly as it was written, Arabic-Indic and all.
    { start: '3', persian: true, label: '٣' },
    { start: '4', persian: false, label: null },
  ]);
});

// The paper keeps the punctuation the writer typed, and a formula that opens
// an item stands on the marker's line here too: `۱)` prints `۱)`, and
// `الف. $$x$$` prints the formula beside its marker rather than a line below.
test('the printed list keeps the writer’s punctuation', async ({ page }) => {
  const markdown = '۱) یک\n۲) دو\n\nprose\n\n1) one\n2) two\n\nprose\n\nالف. $$x$$';
  await print(page, markdown, { columns: 1, direction: 'rtl', mathAlign: 'center' });
  const drawn = await page.evaluate(() => {
    const lists = [...document.querySelectorAll<HTMLElement>('.pagedjs_page_content ol')].map((list) => ({
      delimiter: list.getAttribute('data-delimiter'),
      marks: [...list.querySelectorAll(':scope > li')].map((item) => getComputedStyle(item, '::before').content),
    }));
    const item = [...document.querySelectorAll<HTMLElement>('.pagedjs_page_content li')]
      .find((one) => one.hasAttribute('data-math-head'))!;
    const math = item.querySelector(':scope > .math-display') as HTMLElement;
    // The marker's strip: its own end against the text, with a hair between.
    const persian = document.querySelector<HTMLElement>('.pagedjs_page_content ol.persian-ordered > li')!;
    const text = document.createRange();
    text.selectNodeContents(persian);
    const itemBox = persian.getBoundingClientRect();
    const textBox = text.getBoundingClientRect();
    return {
      lists,
      headGap: +(math.getBoundingClientRect().top - item.getBoundingClientRect().top).toFixed(1),
      headMargin: getComputedStyle(math).marginBlockStart,
      // Right to left: the text's start is its right edge, the strip is the
      // 1.8em before it.
      strip: +(itemBox.right - textBox.right).toFixed(1),
      font: parseFloat(getComputedStyle(persian).fontSize),
    };
  });
  expect(drawn.lists[0]).toEqual({ delimiter: null, marks: ['"۱)"', '"۲)"'] });
  // The platform's own counter keeps the paren on paper too.
  expect(drawn.lists[1]).toEqual({ delimiter: ')', marks: ['none', 'none'] });
  expect(drawn.headMargin).toBe('0px');
  expect(drawn.headGap).toBeLessThan(3);
  // The text keeps the indent it always had, and the marker hangs inside it.
  expect(drawn.strip).toBeCloseTo(drawn.font * 1.8, 0);
});

// A Persian phrase in a formula is a phrase on paper too: its words read right
// to left across the printed page, inside a formula that stays left to right.
test('a Persian phrase in a printed formula reads right to left', async ({ page }) => {
  await print(page, 'نمودار: $v = \\text{سلام دنیا}$', { columns: 1, direction: 'rtl', mathAlign: 'center' });
  const order = await page.evaluate(() => {
    const run = [...document.querySelectorAll<HTMLElement>('.pagedjs_page_content .katex .text')]
      .find((el) => el.getBoundingClientRect().width > 0 && (el.textContent ?? '').includes('سلام'));
    if (!run) return null;
    const walker = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    for (let next = walker.nextNode(); next; next = walker.nextNode()) {
      if (next instanceof Text && next.data.includes('سلام') && /[\s\u00a0]/.test(next.data)) { node = next; break; }
    }
    if (!node) return null;
    const at = node.data.search(/[\s\u00a0]/);
    const box = (from: number, to: number) => {
      const range = document.createRange();
      range.setStart(node!, from);
      range.setEnd(node!, to);
      return range.getBoundingClientRect();
    };
    return { text: node.data, first: box(0, at).left, second: box(at + 1, node.data.length).left };
  });
  expect(order, 'the phrase is on the page').not.toBeNull();
  expect(order!.first, `${order!.text} reads right to left`).toBeGreaterThan(order!.second);
});

// The marker the page draws stays on the page. The strip before the text was
// a fixed 1.4em, so `الف.` and `۱۰۰.` were printed out over the page's margin
// and the list read as though it had no indent at all. The strip is now the
// widest marker of that list and the hair of space before the text
// (--list-marker-width, measured in src/markdown.ts): the markers still end
// on one line against the text, the widest reaches the column's edge and no
// further, and a list of `۱.` to `۹.` prints exactly as it did.
test('a printed marker keeps inside the text column', async ({ page }) => {
  await print(page, '۱. یک\n۲. دو\n\nمتن\n\nالف. الف\nب. ب\n\nمتن\n\n۹۸. هشت\n۹۹. نه\n۱۰۰. صد', { columns: 1, direction: 'rtl', mathAlign: 'start' });
  const lists = await page.evaluate(() => {
    const column = document.querySelector('.pagedjs_page_content')!.getBoundingClientRect();
    const paint = document.createElement('canvas').getContext('2d')!;
    return [...document.querySelectorAll<HTMLElement>('.pagedjs_page_content ol.persian-ordered')].map((list) => {
      const items = [...list.children] as HTMLElement[];
      const rows = items.map((item) => {
        const style = getComputedStyle(item);
        paint.font = `${style.fontSize} ${style.fontFamily}`;
        const drawn = paint.measureText((item.dataset.persianNumber ?? '') + (item.dataset.persianDelimiter ?? '')).width;
        const box = item.getBoundingClientRect();
        return {
          // The room the marker is given, and the room it asks for.
          room: +(parseFloat(getComputedStyle(item, '::before').width) || 0).toFixed(1),
          drawn: +drawn.toFixed(1),
          strip: +(parseFloat(style.paddingInlineStart) || 0).toFixed(1),
          size: parseFloat(style.fontSize),
          // Right to left: the item starts at the column's right edge.
          fromColumn: +(column.right - box.right).toFixed(1),
        };
      });
      return { head: items[0].dataset.persianNumber, rows };
    });
  });
  expect(lists.map((list) => list.head)).toEqual(['۱', 'الف', '۹۸']);
  for (const list of lists) {
    for (const row of list.rows) {
      // No marker is drawn wider than the strip it hangs in, and no list
      // starts outside the column the page gives it.
      expect(row.drawn, `${list.head}: the marker fits its strip`).toBeLessThanOrEqual(row.room + 0.5);
      expect(row.fromColumn).toBe(0);
    }
    // One strip per list: the text of every item starts on the same line.
    expect(new Set(list.rows.map((row) => row.strip)).size).toBe(1);
  }
  // `۱.` to `۲.` fits the 1.8em a platform list indents by, and keeps it;
  // the letters ask for more, and are given exactly what they ask for.
  const [digits, letters] = lists;
  expect(digits.rows[0].strip).toBeCloseTo(digits.rows[0].size * 1.8, 0);
  expect(letters.rows[0].strip).toBeGreaterThan(letters.rows[0].size * 1.8);
  // Exactly the room the widest marker asks for — within the pixel the font
  // rounds by: the width is measured from the font's own metrics once and
  // kept in em, and a renderer rounds an advance to the size it draws at.
  const needs = Math.max(...letters.rows.map((row) => row.drawn)) + letters.rows[0].size * 0.4;
  expect(letters.rows[0].strip).toBeGreaterThanOrEqual(needs);
  expect(letters.rows[0].strip).toBeLessThan(needs + 1.5);
});
