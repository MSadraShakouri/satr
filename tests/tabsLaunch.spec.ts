import { expect, test, type Page } from '@playwright/test';

// Starting tabs: "On launch" keeps the last tabs or adds an empty one, and
// "New tab after being away" adds an empty tab when Satr comes back after the
// chosen time. Both live in Settings → Tabs.

const AWAY_KEY = 'satr:awayAt';
const SEEN_KEY = 'satr:seenAt';

async function boot(page: Page, settings: Record<string, unknown>, awayAt?: number, seenAt?: number) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ settings, awayAt, seenAt }) => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/B.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# Alpha\n\nfirst\n');
    localStorage.setItem('satr:fs:file:Notes/B.md', '# Beta\n\nsecond\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }], active: 1 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:settings', JSON.stringify({ version: 3, ...settings }));
    if (awayAt !== undefined) localStorage.setItem('satr:awayAt', String(awayAt));
    if (seenAt !== undefined) localStorage.setItem('satr:seenAt', String(seenAt));
  }, { settings, awayAt, seenAt });
  await page.goto('/');
  await expect(page.locator('#nav-tabs .mobile-navbar-tabs-number')).toBeVisible();
}

const tabCount = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('satr:tabs') ?? '{"tabs":[]}') as { tabs: unknown[] }).tabs.length);

test('On launch: restore last tabs is the default, and the last tabs come back as they were', async ({ page }) => {
  await boot(page, {});
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  expect(await tabCount(page)).toBe(2);
});

test('On launch: an empty tab is added after the last tabs, and it is the one shown', async ({ page }) => {
  await boot(page, { launchTabs: 'empty' });
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await tabCount(page)).toBe(3);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('satr:tabs')!).tabs.map((t: { path: string }) => t.path))).toEqual(['Notes/A.md', 'Notes/B.md', '']);
});

test('after being away past the chosen time, the app comes back with a new empty tab', async ({ page }) => {
  await boot(page, { launchTabs: 'away', newTabAfterMinutes: 5 }, Date.now() - 6 * 60_000);
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await tabCount(page)).toBe(3);
  // One absence gives one new tab: the mark is gone.
  expect(await page.evaluate((key) => localStorage.getItem(key), AWAY_KEY)).toBeNull();
});

test('a shorter absence than the chosen time opens nothing new', async ({ page }) => {
  await boot(page, { launchTabs: 'away', newTabAfterMinutes: 5 }, Date.now() - 60_000);
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  expect(await tabCount(page)).toBe(2);
});

test('Restore (the default) opens nothing new however long the absence', async ({ page }) => {
  await boot(page, {}, Date.now() - 10 * 24 * 60 * 60_000);
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  expect(await tabCount(page)).toBe(2);
});

