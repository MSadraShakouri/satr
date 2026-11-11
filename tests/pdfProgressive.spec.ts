import { test, expect } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

const sample = tinyPdf(3);

test('a large stored Blob opens through PDFium random access and keeps the same place key', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  const keyEqual = await page.evaluate(async (url) => {
    const { backend } = (window as any).__satr.load('/src/vault.ts');
    const { pdfKey } = (window as any).__satr.load('/src/pdfView.ts');
    const raw = atob(url.split(',')[1]);
    const original = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    // Add an inert PDF comment after the original EOF, then a new trailer
    // pointing at the original xref. The file is large without private data.
    const xref = /startxref\n(\d+)\n%%EOF/.exec(raw)![1];
    const blob = new Blob([original, '\n%', new Uint8Array(17 * 1024 * 1024).fill(120), `\nstartxref\n${xref}\n%%EOF\n`], { type: 'application/pdf' });
    const equal = await pdfKey(blob) === await pdfKey(new Uint8Array(await blob.arrayBuffer()));
    await backend.writeBytes('Notes/large-random.pdf', blob);
    await backend.write('Notes/A.md', '# A note');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/large-random.pdf' }, { path: 'Notes/A.md' }], active: 0 }));
    return equal;
  }, sample);
  expect(keyEqual).toBe(true);
  await page.reload();
  await expect(page.locator('.pdf-page')).toHaveCount(3, { timeout: 30000 });
  await expect.poll(() => page.locator('.pdf-page canvas').count(), { timeout: 30000 }).toBeGreaterThan(0);
  const logs = await page.evaluate(() => (window as any).__satr.load('/src/log.ts').lines());
  const opening = logs.find((l: any) => l.text === 'random source opened');
  expect(opening).toBeTruthy();
  expect(opening.facts.bytes).toBeLessThan(1024 * 1024);
  expect(opening.facts.size).toBeGreaterThan(16 * 1024 * 1024);
  await expect.poll(() => page.evaluate(() => (window as any).__satr.load('/src/log.ts').lines().some((line: any) => line.text === 'random reads after first page')), { timeout: 10000 }).toBe(true);
  await page.locator('#nav-tabs').first().evaluate((el: HTMLButtonElement) => el.click());
  await page.locator('.mobile-tab-title').getByText('A', { exact: true }).click();
  await expect(page.locator('.pdf-page')).toHaveCount(0);
  await page.locator('#nav-tabs').first().evaluate((el: HTMLButtonElement) => el.click());
  await page.locator('.mobile-tab-title').getByText('large-random.pdf', { exact: true }).click();
  await expect(page.locator('.pdf-page')).toHaveCount(3, { timeout: 30000 });
  await expect.poll(() => page.locator('.pdf-page canvas').count(), { timeout: 30000 }).toBeGreaterThan(0);
  await page.locator('#nav-tabs').first().evaluate((el: HTMLButtonElement) => el.click());
  await page.locator('.mobile-tab').filter({ has: page.locator('.mobile-tab-title', { hasText: 'large-random.pdf' }) }).getByRole('button', { name: 'Close tab' }).click();
  await expect(page.locator('.pdf-page')).toHaveCount(0);
});

