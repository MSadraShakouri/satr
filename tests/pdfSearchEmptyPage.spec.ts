import { expect, test } from '@playwright/test';
import { picturePdf } from './support/tinyPdf';

/** A textless first page followed by text: page boundaries must not shift. */
function twoPages(): string {
  const first = '0 0 595 842 re f';
  const second = 'BT /F1 24 Tf 60 700 Td (quenchwort) Tj ET';
  const objects = [
    '',
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
    `<< /Length ${first.length} >>\nstream\n${first}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${second.length} >>\nstream\n${second}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i += 1) { offsets[i] = pdf.length; pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
}

test('an image-only page contributes no text and remains cached', async ({ page }) => {
  await page.addInitScript((pdf) => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/scan.pdf': 1, 'Notes/note.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/scan.pdf', pdf);
    localStorage.setItem('satr:fs:file:Notes/note.md', 'note');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/note.md' }], active: 0 }));
  }, picturePdf(0.8, { text: 'none' }));
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('note');
  const result = await page.evaluate(async () => {
    const { backend } = window.__satr.load('/src/vault.ts');
    const { pdfium } = window.__satr.load('/src/pdfiumEngine.ts');
    const engine = await pdfium();
    const bytes = await backend.readBytes('Notes/scan.pdf');
    const doc = await engine.openDocumentBuffer({ id: 'audit-scan', content: bytes!.slice().buffer }).toPromise();
    const glyphs = await engine.getPageGlyphs(doc, doc.pages[0]).toPromise();
    await engine.closeDocument(doc).toPromise();
    let reads = 0;
    const original = backend.readBytes.bind(backend);
    backend.readBytes = async (path: string) => { reads += 1; return original(path); };
    const text = window.__satr.load('/src/documentText.ts');
    const first = await text.textOf('Notes/scan.pdf');
    const second = await text.textOf('Notes/scan.pdf');
    return { glyphs: glyphs.length, first, second, held: text.textHeld('Notes/scan.pdf'), reads };
  });
  expect(result.glyphs, 'the scanned fixture has no text glyphs').toBe(0);
  expect(result.first, 'textless pages do not add synthetic text to folder search').toBe('');
  expect(result.held, 'a successful empty extraction is cached').toBe('');
  expect(result.second, 'a cached scan stays empty').toBe('');
  expect(result.reads, 'a cached scan is not read repeatedly').toBe(1);
});

test('a textless page before a text page preserves the result page', async ({ page }) => {
  await page.addInitScript((pdf) => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/mixed.pdf': 1, 'Notes/note.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/mixed.pdf', pdf);
    localStorage.setItem('satr:fs:file:Notes/note.md', 'note');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/note.md' }], active: 0 }));
  }, twoPages());
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('note');
  const result = await page.evaluate(async () => {
    const document = window.__satr.load('/src/documentText.ts');
    const text = await document.textOf('Notes/mixed.pdf');
    return { text, page: document.pageAt('Notes/mixed.pdf', text.indexOf('quenchwort')) };
  });
  expect(result.text, 'the empty first page contributes only a separator').toBe('\nquenchwort');
  expect(result.page, 'the word still belongs to page two').toBe(2);
});
