import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
});

test('opening files keeps the note shifted after the animation', async ({ page }) => {
  await page.locator('#files').click();
  await expect(page.locator('body')).toHaveClass(/files-open/);
  const shifted = await page.evaluate(() => document.querySelector('.workspace')!.getBoundingClientRect().left);
  expect(shifted).toBeGreaterThan(40);
  // The old CSS 0.45s ease on .workspace was the slide-back. Wait past it.
  await page.waitForTimeout(500);
  const later = await page.evaluate(() => document.querySelector('.workspace')!.getBoundingClientRect().left);
  expect(later, JSON.stringify({ shifted, later })).toBeGreaterThan(40);
  expect(Math.abs(later - shifted), JSON.stringify({ shifted, later })).toBeLessThan(2);
});

// ---- The drawers' headers (their second line) ----
//
// Left drawer: the space's path on the first line, its size — "4 files, 1
// folder", the way Obsidian puts the vault's — on a line of its own under it.
// The two used to share one line, and a path long enough to fill it pushed the
// counts off the end, where the ellipsis ate them ("the counts never show").
//
// Right drawer: the note's own size, "2 words, 11 characters", under its name.

type Space = { id: string; name: string; path: string };

/** A vault for the tests that need one. The beforeEach has already booted the
 *  app, so the seed goes in as an init script and the page reloads onto it.
 *  Folders come from the files, plus whatever a fixture needs empty. */
async function seed(
  page: Page,
  files: Record<string, string>,
  spaces: Space[],
  active: string,
  extra: { folders?: string[]; scope?: string; walk?: string; follow?: boolean } = {},
): Promise<void> {
  await page.addInitScript(({ files, spaces, active, extra }) => {
    const folders = new Set<string>(extra.folders ?? []);
    for (const path of Object.keys(files)) {
      const parts = path.split('/');
      parts.pop();
      parts.forEach((_, i) => folders.add(parts.slice(0, i + 1).join('/')));
    }
    const index = { files: {} as Record<string, number>, folders: [...folders] };
    for (const path of Object.keys(files)) index.files[path] = 1;
    localStorage.setItem('satr:fs:index', JSON.stringify(index));
    for (const [path, text] of Object.entries(files)) localStorage.setItem(`satr:fs:file:${path}`, text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: active }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify(spaces));
    if (extra.scope) localStorage.setItem('satr:scope', extra.scope); else localStorage.removeItem('satr:scope');
    if (extra.walk) localStorage.setItem('satr:walk-dir', extra.walk); else localStorage.removeItem('satr:walk-dir');
    localStorage.setItem('satr:follow-active', extra.follow === false ? '0' : '1');
  }, { files, spaces, active, extra });
  await page.reload();
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
}

async function openFiles(page: Page): Promise<void> {
  await page.locator('#files').first().click();
  await expect(page.locator('body')).toHaveClass(/files-open/);
  await page.waitForTimeout(700); // the drawer's settle animation
}

async function openOutline(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+f');
  await expect(page.locator('body')).toHaveClass(/outline-open/);
  await page.waitForTimeout(700);
}

/** The header's lines as the writer sees them: the text, where they sit, and
 *  whether anything runs past the drawer's edge. */
/** The lines each drawer's header is made of. The left one names the space and
 *  its path; the right one names the note (the view's own name is not it). */
const HEADER_LINES = {
  '#file-panel': { name: '.workspace-drawer-vault-name', info: '.workspace-drawer-header-info', count: '.workspace-drawer-count' },
  '#right-panel': { name: '.drawer-note-name', count: '.drawer-note-count' },
} as const;

function header(page: Page, panel: keyof typeof HEADER_LINES) {
  return page.evaluate(({ sel, lines }) => {
    const root = document.querySelector(`#app ${sel}`) as HTMLElement;
    const drawer = root.getBoundingClientRect();
    const line = (selector?: string) => {
      const el = selector ? root.querySelector<HTMLElement>(selector) : null;
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const height = Number.parseFloat(style.lineHeight) || box.height;
      return {
        text: el.textContent ?? '',
        y: Math.round(box.y),
        right: Math.round(box.right),
        lines: Math.round(box.height / height),
        clipped: el.scrollWidth > el.clientWidth + 1,
      };
    };
    return {
      name: line(lines.name),
      info: line(lines.info),
      count: line(lines.count),
      drawerRight: Math.round(drawer.right - Number.parseFloat(getComputedStyle(root).paddingRight)),
    };
  }, { sel: panel, lines: HEADER_LINES[panel] as { name: string; info?: string; count: string } });
}