test('the worker reads bounded binary ranges, searches, closes and refuses failed ranges', async ({ page }) => {
  const raw = Buffer.from(sample.split(',')[1], 'base64').toString('latin1');
  let pageNumber = 0;
  const mixed = raw.replace(/\/MediaBox \[0 0 595 842\]/g, (box) => ++pageNumber === 2 ? '/MediaBox [0 0 842 595]' : box);
  const bytes = Buffer.from(mixed, 'latin1');
  let requests = 0;
  let broken = false;
  await page.route('**/__test_pdf_ranges/**', async (route) => {
    requests += 1;
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset'));
    const length = Number(url.searchParams.get('length'));
    if (broken || !Number.isInteger(offset) || !Number.isInteger(length) || length < 1 || length > 1024 * 1024 || offset < 0 || offset + length > bytes.length) {
      await route.fulfill({ status: 404, body: '' });
    } else await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: bytes.subarray(offset, offset + length), headers: { 'cache-control': 'no-store' } });
  });
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  const result = await page.evaluate(async ({ size, base64 }) => {
    const { pdfium, openPdfUrlSource } = (window as any).__satr.load('/src/pdfiumEngine.ts');
    const engine = await pdfium();
    const remote = await openPdfUrlSource('test-random-ranges', { url: new URL('/__test_pdf_ranges/test', location.href).href, size });
    const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const full = await engine.openDocumentBuffer({ id: 'test-buffer', content: raw.buffer }).toPromise();
    const randomSearch = await engine.searchAllPages(remote.document, 'Page').toPromise();
    const fullSearch = await engine.searchAllPages(full, 'Page').toPromise();
    const pixelHashes = async (document: any) => Promise.all(document.pages.map(async (p: any) => {
      const image = await engine.renderPageRaw(document, p, { scaleFactor: 0.3, dpr: 1, withAnnotations: false }).toPromise();
      const digest = await crypto.subtle.digest('SHA-256', image.data);
      return Array.from(new Uint8Array(digest));
    }));
    const answer = { pages: remote.document.pages, fullPages: full.pages, pixels: await pixelHashes(remote.document), fullPixels: await pixelHashes(full), found: randomSearch.results.length, fullFound: fullSearch.results.length, reads: remote.reads };
    await engine.closeDocument(remote.document).toPromise();
    await engine.closeDocument(full).toPromise();
    return answer;
  }, { size: bytes.length, base64: bytes.toString('base64') });
  expect(requests).toBeGreaterThan(0);
  expect(result.pages).toEqual(result.fullPages);
  expect(result.pages[1].size).not.toEqual(result.pages[0].size);
  expect(result.pixels).toEqual(result.fullPixels);
  expect(result.found).toBe(3);
  expect(result.found).toBe(result.fullFound);
  expect(result.reads).toBeGreaterThan(0);
  broken = true;
  const refused = await page.evaluate(async (size) => {
    try {
      const { openPdfUrlSource } = (window as any).__satr.load('/src/pdfiumEngine.ts');
      await openPdfUrlSource('test-broken-ranges', { url: new URL('/__test_pdf_ranges/test', location.href).href, size });
      return false;
    } catch { return true; }
  }, bytes.length);
  expect(refused).toBe(true);
});

test('an unavailable range source falls back to the whole file', async ({ page }) => {
  await page.route('**/__test_pdf_ranges/broken**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  const outcome = await page.evaluate(async ({ base64, size }) => {
    const { showPdf } = (window as any).__satr.load('/src/pdfView.ts');
    const host = document.createElement('div');
    const scroller = document.createElement('div');
    scroller.append(host); document.body.append(scroller);
    let fallbacks = 0;
    const handle = await showPdf(host, { kind: 'device-pdf', token: 'fake', url: new URL('/__test_pdf_ranges/broken', location.href).href, size }, {
      scroller,
      readDeviceFallback: async () => { fallbacks++; return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer; },
    });
    const pages = host.querySelectorAll('.pdf-page').length;
    const hits = await handle.find('Page');
    handle.destroy(); scroller.remove();
    return { pages, fallbacks, hits: hits.length };
  }, { size: Buffer.from(sample.split(',')[1], 'base64').length, base64: sample.split(',')[1] });
  expect(outcome).toEqual({ pages: 3, fallbacks: 1, hits: 3 });
});


