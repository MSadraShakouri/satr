import { expect, test, type Page } from '@playwright/test';

// The order the file tree puts things in.
//
// Three complaints, one place. "The file order is unpleasant": sorting by
// time does not see inside folders, so a folder whose notes were all
// rewritten this morning sits at the bottom of "recently edited". Folders
// above files was a law and not a choice -- "by name" never actually
// meant by name. And one rule covered the whole vault: "when I set a
// rule, the rule exists for every subfolder unless they have an
// override", which is the opposite of what it did.
//
// A rule now belongs to a folder and travels downwards from it. A space is
// a folder like any other ("spaces are technically folders too"), so a
// rule set on the folder a space points at is that space's rule.

const FILES: Record<string, string> = {
  'Notes/apple.md': '# Apple\n',
  'Notes/zebra.md': '# Zebra\n',
  'Notes/Beta/one.md': '# One\n',
  'Notes/Beta/far.md': '# Far\n',
  'Notes/Beta/Deep/two.md': '# Two\n',
  'Notes/Alpha/three.md': '# Three\n',
};

async function boot(page: Page, before?: (window: Window) => void): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((files: Record<string, string>) => {
    const folders = [...new Set(Object.keys(files).flatMap((path) => {
      const parts = path.split('/');
      parts.pop();
      return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    }))];
    const index = { files: {} as Record<string, number>, folders };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/apple.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:expanded:notes', JSON.stringify(['Notes/Beta']));
    localStorage.setItem('satr:demoShown', '1');
  }, FILES);
  if (before) await page.addInitScript(before);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

async function openDrawer(page: Page): Promise<void> {
  if (!(await page.locator('body').evaluate((body) => body.classList.contains('files-open')))) {
    await page.locator('#files').click();
    await expect(page.locator('body')).toHaveClass(/files-open/);
  }
}

/** The rows of the tree, top to bottom, by the path each one stands for. */
const rows = (page: Page): Promise<string[]> =>
  page.locator('#file-panel .tree-item-self').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.path ?? ''));

/** The rows directly inside one folder, in the order they are drawn. */
async function inside(page: Page, dir: string): Promise<string[]> {
  const all = await rows(page);
  return all.filter((path) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'));
}

/** The sort menu from the button at the top of the tree. */
async function sortMenu(page: Page): Promise<void> {
  await openDrawer(page);
  await page.locator('#file-panel [data-act="sort"]').click();
  await expect(page.locator('.menu.mod-bottom-sheet')).toBeVisible();
}

/** A folder row's own menu, then its sort sheet. */
async function folderSortMenu(page: Page, path: string): Promise<void> {
  await openDrawer(page);
  await page.locator(`#file-panel .tree-item-self[data-path="${path}"]`).click({ button: 'right' });
  await expect(page.locator('.menu.mod-bottom-sheet')).toBeVisible();
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Sort this folder' }).click();
  await expect(page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'File name (A to Z)' })).toBeVisible();
}

const pick = async (page: Page, title: string): Promise<void> => {
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: title }).first().click();
  await expect(page.locator('.menu.mod-bottom-sheet')).toHaveCount(0);
};

test('folders above files is a choice, not a law', async ({ page }) => {
  await boot(page);
  await openDrawer(page);
  expect(await inside(page, 'Notes'), 'as it has always been: the folders, then the files')
    .toEqual(['Notes/Alpha', 'Notes/Beta', 'Notes/apple.md', 'Notes/zebra.md']);

  await sortMenu(page);
  await pick(page, 'Folders first');
  // By name means by name now: apple falls between the two folders.
  expect(await inside(page, 'Notes')).toEqual(['Notes/Alpha', 'Notes/apple.md', 'Notes/Beta', 'Notes/zebra.md']);

  await sortMenu(page);
  await pick(page, 'Folders first');
  expect(await inside(page, 'Notes'), 'and back again').toEqual(['Notes/Alpha', 'Notes/Beta', 'Notes/apple.md', 'Notes/zebra.md']);
});

test('a rule set on a folder is the rule inside it, all the way down', async ({ page }) => {
  await boot(page);
  await openDrawer(page);
  // Beta is open, and Deep inside it.
  await page.locator('#file-panel .tree-item-self[data-path="Notes/Beta/Deep"]').click();
  await expect(page.locator('#file-panel .tree-item-self[data-path="Notes/Beta/Deep/two.md"]')).toBeVisible();

  await folderSortMenu(page, 'Notes/Beta');
  await pick(page, 'File name (Z to A)');

  // The folder that was told, its own rows reversed -- within the folders
  // and within the files, because folders first is still on here.
  expect(await inside(page, 'Notes/Beta')).toEqual(['Notes/Beta/Deep', 'Notes/Beta/one.md', 'Notes/Beta/far.md']);
  expect(await inside(page, 'Notes/Beta/Deep')).toEqual(['Notes/Beta/Deep/two.md']);
  // ...and the folder above it, which was told nothing, left alone.
  expect(await inside(page, 'Notes')).toEqual(['Notes/Alpha', 'Notes/Beta', 'Notes/apple.md', 'Notes/zebra.md']);
});

