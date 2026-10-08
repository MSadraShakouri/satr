import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const homework = await readFile(new URL('./fixtures/homework-12-2.md', import.meta.url), 'utf8');

declare global {
  interface Window {
    __printedHtml?: string;
  }
}

// Exercise the real renderer, font embedding, math layout and Paged.js in a
// browser, not a DOM mock. Only the OS print dialog is replaced by a capture.
for (const fontSize of [15, 12, 20]) {
  test(`exports all of Homework 12.2 at ${fontSize}px`, async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        window.parent.__printedHtml = document.documentElement.outerHTML;
      };
    });
    await page.goto('/');
    const { html, sourceFormulas } = await page.evaluate(async ({ markdown, fontSize }) => {
      localStorage.setItem('satr:settings', JSON.stringify({
        version: 2,
        pdfPageNumbers: 'latin',
        pdfCss: fontSize === 15 ? '' : `html { font-size: ${fontSize}px; }`,
      }));
      const rendererPath = '/src/markdown.ts';
      const { renderMarkdown } = await window.__satr.load(rendererPath);
      const source = new DOMParser().parseFromString(renderMarkdown(markdown), 'text/html');
      source.querySelectorAll('.math-cont').forEach((el) => el.remove());
      const sourceFormulas = [...source.querySelectorAll('annotation')].map((el) => el.textContent);
      const exporterPath = '/src/exportPdf.ts';
      const { exportPdf } = await window.__satr.load(exporterPath);
      await exportPdf('Homework 12.2', markdown);
      return { html: window.__printedHtml, sourceFormulas };
    }, { markdown: homework, fontSize });

    expect(html, 'export must reach the print dialog').toBeTruthy();
    await page.setContent(html!);
    await page.evaluate(() => document.fonts.ready);
    const content = page.locator('.pagedjs_page_content');
    await expect(content.locator('h3')).toHaveText(Array.from({ length: 40 }, (_, i) => `${i + 1}.`));
    await expect(content.locator('.math-display')).toHaveCount(64);
    await expect(content.locator('.katex-error')).toHaveCount(0);
    const printed = await content.evaluateAll((pages) => {
      const root = document.createElement('div');
      pages.forEach((p) => root.appendChild(p.cloneNode(true)));
      root.querySelectorAll('.math-cont').forEach((el) => el.remove());
      return {
        formulas: [...root.querySelectorAll('annotation')].map((el) => el.textContent),
        tails: root.textContent?.match(/head-to-tail\./g)?.length,
        introductions: root.textContent?.match(/Graphical exercise — sketch/g)?.length,
      };
    });
    expect(printed.formulas).toEqual(sourceFormulas);
    expect(printed.tails).toBe(2);
    expect(printed.introductions).toBe(2);
    await expect(page.locator('html')).toHaveCSS('font-size', `${fontSize}px`);

    // Also run Chromium's print renderer; don't keep generated PDFs in Git.
    const pdf = await page.pdf({ preferCSSPageSize: true });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10_000);
  });
}
