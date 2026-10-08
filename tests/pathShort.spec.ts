import { expect, test, type Page } from '@playwright/test';

// The paths the drawers and the new tab show, shortened the way powerlevel10k
// shortens a prompt's directory (`truncate_to_unique`): every component but the
// last is cut to the shortest prefix no sibling of it shares. "Accounting keeps
// its name" — the folder a note lives in is the low-level one the reader is
// looking for, and the components above it are the ones carrying the length.
//
// The module is pure (a sibling lookup in, a path out), so it is tested on its
// own here; the surfaces that show it are pinned in tests/searchPaths.spec.ts
// and tests/newTab.spec.ts.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const SIBLINGS: Record<string, string[]> = {
  '': ['Documents', 'Downloads'],
  Documents: ['Uni', 'Upper'],
  'Documents/Uni': ['Semester 3', 'Semester 4'],
  'Documents/Uni/Semester 3': ['Accounting', 'Art'],
  Notes: ['Uni'],
  'Notes/Uni': ['Semester 3'],
};

test('a component is cut to the shortest prefix no sibling shares', async ({ page }) => {
  const out = await page.evaluate(async (siblings) => {
    const m = await window.__satr.load('/src/pathShort.ts');
    const of = (dir: string): readonly string[] | null => siblings[dir] ?? null;
    return [
      m.shortestUnique('Documents', of('')),
      m.shortestUnique('Uni', of('Documents')),
      m.shortestUnique('Semester 3', of('Documents/Uni')),
      m.shortestUnique('Accounting', of('Documents/Uni/Semester 3')),
    ];
  }, SIBLINGS);
  // "Documents" shares "Do" with "Downloads" and is cut to three letters, and
  // "Accounting" shares "A" with "Art". "Uni"/"Upper" share "U" — and the two
  // Semesters share *every* prefix of either name, so no cut can tell them
  // apart: the name stays whole, which is the honest answer (a shell would
  // need the digit too).
  expect(out).toEqual(['Doc', 'Un', null, 'Ac']);
});

test('a name is never cut to nothing, and an unknown sibling set cuts nothing', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const m = await window.__satr.load('/src/pathShort.ts');
    return [
      m.shortestUnique('Note', null),
      m.shortestUnique('N', ['Note', 'Notes']),
      m.shortestUnique('Note', ['Note', 'Notes']),
      m.shortestUnique('Note', ['Notes']),
    ];
  });
  // No listing: nothing is claimed. A one-letter name, and a name that is a
  // prefix of a longer sibling: nothing can be cut and still be unique, so the
  // name is kept whole.
  expect(out).toEqual([null, null, null, null]);
});

test('whole paths: the last component keeps its name, the first is the anchor', async ({ page }) => {
  const out = await page.evaluate(async (siblings) => {
    const m = await window.__satr.load('/src/pathShort.ts');
    const of = (dir: string): readonly string[] | null => siblings[dir]
      ?? (dir === 'Documents/Uni/Semester 3' ? ['Accounting'] : null);
    return m.shortenPath('Documents/Uni/Semester 3/Accounting', of);
  }, SIBLINGS);
  // The folder the note is in keeps its name; the ones above it are cut — and
  // with no anchor, the first component is cut like the rest.
  expect(out).toBe('Doc/Un/Semester 3/Accounting');
});

test('with a base, the ancestors are read at their full paths', async ({ page }) => {
  const out = await page.evaluate(async (siblings) => {
    const m = await window.__satr.load('/src/pathShort.ts');
    const asked: string[] = [];
    const of = (dir: string): readonly string[] | null => {
      asked.push(dir);
      if (dir === 'Notes') return siblings.Notes!;
      if (dir === 'Notes/Uni') return siblings['Notes/Uni']!;
      return null;
    };
    return [m.shortenPath('Uni/Semester 3/Accounting', of, { base: 'Notes', anchor: true }), asked];
  }, SIBLINGS);
  // With the anchor on, the root's own folder keeps its name ("Notes" is where
  // the reader is, not a folder competing for length) — and is not even looked
  // up: nothing about it is going to be cut.
  expect(out).toEqual(['Uni/S/Accounting', ['Notes/Uni']]);
});

test('the async form asks each folder once, and a folder that cannot be listed stays whole', async ({ page }) => {
  const out = await page.evaluate(async (siblings) => {
    const m = await window.__satr.load('/src/pathShort.ts');
    let calls = 0;
    const names = async (dir: string): Promise<readonly string[] | null> => {
      calls += 1;
      if (dir === 'Documents/Uni') throw new Error('no access');
      if (dir === 'Documents/Uni/Semester 3') return ['Accounting'];
      return siblings[dir] ?? null;
    };
    return [await m.shortenPathIn('Documents/Uni/Semester 3/Accounting', names, { anchor: false }), calls];
  }, SIBLINGS);
  // One listing per folder in the path, and the component whose siblings could
  // not be read keeps its name.
  expect(out).toEqual(['Doc/Un/Semester 3/Accounting', 4]);
});
