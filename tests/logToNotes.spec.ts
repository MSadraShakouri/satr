import { expect, test, type Page } from '@playwright/test';

// The log saved into the vault, as a file. The share sheet hands it to
// another app and is gone; this leaves it somewhere -- openable in Satr
// itself, and still there tomorrow.

declare global {
  interface Window {
    __satr: { load(path: string): {
      note(area: string, text: string, facts?: Record<string, unknown>): void;
      forget(): void;
      setVolume(v: string): void;
      lines(): { area: string; text: string }[];
      forgetStored(): Promise<void>;
      backend: { read(path: string): Promise<string | null>; list(dir: string): Promise<{ path: string }[]> };
    } };
  }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n\nwords\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  });
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.evaluate(async () => {
    const log = window.__satr.load('/src/log.ts');
    await window.__satr.load('/src/logStore.ts').forgetStored();
    log.setVolume('normal');
    log.forget();
    log.note('pdf', 'bytes read', { path: 'books/book.pdf' });
    log.note('tabs', 'switch', { to: 'B.md' });
  });
}

async function openLog(page: Page): Promise<void> {
  await page.locator('#files').dispatchEvent('click');
  await page.locator('#settings-button').dispatchEvent('click');
  await page.locator('.setting-item[data-open="log"]').click();
  await expect(page.locator('.log-screen')).toBeVisible();
}

const saved = (page: Page) => page.evaluate(async () => {
  const vault = window.__satr.load('/src/vault.ts');
  const inside = await vault.backend.list('Notes/Logs');
  return Promise.all(inside.map(async (entry) => ({ path: entry.path, text: await vault.backend.read(entry.path) })));
});

test.beforeEach(async ({ page }) => { await boot(page); });

test('the log is written into the vault, named for the moment', async ({ page }) => {
  await openLog(page);
  await page.locator('[data-act="keep"]').click();
  await expect(page.locator('[data-act="keep"]')).toHaveText('Saved');
  const files = await saved(page);
  expect(files, 'one file, where the notes are').toHaveLength(1);
  expect(files[0].path).toMatch(/^Notes\/Logs\/satr-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.log$/);
  expect(files[0].text).toContain('bytes read');
  expect(files[0].text).toContain('switch');
});

test('it holds what the filters left, like the other two ways out', async ({ page }) => {
  await openLog(page);
  await page.locator('.log-chip[data-area="pdf"]').click();
  await page.locator('[data-act="keep"]').click();
  await expect(page.locator('[data-act="keep"]')).toHaveText('Saved');
  const files = await saved(page);
  expect(files[0].text, 'the area that was switched off is not in it').not.toContain('bytes read');
  expect(files[0].text).toContain('switch');
});

test('the saved log says where it went, and shows up in the file tree', async ({ page }) => {
  await openLog(page);
  await page.locator('[data-act="keep"]').click();
  await expect(page.locator('.notice')).toContainText('Saved as Notes/Logs/satr-');
  // Back out of the log and Settings, and open the files drawer: the folder
  // is in the explorer, without the app having to be started again.
  await page.locator('.log-screen .clickable-icon').first().click();
  await page.locator('.settings-screen .clickable-icon').first().click();
  await page.locator('#files').dispatchEvent('click');
  await expect(page.locator('#file-panel').getByText('Logs', { exact: true })).toBeVisible();
});
