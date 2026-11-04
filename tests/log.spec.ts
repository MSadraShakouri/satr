import { expect, test, type Page } from '@playwright/test';

// The log itself: the ring, the dial that decides what is *shown*, and the
// promise that writing a line costs almost nothing and builds no text until
// somebody reads it.
//
// The dial used to decide what was written down. It does not any more: a
// diagnostic that throws a line away at the pen cannot answer a question
// asked an hour later, which is when the questions get asked.
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
  detail(): string;
  setDetail(v: string): void;
  shows(line: Line, at?: string): boolean;
  onLine(fn: (line: Line) => void): () => void;
  forget(): void;
  lineText(line: Line): string;
  format(as?: string, some?: Line[]): string;
  weigh(line: Line): number;
  weight(): number;
  KEEP_BYTES: number;
  KEEP_LINES: number;
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
  // Each case starts from an empty log and the normal dial, whatever the
  // app wrote while it was starting up.
  await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    log.setDetail('normal');
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

test('everything is written down whatever the dial says', async ({ page }) => {
  const kept = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    const at = (v: string) => {
      log.forget();
      log.setDetail(v);
      log.note('file', 'opened');
      log.warn('file', 'slow');
      log.fail('file', 'could not read');
      log.loud('file', 'every byte');
      return log.lines().map((l) => l.kind + (l.loud ? '+loud' : ''));
    };
    const out = { quiet: at('quiet'), normal: at('normal'), verbose: at('verbose') };
    log.setDetail('normal');
    return out;
  });
  // The dial is at its quietest and every line is still there. This is the
  // whole point: the question gets asked after the thing has happened.
  const all = ['note', 'warning', 'failure', 'note+loud'];
  expect(kept.quiet).toEqual(all);
  expect(kept.normal).toEqual(all);
  expect(kept.verbose).toEqual(all);
});

test('the dial decides what is shown, and nothing else', async ({ page }) => {
  const shown = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    log.forget();
    log.note('file', 'opened');
    log.warn('file', 'slow');
    log.fail('file', 'could not read');
    log.loud('file', 'every byte');
    const all = log.lines();
    const at = (v: string) => all.filter((l) => log.shows(l, v)).map((l) => l.kind + (l.loud ? '+loud' : ''));
    return { quiet: at('quiet'), normal: at('normal'), verbose: at('verbose'), held: all.length };
  });
  expect(shown.held, 'all four were recorded').toBe(4);
  expect(shown.quiet, 'only what went wrong -- a warning counts').toEqual(['warning', 'failure']);
  expect(shown.normal).toEqual(['note', 'warning', 'failure']);
  expect(shown.verbose, 'everything, down to the per-page measurements').toEqual(['note', 'warning', 'failure', 'note+loud']);
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

test('a verbose measurement is still measured when the dial is down', async ({ page }) => {
  // It used to return an empty function at anything below verbose, so the
  // measurement never happened and the line never existed. Now it is taken
  // and kept, and the dial only decides whether it is on screen -- which
  // means a reader can turn the dial *up after* the slow thing happened and
  // find it already written down.
  const out = await page.evaluate(async () => {
    const log = window.__satr.load('/src/log.ts');
    log.setDetail('normal');
    const done = log.timeLoud('pdf', 'page drawn');
    await new Promise((r) => setTimeout(r, 60));
    done({ page: 3 });
    const line = log.lines()[0];
    return { held: log.lines().length, ms: line?.ms ?? -1, shownNormal: log.shows(line, 'normal'), shownVerbose: log.shows(line, 'verbose') };
  });
  expect(out.held, 'recorded at normal').toBe(1);
  expect(out.ms, 'and actually timed').toBeGreaterThanOrEqual(40);
  expect(out.shownNormal).toBe(false);
  expect(out.shownVerbose).toBe(true);
});

test('the ring keeps the newest and says how many it lost', async ({ page }) => {
  const out = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    // Short lines, so the megabyte is nowhere near: it is the line bound
    // under test here, and the weight bound is tested below it.
    for (let i = 0; i < log.KEEP_LINES + 500; i += 1) log.note('tabs', 'switch', { i });
    const all = log.lines();
    return {
      held: all.length,
      first: all[0].facts?.i,
      last: all[all.length - 1].facts?.i,
      dropped: log.dropped(),
      bound: log.KEEP_LINES,
      weight: log.weight(),
      byteBound: log.KEEP_BYTES,
    };
  });
  expect(out.weight, 'the weight bound did not get there first').toBeLessThan(out.byteBound);
  expect(out.held).toBe(out.bound);
  expect(out.first, 'the oldest 500 fell off the front').toBe(500);
  expect(out.last).toBe(out.bound + 499);
  expect(out.dropped).toBe(500);
});

