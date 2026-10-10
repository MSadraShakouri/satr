import { expect, test, type Page } from '@playwright/test';

// Tables: one direction of their own (the note's, or `<!-- table: rtl -->`
// set by hand), panning when wider than the pane, and never split across
// pages in print unless taller than one.

// ---- Reading view (renderMarkdown + the preview's CSS) ----

async function rendered(page: Page, markdown: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (markdown) => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    let host = document.querySelector<HTMLElement>('#spec-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'spec-host';
      host.className = 'preview-pane';
      host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000;font-size:16px;direction:ltr';
      document.body.appendChild(host);
    }
    host.innerHTML = renderMarkdown(markdown);
    await document.fonts.ready;
  }, markdown);
}

test('a table sits in a scrolling wrapper and keeps its natural width', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 844 });
  const wide = (n: number) => `| ${Array.from({ length: n }, (_, i) => `column ${i + 1}`).join(' | ')} |\n|${Array.from({ length: n }, () => ' --- ').join('|')}|\n| ${Array.from({ length: n }, (_, i) => `c${i + 1}`).join(' | ')} |\n`;
  await rendered(page, wide(16));
  const result = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('#spec-host')!;
    const wrapper = host.querySelector('.table-wrapper')!;
    const table = wrapper.querySelector('table')!;
    const style = getComputedStyle(wrapper);
    return {
      wrappers: host.querySelectorAll('.table-wrapper').length,
      overflowX: style.overflowX,
      pans: wrapper.scrollWidth > wrapper.clientWidth + 1,
      tableWidth: table.getBoundingClientRect().width,
      wrapperWidth: wrapper.clientWidth,
      firstCellReachable: wrapper.scrollLeft === 0,
    };
  });
  expect(result.wrappers).toBe(1);
  expect(result.overflowX).toBe('auto');
  expect(result.pans).toBe(true);
  // The table itself is never squeezed below its natural width: the wrapper
  // scrolls instead.
  expect(result.tableWidth).toBeGreaterThan(result.wrapperWidth);
  // Narrow tables stay centred (auto margins), so this is the first peek.
  expect(result.firstCellReachable).toBe(true);
});

test('a narrow table stays centred and its wrapper does not scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await rendered(page, '| A | B |\n| --- | --- |\n| 1 | 2 |\n');
  const result = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('#spec-host')!;
    const wrapper = host.querySelector('.table-wrapper')!;
    const table = wrapper.querySelector('table')!;
    const outer = wrapper.clientWidth;
    const inner = table.getBoundingClientRect().width;
    return {
      pans: wrapper.scrollWidth > wrapper.clientWidth + 1,
      centred: Math.abs(table.getBoundingClientRect().left - wrapper.getBoundingClientRect().left
        - (outer - inner) / 2) < 2,
      marginBlock: getComputedStyle(table).marginBlock,
    };
  });
  expect(result.pans).toBe(false);
  expect(result.centred).toBe(true);
  // The wrapper carries the paragraph spacing; the table adds none of its own.
  expect(result.marginBlock).toBe('0px');
});

test("a table's own dir follows its first cell, on the table element", async ({ page }) => {
  await rendered(page, 'مقدمه\n\n| ستون | Column |\n| --- | --- |\n| یک | two |\n');
  expect(await page.evaluate(() => document.querySelector('#spec-host table')!.getAttribute('dir'))).toBe('rtl');
});

test('a table takes its direction from its own first strong letter, not the note\'s majority', async ({ page }) => {
  // Like every block: the table's first strong letter decides — a Latin-led
  // table inside a Persian note keeps left-to-right columns.
  await rendered(page, 'مقدمه فارسی\n\n| Column | ستون |\n| --- | --- |\n| two | یک |\n');
  expect(await page.evaluate(() => document.querySelector('#spec-host table')!.getAttribute('dir'))).toBe('ltr');
});

test('<!-- table: rtl --> on the line above sets the whole table, and never renders', async ({ page }) => {
  await rendered(page, '<!-- table: rtl -->\n\n| Column | ستون |\n| --- | --- |\n| two | یک |\n');
  const result = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('#spec-host')!;
    return {
      dir: host.querySelector('table')!.getAttribute('dir'),
      commentVisible: host.textContent?.includes('table:'),
      sections: host.querySelectorAll('.md-section').length,
    };
  });
  expect(result.dir).toBe('rtl');
  expect(result.commentVisible).toBe(false);
  expect(result.sections).toBe(1); // the comment leaves no empty section behind
});

