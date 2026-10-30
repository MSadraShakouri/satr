import type { Page } from '@playwright/test';

/**
 * What the vault really holds for a file.
 *
 * Contents live in IndexedDB; `satr:fs:file:<path>` in localStorage is an
 * inbox that the backend drains on the first read of that path. A spec may
 * still seed through the inbox — that is what it is for — but reading one
 * back through it only works until the app has touched the file, which is
 * exactly when a spec wants to look.
 */
export const vaultText = (page: Page, path: string): Promise<string | null> =>
  page.evaluate(async (file) => {
    const { getStored, storedText } = await (window as unknown as {
      __satr: { load(module: string): Promise<{ getStored(path: string): Promise<unknown>; storedText(value: unknown): Promise<string> }> };
    }).__satr.load('/src/webStore.ts');
    const value = await getStored(file);
    return value ? await storedText(value) : localStorage.getItem(`satr:fs:file:${file}`);
  }, path);
