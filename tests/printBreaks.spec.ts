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
        const { exportPdf } = await import(path);
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
