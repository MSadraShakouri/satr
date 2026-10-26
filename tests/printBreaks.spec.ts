import { expect, test } from '@playwright/test';

// Force room for five lines (would leave two widows), or two lines (would
// leave two orphans). Tight list items have no <p>: they used to retain the
// browser's default of 2 even though paragraph CSS requested 3.
for (const kind of ['paragraph', 'list', 'quote'] as const) {
  for (const height of [210, 270]) {
    test(`${kind}: at least three lines on either side of a page break (${height})`, async ({ page }) => {
      await page.addInitScript(() => {
        window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; };
      });
      await page.goto('/');
      const rows = Array.from({ length: 7 }, (_, i) => `Row ${i + 1}`);
      const content = kind === 'list' ? `- ${rows.join('  \n  ')}`
        : kind === 'quote' ? rows.map((s) => `> ${s}`).join('  \n') : rows.join('  \n');
      const html = await page.evaluate(async ({ markdown, height }) => {
        localStorage.setItem('satr:settings', JSON.stringify({ version: 3, pdfCss: `
          @page { size: 400px 400px; margin: 40px; }
          h1 { height: ${height}px; margin: 0; padding: 0; border: 0; break-after: auto; }
          p, li { font-size: 15px; line-height: 20px; margin: 0; }
        ` }));
        const path = '/src/exportPdf.ts';
        const { exportPdf } = await window.__satr.load(path);
        await exportPdf('Page-break regression', markdown);
        return window.__printedHtml;
      }, { markdown: `# Filler\n\n${content}`, height });
      expect(html).toBeTruthy();
      await page.setContent(html!);
      const pages = await page.locator('.pagedjs_page_content').allTextContents();
      expect(pages.length).toBe(2);
      const counts = pages.map((text) => text.match(/Row \d/g)?.length ?? 0);
      expect(counts.reduce((a, b) => a + b)).toBe(7);
      expect(counts.filter(Boolean).every((n) => n >= 3)).toBe(true);
      // The split is measured against the room a page has, and every page now
      // keeps a line of slack at its foot for the print WebView (see the
      // reserve in src/exportPdf.ts): the same fixture with the same rule sits
      // one line differently from here than it would with none. What must not
      // change is the rule itself — three lines on either side, and no widows.
      expect(counts).toEqual(height === 210 ? [3, 4] : [0, 7]);
    });
  }
}

// A page break is a zero-height marker carrying break-after. When the text
// before it fills a page, the marker itself is what flows onto the next one,
// and breaks again there: a sheet with nothing on it but its page number. A
// 52-page set of lecture notes printed one in the middle. Paged.js keeps
// honouring a forced break at the top of a page, so the pages are read after
// they are laid out and an unasked-for empty one is dropped.
for (const [label, fill, pages, blank] of [
  ['the marker fits', 280, 2, 0],
  ['the marker is pushed onto a page of its own', 292, 2, 0],
] as const) {
  test(`a break that lands on a fresh page makes no empty page (${label})`, async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; };
    });
    await page.goto('/');
    const html = await page.evaluate(async (height) => {
      localStorage.setItem('satr:settings', JSON.stringify({ version: 3, pdfPageNumbers: 'latin', pdfCss:
        `@page { size: 400px 400px; margin: 40px; } p { height: ${height}px; margin: 0; }` }));
      const { exportPdf } = await window.__satr.load('/src/exportPdf.ts');
      await exportPdf('Blank page', 'Filler\n\n<!-- pagebreak -->\n\nAfter the break\n');
      return window.__printedHtml;
    }, fill);
    await page.setContent(html!);
    const sheets = await page.locator('.pagedjs_page').count();
    const empty = await page.evaluate(() => [...document.querySelectorAll('.pagedjs_area')]
      .filter((area) => !(area.textContent ?? '').trim()).length);
    expect(sheets).toBe(pages);
    expect(empty, 'no page may be empty').toBe(blank);
    expect(await page.locator('.pagedjs_page').last().textContent()).toContain('After the break');
  });
}

test('two breaks in a row still print the empty page between them', async ({ page }) => {
  // Asking for a blank sheet — one to write on after each lecture, or a
  // chapter made to start further on — is what a second break means. Only a
  // page nobody asked for is dropped.
  await page.addInitScript(() => {
    window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; };
  });
  await page.goto('/');
  const html = await page.evaluate(async () => {
    localStorage.setItem('satr:settings', JSON.stringify({ version: 3, pdfPageNumbers: 'latin', pdfCss: '@page { size: 400px 400px; margin: 40px; }' }));
    const { exportPdf } = await window.__satr.load('/src/exportPdf.ts');
    await exportPdf('Blank page', 'One\n\n<!-- pagebreak -->\n\n<!-- pagebreak -->\n\nTwo\n');
    return window.__printedHtml;
  });
  await page.setContent(html!);
  expect(await page.locator('.pagedjs_page').count()).toBe(3);
  const empty = await page.evaluate(() => [...document.querySelectorAll('.pagedjs_area')]
    .map((area) => (area.textContent ?? '').trim()));
  expect(empty).toEqual(['One', '', 'Two']);
});
