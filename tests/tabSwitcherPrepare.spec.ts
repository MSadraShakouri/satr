import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

/** Control idle callbacks so a tap can be placed between two preparation slices. */
async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.evaluate(async () => {
    const w = window as any;
    const mod = await w.__satr.load('/src/tabs.ts');
    const callbacks = new Map<number, IdleRequestCallback>();
    let id = 0;
    w.requestIdleCallback = (cb: IdleRequestCallback) => { callbacks.set(++id, cb); return id; };
    w.cancelIdleCallback = (n: number) => callbacks.delete(n);
    const html = '<div class="formula">' + '<span>math</span>'.repeat(1100) + '</div><p>Complete end</p>';
    const state = w.prepTest = {
      mod, callbacks, html, calls: 0, selected: -1, closed: -1,
      tabs: [
        { key: 'a', title: 'A', active: true, empty: false, external: false },
        { key: 'b', title: 'B', active: false, empty: false, external: false },
      ],
      makeDeps() { return {
        tabs: () => this.tabs,
        previewNow: (i: number) => i === 0 ? '<p>Active</p>' : this.html,
        preview: () => { this.calls++; return new Promise<string>(() => {}); },
        select: (i: number) => { this.selected = i; },
        close: async (i: number) => { this.closed = i; this.tabs.splice(i, 1); }, newTab: () => {}, canReopen: () => false,
        reopen: () => {}, closeOthers: () => {}, closeAll: async () => {}, move: () => {},
      }; },
      step() {
        const first = callbacks.entries().next().value as [number, IdleRequestCallback] | undefined;
        if (!first) return false;
        callbacks.delete(first[0]);
        first[1]({ didTimeout: false, timeRemaining: () => 50 });
        return true;
      },
      drain() { let count = 0; while (this.step()) { if (++count > 200) throw Error('idle loop did not finish'); } },
    };
    mod.prepareTabSwitcher(state.makeDeps());
  });
}

test('prepares cached cards invisibly, in bounded slices, then reuses them on the first opening', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.mobile-tab-switcher'), 'no switcher is exposed').toHaveCount(0);
  await expect(page.locator('.mobile-tab-switcher-parked'), 'one hidden sheet is prepared').toHaveCount(1);
  await page.evaluate(() => {
    const t = (window as any).prepTest;
    t.step(); // first card
    t.step(); // start the large second card
  });
  const partial = await page.locator('.mobile-tab-switcher-parked .mobile-tab-preview-page').nth(1).locator('*').count();
  expect(partial, 'a large formula is split rather than built in one idle slice').toBeGreaterThan(0);
  expect(partial, 'the first slice has at most 350 nodes').toBeLessThanOrEqual(350);
  await page.evaluate(() => { (window as any).prepTest.drain(); });
  await expect(page.locator('.mobile-tab-switcher-parked .mobile-tab-preview-page').nth(1).locator('span')).toHaveCount(1100);
  expect(await page.evaluate(() => (window as any).prepTest.calls), 'preparing does not fetch or validate cards').toBe(0);
  await page.evaluate(() => {
    const t = (window as any).prepTest;
    t.old = document.querySelector('.mobile-tab-switcher-parked .formula');
    t.mod.openTabSwitcher(t.makeDeps());
  });
  expect(await page.evaluate(() => (window as any).prepTest.old === document.querySelector('.mobile-tab-switcher .formula')), 'first opening reuses the prepared DOM').toBe(true);
  await expect(page.locator('.mobile-tab-switcher .mobile-tab-preview-page').nth(1).locator('span')).toHaveCount(1100);
  await expect(page.locator('.mobile-tab-switcher .mobile-tab-preview-page').nth(1)).toContainText('Complete end');
  expect(await page.evaluate(() => (window as any).prepTest.calls), 'the real opening validates every card').toBe(2);
});

