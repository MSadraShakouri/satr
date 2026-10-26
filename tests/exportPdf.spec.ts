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

// A note's stylesheet belongs to the note, never to the sheet it is printed
// on. `* { direction: rtl }` opens every lecture in a real 52-page set of
// notes, and an RTL page box hides overflow from Paged.js: the whole export
// came out as one page per explicit break, with the other three quarters of
// the text drawn past the edge of the paper.
test('a note cannot restyle the page it is printed on', async ({ page }) => {
  const paragraphs = Array.from({ length: 90 }, (_, index) => `بند ${index + 1}. ` + 'این متن برای سنجش صفحه‌بندی نوشته شده است. '.repeat(4));
  await page.addInitScript(() => {
    window.print = () => {
      window.parent.__printedHtml = document.documentElement.outerHTML;
    };
  });
  await page.goto('/');
  const html = await page.evaluate(async (markdown) => {
    const { exportPdf } = await window.__satr.load('/src/exportPdf.ts');
    await exportPdf('notes', markdown);
    return window.__printedHtml;
  }, `<style>*{direction:rtl}</style>\n\n${paragraphs.join('\n\n')}`);
  await page.setContent(html!);
  await page.evaluate(() => document.fonts.ready);

  const pages = await page.locator('.pagedjs_page').count();
  expect(pages, 'the note pages normally').toBeGreaterThan(8);
  const printed = await page.evaluate(() => {
    const area = document.querySelector('.pagedjs_area') as HTMLElement;
    const note = document.querySelector('.pagedjs_page .md-note p') as HTMLElement;
    return {
      areaDirection: getComputedStyle(area).direction,
      noteDirection: getComputedStyle(note).direction,
      text: (document.body.textContent || '').replace(/\s+/g, ' '),
    };
  });
  // The page keeps its own direction; the note keeps the one it asked for.
  expect(printed.areaDirection).toBe('ltr');
  expect(printed.noteDirection).toBe('rtl');
  // And nothing is left behind: the last paragraph is on the paper too.
  expect(printed.text).toContain('بند 90');
});