test('the worker transport probe accepts exact bytes and rejects a bad response', async ({ browser }) => {
  for (const success of [true, false]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/__test_pdf_probe/**', async (route) => {
      await route.fulfill({ status: success ? 200 : 404, contentType: 'application/octet-stream', body: success ? Buffer.from([1, 2, 3, 4]) : '' });
    });
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const { probeDeviceWorker } = (window as any).__satr.load('/src/pdfDevice.ts');
      return probeDeviceWorker({ url: new URL('/__test_pdf_probe/x', location.href).href, size: 4, token: 'x', kind: 'device-pdf' }, new Uint8Array([1, 2, 3, 4]));
    });
    expect(result).toBe(success);
    await context.close();
  }
});

/** Page streams live far from their page dictionaries, so a later search must
 * ask the source for bytes that were not needed to open the document. */
function scatteredPdf(): Buffer {
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let size = 0;
  const put = (text: string | Buffer) => { const b = Buffer.isBuffer(text) ? text : Buffer.from(text, 'latin1'); chunks.push(b); size += b.length; };
  put('%PDF-1.4\n');
  const object = (id: number, body: string) => { offsets[id] = size; put(`${id} 0 obj\n${body}\nendobj\n`); };
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>');
  for (const id of [3, 5, 7]) object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 9 0 R >> >> /Contents ${id + 1} 0 R >>`);
  object(9, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const id of [4, 6, 8]) {
    put('\n%'); put(Buffer.alloc(2 * 1024 * 1024, 120)); put('\n');
    const content = `BT /F1 24 Tf 30 700 Td (Scattered page ${id}) Tj ET`;
    object(id, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  const xref = size;
  put('xref\n0 10\n0000000000 65535 f \n');
  for (let id = 1; id <= 9; id++) put(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size 10 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

test('a source that fails after opening notifies the reader rather than silently returning blank pages', async ({ page }) => {
  const bytes = scatteredPdf();
  let broken = false;
  await page.route('**/__test_scattered/**', async (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset'));
    const length = Number(url.searchParams.get('length'));
    await route.fulfill(broken ? { status: 404, body: '' } : { status: 200, contentType: 'application/octet-stream', body: bytes.subarray(offset, offset + length) });
  });
  await page.goto('/');
  const doc = await page.evaluate(async (size) => {
    const { openPdfUrlSource, onPdfReadFailure, pdfium } = (window as any).__satr.load('/src/pdfiumEngine.ts');
    const result = await openPdfUrlSource('late-failure-test', { url: new URL('/__test_scattered/a', location.href).href, size });
    (window as any).__laterDoc = result.document;
    (window as any).__lateFailure = new Promise<boolean>((resolve) => {
      (window as any).__stopFailure = onPdfReadFailure(result.document.id, () => resolve(true));
      setTimeout(() => resolve(false), 10000);
    });
    (window as any).__pdfEngine = await pdfium();
    return result.document.pageCount;
  }, bytes.length);
  expect(doc).toBe(3);
  broken = true;
  const failed = await page.evaluate(async () => {
    const w = window as any;
    void w.__pdfEngine.searchAllPages(w.__laterDoc, 'Scattered').toPromise().catch(() => undefined);
    const notified = await w.__lateFailure;
    w.__stopFailure();
    await w.__pdfEngine.closeDocument(w.__laterDoc).toPromise();
    return notified;
  });
  expect(failed).toBe(true);
});

test('a late Blob source failure reopens the document from its complete bytes', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class WatchedWorker extends NativeWorker {
      postMessage(message: any, transfer?: any): void {
        if (message?.type === 'Start') (window as any).__pdfWorkerForFailure = this;
        if (transfer) super.postMessage(message, transfer); else super.postMessage(message);
      }
    }
    window.Worker = WatchedWorker as typeof Worker;
  });
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.evaluate(async (url) => {
    const { backend } = (window as any).__satr.load('/src/vault.ts');
    const raw = atob(url.split(',')[1]);
    const xref = /startxref\n(\d+)\n%%EOF/.exec(raw)![1];
    const original = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const blob = new Blob([original, '\n%', new Uint8Array(17 * 1024 * 1024).fill(120), `\nstartxref\n${xref}\n%%EOF\n`]);
    await backend.writeBytes('Notes/failure-retry.pdf', blob);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/failure-retry.pdf' }], active: 0 }));
  }, sample);
  await page.reload();
  await expect(page.locator('.pdf-page')).toHaveCount(3, { timeout: 30000 });
  await expect.poll(() => page.evaluate(() => (window as any).__satr.load('/src/log.ts').lines().filter((l: any) => l.text === 'document parsed').length), { timeout: 20000 }).toBe(1);
  await page.evaluate(() => {
    const worker = (window as any).__pdfWorkerForFailure;
    if (!worker) throw new Error('PDF worker was not captured');
    worker.dispatchEvent(new MessageEvent('message', { data: { type: 'satr-pdf-read-failed', documentId: 'satr-1' } }));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__satr.load('/src/log.ts').lines().some((l: any) => l.text === 'random source failed after opening; reading whole file')), { timeout: 20000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__satr.load('/src/log.ts').lines().filter((l: any) => l.text === 'document parsed').length), { timeout: 30000 }).toBe(2);
  await expect(page.locator('.pdf-page')).toHaveCount(3, { timeout: 30000 });
  await expect.poll(() => page.locator('.pdf-page canvas').count(), { timeout: 30000 }).toBeGreaterThan(0);
  const log = await page.evaluate(() => (window as any).__satr.load('/src/log.ts').lines().filter((l: any) => l.text === 'random source opened').length);
  expect(log).toBe(1); // the retry was the complete buffer, not another random source
});
