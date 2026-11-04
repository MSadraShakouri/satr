import { expect, test, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// Launching on a document's tab must not read the document as text. The
// launch has its own way in -- not openTab, not openFile -- and it read
// whatever the tab pointed at end to end before showing it. For a picture
// that was already skipped; a pdf was not, so a 31MB book became 41 million
// characters of base64 at the slowest possible moment, and then was thrown
// away: showFile keeps no text for a document and reads its bytes again.

const PDF = tinyPdf(6);

declare global {
  interface Window {
    __satr: { load(path: string): { lines(): { area: string; text: string; facts?: Record<string, unknown> }[] } };
  }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

async function bootOn(page: Page, path: string): Promise<void> {
  await page.addInitScript(([pdf, open]: [string, string]) => {
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/doc.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n\nwords\n');
    localStorage.setItem('satr:fs:file:Notes/doc.pdf', pdf);
    localStorage.setItem('satr:tabs', open);
  }, [PDF, JSON.stringify({ tabs: [{ path: 'Notes/doc.pdf' }, { path: 'Notes/A.md' }], active: path.endsWith('.pdf') ? 0 : 1 })] as [string, string]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

const lines = (page: Page) => page.evaluate(() =>
  window.__satr.load('/src/log.ts').lines().map((line) => ({ area: line.area, text: line.text, facts: line.facts ?? {} })));

test('launching on a pdf does not read it as text', async ({ page }) => {
  await bootOn(page, 'Notes/doc.pdf');
  await page.waitForSelector('.pdf-page canvas', { timeout: 30_000 });
  const said = await lines(page);
  const asText = said.filter((line) => line.area === 'file' && line.text === 'read' && line.facts.path === 'Notes/doc.pdf');
  expect(asText, 'the launch reads nothing it is going to throw away').toHaveLength(0);
  expect(said.some((line) => line.area === 'pdf' && line.text.startsWith('bytes read')), 'the bytes are still read, once, as bytes').toBe(true);
});

test('launching on a note still reads the note', async ({ page }) => {
  // The same assertion the other way round: the saving must come from the
  // file being a document, not from the launch having stopped reading.
  await bootOn(page, 'Notes/A.md');
  await expect(page.locator('.cm-file-name')).toBeVisible();
  const said = await lines(page);
  const read = said.filter((line) => line.area === 'file' && line.text === 'read' && line.facts.path === 'Notes/A.md');
  expect(read, 'a note is read at launch, as it always was').toHaveLength(1);
  expect(read[0].facts.bytes, 'and all of it').toBe('# A\n\nwords\n'.length);
});
