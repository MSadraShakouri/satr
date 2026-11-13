import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('the first note starts reading while saved positions load, but waits to show it', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', 'Important note');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:view:Notes/A.md', JSON.stringify({ mode: 'preview', line: 1, cursor: [0, 0] }));
    const state = window as unknown as { viewHeld: boolean; noteRead: boolean; releaseView?: () => void };
    state.viewHeld = false; state.noteRead = false;
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) {
      if (key === 'satr:fs:file:Notes/A.md') state.noteRead = true;
      return get.call(this, key);
    };
    const getAll = IDBObjectStore.prototype.getAll;
    const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
    IDBObjectStore.prototype.getAll = function(...args) {
      const request = getAll.apply(this, args);
      if (this.transaction.db.name !== 'satr-view') return request;
      Object.defineProperty(request, 'onsuccess', { configurable: true, set(handler) {
        descriptor.set!.call(request, (event: Event) => {
          state.viewHeld = true;
          state.releaseView = () => handler.call(request, event);
        });
      }, get() { return descriptor.get!.call(request); } });
      return request;
    };
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).viewHeld);
  await expect.poll(() => page.evaluate(() => (window as any).noteRead), { timeout: 3000 }).toBe(true);
  expect(await page.evaluate(() => (window as any).__satrBooted === true), 'the saved position still gates showing the note').toBe(false);
  await page.evaluate(() => (window as any).releaseView());
  await page.waitForFunction(() => (window as any).__satrBooted === true);
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');
  await expect(page.locator('#preview')).toContainText('Important note');
});

test('the Android bridge can read the note while positions load', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:view:Notes/A.md', JSON.stringify({ mode: 'preview', line: 1, cursor: [0, 0] }));
    const state = window as any;
    state.androidBridge = {};
    state.nativeReadStarted = false;
    const promiseMethods: Record<string, string[]> = {
      Filesystem: ['readFile', 'stat', 'readdir', 'writeFile'],
      SatrStorage: ['status'], SatrSystemBars: ['get', 'setStyle', 'setOrientation'],
      SatrOpenFile: ['pending'], SatrSplash: ['dismiss'],
    };
    const callbacks = ['App', 'SatrSystemBars', 'SatrOpenFile'];
    state.Capacitor = {
      PluginHeaders: [...Object.entries(promiseMethods).map(([name, methods]) => ({ name, methods: [
        ...methods.map((method) => ({ name: method, rtype: 'promise' })),
        ...(callbacks.includes(name) ? [{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' }] : []),
      ] })), { name: 'App', methods: [{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' }] }],
      nativeCallback: () => Promise.resolve('listener-id'),
      nativePromise: (plugin: string, method: string) => {
        if (plugin === 'Filesystem' && method === 'readFile') {
          state.nativeReadStarted = true;
          return new Promise((resolve) => { state.releaseNativeRead = () => resolve({ data: 'Android note' }); });
        }
        if (plugin === 'Filesystem' && method === 'stat') return Promise.resolve({ type: 'file', mtime: 1, size: 12 });
        if (plugin === 'Filesystem' && method === 'readdir') return Promise.resolve({ files: [] });
        if (plugin === 'SatrStorage') return Promise.resolve({ granted: true, sdk: 35 });
        if (plugin === 'SatrSystemBars' && method === 'get') return Promise.resolve({ fontScale: 1 });
        if (plugin === 'SatrOpenFile') return Promise.resolve({ available: false });
        return Promise.resolve({});
      },
    };
    const getAll = IDBObjectStore.prototype.getAll;
    const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
    IDBObjectStore.prototype.getAll = function(...args) {
      const request = getAll.apply(this, args);
      if (this.transaction.db.name !== 'satr-view') return request;
      Object.defineProperty(request, 'onsuccess', { configurable: true, set(handler) {
        descriptor.set!.call(request, (event: Event) => {
          state.nativeViewHeld = true;
          state.releaseNativeView = () => handler.call(request, event);
        });
      }, get() { return descriptor.get!.call(request); } });
      return request;
    };
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).nativeViewHeld);
  await expect.poll(() => page.evaluate(() => (window as any).nativeReadStarted), { timeout: 3000 }).toBe(true);
  await page.evaluate(() => (window as any).releaseNativeRead());
  expect(await page.evaluate(() => (window as any).__satrBooted === true), 'the native note waits for its saved view').toBe(false);
  await page.evaluate(() => (window as any).releaseNativeView());
  await page.waitForFunction(() => (window as any).__satrBooted === true);
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');
  await expect(page.locator('#preview')).toContainText('Android note');
});

test('a launch-loop reset waits for the saved-position store before clearing it', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:launching', JSON.stringify({ times: 2, path: 'Notes/A.md' }));
    localStorage.setItem('satr:view:Notes/A.md', JSON.stringify({ mode: 'preview', line: 7, cursor: [0, 0] }));
    const state = window as any;
    const getAll = IDBObjectStore.prototype.getAll;
    const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
    IDBObjectStore.prototype.getAll = function(...args) {
      const request = getAll.apply(this, args);
      if (this.transaction.db.name !== 'satr-view') return request;
      Object.defineProperty(request, 'onsuccess', { configurable: true, set(handler) {
        descriptor.set!.call(request, (event: Event) => {
          state.rescueViewHeld = true;
          state.releaseRescueView = () => handler.call(request, event);
        });
      }, get() { return descriptor.get!.call(request); } });
      return request;
    };
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).rescueViewHeld);
  expect(await page.evaluate(() => localStorage.getItem('satr:view:Notes/A.md')), 'the reset has not run ahead of the store').not.toBeNull();
  await page.evaluate(() => (window as any).releaseRescueView());
  await page.waitForFunction(() => (window as any).__satrBooted === true);
  await expect(page.locator('body')).toHaveClass(/is-empty-tab/);
  await expect(page.locator('.empty-state-note')).toContainText('did not finish starting twice');
  const keys = await page.evaluate(() => window.__satr.load('/src/viewStore.ts').recordKeys());
  expect(keys, 'the reset removes the loaded reading position').toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('satr:launching')), 'successful rescue lifts the launch mark').toBeNull();
});

test('a failing early file read does not release boot while positions are still loading', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    const state = window as any;
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) {
      if (key === 'satr:fs:file:Notes/A.md') { state.readFailed = true; throw new Error('injected read failure'); }
      return get.call(this, key);
    };
    const getAll = IDBObjectStore.prototype.getAll;
    const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
    IDBObjectStore.prototype.getAll = function(...args) {
      const request = getAll.apply(this, args);
      if (this.transaction.db.name !== 'satr-view') return request;
      Object.defineProperty(request, 'onsuccess', { configurable: true, set(handler) {
        descriptor.set!.call(request, (event: Event) => {
          state.errorViewHeld = true;
          state.releaseErrorView = () => handler.call(request, event);
        });
      }, get() { return descriptor.get!.call(request); } });
      return request;
    };
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).errorViewHeld && (window as any).readFailed);
  expect(await page.evaluate(() => (window as any).__satrBooted === true), 'the failure must not bypass positions initialization').toBe(false);
  await page.evaluate(() => (window as any).releaseErrorView());
  await page.waitForFunction(() => (window as any).__satrBooted === true);
});
