import { expect, test, type Page } from '@playwright/test';

// Where each file was left now lives in IndexedDB rather than localStorage.
// What these check is that moving it did not lose any of it: the same
// memory, across a restart, out of the old place and into the new one.

const NOTE = '# A\n\none\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n';

async function boot(page: Page, legacy: Record<string, string> = {}): Promise<void> {
  await page.addInitScript((old: Record<string, string>) => {
    if (localStorage.getItem('satr:test:seeded')) return;
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/B.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n\none\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n');
    localStorage.setItem('satr:fs:file:Notes/B.md', '# B\n');
    localStorage.setItem('satr:tabs', JSON.stringify([{ path: 'Notes/A.md' }]));
    for (const [key, value] of Object.entries(old)) localStorage.setItem(key, value);
  }, legacy);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A', { timeout: 15000 });
}

/** Every satr:view:/satr:place: key still sitting in localStorage. */
const leftInLocalStorage = (page: Page): Promise<string[]> => page.evaluate(() => {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('satr:view:') || key.startsWith('satr:place:'))) keys.push(key);
  }
  return keys;
});

test('a note comes back in the view it was left in, and localStorage is not where it was kept', async ({ page }) => {
  await boot(page);
  await page.locator('#preview-toggle').click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');

  // The record is not in localStorage -- that is the whole point of the move.
  await expect.poll(() => leftInLocalStorage(page)).toEqual([]);

  await page.reload();
  await expect(page.locator('#app .cm-file-name')).toHaveText('A', { timeout: 15000 });
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');
  expect(await leftInLocalStorage(page)).toEqual([]);
});

test('records left in localStorage by an older version are taken over, not dropped', async ({ page }) => {
  // The upgrade path. Someone running the old build has these in
  // localStorage; the new one must honour them on the very first start and
  // then get them out of there.
  await boot(page, {
    'satr:view:Notes/A.md': JSON.stringify({ mode: 'preview', line: 0 }),
    'satr:place:somedocument': JSON.stringify({ page: 7, into: 0.25, zoom: 2 }),
  });
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');
  await expect.poll(() => leftInLocalStorage(page)).toEqual([]);

  // ...and they are still there to be read, from their new home.
  const place = await page.evaluate(async () => {
    const module = await window.__satr.load('/src/viewStore.ts');
    return module.readRecord('satr:place:somedocument');
  });
  expect(JSON.parse(place as string)).toMatchObject({ page: 7, zoom: 2 });

  await page.reload();
  await expect(page.locator('#app .cm-file-name')).toHaveText('A', { timeout: 15000 });
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');
});

test('a record survives a restart through the database, not the cache', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const module = await window.__satr.load('/src/viewStore.ts');
    module.writeRecord('satr:place:deliberate', JSON.stringify({ page: 42, into: 0.5, zoom: 3 }));
  });
  await page.reload();
  await expect(page.locator('#app .cm-file-name')).toHaveText('A', { timeout: 15000 });
  const back = await page.evaluate(async () => {
    const module = await window.__satr.load('/src/viewStore.ts');
    await module.openViewStore();
    return module.readRecord('satr:place:deliberate');
  });
  expect(JSON.parse(back as string)).toMatchObject({ page: 42, zoom: 3 });
});

test('the store is bounded: the oldest records go, the newest stay', async ({ page }) => {
  // "Grows forever" is what went wrong the first time. The bound is far
  // above any real vault, but it exists.
  await boot(page);
  const result = await page.evaluate(async () => {
    const module = await window.__satr.load('/src/viewStore.ts');
    await module.openViewStore();
    for (let i = 0; i < 2100; i += 1) module.writeRecord(`satr:view:bulk/${i}.md`, `{"mode":"edit","line":${i}}`);
    return {
      oldestGone: module.readRecord('satr:view:bulk/0.md') === null,
      newestKept: module.readRecord('satr:view:bulk/2099.md') !== null,
      held: module.recordKeys().length,
    };
  });
  expect(result.oldestGone).toBe(true);
  expect(result.newestKept).toBe(true);
  expect(result.held).toBeLessThanOrEqual(2000);
});

test('a note with no record opens as a note, not as nothing', async ({ page }) => {
  await boot(page);
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'edit');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
});

test('forgetting the view memory leaves nothing behind in either place', async ({ page }) => {
  // What a reset needs: the records are in two places during an upgrade, and
  // clearing one of them is not clearing them.
  await boot(page, { 'satr:view:Notes/B.md': JSON.stringify({ mode: 'preview', line: 0 }) });
  await page.evaluate(async () => {
    const module = await window.__satr.load('/src/viewStore.ts');
    await module.openViewStore();
    module.writeRecord('satr:place:doc', '{"page":3}');
    module.forgetViews();
  });
  expect(await page.evaluate(async () => {
    const module = await window.__satr.load('/src/viewStore.ts');
    return { held: module.recordKeys().length, read: module.readRecord('satr:place:doc') };
  })).toEqual({ held: 0, read: null });
  expect(await leftInLocalStorage(page)).toEqual([]);

  await page.reload();
  await expect(page.locator('#app .cm-file-name')).toHaveText('A', { timeout: 15000 });
  expect(await page.evaluate(async () => {
    const module = await window.__satr.load('/src/viewStore.ts');
    await module.openViewStore();
    return module.recordKeys().filter((k: string) => k.startsWith('satr:place:')).length;
  })).toBe(0);
});