test('coming back to the visible app after being away adds the empty tab too', async ({ page }) => {
  await boot(page, { newTabAfterMinutes: 15 });
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  // The away time belongs to the empty-tab launch, so that is the choice in force.
  await page.evaluate(() => localStorage.setItem('satr:settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('satr:settings')!), launchTabs: 'away' })));
  // Away: the app goes to the background (the same event the app listens for).
  // Twenty minutes in which the app did not run, so neither mark moved on.
  await page.evaluate(([away, seen]) => {
    localStorage.setItem(away, String(Date.now() - 20 * 60_000));
    localStorage.setItem(seen, String(Date.now() - 20 * 60_000));
    document.dispatchEvent(new Event('visibilitychange'));
  }, [AWAY_KEY, SEEN_KEY]);
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await tabCount(page)).toBe(3);
});

test('Always open a new empty tab: coming back without a full start opens one too', async ({ page }) => {
  await boot(page, { launchTabs: 'last' });
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  await page.evaluate(() => {
    localStorage.setItem('satr:settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('satr:settings')!), launchTabs: 'empty' }));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await tabCount(page)).toBe(3);
});

test('Restore last tabs: coming back never adds a tab', async ({ page }) => {
  await boot(page, { launchTabs: 'last' });
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  await page.evaluate((key) => {
    localStorage.setItem(key, String(Date.now() - 10 * 24 * 60 * 60_000));
    document.dispatchEvent(new Event('visibilitychange'));
  }, AWAY_KEY);
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  await expect(page.locator('body')).not.toHaveClass(/is-empty-tab/);
  expect(await tabCount(page)).toBe(2);
});

test('a pause the phone never reports still counts as being away', async ({ page }) => {
  // Android can freeze or kill the WebView without a word, which leaves no away
  // mark at all. What it cannot fake is the app running: the last heartbeat is
  // twenty minutes old, so the app has been away for twenty minutes.
  await boot(page, { launchTabs: 'away', newTabAfterMinutes: 5 }, undefined, Date.now() - 20 * 60_000);
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await tabCount(page)).toBe(3);
});

test('an away mark left over from an earlier absence is overtaken by real use', async ({ page }) => {
  // The mark is only cleared when a tab is actually opened, so an old one can
  // still be lying there. Reading a minute ago is the later word on it.
  await boot(page, { launchTabs: 'away', newTabAfterMinutes: 5 }, Date.now() - 20 * 60_000, Date.now() - 60_000);
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  await expect(page.locator('body')).not.toHaveClass(/is-empty-tab/);
  expect(await tabCount(page)).toBe(2);
});

test('the app marks itself alive while it is being read', async ({ page }) => {
  await boot(page, { launchTabs: 'away', newTabAfterMinutes: 5 });
  const booted = await page.evaluate((key) => Number(localStorage.getItem(key)), SEEN_KEY);
  expect(Date.now() - booted).toBeLessThan(10_000);
  // Coming back to the front marks it again, so the next absence is measured
  // from this visit and not from the one before it.
  await page.evaluate((key) => {
    localStorage.setItem(key, String(Date.now() - 20 * 60_000));
    document.dispatchEvent(new Event('visibilitychange'));
  }, SEEN_KEY);
  await expect.poll(async () => await page.evaluate((key) => Date.now() - Number(localStorage.getItem(key)), SEEN_KEY)).toBeLessThan(10_000);
});

test('the Tabs settings save their choices', async ({ page }) => {
  await boot(page, {});
  await page.evaluate(async () => {
    const { openSettings } = await window.__satr.load('/src/settings.ts');
    openSettings({ apply: () => {}, tools: () => [] });
  });
  await expect(page.locator('.settings-screen')).toBeVisible();
  await page.locator('[data-select="launchTabs"]').selectOption('away');
  await page.locator('[data-select="newTabAfterMinutes"]').selectOption('30');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('satr:settings')!));
  expect(saved.launchTabs).toBe('away');
  expect(saved.newTabAfterMinutes).toBe(30);
});

test('Restore last tabs: a long absence or a refresh adds no tab, and the away time is not shown', async ({ page }) => {
  await boot(page, { launchTabs: 'last', newTabAfterMinutes: 5 }, Date.now() - 6 * 60_000);
  await expect(page.locator('#app .cm-file-name')).toHaveText('B');
  expect(await tabCount(page)).toBe(2);
  await expect(page.locator('body')).not.toHaveClass(/is-empty-tab/);
  expect(await page.evaluate((key) => localStorage.getItem(key), AWAY_KEY)).toBeNull();
  await page.evaluate(async () => {
    const { openSettings } = await window.__satr.load('/src/settings.ts');
    openSettings({ apply: () => {}, tools: () => [] });
  });
  await expect(page.locator('.settings-screen')).toBeVisible();
  await expect(page.locator('[data-away-row]')).toBeHidden();
  await page.locator('[data-select="launchTabs"]').selectOption('away');
  await expect(page.locator('[data-away-row]')).toBeVisible();
});

test('Always open a new empty tab: every launch adds one, whatever the time setting', async ({ page }) => {
  await boot(page, { launchTabs: 'empty', newTabAfterMinutes: 1440 }, Date.now() - 1000);
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  expect(await tabCount(page)).toBe(3);
});

const lastScreen = {
  v: 1, w: 390, h: 844, root: 'theme-light', style: '', body: '',
  html: '<div id="old-note-flash">OLDNOTEFLASH</div>', css: '', scroll: [] as [number, number][],
};

test('empty-tab launch shows the logo, not the last note', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((snap) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# Alpha\n\nfirst\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:settings', JSON.stringify({ version: 3, launchTabs: 'empty' }));
    localStorage.setItem('satr:snapshot', JSON.stringify(snap));
  }, lastScreen);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const cover = page.locator('#boot-snapshot');
  await expect(cover).toBeVisible();
  await expect(cover).toHaveClass(/is-splash/);
  await expect(cover).not.toContainText('OLDNOTEFLASH');
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
});

test('restore last tabs still paints the last screen first', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((snap) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# Alpha\n\nfirst\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:settings', JSON.stringify({ version: 3, launchTabs: 'last' }));
    localStorage.setItem('satr:snapshot', JSON.stringify(snap));
  }, lastScreen);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#boot-snapshot')).toContainText('OLDNOTEFLASH');
});

test('the cover hands over: the beat on the web, at once on the device', async ({ page }) => {
  // On the device the system splash (android/.../MainActivity.java) is held
  // until the note is on screen, so the HTML cover under it has nothing left
  // to cover: `instant` lifts it as soon as the app has painted, and `done`
  // says when it really is gone. The splash is dismissed on that, not on a
  // timer — on a timer the splash left first and uncovered this cover's own
  // icon, a second icon at a second size, for a few hundred milliseconds.
  // In a browser there is no splash above it, so the cover keeps its beat.
  await page.goto('/');
  const out = await page.evaluate(async () => {
    const { dropSnapshot } = await window.__satr.load('/src/snapshot.ts');
    const cover = (): HTMLElement => {
      document.getElementById('boot-snapshot')?.remove();
      const el = document.createElement('div');
      el.id = 'boot-snapshot';
      document.body.appendChild(el);
      return el;
    };
    const run = (options: Record<string, unknown>): Promise<{ at: number; gone: boolean }> => {
      const el = cover();
      const started = performance.now();
      return new Promise((resolve) => {
        window.setTimeout(() => resolve({ at: -1, gone: !el.isConnected }), 3000);
        dropSnapshot({ ...options, done: () => resolve({ at: performance.now() - started, gone: !el.isConnected }) });
      });
    };
    const device = await run({ instant: true });
    // The web path: the cover is held a beat (480 ms) and fades out.
    (window as { __satrCoverAt?: number }).__satrCoverAt = Date.now();
    const web = await run({});
    // No cover at all (a hand-over after boot): the caller is not left waiting.
    document.getElementById('boot-snapshot')?.remove();
    const none = await new Promise<number>((resolve) => {
      const started = performance.now();
      dropSnapshot({ done: () => resolve(performance.now() - started) });
    });
    return { device, web, none };
  });
  expect(out.device.gone, 'the copy is gone before the splash is dismissed').toBe(true);
  expect(out.device.at, 'no beat on the device').toBeLessThan(300);
  expect(out.web.gone).toBe(true);
  expect(out.web.at, 'the beat, then the fade').toBeGreaterThan(500);
  expect(out.none, 'nothing to lift: at once').toBeLessThan(100);
});
