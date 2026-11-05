import { test, expect, type Page } from '@playwright/test';

// What a tab's card costs the SECOND time it is shown.
//
// Reported: "right now it's not too interesting and it takes a short
// moment to load, it doesn't need to load if it's saved to the db". Every
// opening of the switcher read every open tab's file off the phone and
// rendered the markdown again, so eight tabs were eight reads and eight
// renders -- and until they landed the cards were blank rectangles, every
// time, for files that had not changed since the last look.
//
// A card built once is kept under its file's path with the file's modified
// time as its stamp (src/tabCards.ts): in memory, where it is handed back
// without waiting at all, and in the database, where it survives the app
// being killed. What is pinned here is all three halves of that -- no
// second read, no blank moment, and no card that outlives the text it was
// made from.

declare global {
  interface Window {
    __satr: { load(path: string): { backend: { read(path: string): Promise<string | null>; write(path: string, text: string): Promise<void> } } };
    __reads?: string[];
  }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

const NOTES: Record<string, string> = {
  'alpha.md': '# Alpha\n\nthe first note, with a line of prose in it\n',
  'beta.md': '# Beta\n\nthe second note, with a different line\n',
  'gamma.md': '# Gamma\n\nthe third note, which is also not the first\n',
};

async function boot(page: Page): Promise<void> {
  await page.addInitScript((seed) => {
    const vault = seed as Record<string, string>;
    const names = Object.keys(vault);
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: Object.fromEntries(names.map((name) => [`Notes/${name}`, 1])),
      folders: ['Notes'],
    }));
    for (const name of names) localStorage.setItem(`satr:fs:file:Notes/${name}`, vault[name]);
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:tabs', JSON.stringify({
      tabs: names.map((name) => ({ path: `Notes/${name}` })), active: 0,
    }));
  }, NOTES);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('#app .cm-file-name')).toHaveText(/alpha/i);
}

const cards = (page: Page) => page.locator('.mobile-tab-preview-page');

/** Open the switcher and wait for every card to have something on it. */
async function openSwitcher(page: Page): Promise<void> {
  await page.locator('#nav-tabs').dispatchEvent('click');
  await expect(page.locator('.mobile-tab-switcher')).toBeVisible();
  await expect(cards(page)).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) await expect(cards(page).nth(i)).not.toBeEmpty();
}

async function closeSwitcher(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
}

/** Count what the vault is asked to read, from here on. */
async function watchReads(page: Page): Promise<void> {
  await page.evaluate(() => {
    const vault = window.__satr.load('/src/vault.ts');
    window.__reads = [];
    const was = vault.backend.read.bind(vault.backend);
    vault.backend.read = (path: string) => { window.__reads!.push(path); return was(path); };
  });
}
const readsSince = (page: Page): Promise<string[]> => page.evaluate(() => window.__reads ?? []);

test('a card that has been built once is not built again', async ({ page }) => {
  await boot(page);
  await openSwitcher(page);
  await closeSwitcher(page);

  await watchReads(page);
  await openSwitcher(page);
  await page.waitForTimeout(600);

  const reads = await readsSince(page);
  // The note being edited is read by the save the switcher does on its way
  // in -- readDiskVersion, comparing the editor against the disk before
  // writing (src/main.ts) -- and that has nothing to do with its card.
  expect(reads.filter((path) => path !== 'Notes/alpha.md'), 'no note was read for a card it already had').toEqual([]);
});

test('a slow disk cannot slow down a card you have already seen', async ({ page }) => {
  // The point of keeping them: the blank rectangle goes away. A browser's
  // localStorage answers in microseconds, which is not the phone this is
  // for -- his reads come back at six to thirteen megabytes a second over
  // a bridge -- so the disk is made slow here on purpose. The cards are
  // then read in the first frame the sheet exists in: anything on them was
  // put there by the draw itself, because a read started at the same
  // moment cannot have landed yet.
  await boot(page);
  await openSwitcher(page);
  await closeSwitcher(page);
  await page.evaluate(() => {
    const vault = window.__satr.load('/src/vault.ts');
    const was = vault.backend.read.bind(vault.backend);
    vault.backend.read = async (path: string) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return was(path);
    };
  });

  const painted = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('#nav-tabs')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise<void>((resolve) => {
      const tick = (): void => { if (document.querySelector('.mobile-tab')) resolve(); else requestAnimationFrame(tick); };
      tick();
    });
    return [...document.querySelectorAll('.mobile-tab-preview-page')].map((card) => card.textContent?.trim() ?? '');
  });
  // Not the tab being read: its note is in the editor, being typed into,
  // so it is the one card that is always built fresh (src/main.ts).
  expect(painted.length).toBe(3);
  expect(painted[1], 'the second tab was drawn with its card already on it').toContain('Beta');
  expect(painted[2], 'and the third').toContain('Gamma');
});

test('the cards outlive the app being killed', async ({ page }) => {
  await boot(page);
  await openSwitcher(page);
  await closeSwitcher(page);

  // Everything in memory goes; the database is what is left, which is the
  // half of this the author asked for by name.
  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('#app .cm-file-name')).toHaveText(/alpha/i);
  await watchReads(page);
  await openSwitcher(page);
  await page.waitForTimeout(600);

  await expect(cards(page).nth(1)).toContainText('Beta');
  const reads = await readsSince(page);
  expect(reads.filter((path) => path === 'Notes/beta.md'), 'the kept card answered, not the file').toEqual([]);
});

test('a note that has changed gets a new card', async ({ page }) => {
  // The whole risk of keeping a card is showing one that is a lie. The
  // stamp is the file's modified time, so a write is a new card and
  // nothing else is.
  await boot(page);
  await openSwitcher(page);
  await expect(cards(page).nth(1)).toContainText('the second note');
  await closeSwitcher(page);

  await page.evaluate(async () => {
    const vault = window.__satr.load('/src/vault.ts');
    await vault.backend.write('Notes/beta.md', '# Beta\n\nrewritten while the switcher was shut\n');
  });

  await openSwitcher(page);
  await expect(cards(page).nth(1), 'the card followed the file').toContainText('rewritten while the switcher was shut');
});