test('input interrupts preparation; a tap never exposes a partial card', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { const t = (window as any).prepTest; t.step(); t.step(); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await expect(page.locator('.mobile-tab-switcher-parked .mobile-tab-preview-page').nth(1), 'unfinished preview is removed').toBeEmpty();
  expect(await page.evaluate(() => (window as any).prepTest.callbacks.size), 'no further idle work remains').toBe(0);
  await page.evaluate(() => { const t = (window as any).prepTest; t.mod.openTabSwitcher(t.makeDeps()); });
  await expect(page.locator('.mobile-tab-switcher .mobile-tab-preview-page').nth(1).locator('span'), 'cached card is complete on the first opening').toHaveCount(1100);
  await expect(page.locator('.mobile-tab-switcher .mobile-tab-preview-page').nth(1)).toContainText('Complete end');
});

test('changing tab identities during preparation discards the old sheet', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { const t = (window as any).prepTest; t.step(); t.tabs[1].key = 'new-path'; t.html = '<p>New file</p>'; t.step(); });
  await expect(page.locator('.mobile-tab-switcher-parked')).toHaveCount(0);
  await page.evaluate(() => { const t = (window as any).prepTest; t.mod.openTabSwitcher(t.makeDeps()); });
  await expect(page.locator('.mobile-tab-switcher .mobile-tab-preview-page').nth(1)).toHaveText('New file');
});

test('backgrounding discards a partially prepared tree', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const t = (window as any).prepTest; t.step(); t.step();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  await expect(page.locator('.mobile-tab-switcher-parked')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).prepTest.callbacks.size), 'the detached tree has no scheduled work').toBe(0);
});

test('pictures are not prepared or decoded, and still appear on opening', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const t = (window as any).prepTest;
    t.html = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';
    t.drain();
  });
  await expect(page.locator('.mobile-tab-switcher-parked img')).toHaveCount(0);
  await page.evaluate(() => { const t = (window as any).prepTest; t.mod.openTabSwitcher(t.makeDeps()); });
  await expect(page.locator('.mobile-tab-switcher .mobile-tab-preview-page img')).toHaveCount(1);
});

test('very large cached cards are left for the real opening', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { const t = (window as any).prepTest; t.html = '<p>' + 'a'.repeat(128_001) + '</p>'; t.drain(); });
  await expect(page.locator('.mobile-tab-switcher-parked .mobile-tab-preview-page').nth(1)).toBeEmpty();
  await page.evaluate(() => { const t = (window as any).prepTest; t.mod.openTabSwitcher(t.makeDeps()); });
  expect(await page.locator('.mobile-tab-switcher .mobile-tab-preview-page').nth(1).textContent()).toHaveLength(128_001);
});


test('a swipe still closes the right tab on a prepared first opening', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { const t = (window as any).prepTest; t.drain(); t.mod.openTabSwitcher(t.makeDeps()); });
  await page.evaluate(async () => {
    const card = document.querySelector<HTMLElement>('.mobile-tab-switcher .mobile-tab[data-index="1"]')!;
    const box = card.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const send = (type: string, dx: number, up = false) => {
      const t = new Touch({ identifier: 1, target: card, clientX: x + dx, clientY: y, pageX: x + dx, pageY: y });
      card.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: up ? [] : [t], targetTouches: up ? [] : [t], changedTouches: [t] }));
    };
    send('touchstart', 0); send('touchmove', -Math.round(box.width * 0.35));
    await new Promise(resolve => setTimeout(resolve, 200)); send('touchend', -Math.round(box.width * 0.35), true);
  });
  await expect.poll(() => page.evaluate(() => (window as any).prepTest.closed), { message: 'the second tab was closed' }).toBe(1);
  await expect(page.locator('.mobile-tab-switcher .mobile-tab')).toHaveCount(1);
});

test('a tabs press before the idle callback prevents a late speculative sheet', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.evaluate(async () => {
    const mod = await (window as any).__satr.load('/src/tabs.ts');
    mod.stopPreparingTabSwitcher(); // the real tabs pointerdown does this
    mod.prepareTabSwitcher({
      tabs: () => [{ key: 'a', title: 'A', active: true, empty: false, external: false }, { key: 'b', title: 'B', active: false, empty: false, external: false }],
      preview: async () => '', previewNow: () => '<p>cached</p>', select: () => {}, close: async () => {}, newTab: () => {},
      canReopen: () => false, reopen: () => {}, closeOthers: () => {}, closeAll: async () => {}, move: () => {},
    });
  });
  await expect(page.locator('.mobile-tab-switcher-parked')).toHaveCount(0);
});
