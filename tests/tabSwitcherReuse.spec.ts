import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.evaluate(async () => {
    const w = window as any;
    const mod = await w.__satr.load('/src/tabs.ts');
    w.reuseTest = {
      mod,
      tabs: [
        { key: 'a', title: 'Same', active: true, empty: false, external: false },
        { key: 'b', title: 'Same', active: false, empty: false, external: false },
        { key: 'c', title: 'Third', active: false, empty: false, external: false },
      ],
      now: ['<p>Alpha</p>', '<p>Beta</p>', '<p>Gamma</p>'],
      latest: ['<p>Alpha</p>', '<p>Beta</p>', '<p>Gamma</p>'],
      selected: '',
      open(label: string) {
        mod.openTabSwitcher({
          tabs: () => this.tabs,
          previewNow: (i: number) => this.now[i],
          preview: (i: number) => Promise.resolve(this.latest[i]),
          select: (i: number) => { this.selected = `${label}:${i}`; },
          close: async () => {}, newTab: () => {}, canReopen: () => false, reopen: () => {},
          closeOthers: () => {}, closeAll: async () => {}, move: () => {},
        });
      },
    };
    w.reuseTest.open('old');
  });
  await expect(page.locator('.mobile-tab-preview-page')).toHaveCount(3);
  await expect(page.locator('.mobile-tab-preview-page').nth(2)).toHaveText('Gamma');
}

async function close(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
}

test('reuses the same rendered cards across a tab switch, but refreshes changed cards and callbacks', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).reuseTest.original = [...document.querySelectorAll('.mobile-tab-preview-page > p')]; });
  await close(page);
  await expect(page.locator('.mobile-tab-switcher-parked')).toHaveCount(1);
  const hidden = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.mobile-tab-switcher-parked')!;
    return { visibility: getComputedStyle(el).visibility, inert: el.inert, aria: el.getAttribute('aria-hidden') };
  });
  expect(hidden, 'the retained sheet cannot be seen or interacted with').toEqual({ visibility: 'hidden', inert: true, aria: 'true' });
  await page.evaluate(() => {
    const t = (window as any).reuseTest;
    t.tabs[0].active = false; t.tabs[1].active = true;
    t.now[1] = null; // active tab: use its last rendered card until the refresh
    t.now[2] = '<p>Gamma changed</p>'; t.latest[2] = t.now[2];
    t.open('new');
  });
  await expect(page.locator('.mobile-tab.is-active')).toHaveAttribute('data-index', '1');
  await expect(page.locator('.mobile-tab-preview-page').nth(1)).toHaveText('Beta');
  await expect(page.locator('.mobile-tab-preview-page').nth(2)).toHaveText('Gamma changed');
  const reused = await page.evaluate(() => {
    const old = (window as any).reuseTest.original;
    const now = [...document.querySelectorAll('.mobile-tab-switcher .mobile-tab-preview-page > p')];
    return [old[0] === now[0], old[1] === now[1], old[2] === now[2]];
  });
  expect(reused, 'unchanged previews retain their rendered nodes; changed content does not').toEqual([true, true, false]);
  await page.locator('.mobile-tab-switcher .mobile-tab').nth(1).click();
  expect(await page.evaluate(() => (window as any).reuseTest.selected), 'the current callback is used').toBe('new:1');
});

test('same display names with different paths never reuse the wrong preview', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).reuseTest.old = document.querySelector('.mobile-tab-preview-page > p'); });
  await close(page);
  await expect(page.locator('.mobile-tab-switcher-parked')).toHaveCount(1);
  await page.evaluate(() => { const t = (window as any).reuseTest; t.tabs[0].key = 'different'; t.now[0] = t.latest[0] = '<p>Replacement</p>'; t.open('new'); });
  await expect(page.locator('.mobile-tab-preview-page').first()).toHaveText('Replacement');
  expect(await page.evaluate(() => (window as any).reuseTest.old === document.querySelector('.mobile-tab-preview-page > p')), 'a new identity rebuilds the sheet').toBe(false);
});

test('late results from a previous opening cannot overwrite a reopened card', async ({ page }) => {
  await setup(page);
  await close(page);
  await expect(page.locator('.mobile-tab-switcher-parked')).toHaveCount(1);
  await page.evaluate(() => {
    const t = (window as any).reuseTest;
    const make = (label: string, preview: () => Promise<string>) => ({
      tabs: () => t.tabs, previewNow: (i: number) => t.now[i], preview,
      select: () => {}, close: async () => {}, newTab: () => {}, canReopen: () => false,
      reopen: () => {}, closeOthers: () => {}, closeAll: async () => {}, move: () => {},
    });
    t.make = make;
    t.mod.openTabSwitcher(make('first', () => new Promise(resolve => { (t.pending ??= []).push(resolve); })));
  });
  await close(page);
  await expect(page.locator('.mobile-tab-switcher-parked')).toHaveCount(1);
  await page.evaluate(() => {
    const t = (window as any).reuseTest;
    t.mod.openTabSwitcher(t.make('second', () => Promise.resolve('<p>Fresh</p>')));
  });
  await expect(page.locator('.mobile-tab-preview-page').first()).toHaveText('Fresh');
  await page.evaluate(() => { for (const finish of (window as any).reuseTest.pending) finish('<p>Stale</p>'); });
  await expect(page.locator('.mobile-tab-preview-page').first()).toHaveText('Fresh');
});

