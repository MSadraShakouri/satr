import { expect, test, type Page } from '@playwright/test';
import { picturePdf, typesetPdf } from './support/tinyPdf';
const PDF = typesetPdf([{ chapter: 'quenchwort' }]);
const PATH = 'Notes/retry.pdf';
async function boot(page: Page): Promise<void> {
  await page.addInitScript((pdf) => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/retry.pdf': 1, 'Notes/note.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/retry.pdf', pdf);
    localStorage.setItem('satr:fs:file:Notes/note.md', 'note');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/note.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, PDF);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('note');
  await page.evaluate(() => {
    const now = performance.now.bind(performance);
    (window as any).auditElapsed = 0;
    performance.now = () => now() + (window as any).auditElapsed;
  });
}
for (const failure of ['throws', 'missing'] as const) {
  test(`a PDF text read that ${failure} can retry after a quiet interval`, async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(async ({ path, failure }) => {
      const { backend } = window.__satr.load('/src/vault.ts');
      const document = window.__satr.load('/src/documentText.ts');
      const original = backend.readBytes.bind(backend);
      let calls = 0;
      backend.readBytes = async (p: string) => {
        calls += 1;
        if (calls === 1) { if (failure === 'throws') throw new Error('injected failure'); return null; }
        return original(p);
      };
      const first = await document.textOf(path);
      const before = document.textHeld(path);
      for (let n = 0; n < 10; n += 1) await document.textOf(path);
      const callsDuringCooldown = calls;
      (window as any).auditElapsed = 30000;
      const recovered = await document.textOf(path);
      const again = await document.textOf(path);
      return { first, before, callsDuringCooldown, calls, recovered, again };
    }, { path: PATH, failure });
    expect(result.first, 'the failed request does not throw into search').toBe('');
    expect(result.before, 'a failed read is not cached as successful empty text').toBeNull();
    expect(result.callsDuringCooldown, 'repeated searches do not hammer a broken file').toBe(1);
    expect(result.calls, 'the next request after the quiet interval retries once').toBe(2);
    expect(result.recovered, 'the text is found after the failure clears').toContain('quenchwort');
    expect(result.again, 'a successful read remains cached').toBe(result.recovered);
  });
}

test('a failed folder search does not self-refresh forever and a later query retries', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const { backend } = window.__satr.load('/src/vault.ts');
    const original = backend.readBytes.bind(backend);
    (window as any).auditReads = 0;
    backend.readBytes = async (path: string) => {
      if (path === 'Notes/retry.pdf') {
        (window as any).auditReads += 1;
        if ((window as any).auditReads === 1) throw new Error('injected failure');
      }
      return original(path);
    };
  });
  await page.keyboard.press('Control+Shift+f');
  const panel = page.locator('#right-panel');
  await panel.locator('[data-scope="all"]').click();
  await panel.locator('.vault-search').fill('quenchwort');
  await expect(panel.locator('.pane-empty')).toHaveText('No results', { timeout: 10000 });
  await expect.poll(() => page.evaluate(() => (window as any).auditReads)).toBe(1);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as any).auditReads), 'failed extraction does not continuously refresh').toBe(1);
  await page.evaluate(() => { (window as any).auditElapsed = 30000; });
  await panel.locator('.vault-search').fill('quenchwortx');
  await panel.locator('.vault-search').fill('quenchwort');
  await expect(panel.locator(`.search-result-file-match[data-path="${PATH}"]`), 'a later search finds the document').toBeVisible({ timeout: 10000 });
  expect(await page.evaluate(() => (window as any).auditReads), 'the successful retry read once').toBe(2);
});


test('a successfully extracted image-only PDF stays cached as empty', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async ({ path, pdf }) => {
    const { backend } = window.__satr.load('/src/vault.ts');
    const document = window.__satr.load('/src/documentText.ts');
    await backend.write(path, pdf);
    const original = backend.readBytes.bind(backend);
    let reads = 0;
    backend.readBytes = async (p: string) => { reads += 1; return original(p); };
    const first = await document.textOf(path);
    (window as any).auditElapsed = 30000;
    const second = await document.textOf(path);
    return { first, second, held: document.textHeld(path), reads };
  }, { path: PATH, pdf: picturePdf(0.8, { text: 'none' }) });
  expect(result.first, 'a picture-only page has no extracted text').toBe('');
  expect(result.held, 'a successful empty extraction is retained').toBe('');
  expect(result.second, 'the second search also sees no text').toBe('');
  expect(result.reads, 'successful empty text does not cause repeated reads').toBe(1);
});

test('an invalidated failing request cannot put the replacement into cooldown', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const { backend } = window.__satr.load('/src/vault.ts');
    const document = window.__satr.load('/src/documentText.ts');
    const original = backend.readBytes.bind(backend);
    let calls = 0;
    backend.readBytes = async (p: string) => {
      calls += 1;
      if (calls === 1) { await new Promise<void>((resolve) => { (window as any).releaseFailedRead = resolve; }); throw new Error('injected failure'); }
      return original(p);
    };
    (window as any).oldRead = document.textOf('Notes/retry.pdf');
  });
  await page.waitForFunction(() => Boolean((window as any).releaseFailedRead));
  const result = await page.evaluate(async () => {
    const document = window.__satr.load('/src/documentText.ts');
    document.forgetText('Notes/retry.pdf');
    const fresh = document.textOf('Notes/retry.pdf');
    (window as any).releaseFailedRead();
    await (window as any).oldRead;
    return await fresh;
  });
  expect(result, 'the replacement is read despite the invalidated failure').toContain('quenchwort');
});
