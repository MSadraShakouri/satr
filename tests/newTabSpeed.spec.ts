import { expect, test, type Page } from '@playwright/test';

// Eight recent notes on a slow device bridge. The data stays as it was: the
// first eight files that still exist, in recency order, with shortened paths.
// The clock starts at the real + click, and ends when the recent rows exist.
const existing = Array.from({ length: 10 }, (_, i) => `Notes/recent${i}.md`);
async function boot(page: Page, recent: string[] = existing) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ existing, recent }) => {
    const paths = ['Notes/current.md', ...existing];
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: Object.fromEntries(paths.map(p => [p, 1])), folders: ['Notes'] }));
    for (const path of paths) localStorage.setItem(`satr:fs:file:${path}`, `# ${path}\n`);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/current.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:recent', JSON.stringify(recent));
    localStorage.setItem('satr:demoShown', '1');
  }, { existing, recent });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('current');
  await page.evaluate(() => {
    const vault = (window as any).__satr.load('/src/vault.ts');
    const stat = vault.backend.stat.bind(vault.backend);
    vault.backend.stat = async (path: string) => {
      if (/Notes\/(recent\d+|missing\d+)\.md$/.test(path)) await new Promise(r => setTimeout(r, 80));
      return stat(path);
    };
  });
}

test('new tab is not held up by eight sequential recent-file checks', async ({ page }) => {
  await boot(page);
  const elapsed = await page.evaluate(async () => {
    const old = document.querySelector('#empty-tab .empty-state-container');
    const start = performance.now();
    (document.querySelector('#nav-new') as HTMLElement).click();
    await new Promise<void>((resolve, reject) => {
      const end = performance.now() + 3000;
      const tick = () => {
        if (document.querySelector('#empty-tab .empty-state-container') !== old && document.querySelectorAll('#empty-tab .empty-state-recent-item').length === 8) resolve();
        else if (performance.now() > end) reject(new Error('recent items did not arrive'));
        else requestAnimationFrame(tick);
      };
      tick();
    });
    return Math.round(performance.now() - start);
  });
  console.log(`NEW TAB: ${elapsed}ms (eight 80ms simulated file checks)`);
  expect(elapsed).toBeLessThan(450);
  await expect(page.locator('#empty-tab .empty-state-recent-item')).toHaveCount(8);
  expect(await page.locator('#empty-tab .empty-state-recent-item').evaluateAll(es => es.map(e => (e as HTMLElement).dataset.path)))
    .toEqual(existing.slice(0, 8));
});

test('missing recent files are skipped without disturbing the order', async ({ page }) => {
  const recent = ['Notes/missing0.md', existing[0], existing[1], 'Notes/missing1.md', ...existing.slice(2)];
  await boot(page, recent);
  await page.locator('#nav-new').click();
  await expect.poll(() => page.evaluate(() => (window as any).__satr.load('/src/log.ts').lines()
    .some((l: any) => l.text === 'new tab page built' && l.facts?.checked === 12 && l.facts?.shown === 8))).toBe(true);
  await expect(page.locator('#empty-tab .empty-state-recent-item')).toHaveCount(8);
  expect(await page.locator('#empty-tab .empty-state-recent-item').evaluateAll(es => es.map(e => (e as HTMLElement).dataset.path)))
    .toEqual(existing.slice(0, 8));
});

test('an older page build cannot replace a newer recent list', async ({ page }) => {
  await boot(page);
  await page.locator('#nav-new').click();
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  // A second visit has a newer list while the first one's disk checks are
  // still in flight. The first answer must never replace the second.
  await page.evaluate((path) => localStorage.setItem('satr:recent', JSON.stringify([path])), existing[9]);
  await page.locator('#nav-back').evaluate((el: HTMLElement) => el.click());
  await expect(page.locator('body')).not.toHaveClass(/is-empty-tab/);
  await page.locator('#nav-new').evaluate((el: HTMLElement) => el.click());
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  await expect(page.locator('#empty-tab .empty-state-recent-item')).toHaveCount(1);
  await page.waitForTimeout(900);
  await expect(page.locator('#empty-tab .empty-state-recent-item')).toHaveCount(1);
  await expect(page.locator('#empty-tab .empty-state-recent-item')).toHaveAttribute('data-path', existing[9]);
});

test('the log names the new-tab checks and switcher preparation', async ({ page }) => {
  await boot(page);
  await page.locator('#nav-new').click();
  const readLog = () => page.evaluate(() => (window as any).__satr.load('/src/log.ts').lines() as { area: string; text: string; facts?: Record<string, unknown>; ms?: number }[]);
  await expect.poll(async () => (await readLog()).some(l => l.text === 'new tab page built' && l.facts?.shown === 8)).toBe(true);
  const built = (await readLog()).filter(l => l.text === 'new tab page built' && l.facts?.shown === 8).pop()!;
  expect(built.area).toBe('tabs');
  expect(built.facts?.checked).toBe(8);
  expect(built.facts?.checks).toEqual(expect.any(Number));
  expect(built.facts?.labels).toEqual(expect.any(Number));
  expect(built.ms).toEqual(expect.any(Number));
  const activated = (await readLog()).filter(l => l.text === 'new tab activated').pop()!;
  expect(activated.facts?.left).toEqual(expect.any(Number));
  await page.locator('#nav-tabs').evaluate((el: HTMLElement) => el.click());
  await expect(page.locator('.mobile-tab-switcher')).toBeVisible();
  const switcher = (await readLog()).filter(l => l.text === 'tab switcher built').pop()!;
  expect(switcher.facts?.left).toEqual(expect.any(Number));
  expect(switcher.facts?.count).toBe(2);
  expect(switcher.ms).toEqual(expect.any(Number));
});