const PHYSICS = 'Documents/Uni/Semester 3/Physics';

test('the space counts sit on their own line under its path', async ({ page }) => {
  await seed(page, {
    [`${PHYSICS}/lecture 1.md`]: '# one\n',
    [`${PHYSICS}/lecture 2.md`]: '# two\n',
    [`${PHYSICS}/terms/alpha.md`]: 'a\n',
    [`${PHYSICS}/terms/beta.md`]: 'b\n',
  }, [{ id: 'notes', name: 'Physics', path: PHYSICS }], `${PHYSICS}/lecture 1.md`);
  await openFiles(page);
  const head = await header(page, '#file-panel');
  // The path is the path: the counts are not appended to it any more.
  expect(head.info?.text).toBe(PHYSICS);
  expect(head.count?.text).toBe('4 files, 1 folder');
  // And they are on the line below it, inside the drawer.
  expect(head.count!.y).toBeGreaterThan(head.info!.y);
  expect(head.count!.clipped, JSON.stringify(head)).toBe(false);
  expect(head.count!.right, JSON.stringify(head)).toBeLessThanOrEqual(head.drawerRight + 1);
});

test('a single file and folder read in the singular', async ({ page }) => {
  await seed(page, {
    [`${PHYSICS}/lecture 1.md`]: '# one\n',
  }, [{ id: 'notes', name: 'Physics', path: PHYSICS }], `${PHYSICS}/lecture 1.md`, {
    folders: [`${PHYSICS}/terms`],
  });
  await openFiles(page);
  expect((await header(page, '#file-panel')).count?.text).toBe('1 file, 1 folder');
});

test('a long space name and a deep path leave the count line in view', async ({ page }) => {
  const deep = 'Documents/University/Semester 3/Physics/Notes archive';
  await seed(page, {
    [`${deep}/lecture 1.md`]: '# one\n',
    [`${deep}/lecture 2.md`]: '# two\n',
  }, [{ id: 'notes', name: 'Semester Three Physics Notes', path: deep }], `${deep}/lecture 1.md`);
  await openFiles(page);
  const head = await header(page, '#file-panel');
  // The name wraps (two lines at most), the path wraps, and the counts — the
  // line the writer asked for — are still whole, not ellipsised away.
  expect(head.name!.lines).toBeLessThanOrEqual(2);
  expect(head.info!.lines).toBeLessThanOrEqual(2);
  expect(head.count?.text).toBe('2 files, 0 folders');
  expect(head.count!.clipped, JSON.stringify(head)).toBe(false);
  expect(head.count!.right, JSON.stringify(head)).toBeLessThanOrEqual(head.drawerRight + 1);
});

test('a filter narrows the list but not the space the counts describe', async ({ page }) => {
  await seed(page, {
    [`${PHYSICS}/lecture 1.md`]: '# one\n',
    [`${PHYSICS}/terms/alpha.md`]: 'a\n',
  }, [{ id: 'notes', name: 'Physics', path: PHYSICS }], `${PHYSICS}/lecture 1.md`);
  await openFiles(page);
  expect((await header(page, '#file-panel')).count?.text).toBe('2 files, 1 folder');
  const filter = page.locator('#app #file-panel .nav-filter-input');
  await filter.fill('lecture');
  await expect(page.locator('#app #file-panel')).toHaveClass(/mod-filtering/);
  // The one match on screen; the header still counts the whole space.
  await expect(page.locator('#app #file-panel .nav-file-title-content')).toHaveCount(1);
  const filtered = await header(page, '#file-panel');
  expect(filtered.count?.text).toBe('2 files, 1 folder');
  expect(filtered.info?.text).toBe(PHYSICS);
  await filter.fill('');
  await expect(page.locator('#app #file-panel')).not.toHaveClass(/mod-filtering/);
  await expect.poll(async () => (await header(page, '#file-panel')).count?.text).toBe('2 files, 1 folder');
});

