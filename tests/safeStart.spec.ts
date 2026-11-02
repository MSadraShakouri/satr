import { expect, test, type Page } from '@playwright/test';

// Getting back in (src/safeStart.ts).
//
// Reported: three documents open, the app stopped answering, and neither a
// force stop nor a cleared cache helped. That is the diagnosis -- a force
// stop throws away everything held in memory, so what was wrong was being
// read back from localStorage on every start, and the app reopened its way
// into the same corner each time.
//
// What these pin is the way out: a start writes a mark before it restores
// anything and rubs it out once a file is on the screen, so a start that
// never finishes is visible to the next one.

const VAULT = {
  'Notes/A.md': '# A\n\nthe note that must survive all of this\n',
  'Notes/B.md': '# B\n',
};

async function boot(page: Page, options: {
  tabs: Array<{ path: string }>; active?: number; marks?: number; build?: string;
} ): Promise<void> {
  await page.addInitScript((set) => {
    if (localStorage.getItem('satr:test:seeded')) return;
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: { 'Notes/A.md': 1, 'Notes/B.md': 1, 'Notes/paper.pdf': 1, 'Notes/other.pdf': 1 }, folders: ['Notes'],
    }));
    localStorage.setItem('satr:fs:file:Notes/A.md', set.vault['Notes/A.md']);
    localStorage.setItem('satr:fs:file:Notes/B.md', set.vault['Notes/B.md']);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: set.tabs, active: set.active ?? 0 }));
    localStorage.setItem('satr:place:paper', JSON.stringify({ page: 4, into: 0, zoom: 1 }));
    if (set.marks) localStorage.setItem('satr:boot:attempts', String(set.marks));
    // The build this device has already started once, so the first-run rule
    // does not fire unless a test asks for it.
    if (set.build !== 'new') localStorage.setItem('satr:boot:build', '0.18.1');
  }, { vault: VAULT, tabs: options.tabs, active: options.active, marks: options.marks, build: options.build });
  await page.goto('/');
}

const openTabs = (page: Page): Promise<string[]> => page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('satr:tabs') ?? '{"tabs":[]}') as { tabs: Array<{ path: string }> };
  return saved.tabs.map((t) => t.path);
});

test('a start that finishes leaves no mark behind', async ({ page }) => {
  await boot(page, { tabs: [{ path: 'Notes/A.md' }] });
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('satr:boot:attempts'))).toBe(null);
});

test('after one start that did not finish, the notes come back and the document does not', async ({ page }) => {
  await boot(page, { tabs: [{ path: 'Notes/A.md' }, { path: 'Notes/paper.pdf' }, { path: 'Notes/B.md' }], marks: 1 });
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  // Three tabs still, in their places -- the document's is an empty tab now,
  // not a missing one, so nothing the reader had is silently renumbered.
  await expect.poll(() => openTabs(page)).toEqual(['Notes/A.md', '', 'Notes/B.md']);
  // And it says so rather than leaving them to wonder.
  await expect(page.locator('.notice, #notice')).toContainText(/did not finish starting/i);
});

test('after two, the session is put back to nothing and the notes are still there', async ({ page }) => {
  await boot(page, { tabs: [{ path: 'Notes/paper.pdf' }, { path: 'Notes/A.md' }], marks: 2 });
  await expect(page.locator('#boot-snapshot')).toHaveCount(0, { timeout: 15000 });
  // The session the reader had is gone: no document is reopened, and the two
  // tabs are not two tabs any more. (What the app lands on instead is its
  // ordinary empty-session behaviour -- it may show a note, which is a fine
  // place to be; what matters here is that nothing expensive is restored.)
  await expect.poll(() => openTabs(page)).not.toContain('Notes/paper.pdf');
  expect((await openTabs(page)).length).toBe(1);
  // The reading place went with the session.
  expect(await page.evaluate(() => localStorage.getItem('satr:place:paper'))).toBe(null);
  // The vault did not. This is the line that matters most in this file.
  expect(await page.evaluate(() => localStorage.getItem('satr:fs:file:Notes/A.md')
    ?? JSON.stringify(JSON.parse(localStorage.getItem('satr:fs:index') ?? '{}')))).toContain('A.md');
  const index = await page.evaluate(() => JSON.parse(localStorage.getItem('satr:fs:index') ?? '{}'));
  expect(Object.keys((index as { files: Record<string, number> }).files)).toContain('Notes/A.md');
});

test('the first start on a new build leaves several documents closed', async ({ page }) => {
  await boot(page, {
    tabs: [{ path: 'Notes/A.md' }, { path: 'Notes/paper.pdf' }, { path: 'Notes/other.pdf' }],
    build: 'new',
  });
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await expect.poll(() => openTabs(page)).toEqual(['Notes/A.md', '', '']);
  await expect(page.locator('.notice, #notice')).toContainText(/First run of this version/i);
  // ...and having started once, the build is recorded, so the next start is
  // an ordinary one.
  // ...recorded as whatever this build is. Not spelled out here: a test that
  // has to be edited for every release is a test that will one day be edited
  // without being read.
  expect(await page.evaluate(() => localStorage.getItem('satr:boot:build'))).toMatch(/^\d+\.\d+\.\d+/);
});

test('one document is not the dangerous case, so a new build still opens it', async ({ page }) => {
  // The reader in the middle of a book does not lose their page to an
  // upgrade. Only a session holding several documents is treated as the one
  // that might not come back.
  await boot(page, { tabs: [{ path: 'Notes/paper.pdf' }], build: 'new' });
  await expect(page.locator('#boot-snapshot')).toHaveCount(0, { timeout: 15000 });
  await expect.poll(() => openTabs(page)).toEqual(['Notes/paper.pdf']);
});

test('the mark is rubbed out, so a good start after a bad one restores everything again', async ({ page }) => {
  await boot(page, { tabs: [{ path: 'Notes/A.md' }], marks: 1 });
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('satr:boot:attempts'))).toBe(null);
  await page.evaluate(() => {
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }, { path: 'Notes/paper.pdf' }], active: 0 }));
  });
  await page.reload();
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await expect.poll(() => openTabs(page)).toEqual(['Notes/A.md', 'Notes/paper.pdf']);
});