test('backgrounding drops the retained sheet', async ({ page }) => {
  await setup(page); await close(page);
  await expect(page.locator('.mobile-tab-switcher-parked')).toHaveCount(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  await expect(page.locator('.mobile-tab-switcher-parked'), 'no retained sheet in background').toHaveCount(0);
});

test('decoded pictures are dropped without discarding note cards, and excessive trees are not retained', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const t = (window as any).reuseTest;
    t.now[0] = t.latest[0] = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';
    document.querySelector('.mobile-tab-preview-page')!.innerHTML = t.now[0];
  });
  await close(page);
  await expect(page.locator('.mobile-tab-switcher-parked'), 'the other note cards are retained').toHaveCount(1);
  await expect(page.locator('.mobile-tab-switcher-parked img'), 'the decoded picture was released').toHaveCount(0);
  await page.evaluate(() => { (window as any).reuseTest.open('again'); });
  await expect(page.locator('.mobile-tab-switcher .mobile-tab-preview-page img'), 'the released picture is restored').toHaveCount(1);
  await close(page);
  await expect(page.locator('.mobile-tab-switcher-parked')).toHaveCount(1);
  await page.evaluate(() => {
    const t = (window as any).reuseTest;
    t.tabs[0].key = 'large';
    t.now[0] = t.latest[0] = '<p>' + '<i>x</i>'.repeat(10_001) + '</p>';
    t.open('large');
  });
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(1);
  await close(page);
  await expect(page.locator('.mobile-tab-switcher-parked'), 'a large sheet is discarded').toHaveCount(0);
});

test('the retained sheet expires, and rapid close and reopen cannot leave two sheets', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const t = (window as any).reuseTest;
    t.mod.closeTabSwitcher();
    t.open('rapid');
  });
  await expect(page.locator('.mobile-tab-switcher'), 'one sheet after rapid reopen').toHaveCount(1);
  await expect(page.locator('.mobile-tab-switcher-parked'), 'the interrupted close does not park a second sheet').toHaveCount(0);
  await page.evaluate(() => {
    const w = window as any;
    w.savedTimeout = window.setTimeout;
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: any[]) =>
      w.savedTimeout(handler, delay === 30_000 ? 1000 : delay, ...args)) as typeof window.setTimeout;
  });
  await close(page);
  await expect(page.locator('.mobile-tab-switcher-parked')).toHaveCount(1);
  await page.evaluate(() => { window.setTimeout = (window as any).savedTimeout; });
  await expect(page.locator('.mobile-tab-switcher-parked'), 'the retained sheet expires').toHaveCount(0, { timeout: 3000 });
});

test('a sheet with excessive preview HTML is not retained', async ({ page }) => {
  await setup(page); await close(page);
  await expect(page.locator('.mobile-tab-switcher-parked')).toHaveCount(1);
  await page.evaluate(() => {
    const t = (window as any).reuseTest;
    t.tabs[0].key = 'big-text'; t.now[0] = t.latest[0] = '<p>' + 'a'.repeat(512_001) + '</p>';
    t.open('large');
  });
  await close(page);
  await expect(page.locator('.mobile-tab-switcher-parked'), 'an oversized HTML sheet is discarded').toHaveCount(0);
});

test('an edited active note keeps its last card until the fresh card arrives', async ({ page }) => {
  await setup(page); await close(page);
  await expect(page.locator('.mobile-tab-switcher-parked')).toHaveCount(1);
  await page.evaluate(() => {
    const t = (window as any).reuseTest;
    t.mod.openTabSwitcher({
      tabs: () => t.tabs, previewNow: (i: number) => i === 0 ? null : t.now[i],
      preview: (i: number) => i === 0 ? new Promise(resolve => { t.finishActive = resolve; }) : Promise.resolve(t.latest[i]),
      select: () => {}, close: async () => {}, newTab: () => {}, canReopen: () => false,
      reopen: () => {}, closeOthers: () => {}, closeAll: async () => {}, move: () => {},
    });
  });
  await expect(page.locator('.mobile-tab-switcher .mobile-tab-preview-page').first(), 'the old preview stays visible while refreshing').toHaveText('Alpha');
  await page.evaluate(() => { (window as any).reuseTest.finishActive('<p>Edited Alpha</p>'); });
  await expect(page.locator('.mobile-tab-switcher .mobile-tab-preview-page').first(), 'the current edit replaces it').toHaveText('Edited Alpha');
});
