import { expect, test, type Page } from '@playwright/test';

// What is inside a file of the browser vault lives in IndexedDB, not in
// localStorage (src/webStore.ts).
//
// localStorage holds text, so bytes have to be base64 — a third bigger again —
// and the whole origin gets about five megabytes for every note and every
// imported file together. One PDF spends a quarter of that, and when the
// budget runs out it is not only the import that fails: saving a note starts
// throwing as well. The index stays where it was, because it is small and the
// app wants it before it can wait for anything.

type Vault = {
  backend: {
    read(path: string): Promise<string | null>;
    write(path: string, text: string): Promise<void>;
    writeBytes?(path: string, blob: Blob): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    remove(path: string): Promise<void>;
    readDataUrl(path: string): Promise<string | null>;
  };
};

const vault = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('demo');
};

/** Run something against the app's own vault, in the page. */
const inVault = <T>(page: Page, work: (vault: Vault, arg: string) => Promise<T>, arg = ''): Promise<T> =>
  page.evaluate(async ([source, value]) => {
    const mod = await (window as unknown as { __satr: { load(p: string): Promise<Record<string, never>> } })
      .__satr.load('/src/vault.ts') as unknown as Vault;
    // eslint-disable-next-line no-new-func
    return (new Function(`return (${source})`)() as (v: Vault, a: string) => Promise<T>)(mod, value);
  }, [work.toString(), arg] as const);

test('a file far larger than localStorage would hold is kept, and read back whole', async ({ page }) => {
  await vault(page);
  // Eight megabytes: more than the whole origin is given in localStorage, and
  // about what a picture-heavy PDF comes to.
  const size = await inVault(page, async (mod) => {
    const big = 'x'.repeat(8 * 1024 * 1024);
    await mod.backend.write('Notes/big.txt', big);
    const back = await mod.backend.read('Notes/big.txt');
    return back === null ? -1 : back.length;
  });
  expect(size).toBe(8 * 1024 * 1024);
  // and nothing of it was left sitting in localStorage
  expect(await page.evaluate(() => localStorage.getItem('satr:fs:file:Notes/big.txt'))).toBeNull();
});

test('bytes go in as bytes and come back as the data URL the app reads them by', async ({ page }) => {
  await vault(page);
  const url = await inVault(page, async (mod) => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // %PDF-1.4
    await mod.backend.writeBytes!('Notes/paper.pdf', new Blob([bytes], { type: 'application/pdf' }));
    return mod.backend.readDataUrl('Notes/paper.pdf');
  });
  expect(url).toBe('data:application/pdf;base64,JVBERi0xLjQ=');
});

test('a file an older version left in localStorage is moved into the store as it is read', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/old.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/old.md', '# written by the version before\n');
  });
  await page.goto('/');
  await expect(page.locator('.empty-state-title')).toHaveText('No file is open');
  expect(await inVault(page, (mod) => mod.backend.read('Notes/old.md'))).toContain('the version before');
  // read once, and it has moved: the old key is gone
  expect(await page.evaluate(() => localStorage.getItem('satr:fs:file:Notes/old.md'))).toBeNull();
  // and it is still there afterwards, from the store this time
  expect(await inVault(page, (mod) => mod.backend.read('Notes/old.md'))).toContain('the version before');
});

test('renaming carries the contents, and deleting takes them away', async ({ page }) => {
  await vault(page);
  const [moved, gone] = await inVault(page, async (mod) => {
    await mod.backend.write('Notes/one.md', 'the contents');
    await mod.backend.rename('Notes/one.md', 'Notes/two.md');
    const after = await mod.backend.read('Notes/two.md');
    await mod.backend.remove('Notes/two.md');
    return [after, await mod.backend.read('Notes/two.md')];
  });
  expect(moved).toBe('the contents');
  expect(gone).toBeNull();
});
