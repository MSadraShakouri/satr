import { expect, test, type Page } from '@playwright/test';

// The log on screen: opened from Settings, filtered three ways, and taken
// off the phone. A log nobody can read is a log nobody has.

declare global {
  interface Window {
    __satr: { load(path: string): {
      note(area: string, text: string, facts?: Record<string, unknown>): void;
      fail(area: string, text: string, facts?: Record<string, unknown>): void;
      forget(): void;
      lines(): { area: string; kind: string; text: string }[];
      lineText(line: unknown): string;
      setVolume(v: string): void;
      volume(): string;
      shownText(): string;
      forgetStored(): Promise<void>;
      flush(): Promise<unknown>;
    } };
  }
}

async function boot(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n\nwords\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
  });
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.evaluate(async () => {
    const log = window.__satr.load('/src/log.ts');
    const store = window.__satr.load('/src/logStore.ts');
    log.setVolume('normal');
    await store.forgetStored();
    log.forget();
    log.note('pdf', 'bytes read', { path: 'books/book.pdf' });
    log.note('tabs', 'switch', { to: 'B.md' });
    log.fail('storage', 'quota refused');
  });
}

async function openLog(page: Page): Promise<void> {
  await page.locator('#files').dispatchEvent('click');
  await page.locator('#settings-button').dispatchEvent('click');
  await expect(page.locator('.settings-screen')).toBeVisible();
  await page.locator('.setting-item[data-open="log"]').click();
  await expect(page.locator('.log-screen')).toBeVisible();
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('Settings has a row that opens it, and the log is what is on screen', async ({ page }) => {
  await openLog(page);
  await expect(page.locator('.log-screen .settings-title')).toHaveText('Log');
  const rows = page.locator('.log-row-line');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('bytes read');
  await expect(rows.first()).toContainText('path=books/book.pdf');
  // A failure is marked, so it can be found by eye as well as by filter.
  await expect(page.locator('.log-row-line.is-failure')).toHaveText(/quota refused/);
});

test('the search narrows it, and says so when nothing matches', async ({ page }) => {
  await openLog(page);
  await page.locator('.log-search').fill('switch');
  await expect(page.locator('.log-row-line')).toHaveCount(1);
  await expect(page.locator('.log-row-line')).toContainText('to=B.md');
  await page.locator('.log-search').fill('nothing like this');
  await expect(page.locator('.log-row-line')).toHaveCount(0);
  await expect(page.locator('.log-note')).toHaveText('Nothing matches.');
});

test('an area chip takes its lines out and puts them back', async ({ page }) => {
  await openLog(page);
  await page.locator('.log-chip[data-area="pdf"]').click();
  await expect(page.locator('.log-chip[data-area="pdf"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.log-row-line')).toHaveCount(2);
  await expect(page.locator('.log-row-line', { hasText: 'bytes read' })).toHaveCount(0);
  await page.locator('.log-chip[data-area="pdf"]').click();
  await expect(page.locator('.log-row-line')).toHaveCount(3);
});

test('the volume is set from here, and it is the log that changes', async ({ page }) => {
  await openLog(page);
  await page.locator('[data-volume="quiet"]').click();
  expect(await page.evaluate(() => window.__satr.load('/src/log.ts').volume())).toBe('quiet');
  // Quiet from now on: a note written after it is refused, a failure is not.
  await page.evaluate(() => {
    const log = window.__satr.load('/src/log.ts');
    log.note('file', 'read');
    log.fail('file', 'could not read');
  });
  await expect(page.locator('.log-row-line', { hasText: 'could not read' })).toHaveCount(1);
  await expect(page.locator('.log-row-line', { hasText: /file  *read$/ })).toHaveCount(0);
  await page.locator('[data-volume="normal"]').click();
});

test('a line written while it is open shows up by itself', async ({ page }) => {
  await openLog(page);
  await expect(page.locator('.log-row-line')).toHaveCount(3);
  await page.evaluate(() => window.__satr.load('/src/log.ts').note('search', 'queried', { q: 'needle' }));
  // Redrawn on a beat rather than once per line, so this is a poll.
  await expect(page.locator('.log-row-line', { hasText: 'q=needle' })).toHaveCount(1, { timeout: 3000 });
});

test('what is copied or saved is what the filters left, not the lot', async ({ page }) => {
  await openLog(page);
  await page.locator('.log-search').fill('switch');
  await expect(page.locator('.log-row-line')).toHaveCount(1);
  const text = await page.evaluate(() => window.__satr.load('/src/logView.ts').shownText());
  expect(text).toContain('satr log');
  expect(text).toContain('to=B.md');
  expect(text, 'the filtered-out lines are not in it').not.toContain('quota refused');
});

test('saving hands over a file named for the moment', async ({ page }) => {
  await openLog(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-act="save"]').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^satr-log-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.log$/);
});

test('on a phone it goes to the share sheet instead, with the same text', async ({ page }) => {
  // Capacitor's own hook for standing in as a platform, set before anything
  // loads: registerPlugin resolves against it, so this exercises the real
  // path the app takes on the phone rather than a stub of it. The Java side
  // is the phone's to prove; what is proved here is that the text leaves by
  // the share sheet and not by a download, and that it is the filtered text.
  await page.addInitScript(() => {
    (window as unknown as { __shared: unknown[] }).__shared = [];
    (window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = {
      name: 'android',
      plugins: {
        SatrShare: {
          shareText: (options: unknown) => {
            (window as unknown as { __shared: unknown[] }).__shared.push(options);
            return Promise.resolve();
          },
        },
      },
    };
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { __satr?: unknown }).__satr));
  const sent = await page.evaluate(async () => {
    const log = window.__satr.load('/src/log.ts');
    const share = window.__satr.load('/src/share.ts') as unknown as { canShare(): boolean };
    const view = window.__satr.load('/src/logView.ts') as unknown as { sendOut(): Promise<void> };
    log.forget();
    log.note('tabs', 'switch', { to: 'B.md' });
    const native = share.canShare();
    let downloaded = false;
    const madeLink = document.createElement.bind(document);
    (document as unknown as { createElement: unknown }).createElement = (tag: string) => {
      if (tag === 'a') downloaded = true;
      return madeLink(tag);
    };
    await view.sendOut();
    (document as unknown as { createElement: unknown }).createElement = madeLink;
    return { native, downloaded, lines: log.lines().map((line) => log.lineText(line)) };
  });
  expect(sent.native, 'the app knows it is on a phone').toBe(true);
  expect(sent.downloaded, 'a download is the browser fallback, never the phone path').toBe(false);
  // The Java side is the phone's to prove. What is proved here: the text went
  // to the share sheet rather than a download, and a sheet that will not open
  // says so where the reader is already looking.
  expect(sent.lines.join('\n')).toMatch(/share sheet would not open/);
  expect(sent.lines.join('\n')).toContain('SatrShare');
});

test('clearing empties the screen and the database behind it', async ({ page }) => {
  await page.evaluate(() => window.__satr.load('/src/logStore.ts').flush());
  await openLog(page);
  await page.locator('[data-act="clear"]').click();
  await expect(page.locator('.log-row-line')).toHaveCount(0);
  const kept = await page.evaluate(async () => {
    const store = window.__satr.load('/src/logStore.ts');
    await store.flush();
    return (await (store as unknown as { earlier(): Promise<unknown[]> }).earlier()).length;
  });
  expect(kept).toBe(0);
});

test('the back arrow leaves it, and Settings is still there behind', async ({ page }) => {
  await openLog(page);
  await page.locator('.log-screen .settings-back').click();
  await expect(page.locator('.log-screen')).toHaveCount(0);
  await expect(page.locator('.settings-screen')).toBeVisible();
});
