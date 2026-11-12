import { expect, test, type Page } from '@playwright/test';

// What the app is holding, and what went wrong with it.
//
// His log had twenty cold starts in it, six of them ending in the phone
// killing Satr for memory, and not one line anywhere saying what the app was
// carrying at the time. These are the lines that answer that -- and the ones
// that catch a thrown error, which went nowhere at all before.

interface Line { area: string; kind: string; text: string; facts?: Record<string, unknown> }
declare global {
  interface Window {
    __satr: { load(path: string): {
      lines(): Line[];
      forget(): void;
      setDetail(v: string): void;
      memoryFacts(): Record<string, number>;
      canvasBytes(): { canvases: number; bytes: number };
      sayMemory(why: string): void;
    } };
  }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
  });
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('the launch says what the app is holding', async ({ page }) => {
  const held = await page.evaluate(() => window.__satr.load('/src/log.ts').lines().filter((l) => l.text === 'holding'));
  expect(held.length, 'one reading, taken when the launch finished').toBeGreaterThan(0);
  const facts = held[0].facts!;
  expect(facts.why).toBe('launched');
  // The canvas count is the half nobody can see from JavaScript, and the
  // half that explains a 990 MB resident set on a phone reading a book.
  expect(facts).toHaveProperty('canvases');
  expect(facts).toHaveProperty('pictureMb');
  expect(typeof facts.pictureMb).toBe('number');
});

test('the pixels behind a canvas are counted, and they are not on the heap', async ({ page }) => {
  const out = await page.evaluate(() => {
    const vitals = window.__satr.load('/src/vitals.ts');
    const before = vitals.canvasBytes();
    const canvas = document.createElement('canvas');
    canvas.width = 1170; // a 390pt phone at three times the pixels
    canvas.height = 2532;
    document.body.append(canvas);
    const after = vitals.canvasBytes();
    canvas.remove();
    const gone = vitals.canvasBytes();
    return { before: before.bytes, after: after.bytes, gone: gone.bytes, added: after.canvases - before.canvases };
  });
  expect(out.added).toBe(1);
  // One full-screen tile on his phone is eleven megabytes of pixels.
  expect(out.after - out.before).toBe(1170 * 2532 * 4);
  expect(out.after - out.before).toBeGreaterThan(11_000_000);
  expect(out.gone, 'and it stops being counted when it goes').toBe(out.before);
});

test('an error nobody caught lands in the log, with where it came from', async ({ page }) => {
  const line = await page.evaluate(async () => {
    const log = window.__satr.load('/src/log.ts');
    log.forget();
    // Thrown from a timer, so nothing in the page can catch it: this is the
    // kind that used to disappear without trace.
    setTimeout(() => { throw new Error('the roof fell in'); }, 0);
    await new Promise((r) => setTimeout(r, 80));
    return log.lines().find((l) => l.text === 'an error nobody caught');
  });
  expect(line, 'it was written down').toBeTruthy();
  expect(line!.kind).toBe('failure');
  expect(line!.area).toBe('app');
  expect(String(line!.facts!.why)).toContain('the roof fell in');
  expect(line!.facts!.where, 'and the file and line it came from').toBeTruthy();
});

test('a promise nobody handled lands there too', async ({ page }) => {
  const line = await page.evaluate(async () => {
    const log = window.__satr.load('/src/log.ts');
    log.forget();
    void Promise.reject(new Error('the read never came back'));
    await new Promise((r) => setTimeout(r, 80));
    return log.lines().find((l) => l.text === 'a promise nobody handled');
  });
  expect(line, 'it was written down').toBeTruthy();
  expect(line!.kind).toBe('failure');
  expect(String(line!.facts!.why)).toContain('the read never came back');
});

test('a console.error is kept, and the console still gets it', async ({ page }) => {
  const out = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    log.forget();
    console.error('pdfium said no', 42);
    const line = log.lines().find((l) => l.text === 'console.error');
    return { said: line?.facts?.said, kind: line?.kind };
  });
  expect(String(out.said)).toContain('pdfium said no');
  expect(String(out.said), 'everything it was given').toContain('42');
  expect(out.kind).toBe('warning');
});

test('going away and coming back are both in the log', async ({ page }) => {
  const texts = await page.evaluate(async () => {
    const log = window.__satr.load('/src/log.ts');
    log.forget();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 50));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 50));
    return log.lines().map((l) => `${l.text}${l.facts?.why ? ` ${l.facts.why}` : ''}`);
  });
  // The pair that makes a minutes-long silence readable: without them a log
  // cannot tell a phone put down from an app that froze.
  expect(texts).toContain('went to the background');
  expect(texts).toContain('came back');
  // And the last thing written before it went is what it was carrying, which
  // is the reading a kill gets judged by -- the app may never get another
  // line in after this one.
  expect(texts).toContain('holding going away');
  expect(texts.indexOf('holding going away')).toBeLessThan(texts.indexOf('came back'));
});

test('saving a note writes a line, with the bytes and the time it took', async ({ page }) => {
  await page.evaluate(() => window.__satr.load('/src/log.ts').forget());
  await page.locator('#app .cm-content').click();
  await page.keyboard.type('typed ');
  await page.waitForTimeout(900); // past the autosave's beat
  const line = await page.evaluate(() => window.__satr.load('/src/log.ts').lines().find((l) => l.area === 'file' && l.text === 'written'));
  // A save is the single most ordinary thing he does in the app and it had
  // no line at all. (Nothing is asserted about how long it took -- only that
  // the line exists and carries both facts.)
  expect(line, 'a save says so').toBeTruthy();
  expect(line!.facts).toHaveProperty('path');
  expect(line!.facts).toHaveProperty('bytes');
});

test('a felt long task includes a clearly labelled memory sample taken afterward', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const log = window.__satr.load('/src/log.ts');
    log.forget();
    const canvas = document.createElement('canvas');
    canvas.width = 1000; canvas.height = 1000; document.body.append(canvas);
    // Let the observer deliver earlier work first, then hold the main thread.
    await new Promise(resolve => setTimeout(resolve, 150));
    log.forget();
    const start = performance.now(); while (performance.now() - start < 220) { /* deliberately busy */ }
    await new Promise(resolve => setTimeout(resolve, 150));
    canvas.remove();
    return log.lines().filter(line => line.text === 'the thread was busy');
  });
  expect(out.length).toBeGreaterThan(0);
  const line = out.find(line => Number(line.facts?.ms) >= 200)!;
  expect(line).toBeTruthy();
  expect(Number(line.facts?.canvases)).toBeGreaterThanOrEqual(1);
  expect(Number(line.facts?.pictureMb)).toBeGreaterThanOrEqual(4);
  expect(Number(line.facts?.sampleAfterMs)).toBeGreaterThanOrEqual(0);
});