test('a subfolder can be given its own rule, and can hand it back', async ({ page }) => {
  await boot(page, () => {
    localStorage.setItem('satr:sort-rules', JSON.stringify({ 'Notes/Beta': { sort: 'name-desc' } }));
    localStorage.setItem('satr:expanded:notes', JSON.stringify(['Notes/Beta', 'Notes/Beta/Deep']));
  });
  await openDrawer(page);
  expect(await inside(page, 'Notes/Beta'), 'inherited from Beta').toEqual(['Notes/Beta/Deep', 'Notes/Beta/one.md', 'Notes/Beta/far.md']);

  // Deep is given the opposite of what it inherits...
  await folderSortMenu(page, 'Notes/Beta/Deep');
  await expect(page.locator('.menu.mod-bottom-sheet .menu-item.mod-selected', { hasText: 'File name (Z to A)' }),
    'the sheet opens on the rule in force, inherited or not').toBeVisible();
  await pick(page, 'File name (A to Z)');

  // ...and then hands the question back to Beta.
  await folderSortMenu(page, 'Notes/Beta/Deep');
  await pick(page, 'Same as the folder above');
  await folderSortMenu(page, 'Notes/Beta/Deep');
  await expect(page.locator('.menu.mod-bottom-sheet .menu-item.mod-selected', { hasText: 'File name (Z to A)' }),
    'back to Beta\u2019s rule').toBeVisible();
  await expect(page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Same as the folder above' }),
    'and nothing of its own left to undo').toHaveCount(0);
});

test('sorting by time sees inside a folder', async ({ page }) => {
  // The complaint itself. A folder's own modified time says when its entry
  // changed -- a file added or renamed -- and nothing about a note inside
  // it being rewritten, which is what he does all day. Alpha sorts before
  // Beta by name; a write inside Beta has to put Beta first.
  await boot(page);
  await openDrawer(page);
  await sortMenu(page);
  await pick(page, 'Modified time (new to old)');
  expect(await inside(page, 'Notes'), 'nothing to tell them apart yet, so by name')
    .toEqual(['Notes/Alpha', 'Notes/Beta', 'Notes/apple.md', 'Notes/zebra.md']);

  await page.evaluate(async () => {
    const vault = (window as unknown as {
      __satr: { load(path: string): { backend: { write(path: string, text: string): Promise<void> } } };
    }).__satr.load('/src/vault.ts');
    await vault.backend.write('Notes/Beta/Deep/two.md', '# Two\n\nrewritten this morning\n');
  });
  // Draw the tree again: the write happened behind its back.
  await sortMenu(page);
  await pick(page, 'Modified time (new to old)');

  const order = await inside(page, 'Notes');
  expect(order[0], 'the folder he was working in, however deep the note was').toBe('Notes/Beta');
  expect(order.indexOf('Notes/Beta')).toBeLessThan(order.indexOf('Notes/Alpha'));
});

test('a space is a folder for this too', async ({ page }) => {
  // A space is a folder that was picked, so a rule set on that folder is
  // the rule the space opens with -- and a rule set at the root of the
  // vault reaches into every space that has not been told otherwise.
  await boot(page, () => {
    localStorage.setItem('satr:sort-rules', JSON.stringify({ '': { sort: 'name-desc' } }));
  });
  await openDrawer(page);
  expect(await inside(page, 'Notes'), 'the vault\u2019s rule, inside the space')
    .toEqual(['Notes/Beta', 'Notes/Alpha', 'Notes/zebra.md', 'Notes/apple.md']);

  await folderSortMenu(page, 'Notes/Beta');
  await pick(page, 'File name (A to Z)');
  expect(await inside(page, 'Notes'), 'the space\u2019s own folders are not the folder that was told')
    .toEqual(['Notes/Beta', 'Notes/Alpha', 'Notes/zebra.md', 'Notes/apple.md']);
  expect(await inside(page, 'Notes/Beta')).toEqual(['Notes/Beta/Deep', 'Notes/Beta/far.md', 'Notes/Beta/one.md']);
});
