import { expect, test, type Page } from '@playwright/test';

// The log itself: the ring, the three dials, and the promise that writing a
// line costs almost nothing and builds no text until somebody reads it.
//
// This is the app's own module, handed over by the test build, not a copy --
// so what passes here is what runs.

interface Line { at: number; area: string; kind: string; text: string; facts?: Record<string, unknown>; ms?: number; loud?: boolean }
interface LogModule {
  note(area: string, text: string, facts?: Record<string, unknown>): void;
  warn(area: string, text: string, facts?: Record<string, unknown>): void;
  fail(area: string, text: string, facts?: Record<string, unknown>): void;
  loud(area: string, text: string, facts?: Record<string, unknown>): void;
  time(area: string, text: string, facts?: Record<string, unknown>): (more?: Record<string, unknown>) => void;
  timeLoud(area: string, text: string, facts?: Record<string, unknown>): (more?: Record<string, unknown>) => void;
  lines(): Line[];
  dropped(): number;
  volume(): string;
  setVolume(v: string): void;
  onLine(fn: (line: Line) => void): () => void;
  forget(): void;
  lineText(line: Line): string;
  format(as?: string, some?: Line[]): string;
  keeps(kind: string, loud?: boolean): boolean;
  KEEP: number;
}

declare global {
  interface Window { __satr: { load(path: string): LogModule } }
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
  });
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  // Each case starts from an empty log and the normal volume, whatever the
  // app wrote while it was starting up.
  await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    log.setVolume('normal');
    log.forget();
  });
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('a line is kept as its pieces, and becomes text only when it is read', async ({ page }) => {
  const kept = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    log.note('pdf', 'open', { path: 'books/book.pdf', bytes: 31016653 });
    return log.lines()[0];
  });
  // Nothing in the stored record is a composed sentence: the message is the
  // short constant it was written as, and the varying part is still a record
  // of values.
  expect(kept.text).toBe('open');
  expect(kept.facts).toEqual({ path: 'books/book.pdf', bytes: 31016653 });
  expect(JSON.stringify(kept)).not.toContain('books/book.pdf 31016653');
  expect(typeof kept.at).toBe('number');

  // And it reads as a line when something asks for it.
  const text = await page.evaluate((line) => window.__satr.load('/src/log.ts').lineText(line as never), kept);
  expect(text).toContain('pdf');
  expect(text).toContain('open');
  expect(text).toContain('path=books/book.pdf');
  expect(text).toContain('bytes=31016653');
});

test('a failure is kept whatever the volume, and a note is not', async ({ page }) => {
  const counts = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    const at = (v: string) => {
      log.forget();
      log.setVolume(v);
      log.note('file', 'opened');
      log.warn('file', 'slow');
      log.fail('file', 'could not read');
      log.loud('file', 'every byte');
      return log.lines().map((l) => l.kind + (l.loud ? '+loud' : ''));
    };
    const out = { quiet: at('quiet'), normal: at('normal'), verbose: at('verbose') };
    log.setVolume('normal');
    return out;
  });
  // quiet: the one line worth having is never the one you remembered to
  // turn on.
  expect(counts.quiet).toEqual(['failure']);
  expect(counts.normal).toEqual(['note', 'warning', 'failure']);
  expect(counts.verbose).toEqual(['note', 'warning', 'failure', 'note+loud']);
});

test('a timed line is one line, and it carries what it took', async ({ page }) => {
  const line = await page.evaluate(async () => {
    const log = window.__satr.load('/src/log.ts');
    const done = log.time('pdf', 'pdfium loaded', { file: 'book.pdf' });
    await new Promise((r) => setTimeout(r, 120));
    done({ pages: 528 });
    done({ pages: 999 }); // a second call must not write the thing twice
    return log.lines();
  });
  expect(line, 'one event is one line').toHaveLength(1);
  expect(line[0].ms).toBeGreaterThanOrEqual(100);
  expect(line[0].ms).toBeLessThan(600);
  expect(line[0].facts).toEqual({ file: 'book.pdf', pages: 528 });
  const text = await page.evaluate((l) => window.__satr.load('/src/log.ts').lineText(l as never), line[0]);
  expect(text).toMatch(/took \d+ms$/);
});

test('a verbose measurement costs nothing at all when it is not being kept', async ({ page }) => {
  const out = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    log.setVolume('normal');
    const done = log.timeLoud('pdf', 'page drawn');
    done({ page: 3 });
    const quiet = log.lines().length;
    log.setVolume('verbose');
    log.timeLoud('pdf', 'page drawn')({ page: 3 });
    const verbose = log.lines().length;
    log.setVolume('normal');
    return { quiet, verbose };
  });
  expect(out.quiet).toBe(0);
  expect(out.verbose).toBe(1);
});

test('the ring keeps the newest and says how many it lost', async ({ page }) => {
  const out = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    for (let i = 0; i < log.KEEP + 500; i += 1) log.note('tabs', 'switch', { i });
    const all = log.lines();
    return {
      held: all.length,
      first: all[0].facts?.i,
      last: all[all.length - 1].facts?.i,
      dropped: log.dropped(),
      bound: log.KEEP,
    };
  });
  expect(out.held).toBe(out.bound);
  expect(out.first, 'the oldest 500 fell off the front').toBe(500);
  expect(out.last).toBe(out.bound + 499);
  expect(out.dropped).toBe(500);
});

test('writing is cheap, and a dropped line is cheaper', async ({ page }) => {
  const cost = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    const run = (times: number) => {
      const began = performance.now();
      for (let i = 0; i < times; i += 1) log.note('file', 'read', { bytes: i });
      return performance.now() - began;
    };
    log.setVolume('normal');
    run(2000); // warm
    log.forget();
    const kept = run(2000);
    log.setVolume('quiet');
    const refused = run(2000);
    log.setVolume('normal');
    log.forget();
    return { kept: kept / 2000, refused: refused / 2000 };
  });
  // A line costs well under a tenth of a millisecond: a hundred of them in a
  // frame would still not be seen.
  expect(cost.kept, 'a kept line').toBeLessThan(0.05);
  // And when the volume refuses it, it is a comparison and a return.
  expect(cost.refused, 'a refused line').toBeLessThan(0.01);
});

test('the viewer can watch, and can stop watching', async ({ page }) => {
  const seen = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    const texts: string[] = [];
    const stop = log.onLine((line) => texts.push(line.text));
    log.note('search', 'first');
    stop();
    log.note('search', 'second');
    return texts;
  });
  expect(seen).toEqual(['first']);
});

test('the whole log reads as text, or as one object a line', async ({ page }) => {
  const out = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    log.note('launch', 'cold start');
    log.fail('storage', 'quota refused', { needed: 4096 });
    return { text: log.format('text'), ndjson: log.format('ndjson') };
  });
  expect(out.text).toContain('satr log');
  expect(out.text).toContain('volume normal');
  expect(out.text).toContain('cold start');
  expect(out.text).toContain('! storage  quota refused  needed=4096');
  const rows = out.ndjson.split('\n').map((row) => JSON.parse(row));
  expect(rows).toHaveLength(2);
  expect(rows[1].kind).toBe('failure');
  expect(rows[1].facts.needed).toBe(4096);
});

test('the volume is remembered across a restart', async ({ page }) => {
  await page.evaluate(() => window.__satr.load('/src/log.ts').setVolume('verbose'));
  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  const after = await page.evaluate(() => window.__satr.load('/src/log.ts').volume());
  expect(after).toBe('verbose');
  await page.evaluate(() => window.__satr.load('/src/log.ts').setVolume('normal'));
});
