import { expect, test, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

interface Line { area: string; text: string; facts?: Record<string, unknown>; ms?: number }
declare global { interface Window { __satr: { load(path: string): any } } }
const lines = (page: Page): Promise<Line[]> => page.evaluate(() => window.__satr.load('/src/log.ts').lines());
async function boot(page: Page, pdf = false) {
  await page.addInitScript(({ pdf, data }) => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/private-name.md': 1, 'Notes/book.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/private-name.md', '# Secret content\n\nhello');
    localStorage.setItem('satr:fs:file:Notes/book.pdf', data);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: pdf ? 'Notes/book.pdf' : 'Notes/private-name.md' }], active: 0 }));
  }, { pdf, data: tinyPdf(6) });
  await page.goto('/'); await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}
test('launch names editor construction and a frame opportunity', async ({ page }) => {
  await boot(page);
  await expect.poll(async () => (await lines(page)).find(l => l.text === 'first screen frame opportunity')).toBeTruthy();
  const logs = await lines(page);
  const setup = logs.find(l => l.text === 'entry setup');
  expect(setup?.facts?.editorMs, 'editor construction is included in setup, not added to it').toEqual(expect.any(Number));
  const frame = logs.find(l => l.text === 'first screen frame opportunity');
  expect(frame?.facts?.afterReadyMs).toEqual(expect.any(Number));
});
test('an actual save has an outcome without note or filename', async ({ page }) => {
  await boot(page);
  await page.locator('.cm-content').click(); await page.keyboard.type('secret-typed-value');
  await expect.poll(async () => (await lines(page)).find(l => l.text === 'save attempt finished'), { timeout: 10000 }).toBeTruthy();
  const line = (await lines(page)).find(l => l.text === 'save attempt finished')!;
  expect(line.facts?.outcome).toBe('completed'); expect(line.facts?.totalMs).toEqual(expect.any(Number));
  expect(JSON.stringify(line)).not.toMatch(/secret|private-name/i);
});
test('pdf first picture includes elapsed time from showFile', async ({ page }) => {
  await boot(page, true);
  await expect.poll(async () => (await lines(page)).find(l => l.text === 'first page on glass'), { timeout: 20000 }).toBeTruthy();
  const line = (await lines(page)).find(l => l.text === 'first page on glass')!;
  expect(line.facts?.sinceShowFileMs).toEqual(expect.any(Number));
  expect(Number(line.facts?.sinceShowFileMs)).toBeGreaterThanOrEqual(Number(line.ms));
});
test('resume reports screen type and pending save without paths', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const line = (await lines(page)).find(l => l.text === 'came back')!;
  expect(line.facts?.screen).toBe('note');
  expect(line.facts?.savePending).toEqual(expect.any(Boolean));
  expect(JSON.stringify(line)).not.toMatch(/secret|private-name/i);
});
test('slow input, large selection changes and restore corrections give bounded metadata, not input', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const mod = window.__satr.load('/src/editorDiagnostics.ts');
    const log = window.__satr.load('/src/log.ts'); log.forget();
    const el = document.createElement('div'); document.body.append(el);
    const diag = mod.watchEditorDiagnostics(el);
    diag.selection(10, true, false);
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: 'secret-composition' }));
    el.dispatchEvent(new InputEvent('beforeinput', { data: 'secret-input', inputType: 'insertText', isComposing: true }));
    diag.selection(220, true, true);
    diag.correction(true);
    const t = performance.now(); while (performance.now() - t < 150) { /* a blocked frame */ }
    await new Promise(requestAnimationFrame);
    const data = log.lines().filter((line: Line) => ['large selection after input', 'editor restore correction', 'input frame delayed'].includes(line.text));
    el.remove(); return data;
  });
  expect(result.find((l: Line) => l.text === 'large selection after input')?.facts?.composing).toBe(true);
  expect(result.find((l: Line) => l.text === 'editor restore correction')?.facts?.composing).toBe(true);
  expect(result.find((l: Line) => l.text === 'input frame delayed')?.facts?.delayMs).toBeGreaterThanOrEqual(120);
  expect(JSON.stringify(result)).not.toMatch(/secret/);
  expect(Object.keys(result.find((l: Line) => l.text === 'large selection after input').facts).sort()).toEqual(['collapsed', 'composing']);
});
test('a felt stall includes the current screen and save state with an after-task memory sample', async ({ page }) => {
  await boot(page);
  const line = await page.evaluate(() => {
    const mod = window.__satr.load('/src/diagnostics.ts'); const log = window.__satr.load('/src/log.ts'); log.forget();
    const Original = window.PerformanceObserver; let cb: any;
    (window as any).PerformanceObserver = class { static supportedEntryTypes = ['longtask']; constructor(fn: any) { cb = fn; } observe() {} };
    try { mod.watchTheThread(() => ({ screen: 'pdf', savePending: true })); cb({ getEntries: () => [{ duration: 150, startTime: performance.now() - 151 }] }); }
    finally { window.PerformanceObserver = Original; }
    return log.lines().find((l: Line) => l.text === 'the thread was busy');
  });
  expect(line.facts.screen).toBe('pdf'); expect(line.facts.savePending).toBe(true);
  expect(line.facts.sampleAfterMs).toEqual(expect.any(Number)); expect(line.facts.canvases).toEqual(expect.any(Number));
});
test('a missing launch tab reports fallback without its path', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: {}, folders: ['Notes'] }));
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/private-missing.md' }], active: 0 }));
  });
  await page.goto('/'); await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  const line = (await lines(page)).find(l => l.text === 'saved launch tab unavailable');
  expect(line).toBeTruthy(); expect(line?.facts?.kind).toBe('note');
  expect(JSON.stringify(line)).not.toContain('private-missing');
});
test('repeated caret oscillation is bounded and records no positions or keys', async ({ page }) => {
  await boot(page);
  const data = await page.evaluate(() => {
    const { watchEditorDiagnostics } = window.__satr.load('/src/editorDiagnostics.ts');
    const log = window.__satr.load('/src/log.ts'); log.forget();
    const el = document.createElement('div'); document.body.append(el); const diag = watchEditorDiagnostics(el);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    for (let i = 0; i < 100; i++) diag.selection(i % 2 ? 712 : 711, true, false);
    return log.lines().filter((l: Line) => l.text === 'selection oscillation');
  });
  expect(data.length).toBe(20); expect(data[19].facts.andNoMore).toBe(true);
  expect(JSON.stringify(data)).not.toMatch(/711|712|ArrowLeft/);
});
test('a failed save records an error outcome without the error message', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const backend = window.__satr.load('/src/vault.ts').backend;
    backend.write = async () => { throw new Error('private-provider-message'); };
  });
  await page.locator('.cm-content').click(); await page.keyboard.type('change');
  await expect.poll(async () => (await lines(page)).find(l => l.text === 'save attempt finished'), { timeout: 10000 }).toBeTruthy();
  const line = (await lines(page)).find(l => l.text === 'save attempt finished')!;
  expect(line.facts?.outcome).toBe('error'); expect(JSON.stringify(line)).not.toMatch(/private/i);
});
test('slow PDF worker round trips are bounded and do not name a document', async ({ page }) => {
  await boot(page);
  const data = await page.evaluate(() => {
    const mod = window.__satr.load('/src/pdfDiagnostics.ts'); const log = window.__satr.load('/src/log.ts'); log.forget();
    const report = mod.slowPdfRenders();
    report(50, 1000000, 'base'); for (let i = 0; i < 30; i++) report(300, 1000000, 'detail');
    return log.lines().filter((l: Line) => l.text === 'slow PDF render round trip');
  });
  expect(data.length).toBe(20); expect(data[0].facts.kind).toBe('detail');
  expect(data[0].facts.roundTripMs).toBe(300); expect(data[19].facts.andNoMore).toBe(true);
  expect(JSON.stringify(data)).not.toMatch(/private|Notes\//i);
});
test('the real editor listens for delayed input without recording its data', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const host = document.querySelector('.cm-content')!;
    host.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: 'PRIVATEINPUT', inputType: 'insertText' }));
    const now = performance.now(); while (performance.now() - now < 150) { /* blocked next frame */ }
  });
  await expect.poll(async () => (await lines(page)).some(l => l.text === 'input frame delayed')).toBe(true);
  const line = (await lines(page)).find(l => l.text === 'input frame delayed');
  expect(JSON.stringify(line)).not.toContain('PRIVATEINPUT');
});
test('a conflicting save says not completed instead of claiming a write', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const backend = window.__satr.load('/src/vault.ts').backend;
    backend.read = async () => 'external version';
  });
  await page.locator('.cm-content').click(); await page.keyboard.type('local change');
  await expect.poll(async () => (await lines(page)).find(l => l.text === 'save attempt finished'), { timeout: 10000 }).toBeTruthy();
  const line = (await lines(page)).find(l => l.text === 'save attempt finished')!;
  expect(line.facts?.outcome).toBe('not completed');
});
test('a slow PDF slice in the real viewer reaches the slow-render log', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const engine = await window.__satr.load('/src/pdfiumEngine.ts').pdfium();
    const was = engine.renderPageRectRaw.bind(engine);
    engine.renderPageRectRaw = (...args: unknown[]) => {
      const task = was(...args);
      return new Proxy(task, { get(target, prop) {
        if (prop === 'toPromise') return async () => { const result = await target.toPromise(); await new Promise(r => setTimeout(r, 320)); return result; };
        const value = Reflect.get(target, prop, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
  });
  await page.locator('#files').evaluate((el: HTMLElement) => el.click());
  await page.locator('[data-path="Notes/book.pdf"]').first().click();
  await expect.poll(async () => (await lines(page)).some(l => l.text === 'slow PDF render round trip'), { timeout: 20000 }).toBe(true);
});
