import { expect, test } from '@playwright/test';

// "Re-opening an already-open file from another app opens the tab again — it
// should go to the already-open one."
//
// The reuse path keyed a hand-over on the plugin's `viewId`, a UUID built from
// the source URI (OpenFilePlugin.java). A content URI is not a stable name for
// a file: the same document can arrive through another provider, another route,
// or with a session parameter, and then the UUID differs and a second tab opens
// on one document. Shared text never had a viewId at all (describe() returns
// before that for it), so sharing the same words twice always opened a second
// tab. What a hand-over is, then, is not a URI but a set of answers, in order:
// the source the plugin names, the file's own name/size/time, the text itself.
//
// The road from another app is native-only (`supportsIncomingFiles()` is false
// in a browser), so the device is what confirms the wiring; the decision it
// carries is this one, and it is pinned here.

type Incoming = {
  id: string; viewId?: string; name: string; mimeType: string; size: number;
  kind: 'text' | 'binary' | 'shared-text' | 'too-large'; readOnly: boolean;
  text?: string; modified?: number;
};

const load = (page: import('@playwright/test').Page) => page.evaluate(async () => {
  const mod = await window.__satr.load('/src/openWith.ts');
  return { keys: Object.keys(mod).sort() };
});

test('the identity module is where the app expects it', async ({ page }) => {
  await page.goto('/');
  const { keys } = await load(page);
  expect(keys).toEqual(expect.arrayContaining(['incomingIdentities', 'openPathForIdentities', 'openTabForSameFile']));
});

test('one file is one thing, whatever route it arrives by', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (base) => {
    const { incomingIdentities, openPathForIdentities } = await window.__satr.load('/src/openWith.ts');
    const file = (over: Partial<Incoming>): Incoming => ({ ...(base as Incoming), ...over });
    const open = ['satr-open://1/note.md'];
    const known = new Map<string, string>();
    for (const identity of incomingIdentities(file({}))) known.set(identity, open[0]);
    const same = (over: Partial<Incoming>) => openPathForIdentities(incomingIdentities(file(over)), open, known);
    return {
      sameId: same({ id: 'tmp-2' }),
      otherRoute: same({ id: 'tmp-3', viewId: 'uuid-b' }),
      otherRouteClosed: openPathForIdentities(incomingIdentities(file({ id: 'tmp-4', viewId: 'uuid-b' })), [], known),
      aCopy: same({ id: 'tmp-5', viewId: 'uuid-c', name: 'note copy.md' }),
      editedElsewhere: same({ id: 'tmp-6', viewId: 'uuid-d', modified: 1_700_000_900_000 }),
      editedSameRoute: same({ id: 'tmp-7', modified: 1_700_000_900_000 }),
      noIdentity: incomingIdentities({ id: 'tmp-8', name: 'nameless', mimeType: '', size: -1, kind: 'too-large', readOnly: true }).length,
    };
  }, {
    id: 'tmp-1', viewId: 'uuid-a', name: 'note.md', mimeType: 'text/markdown', size: 120,
    kind: 'text' as const, readOnly: false, modified: 1_700_000_000_000,
  });
  expect(result.sameId, 'the same hand-over again').toBe('satr-open://1/note.md');
  expect(result.otherRoute, 'the same file by another URI').toBe('satr-open://1/note.md');
  expect(result.otherRouteClosed, 'a tab that is gone is not reused').toBeNull();
  expect(result.aCopy, 'a copy elsewhere is another file').toBeNull();
  expect(result.editedElsewhere, 'the same name, a different file on disk').toBeNull();
  expect(result.editedSameRoute, 'the same route, freshly written').toBe('satr-open://1/note.md');
  expect(result.noIdentity, 'nothing to match on: no identity').toBe(0);
});

test('shared text is its own identity: the same words are the same thing', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { incomingIdentities, openPathForIdentities } = await window.__satr.load('/src/openWith.ts');
    const shared = (id: string, text: string) => ({ id, name: 'Shared text.md', mimeType: 'text/plain', size: text.length, kind: 'shared-text' as const, readOnly: true, text });
    const open = ['satr-open://2/Shared text.md'];
    const known = new Map<string, string>();
    for (const identity of incomingIdentities(shared('tmp-a', 'یک متن مشترک'))) known.set(identity, open[0]);
    return {
      again: openPathForIdentities(incomingIdentities(shared('tmp-b', 'یک متن مشترک')), open, known),
      other: openPathForIdentities(incomingIdentities(shared('tmp-c', 'متن دیگری')), open, known),
      empty: incomingIdentities(shared('tmp-d', '')).length,
    };
  });
  expect(result.again, 'the same words shared twice').toBe('satr-open://2/Shared text.md');
  expect(result.other, 'other words are another note').toBeNull();
  expect(result.empty, 'an empty share has no identity to match on').toBe(0);
});

test('a hand-over of a file the folders already have open goes to that tab', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (file) => {
    const { openTabForSameFile } = await window.__satr.load('/src/openWith.ts');
    const candidates = [{ path: 'Notes/A/B/C/deep.md', mtime: 1_700_000_000_400 }, { path: 'Other.md', mtime: 1_700_000_000_000 }];
    return {
      same: openTabForSameFile(file as never, candidates),
      oneSecondOff: openTabForSameFile({ ...file, modified: 1_700_000_002_000 } as never, candidates),
      noTime: openTabForSameFile({ ...file, modified: undefined } as never, candidates),
      shared: openTabForSameFile({ ...file, kind: 'shared-text' } as never, candidates),
    };
  }, { id: 'x', name: 'deep.md', mimeType: 'text/markdown', size: 10, kind: 'text', readOnly: false, modified: 1_700_000_000_000 });
  expect(result.same, 'the same file, open from the tree').toBe('Notes/A/B/C/deep.md');
  expect(result.oneSecondOff, 'a different modification time').toBeNull();
  expect(result.noTime, 'no time to compare').toBeNull();
  expect(result.shared, 'shared text is not a file').toBeNull();
});
