// The two print paths — the browser's dialog and the app's SatrPrint hand-off
// — must lay a note out the same way: same pages, same breaks, same output.
// They could hardly be more different in how the document leaves the app
// (window.print() versus a native plugin and a second WebView), and that is
// exactly why nothing about the *pages* may depend on which one is in use.
//
// It used to: the app shortened every paginated page by 32px, a one-line
// reserve added when the print WebView still received a fixed-height
// multi-column page content that could clip a line. That box is gone (see
// printDocumentHtml), and the reserve was never free — 24pt less room on every
// page for the measuring frame too, so a section that still fitted at the foot
// of a page in the browser was pushed to the next page in the app. The same
// note exported on the phone and in the site came out with different breaks,
// and the phone — the one with less room — was the sparser of the two.
//
// These tests export one note through both paths and compare the pages
// themselves, then a note built to sit exactly on a page boundary, which is
// where a difference in room shows up first.
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { PrintOptions } from '../src/printOptions';

const homework = await readFile(new URL('./fixtures/homework-12-2.md', import.meta.url), 'utf8');

declare global {
  interface Window { __printHtml?: string; __fontScale?: number; __printedHtml?: string }
}

/** The browser's path: exportPdf prints the export frame in place, so the
 *  document that reaches the paper is the frame itself. */
async function printWeb(page: Page, markdown: string, options: PrintOptions): Promise<string> {
  await page.addInitScript(() => {
    window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; };
  });
  await page.goto('/');
  const html = await page.evaluate(async ({ markdown, options }) => {
    localStorage.setItem('satr:settings', JSON.stringify({ version: 3, pdfPageNumbers: 'latin', pdfCss: '' }));
    const { exportPdf } = await import('/src/exportPdf.ts');
    await exportPdf('Print parity', markdown, '', options);
    return window.__printedHtml;
  }, { markdown, options });
  expect(html, 'the browser path must print the export frame').toBeTruthy();
  return html!;
}

/** The app's path: the platform reports as native, SatrPrint stands in for the
 *  plugin and keeps the document handed to the print WebView. `scale` is the
 *  phone's font scale, reported the way SystemBarsPlugin reports it. */
async function printApp(page: Page, markdown: string, options: PrintOptions, scale = 1): Promise<string> {
  await page.addInitScript(() => {
    window.__printHtml = undefined;
    window.__fontScale = 1;
    window.Capacitor = {
      PluginHeaders: [
        { name: 'SatrPrint', methods: [{ name: 'print', rtype: 'promise' }] },
        { name: 'SatrSystemBars', methods: [{ name: 'get', rtype: 'promise' }] },
      ],
      nativePromise: (plugin: string, _method: string, options?: { html?: string }) => {
        if (plugin === 'SatrPrint') { window.__printHtml = options?.html; return Promise.resolve(); }
        if (plugin === 'SatrSystemBars') return Promise.resolve({ top: 0, right: 0, bottom: 0, left: 0, fontScale: window.__fontScale });
        return Promise.resolve();
      },
    };
  });
  await page.goto('/');
  const html = await page.evaluate(async ({ markdown, options, scale }) => {
    window.__fontScale = scale;
    document.documentElement.style.setProperty('--system-font-scale', String(scale));
    window.Capacitor.isNativePlatform = () => true;
    const { exportPdf } = await import('/src/exportPdf.ts');
    await exportPdf('Print parity', markdown, '', options);
    return window.__printHtml;
  }, { markdown, options, scale });
  expect(html, 'the app must hand a document to the print WebView').toBeTruthy();
  return html!;
}

/** Every page, as the text it holds: the page's own content, whitespace
 *  collapsed. Paged.js's ids and refs differ between runs, the words do not. */
async function pageText(page: Page, html: string): Promise<string[]> {
  await page.setContent(html.replace(/<script[\s\S]*?<\/script>/gi, ''));
  await page.evaluate(() => document.fonts.ready);
  return page.locator('.pagedjs_page_content').evaluateAll((cols) =>
    cols.map((col) => (col.textContent ?? '').replace(/\s+/g, ' ').trim()));
}

const BOUNDARY_NOTE = `${Array.from({ length: 30 }, (_, i) => `Line ${i} of filler prose in a paragraph.`).join('  \n')}

## A heading near the foot

Some prose after the heading.

$$
 u = (1, -1, 2)
$$

Final line.
`;

for (const options of [
  { columns: 1, direction: 'ltr', mathAlign: 'center' },
  { columns: 2, direction: 'rtl', mathAlign: 'start' },
] as const) {
  test(`print: the app and the browser paginate the same note identically (${options.columns} column(s))`, async ({ page }) => {
    const web = await pageText(page, await printWeb(page, homework, options));
    const app = await pageText(page, await printApp(page, homework, options));
    expect(app.length).toBe(web.length);
    // Page by page: the same text, in the same place. A difference in room on
    // any page (a reserve, a font-scale correction, a stray margin) moves a
    // section across a break and fails here.
    for (const [index, text] of web.entries()) {
      expect(app[index], `page ${index + 1}`).toBe(text);
    }
  });
}

test('print: a section at the foot of a page breaks the same way in the app as in the browser', async ({ page }) => {
  const options: PrintOptions = { columns: 1, direction: 'ltr', mathAlign: 'center' };
  const web = await pageText(page, await printWeb(page, BOUNDARY_NOTE, options));
  const app = await pageText(page, await printApp(page, BOUNDARY_NOTE, options));
  expect(app).toEqual(web);
  // The note is long enough to reach the boundary: the heading and its prose
  // sit on the first page, and the formula plus the last line follow.
  expect(web.length).toBe(2);
  expect(web[0]).toContain('A heading near the foot');
  expect(web[1]).toContain('Final line.');
});

test('print: the phone’s font scale changes neither the pages nor the hand-off', async ({ page }) => {
  const options: PrintOptions = { columns: 1, direction: 'ltr', mathAlign: 'center' };
  const plain = await printApp(page, homework, options, 1);
  const scaled = await printApp(page, homework, options, 1.3);
  // Paged.js writes a fresh data-ref onto every element it lays out; everything
  // else — the pages, their breaks, every measured box — must be the same.
  const withoutRefs = (html: string): string => html.replace(/ ?data-ref="[^"]*"/g, '');
  expect(withoutRefs(scaled)).toBe(withoutRefs(plain));
});
