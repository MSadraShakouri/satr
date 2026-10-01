// The app's print path: what src/exportPdf.ts hands to SatrPrint (the native
// plugin behind PrintPlugin.java's print WebView), and whether that document
// still lays out as the A4 pages Paged.js measured, whatever viewport the
// print WebView has. The browser's print dialog is covered by
// tests/printLayout.spec.ts; the web path and this one diverge only here.
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { PrintOptions } from '../src/printOptions';

const homework = await readFile(new URL('./fixtures/homework-12-2.md', import.meta.url), 'utf8');

declare global {
  interface Window {
    __printHtml?: string;
    __fontScale?: number;
  }
}

/** A4 at 96 CSS px/in: the geometry Paged.js paginated every page at. */
const A4_WIDTH = 210 / 25.4 * 96;
const A4_HEIGHT = 297 / 25.4 * 96;

/** Exports the note the way the Android app does: the platform reports as
 *  native, SatrPrint is the native plugin and keeps the document the app
 *  hands to the print WebView instead of printing it. `scale` is the phone's
 *  font scale: the app WebView is pinned at 100% text zoom, so the scale
 *  reaches the page the way the plugin reports it — as --system-font-scale
 *  for the app's own CSS (src/native.ts) — and never as a WebView zoom. */
async function printNative(page: Page, markdown: string, options: PrintOptions, scale = 1): Promise<string> {
  await page.addInitScript(() => {
    window.__printHtml = undefined;
    window.__fontScale = 1;
    // Stand in for the Android runtime: these two plugins are native, so
    // their calls arrive here rather than crossing the bridge.
    window.Capacitor = {
      PluginHeaders: [
        { name: 'SatrPrint', methods: [{ name: 'print', rtype: 'promise' }] },
        { name: 'SatrSystemBars', methods: [{ name: 'get', rtype: 'promise' }] },
      ],
      nativePromise: (plugin: string, _method: string, options?: { html?: string }) => {
        if (plugin === 'SatrPrint') {
          window.__printHtml = options?.html;
          return Promise.resolve();
        }
        if (plugin === 'SatrSystemBars') {
          return Promise.resolve({ top: 0, right: 0, bottom: 0, left: 0, fontScale: window.__fontScale });
        }
        return Promise.resolve();
      },
    };
  });
  await page.goto('/');
  const html = await page.evaluate(async ({ markdown, options, scale }) => {
    window.__fontScale = scale;
    document.documentElement.style.setProperty('--system-font-scale', String(scale));
    window.Capacitor.isNativePlatform = () => true;
    const path = '/src/exportPdf.ts';
    const { exportPdf } = await import(path);
    await exportPdf('Print hand-off regression', markdown, '', options);
    return window.__printHtml;
  }, { markdown, options, scale });
  expect(html, 'the app must hand a document to the print WebView').toBeTruthy();
  return html!;
}

/** Opens that document the way the print WebView does: on a phone-sized
 *  viewport, scripts off, in print media. */
async function openPrintDocument(page: Page, html: string): Promise<void> {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.setContent(html.replace(/<script[\s\S]*?<\/script>/gi, ''));
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
}

/** Every page, in print media on a phone-sized viewport: none may be shorter
 *  than the paper (Paged.js's own print rules tie them to 100% of whatever
 *  viewport the print WebView has, which clipped the bottom of every page
 *  off the sheet), none may hold more content than it measured, and the body
 *  must not be capped at that viewport either, or the pages' right-hand side
 *  — a whole column in two-column mode — would stay outside it. */