test('browsing a folder counts what is in it', async ({ page }) => {
  const uni = 'Documents/Uni/Semester 3';
  await seed(page, {
    [`${uni}/physics.md`]: '# physics\n',
    [`${uni}/Math/algebra.md`]: '# algebra\n',
    [`${PHYSICS}/lecture 1.md`]: '# one\n',
  }, [{ id: 'notes', name: 'Physics', path: PHYSICS }], `${PHYSICS}/lecture 1.md`, {
    scope: 'all',
    walk: uni,
    follow: false,
  });
  await openFiles(page);
  const head = await header(page, '#file-panel');
  expect(head.info?.text).toBe(`/${uni}`);
  // The folder on screen: its own listing — one file, and the two folders in it.
  expect(head.count?.text).toBe('1 file, 2 folders');
  expect(head.count!.clipped, JSON.stringify(head)).toBe(false);
});

test('the open note says its size under its name', async ({ page }) => {
  await seed(page, { 'Notes/A.md': 'alpha beta\n' }, [{ id: 'notes', name: 'Notes', path: 'Notes' }], 'Notes/A.md');
  await openOutline(page);
  const head = await header(page, '#right-panel');
  expect(head.name?.text).toBe('A');
  expect(head.count?.text).toBe('2 words, 11 characters');
  expect(head.count!.y).toBeGreaterThan(head.name!.y);
  expect(head.count!.clipped, JSON.stringify(head)).toBe(false);
});

test('one word and one character read in the singular', async ({ page }) => {
  await seed(page, { 'Notes/A.md': 'x' }, [{ id: 'notes', name: 'Notes', path: 'Notes' }], 'Notes/A.md');
  await openOutline(page);
  expect((await header(page, '#right-panel')).count?.text).toBe('1 word, 1 character');
});

test('the all-notes search says nothing about a note', async ({ page }) => {
  await seed(page, { 'Notes/A.md': 'alpha beta\n' }, [{ id: 'notes', name: 'Notes', path: 'Notes' }], 'Notes/A.md');
  await openOutline(page);
  await page.locator('#app #right-panel [data-scope="all"]').click();
  await expect(page.locator('#app #right-panel .drawer-note-name')).toHaveText('Notes');
  expect((await header(page, '#right-panel')).count?.text).toBe('');
});

test('the count keeps step with the note as it is written', async ({ page }) => {
  await seed(page, { 'Notes/A.md': 'alpha beta\n' }, [{ id: 'notes', name: 'Notes', path: 'Notes' }], 'Notes/A.md');
  await openOutline(page);
  expect((await header(page, '#right-panel')).count?.text).toBe('2 words, 11 characters');
  // The tap outside is the drawer's own way closed (the drawer covers the
  // right of the screen, so aim at the sliver of backdrop left of it).
  await page.locator('#backdrop').click({ position: { x: 20, y: 400 } });
  await expect(page.locator('body')).not.toHaveClass(/outline-open/);
  await page.waitForTimeout(400);
  // Write, then look: the line reads the note as it is now, not as it was.
  const line = await page.locator('#app .cm-content .cm-line').last().boundingBox();
  await page.mouse.click(line!.x + 4, line!.y + line!.height / 2);
  await page.keyboard.type(' gamma');
  await expect.poll(() => page.evaluate(() => document.querySelector('#app .cm-content')!.textContent))
    .toContain('gamma');
  await openOutline(page);
  const live = await page.evaluate(async () => {
    const { EditorView } = await (window as unknown as {
      __satr: { load(path: string): Promise<Record<string, unknown>> };
    }).__satr.load('/node_modules/@codemirror/view/');
    const view = (EditorView as { findFromDOM(dom: Element | null): { state: { doc: { toString(): string } } } })
      .findFromDOM(document.querySelector('#app .cm-content'));
    const text = view.state.doc.toString();
    const words = text.match(/\S+/g)?.length ?? 0;
    return `${words} ${words === 1 ? 'word' : 'words'}, ${text.length} ${text.length === 1 ? 'character' : 'characters'}`;
  });
  const head = await header(page, '#right-panel');
  expect(head.count?.text).toBe(live);
  expect(head.count?.text).not.toBe('2 words, 11 characters');
});