test('the directive must be on the line just above; further away it is an ordinary comment', async ({ page }) => {
  await rendered(page, '<!-- table: rtl -->\n\nA paragraph between.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
  const result = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('#spec-host')!;
    return {
      dir: host.querySelector('table')!.getAttribute('dir'),
      text: host.textContent,
    };
  });
  expect(result.dir).toBe('ltr'); // the policy's own answer for this table
  expect(result.text).not.toContain('table:'); // an unfollowed comment stays invisible
});

test('table: auto explicitly hands the decision back to the note', async ({ page }) => {
  await rendered(page, '<!-- table: auto -->\n\nمقدمه\n\n| ستون | Column |\n| --- | --- |\n| یک | two |\n');
  expect(await page.evaluate(() => document.querySelector('#spec-host table')!.getAttribute('dir'))).toBe('rtl');
});

// ---- The direction menu (tap a table in the reading view) ----

const NOTE = 'Before the table.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter the table.\n';

async function bootApp(page: Page, markdown: string, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript((note) => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', note);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, markdown);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
}

async function openTableMenu(page: Page) {
  // The boot-snapshot cover is a copy of the app: everything tapped here is
  // scoped to #app so the copy is never a second match.
  await page.locator('#app #preview-toggle').click();
  await expect(page.locator('#app #preview .table-wrapper > table')).toBeVisible();
  await page.locator('#app #preview .table-wrapper > table').click();
  await expect(page.locator('.menu.mod-bottom-sheet')).toBeVisible();
}

async function savedNote(page: Page): Promise<string> {
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('satr:fs:file:Notes/A.md'))).not.toBe(NOTE);
  return page.evaluate(() => localStorage.getItem('satr:fs:file:Notes/A.md') ?? '');
}

test('tapping a table in the reading view offers the whole direction, and RTL writes the comment', async ({ page }) => {
  await bootApp(page, NOTE);
  await openTableMenu(page);
  await page.locator('.menu-item', { hasText: 'Right to left' }).click();
  expect(await savedNote(page)).toContain('<!-- table: rtl -->\n| A | B |');
  // The reading view follows at once.
  await expect(page.locator('#app #preview .table-wrapper > table[dir="rtl"]')).toHaveCount(1);
});

test('choosing automatic removes the comment again', async ({ page }) => {
  await bootApp(page, '<!-- table: ltr -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
  await openTableMenu(page);
  await page.locator('.menu-item', { hasText: 'Automatic' }).click();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('satr:fs:file:Notes/A.md')))
    .not.toContain('table:');
  await expect(page.locator('#app #preview .table-wrapper > table[dir="rtl"]')).toHaveCount(0);
});

test('the menu shows what the table is wearing now, and undo takes the comment back', async ({ page }) => {
  await bootApp(page, '<!-- table: rtl -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', 1200);
  // Split view on a wide screen: the preview is beside the editor.
  await expect(page.locator('#app #preview .table-wrapper > table[dir="rtl"]')).toHaveCount(1);
  await page.locator('#app #preview .table-wrapper > table').click();
  await expect(page.locator('.menu-item.mod-selected', { hasText: 'Right to left' })).toHaveCount(1);
  await page.locator('.menu-item', { hasText: 'Left to right' }).click();
  await expect(page.locator('#app #preview .table-wrapper > table[dir="ltr"]')).toHaveCount(1);
  // One undo step apiece: click into the editor and undo.
  await page.locator('#app .cm-content').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#app #preview .table-wrapper > table[dir="rtl"]')).toHaveCount(1);
});

// ---- Print ----

async function printHtml(page: Page, markdown: string, options = { columns: 1 as const, direction: 'auto' as const, mathAlign: 'center' as const }, pdfCss = ''): Promise<string> {
  await page.addInitScript(() => {
    window.print = () => { (window.parent as unknown as { __printedHtml: string }).__printedHtml = document.documentElement.outerHTML; };
  });
  await page.goto('/');
  const result = await page.evaluate(async ({ markdown, options, pdfCss }) => {
    localStorage.setItem('satr:settings', JSON.stringify({ version: 3, pdfPageNumbers: 'latin', pdfCss }));
    const { exportPdf } = await window.__satr.load('/src/exportPdf.ts');
    await exportPdf('Tables', markdown, '', options);
    return (window.parent as unknown as { __printedHtml?: string }).__printedHtml;
  }, { markdown, options, pdfCss });
  expect(result).toBeTruthy();
  await page.setContent(result!);
  await page.evaluate(() => document.fonts.ready);
  return result!;
}