async function pageGeometry(page: Page) {
  return page.evaluate(() => {
    const pages = [...document.querySelectorAll<HTMLElement>('.pagedjs_page')];
    const sheets = [...document.querySelectorAll<HTMLElement>('.pagedjs_sheet')];
    return {
      pages: pages.length,
      documentWidth: Math.round(document.documentElement.scrollWidth),
      bodyWidth: Math.round(document.body.getBoundingClientRect().width),
      pageHeights: pages.map((p) => Math.round(p.getBoundingClientRect().height)),
      sheetHeights: sheets.map((s) => Math.round(s.getBoundingClientRect().height)),
      // The native hand-off leaves 32px below paginated text, so a tiny
      // WebView font-metric difference cannot clip the last line on a sheet.
      contentBottomGaps: pages.map((p) => {
        const content = p.querySelector<HTMLElement>('.pagedjs_page_content');
        const area = content?.parentElement;
        return content && area ? Math.round(area.getBoundingClientRect().height - content.getBoundingClientRect().height) : 0;
      }),
      overflowing: pages.flatMap((p, i) => {
        const content = p.querySelector<HTMLElement>('.pagedjs_page_content');
        const over = content ? content.scrollHeight - content.clientHeight : 0;
        return over > 1 ? [{ page: i, over: Math.round(over) }] : [];
      }),
      // A column that cannot be shown: the page content must not be a
      // multi-column container, or a line that no longer fits the column is
      // laid out — and clipped — beside the sheet, off the paper. That is the
      // line Android's PDF used to lose at a page boundary.
      columnLeaks: pages.flatMap((p, i) => {
        const content = p.querySelector<HTMLElement>('.pagedjs_page_content');
        const over = content ? content.scrollWidth - content.clientWidth : 0;
        return over > 1 ? [{ page: i, over: Math.round(over) }] : [];
      }),
      // Any text laid out past the sheet's right-hand edge: it can only be
      // seen by a page that does not exist.
      offSheetText: pages.flatMap((p, i) => {
        const sheet = p.querySelector<HTMLElement>('.pagedjs_sheet');
        if (!sheet) return [];
        const edge = sheet.getBoundingClientRect().right;
        let worst = 0;
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (!node.textContent?.trim() || !parent || parent.closest('.katex-mathml')) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.height) worst = Math.max(worst, rect.right - edge);
          }
        }
        return worst > 1 ? [{ page: i, over: Math.round(worst) }] : [];
      }),
    };
  });
}

for (const columns of [1, 2] as const) {
  test(`app: ${columns} column(s) keep every page whole in the print WebView`, async ({ page }) => {
    const html = await printNative(page, homework, { columns, direction: 'ltr', mathAlign: 'center' });
    await openPrintDocument(page, html);
    const geometry = await pageGeometry(page);
    expect(geometry.pages).toBe(8);
    expect(geometry.documentWidth).toBeGreaterThanOrEqual(Math.floor(A4_WIDTH));
    expect(geometry.bodyWidth).toBeGreaterThanOrEqual(Math.floor(A4_WIDTH));
    for (const height of [...geometry.pageHeights, ...geometry.sheetHeights]) {
      expect(Math.abs(height - A4_HEIGHT), `page of ${height}px on A4`).toBeLessThanOrEqual(1);
    }
    expect(geometry.overflowing).toEqual([]);
    expect(geometry.columnLeaks).toEqual([]);
    expect(geometry.offSheetText).toEqual([]);
    expect(geometry.contentBottomGaps.every((gap) => gap >= 31)).toBe(true);
    // The laid-out pages still hold the whole note.
    const content = page.locator('.pagedjs_page_content');
    await expect(content.locator('h3')).toHaveText(Array.from({ length: 40 }, (_, i) => `${i + 1}.`));
    await expect(content.locator('.math-display')).toHaveCount(64);
    const text = (await content.allTextContents()).join('');
    expect(text.match(/head-to-tail\./g)?.length).toBe(2);
    expect(text.match(/Graphical exercise — sketch/g)?.length).toBe(2);
  });
}

test('app: a print WebView that lays text a hair taller keeps every line on the paper', async ({ page }) => {
  // The print WebView is its own layout engine instance, and Android's A4
  // (PrintPlugin.java) is never Paged.js's to the last fraction of a pixel,
  // so its pages can come out a hair taller than the ones Paged.js measured.
  // The page content used to be a fixed-height multi-column container: the
  // line that no longer fitted its column was laid out in the next column —
  // past the sheet's right edge, where the sheet's overflow: hidden and the
  // paper both end. That is the line Android's PDF dropped at a page
  // boundary. Make every text size 2% taller and check the surplus runs down
  // the page instead.
  const html = await printNative(page, homework, { columns: 1, direction: 'ltr', mathAlign: 'center' });
  await openPrintDocument(page, html);
  await page.addStyleTag({ content: 'html { font-size: 15.3px !important; }' });
  const geometry = await pageGeometry(page);
  expect(geometry.columnLeaks).toEqual([]);
  expect(geometry.offSheetText).toEqual([]);
  expect(geometry.pages).toBe(8);
  const pdf = await page.pdf({ preferCSSPageSize: true });
  expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBe(8);
  const content = page.locator('.pagedjs_page_content');
  await expect(content.locator('h3')).toHaveText(Array.from({ length: 40 }, (_, i) => `${i + 1}.`));
  await expect(content.locator('.math-display')).toHaveCount(64);
});

