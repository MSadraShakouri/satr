import { expect, test, type Page } from '@playwright/test';

// The pictures already read are kept, but not all of them for ever.
//
// src/images.ts used to say "files are read once per session and kept",
// with no cap: every picture ever shown stayed in memory as a data: URL --
// base64, so a 3MB photo is a 4MB string -- on top of the bitmap the
// browser is already holding. The 12:47 device log has Android killing the
// app three times, at 349, 478 and 299MB. The cache now holds 24MB and lets
// the least recently seen go, which costs a re-read and no correctness.

const CAP = 24 * 1024 * 1024;
const SHOTS = 9;
const EACH = 4_000_000;

interface Images {
  dataUrl(src: string, notePath: string, wiki: boolean): Promise<string | null>;
  picturesHeld(): { bytes: number; count: number };
}
interface Store { putStored(path: string, value: { text: string }): Promise<void> }

async function boot(page: Page): Promise<void> {
  await page.addInitScript((shots) => {
    const files: Record<string, number> = { 'Notes/note.md': 1 };
    for (let i = 0; i < (shots as number); i += 1) files[`Notes/p${i}.png`] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/note.md', '# note\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/note.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:demoShown', '1');
  }, SHOTS);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

test('nine photographs do not pile up: the cache holds its cap and re-reads the rest', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async ([shots, each]) => {
    const load = (window as unknown as { __satr: { load<T>(m: string): Promise<T> } }).__satr.load;
    const store = await load<Store>('/src/webStore.ts');
    const images = await load<Images>('/src/images.ts');
    const body = 'A'.repeat(each as number);
    for (let i = 0; i < (shots as number); i += 1) await store.putStored(`Notes/p${i}.png`, { text: `data:image/png;base64,${i}${body}` });
    for (let i = 0; i < (shots as number); i += 1) await images.dataUrl(`p${i}.png`, 'Notes/note.md', false);
    const full = images.picturesHeld();
    // The first one was dropped long ago; asking again must still give the
    // same picture, read back off disk.
    const again = await images.dataUrl('p0.png', 'Notes/note.md', false);
    return { ...full, firstLength: again?.length ?? 0, firstRight: again?.startsWith('data:image/png;base64,0A') ?? false };
  }, [SHOTS, EACH] as const);

  expect(out.bytes, 'the cache stays under its cap').toBeLessThanOrEqual(CAP);
  expect(out.count, 'it let the oldest pictures go').toBeLessThan(SHOTS);
  expect(out.count, 'and kept the ones it could').toBeGreaterThan(1);
  expect(out.firstRight, 'an evicted picture is read again, whole and right').toBe(true);
  expect(out.firstLength).toBeGreaterThan(EACH);
});
