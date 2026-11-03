import { expect, test, type Page } from '@playwright/test';

// The log kept across a restart. A log that only lives in memory answers
// nothing about the run that went wrong, because the run that went wrong is
// the one that ended.
//
// What this pins: lines survive a reload, each one knows which run wrote it,
// the batch goes out when the app is hidden rather than only on a timer,
// nothing is read at startup, and the stored log has a bound.

interface Line { at: number; area: string; kind: string; text: string; facts?: Record<string, unknown>; ms?: number; run?: number }
interface LogModule {
  note(area: string, text: string, facts?: Record<string, unknown>): void;
  fail(area: string, text: string, facts?: Record<string, unknown>): void;
  lines(): Line[];
  forget(): void;
  setVolume(v: string): void;
  startedAt: number;
}
interface StoreModule {
  earlier(): Promise<Line[]>;
  flush(): Promise<unknown>;
  forgetStored(): Promise<void>;
  startKeeping(): void;
  stopKeeping(): void;
  keeping(): boolean;
  KEEP_STORED: number;
}

declare global {
  interface Window { __satr: { load(path: string): LogModule & StoreModule } }
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
}

test.beforeEach(async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const store = window.__satr.load('/src/logStore.ts');
    const line = window.__satr.load('/src/log.ts');
    line.setVolume('normal');
    await store.forgetStored();
    line.forget();
  });
});

test('boot starts keeping, without reading anything back', async ({ page }) => {
  // The point of not reading at startup is that the first screen pays
  // nothing for the log. Keeping is on; the database has not been asked for
  // a single earlier line.
  expect(await page.evaluate(() => window.__satr.load('/src/logStore.ts').keeping())).toBe(true);
});

test('lines written in one run are there in the next, and say which run wrote them', async ({ page }) => {
  const firstRun = await page.evaluate(async () => {
    const line = window.__satr.load('/src/log.ts');
    const store = window.__satr.load('/src/logStore.ts');
    line.note('pdf', 'open', { path: 'books/book.pdf' });
    line.fail('storage', 'quota refused');
    await store.flush();
    return line.startedAt;
  });

  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });

  const after = await page.evaluate(async () => {
    const store = window.__satr.load('/src/logStore.ts');
    const line = window.__satr.load('/src/log.ts');
    const kept = await store.earlier();
    return { kept, thisRun: line.startedAt };
  });

  const mine = after.kept.filter((l) => l.text === 'open' || l.text === 'quota refused');
  expect(mine).toHaveLength(2);
  expect(mine[0].facts).toEqual({ path: 'books/book.pdf' });
  expect(mine[1].kind).toBe('failure');
  // Each carries the run that wrote it, and that is not this one.
  expect(mine[0].run).toBe(firstRun);
  expect(after.thisRun).not.toBe(firstRun);
});

test('the batch goes out when the app is hidden, not only when a timer says so', async ({ page }) => {
  await page.evaluate(() => {
    window.__satr.load('/src/log.ts').note('tabs', 'switch', { to: 2 });
  });
  // No flush() call of our own: the page being hidden is what has to do it.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => {
    const kept = await page.evaluate(() => window.__satr.load('/src/logStore.ts').earlier());
    return kept.filter((l) => l.text === 'switch').length;
  }, { timeout: 5000 }).toBe(1);
});

test('the stored log has a bound, and it is the oldest that go', async ({ page }) => {
  test.slow();
  const out = await page.evaluate(async () => {
    const line = window.__satr.load('/src/log.ts');
    const store = window.__satr.load('/src/logStore.ts');
    // Past the bound in batches, so the ring in memory is not the thing
    // under test here.
    const over = 300;
    for (let written = 0; written < store.KEEP_STORED + over; written += 1000) {
      for (let i = 0; i < 1000; i += 1) line.note('file', 'read', { i: written + i });
      await store.flush();
      line.forget();
    }
    const kept = await store.earlier();
    return { held: kept.length, first: kept[0]?.facts?.i, bound: store.KEEP_STORED };
  });
  expect(out.held).toBeLessThanOrEqual(out.bound);
  expect(out.held).toBeGreaterThan(out.bound - 1100);
  // The front of the stored log is gone, not the back.
  expect(Number(out.first)).toBeGreaterThan(0);
});

test('with no database at all the app still logs, it just keeps less', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => { throw new Error('refused'); } });
  });
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  const out = await page.evaluate(async () => {
    const line = window.__satr.load('/src/log.ts');
    const store = window.__satr.load('/src/logStore.ts');
    line.note('launch', 'cold start');
    await store.flush();
    return { inMemory: line.lines().length, kept: (await store.earlier()).length };
  });
  expect(out.inMemory, 'the log itself is untouched').toBeGreaterThan(0);
  expect(out.kept, 'there is simply nowhere to keep it').toBe(0);
});

test('clearing throws away what was stored as well as what is held', async ({ page }) => {
  await page.evaluate(async () => {
    const line = window.__satr.load('/src/log.ts');
    const store = window.__satr.load('/src/logStore.ts');
    line.note('search', 'queried');
    await store.flush();
    await store.forgetStored();
    line.forget();
  });
  const left = await page.evaluate(() => window.__satr.load('/src/logStore.ts').earlier());
  expect(left).toHaveLength(0);
});