test('app: the document handed over is static and asks for the paper’s width', async ({ page }) => {
  const html = await printNative(page, homework, { columns: 1, direction: 'ltr', mathAlign: 'center' });
  // Nothing for the print WebView to run or re-measure, and no spent copy of
  // the note: Paged.js leaves the original HTML in a <template>.
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<template/i);
  // The pages are A4: view the document at the paper's width, so nothing is
  // scaled to fit it (PrintPlugin.java sets useWideViewPort).
  expect(html).toMatch(/<meta name="viewport" content="width=794, initial-scale=1">/i);
  // A4 with no margins, as the last word in the cascade: the pages carry
  // their own 1in ones, and Paged.js's letter-sized @page must not shrink
  // the paper under them.
  expect(html).toMatch(/@page\s*\{\s*size:\s*210mm 297mm;\s*margin:\s*0/);
  // An overfull page runs on down the paper: the sheet does not clip it, and
  // the page content is plain flow with no second column to fall into (see
  // the "a hair taller" test above for what that used to cost).
  expect(html).toMatch(/\.pagedjs_sheet\s*\{\s*overflow:\s*visible\s*!important/);
  expect(html).toMatch(/display:\s*flow-root\s*!important/);
  expect(html).toMatch(/column-width:\s*auto\s*!important/);
  expect(html).toMatch(/column-count:\s*auto\s*!important/);
  // The pages are measured and printed at 100%, whatever the phone's font
  // scale: the app's own sheet carries the scale (--system-font-scale), and
  // none of it is in the print CSS.
  expect(html).toMatch(/html\s*\{[^}]*font-size:\s*15px/);
});

test('app: a phone font scale changes neither the pages nor the output', async ({ page }) => {
  // The app WebView no longer follows Android's text zoom: both WebViews are
  // pinned at 100% (SystemBarsPlugin.java, PrintPlugin.java) and the phone's
  // font scale is applied in the app's own CSS — --system-font-scale, which
  // src/style.css derives the note's text from. The export measures in a
  // frame of its own, which that scale cannot reach, so the pages are the
  // same ones at any phone font size, and the print WebView receives them
  // untouched.
  const plain = await printNative(page, homework, { columns: 1, direction: 'ltr', mathAlign: 'center' }, 1);
  const scaled = await printNative(page, homework, { columns: 1, direction: 'ltr', mathAlign: 'center' }, 1.3);
  // Paged.js writes a fresh data-ref onto every element it lays out, so the
  // two hand-overs are compared without those: everything else — the order of
  // the pages, every measured box and style — must be identical.
  const withoutRefs = (html: string): string => html.replace(/ ?data-ref="[^"]*"/g, '');
  expect(withoutRefs(scaled)).toBe(withoutRefs(plain));
  await openPrintDocument(page, scaled);
  const geometry = await pageGeometry(page);
  expect(geometry.pages).toBe(8);
  for (const height of [...geometry.pageHeights, ...geometry.sheetHeights]) {
    expect(Math.abs(height - A4_HEIGHT), `page of ${height}px on A4`).toBeLessThanOrEqual(1);
  }
  expect(geometry.overflowing).toEqual([]);
  expect(geometry.columnLeaks).toEqual([]);
  expect(geometry.offSheetText).toEqual([]);
  expect(geometry.contentBottomGaps.every((gap) => gap >= 31)).toBe(true);
  const content = page.locator('.pagedjs_page_content');
  await expect(content.locator('h3')).toHaveText(Array.from({ length: 40 }, (_, i) => `${i + 1}.`));
  await expect(content.locator('.math-display')).toHaveCount(64);
});

test('app: the handed-over pages print as one sheet per page', async ({ page }) => {
  for (const [columns, sheets] of [[1, 8], [2, 4]] as const) {
    const html = await printNative(page, homework, { columns, direction: 'ltr', mathAlign: 'center' });
    await openPrintDocument(page, html);
    const pdf = await page.pdf({ preferCSSPageSize: true });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length, `${columns} column(s)`).toBe(sheets);
  }
});