test('print: a table keeps the note\'s direction without its section wrapper', async ({ page }) => {
  await printHtml(page, 'مقدمه فارسی\n\n| ستون | Column |\n| --- | --- |\n| یک | two |\n');
  await expect(page.locator('.pagedjs_page_content table[dir="rtl"]').first()).toBeVisible();
  // Column order really is right to left: the first header cell paints
  // to the right of the second.
  const sides = await page.locator('.pagedjs_page_content table th').evaluateAll((cells) => {
    const first = cells[0].getBoundingClientRect();
    const second = cells[1].getBoundingClientRect();
    return { firstLeft: first.left, secondLeft: second.left };
  });
  expect(sides.firstLeft).toBeGreaterThan(sides.secondLeft);
});

test('print: <!-- table: ltr --> holds an RTL note\'s table at left to right', async ({ page }) => {
  await printHtml(page, 'مقدمه\n\n<!-- table: ltr -->\n\n| Column | ستون |\n| --- | --- |\n| two | یک |\n');
  const table = page.locator('.pagedjs_page_content table[dir="ltr"]');
  await expect(table).toHaveCount(1);
  const sides = await page.locator('.pagedjs_page_content table th').evaluateAll((cells) => {
    const first = cells[0].getBoundingClientRect();
    const second = cells[1].getBoundingClientRect();
    return { firstLeft: first.left, secondLeft: second.left };
  });
  expect(sides.firstLeft).toBeLessThan(sides.secondLeft);
});

test('print: a table that fits moves whole to the next page instead of splitting', async ({ page }) => {
  const rows = Array.from({ length: 8 }, (_, i) => `| r${i + 1} | ${i + 1} |`).join('\n');
  const markdown = `Intro paragraph.\n\n| A | B |\n| --- | --- |\n${rows}\n\nTrailing paragraph.\n`;
  // A tiny page: the table cannot fit where the intro leaves it.
  await printHtml(page, markdown, { columns: 1, direction: 'auto', mathAlign: 'center' }, '@page { size: 400px 500px; margin: 40px; }');
  const pages = await page.locator('.pagedjs_page').evaluateAll((pages) => pages.map((page) => ({
    rows: page.querySelectorAll('tr').length,
    complete: page.querySelectorAll('.pagedjs_page_content table').length > 0
      ? page.querySelectorAll('tr').length
      : 0,
  })));
  const withRows = pages.filter((p) => p.rows > 0);
  // Exactly one page holds the table, with every row of it.
  expect(withRows.length).toBe(1);
  expect(withRows[0].rows).toBe(9); // header + separator-less body rows
});

test('print: a table taller than a page still prints all of its rows', async ({ page }) => {
  const rows = Array.from({ length: 40 }, (_, i) => `| r${i + 1} | ${i + 1} |`).join('\n');
  const markdown = `| A | B |\n| --- | --- |\n${rows}\n`;
  await printHtml(page, markdown, { columns: 1, direction: 'auto', mathAlign: 'center' }, '@page { size: 400px 500px; margin: 40px; }');
  const total = await page.locator('.pagedjs_page_content tr').count();
  expect(total).toBe(41); // nothing lost to break-inside: avoid
  await expect(page.locator('.pagedjs_page_content td').first()).toBeVisible();
});

test('print: an unsized picture is capped at reading-view height, a sized one keeps its size', async ({ page }) => {
  // A portrait photo, 1500×3000: without the cap it prints 347px wide and
  // 694px tall — most of a page. The cap keeps it near the phone's reading
  // width. The sized one asks for 200px and keeps them.
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mNk+M+ACzDhVQ4CAAvwATkP0aAAAAAAAElFTkSuQmCC';
  // loadImages reads from the vault; here the picture is already a data: URL
  // in the note itself, which renderMarkdown passes through untouched.
  await printHtml(page, `![](${pixel})\n\n![|200](${pixel})\n`);
  const sizes = await page.locator('.pagedjs_page_content img.md-image').evaluateAll((imgs) => imgs.map((img) => ({
    width: img.getBoundingClientRect().width,
    height: img.getBoundingClientRect().height,
  })));
  expect(sizes.length).toBe(2);
  // 9cm ≈ 340px at 96dpi; the data-URL pixel stretches to the box, so both
  // dimensions respect the cap proportionally.
  expect(sizes[0].height).toBeLessThanOrEqual(342);
  expect(sizes[0].width).toBeLessThanOrEqual(342 / 2 + 1);
  expect(Math.round(sizes[1].width)).toBe(200);
});

test('a directive is never misapplied when another table sits nested in a list', async ({ page }) => {
  const markdown = '<!-- table: rtl -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- item\n\n  | C | D |\n  | --- | --- |\n  | 3 | 4 |\n';
  await rendered(page, markdown);
  const dirs = await page.evaluate(() => [...document.querySelectorAll('#spec-host table')].map((t) => t.getAttribute('dir')));
  // The nested table takes the policy's own answer for its own cells, never
  // the top-level table's comment.
  expect(dirs).toEqual(['rtl', 'ltr']);
});
