import { test, expect } from '@playwright/test';

/** Headings taken from the author's own notes: Persian with a bracketed
 *  aside, Persian with a Latin word in brackets, and Persian with a formula
 *  between the brackets. Exported to a real PDF and read back through the
 *  viewer, the contents used to show ")افراز(", "انحنا )Curvature)" and
 *  "بردار نرمال یکه ( )" — brackets facing the wrong way, and a hole where
 *  the formula stood. */
const BODY = Array.from({ length: 9 }, () =>
  'در این بخش به بررسی رابطه میان مشتق و بردارهای مماس می‌پردازیم و چند مثال ساده را با هم حل می‌کنیم.').join(' ');
const NOTE = [
  '# جلسه هفتم', '', BODY, '',
  '## ضرایب چندجمله ای (افراز)', '', BODY, '', BODY, '',
  '### انحنا (Curvature)', '', BODY, '', BODY, '',
  '### بردار نرمال یکه ($\\vec{N}$)', '', BODY, '', BODY, '',
].join('\n');

test('the contents of an exported note keep their brackets and their formulas', async ({ page, browser }) => {
  test.setTimeout(180000);
  await page.addInitScript(() => {
    window.print = () => {
      (window.parent as unknown as { __printedHtml?: string }).__printedHtml = document.documentElement.outerHTML;
    };
  });
  await page.goto('/');
  const html = await page.evaluate(async (markdown) => {
    const { exportPdf } = await window.__satr.load('/src/exportPdf.ts');
    await exportPdf('Outline', markdown as string, '', { columns: 1, direction: 'rtl', mathAlign: 'center' });
    return (window as unknown as { __printedHtml?: string }).__printedHtml ?? '';
  }, NOTE);
  expect(html).toBeTruthy();

  // The PDF the phone would write: the export document, printed.
  const sheet = await browser.newPage();
  await sheet.setContent(html, { waitUntil: 'networkidle' });
  const bytes = await sheet.pdf({ format: 'A4', printBackground: true });
  await sheet.close();

  const viewer = await browser.newPage();
  await viewer.addInitScript((pdf) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/export.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/export.pdf', pdf as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/export.pdf' }], active: 0 }));
  }, `data:application/pdf;base64,${bytes.toString('base64')}`);
  await viewer.setViewportSize({ width: 390, height: 700 });
  await viewer.goto('/');
  await viewer.waitForSelector('#boot-snapshot', { state: 'detached' });
  await viewer.locator('[aria-label="Table of contents"], [title="Table of contents"]').first().click();
  const items = viewer.locator('.pdf-outline-view .tree-item-inner');
  await expect(items.first()).toBeVisible({ timeout: 30000 });
  const titles = (await items.allTextContents()).map((text) => text.trim());
  await viewer.close();

  expect(titles).toContain('ضرایب چندجمله ای (افراز)');
  expect(titles).toContain('انحنا (Curvature)');
  // "Try to decode, if not possible show that something belonged there":
  // KaTeX's letters are in the file, so the N is read back.
  expect(titles).toContain('بردار نرمال یکه (N)');
  expect(titles.join(' ')).not.toContain(')افراز(');
});

test('a formula whose letters the file gives no reading for leaves a mark', async ({ page }) => {
  await page.goto('/');
  const read = await page.evaluate(() => {
    const { readableMath } = window.__satr.load('/src/pdfView.ts') as { readableMath: (text: string) => string };
    return [readableMath('\uE103\uE104'), readableMath('x\uFFFD\uFFFDy'), readableMath('N')];
  });
  expect(read).toEqual(['…', 'x…y', 'N']);
});