test('writing is cheap even now that nothing is refused', async ({ page }) => {
  // The dial used to buy its cheapness by refusing lines. Nothing is refused
  // any more, so every line pays the full price -- including the weighing
  // that keeps the ring inside a megabyte. The budget is the one from the
  // round that measured it: under a twentieth of a millisecond.
  const cost = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    const run = (times: number) => {
      const began = performance.now();
      for (let i = 0; i < times; i += 1) log.note('file', 'read', { bytes: i });
      return performance.now() - began;
    };
    log.setDetail('normal');
    run(2000); // warm
    log.forget();
    const kept = run(2000);
    log.setDetail('quiet');
    const quiet = run(2000);
    log.setDetail('verbose');
    const loud = (() => {
      const began = performance.now();
      for (let i = 0; i < 2000; i += 1) log.timeLoud('pdf', 'page drawn', { page: i })({ ms: i });
      return performance.now() - began;
    })();
    log.setDetail('normal');
    log.forget();
    return { kept: kept / 2000, quiet: quiet / 2000, loud: loud / 2000 };
  });
  expect(cost.kept, 'a kept line').toBeLessThan(0.05);
  // At the quietest dial the line is still written down -- and it still has
  // to be cheap, because that is the setting the app will be sitting at.
  expect(cost.quiet, 'a line nobody will see').toBeLessThan(0.05);
  expect(cost.loud, 'a measurement taken and kept').toBeLessThan(0.08);
});

test('the ring is bounded by size, so one enormous line cannot eat it', async ({ page }) => {
  const out = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    log.forget();
    // Two thousand lines of a kilobyte each is two megabytes, in under half
    // the line bound: if anything fell off the front it fell off for weight.
    const fat = 'x'.repeat(1000);
    for (let i = 0; i < 2000; i += 1) log.note('file', 'read', { i, blob: fat });
    const all = log.lines();
    return {
      held: all.length,
      first: all[0].facts?.i,
      last: all[all.length - 1].facts?.i,
      weight: log.weight(),
      bound: log.KEEP_BYTES,
      lineBound: log.KEEP_LINES,
      dropped: log.dropped(),
    };
  });
  expect(out.held, 'the line count never got near its own bound').toBeLessThan(out.lineBound);
  expect(out.weight, 'and the ring stayed inside a megabyte').toBeLessThanOrEqual(out.bound);
  expect(out.dropped, 'the oldest went, and were counted').toBeGreaterThan(0);
  expect(out.last, 'the newest line is the last one written').toBe(1999);
  expect(Number(out.first), 'the front is gone').toBeGreaterThan(0);
});

test('a line is weighed without being turned into text', async ({ page }) => {
  const out = await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    log.forget();
    log.note('pdf', 'open', { path: 'books/book.pdf', bytes: 31016653 });
    const line = log.lines()[0];
    const real = JSON.stringify(line).length;
    return { guess: log.weigh(line), real };
  });
  // Within a factor of two of the real thing is all a budget needs, and it
  // is had without building the string.
  expect(out.guess).toBeGreaterThan(out.real / 2);
  expect(out.guess).toBeLessThan(out.real * 2);
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
  expect(out.text, 'the header says what is on show, and that the rest was still kept').toContain('showing normal');
  expect(out.text).toContain('cold start');
  expect(out.text).toContain('! storage  quota refused  needed=4096');
  const rows = out.ndjson.split('\n').map((row) => JSON.parse(row));
  expect(rows).toHaveLength(2);
  expect(rows[1].kind).toBe('failure');
  expect(rows[1].facts.needed).toBe(4096);
});

test('the dial is remembered across a restart, including where it used to live', async ({ page }) => {
  await page.evaluate(() => window.__satr.load('/src/log.ts').setDetail('verbose'));
  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  expect(await page.evaluate(() => window.__satr.load('/src/log.ts').detail())).toBe('verbose');

  // A phone that had the old build has the old key. It is the same dial with
  // a truer name, so it carries over rather than resetting under him.
  await page.evaluate(() => {
    localStorage.removeItem('satr:log:detail');
    localStorage.setItem('satr:log:volume', 'quiet');
  });
  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  expect(await page.evaluate(() => window.__satr.load('/src/log.ts').detail())).toBe('quiet');
  await page.evaluate(() => window.__satr.load('/src/log.ts').setDetail('normal'));
});
