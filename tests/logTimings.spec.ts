import { expect, test, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// The five things the author has called slow, each one measured where it
// happens: launch, opening a file, opening a document, switching tabs, and
// the source-to-preview switch.
//
// These tests do not say anything is fast. They say the number is there, that
// it is attached to the thing it measured, and that it is of the right order
// against a clock Playwright kept itself -- because the whole point is to
// stop guessing where the time goes, and a stopwatch nobody checked is just
// another guess.

interface Line { at: number; area: string; kind: string; text: string; facts?: Record<string, number | string | boolean>; ms?: number }

declare global {
  interface Window { __satr: { load(path: string): { lines(): Line[]; setDetail(v: string): void; forget(): void } } }
}

const NOTE = `# A note\n\n${'words and more words. '.repeat(400)}\n`;

async function boot(page: Page, files: Record<string, string>, first: string): Promise<void> {
  await page.addInitScript(([seed, open]) => {
    const vault = seed as Record<string, string>;
    const names = Object.keys(vault);
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: Object.fromEntries(names.map((name) => [`Notes/${name}`, 1])),
      folders: ['Notes'],
    }));
    for (const name of names) localStorage.setItem(`satr:fs:file:Notes/${name}`, vault[name]);
    if (!localStorage.getItem('satr:tabs')) {
      localStorage.setItem('satr:tabs', JSON.stringify({
        tabs: names.map((name) => ({ path: `Notes/${name}` })),
        active: names.indexOf(open as string),
      }));
    }
  }, [files, first] as [Record<string, string>, string]);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

const read = (page: Page): Promise<Line[]> => page.evaluate(() => window.__satr.load('/src/log.ts').lines());
const find = (lines: Line[], area: string, text: string): Line | undefined => lines.find((l) => l.area === area && l.text === text);

test('a launch says where its time went, from zero', async ({ page }) => {
  const began = Date.now();
  await boot(page, { 'A.md': NOTE }, 'A.md');
  const wall = Date.now() - began;
  const lines = await read(page);

  const cold = find(lines, 'launch', 'cold start');
  const places = find(lines, 'launch', 'reading places read');
  const first = find(lines, 'launch', 'first file on screen');
  const ready = find(lines, 'launch', 'ready to read');
  expect(cold, 'the launch is in the log').toBeTruthy();
  expect(places?.ms, 'the view store read is timed').toBeGreaterThanOrEqual(0);
  expect(first?.ms, 'the first file is timed').toBeGreaterThanOrEqual(0);
  expect(ready?.ms, 'and so is the whole of it').toBeGreaterThanOrEqual(0);

  // In order, and the whole is at least the sum of the parts it contains.
  expect(cold!.at).toBeLessThanOrEqual(places!.at);
  expect(places!.at).toBeLessThanOrEqual(first!.at);
  expect(first!.at).toBeLessThanOrEqual(ready!.at);
  expect(ready!.ms!).toBeGreaterThanOrEqual(places!.ms! + first!.ms! - 1);
  // And against a clock this test kept itself, rather than only against
  // itself: the app cannot claim a launch longer than the page took to open.
  expect(ready!.ms!).toBeLessThan(wall + 1000);
  // The clock on a line is time since the page began loading, so the very
  // first line is near the start rather than near zero-of-its-own.
  expect(cold!.at).toBeLessThan(wall + 1000);
});

test('opening a note says how many bytes it was and what the read cost', async ({ page }) => {
  await boot(page, { 'A.md': NOTE }, 'A.md');
  const line = find(await read(page), 'file', 'read');
  expect(line, 'the read is in the log').toBeTruthy();
  expect(line!.facts?.path).toBe('Notes/A.md');
  expect(line!.facts?.bytes, 'carrying the size of the thing read').toBe(NOTE.length);
  expect(line!.ms).toBeGreaterThanOrEqual(0);
});

test('the source to preview switch is one measurement, and it holds the build inside it', async ({ page }) => {
  await boot(page, { 'A.md': NOTE }, 'A.md');
  await page.evaluate(() => window.__satr.load('/src/log.ts').forget());
  await page.locator('#preview-toggle').dispatchEvent('click');
  await expect(page.locator('#preview-pane')).toBeVisible();

  const lines = await read(page);
  const switched = find(lines, 'tabs', 'edit to preview');
  const built = find(lines, 'file', 'reading view built');
  expect(switched, 'the switch the author calls slow is measured').toBeTruthy();
  expect(built, 'and so is the reading view it has to build').toBeTruthy();
  expect(built!.facts?.chars, 'which says how much there was to build').toBe(NOTE.length);
  // The build happens inside the switch, so the switch cannot be the shorter
  // of the two -- that is what makes this one number and not two guesses.
  expect(switched!.ms!).toBeGreaterThanOrEqual(built!.ms!);
});

test('a tab switch is measured, and says which tab it went to', async ({ page }) => {
  await boot(page, { 'A.md': NOTE, 'B.md': '# B\n\nshort\n' }, 'A.md');
  await page.evaluate(() => window.__satr.load('/src/log.ts').forget());
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await page.locator('.mobile-tab-title').getByText('B', { exact: true }).click();
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);

  const lines = await read(page);
  const switched = find(lines, 'tabs', 'switch');
  expect(switched, 'the switch is in the log').toBeTruthy();
  expect(switched!.facts?.to).toBe('B.md');
  expect(switched!.ms).toBeGreaterThanOrEqual(0);
  // The read it had to do is inside it, and is its own line.
  const readLine = lines.filter((l) => l.area === 'file' && l.text === 'read').pop();
  expect(readLine!.facts?.path).toBe('Notes/B.md');
});

test('opening a document separates the engine coming up from the file being parsed', async ({ page }) => {
  await boot(page, { 'handout.pdf': tinyPdf(6) }, 'handout.pdf');
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });

  const lines = await read(page);
  const bytes = find(lines, 'pdf', 'bytes read');
  const engine = find(lines, 'pdf', 'engine ready');
  const parsed = find(lines, 'pdf', 'document parsed');

  expect(bytes, 'the bytes are read, and that is timed').toBeTruthy();
  expect(Number(bytes!.facts?.bytes)).toBeGreaterThan(400);
  // The two halves of "pdf opening is very slow" are told apart: the wasm
  // engine is paid for once a run, the document every single open.
  expect(engine, 'the engine coming up is its own line').toBeTruthy();
  expect(parsed, 'and the document being parsed is another').toBeTruthy();
  expect(parsed!.facts?.pages).toBe(6);
  expect(parsed!.ms).toBeGreaterThanOrEqual(0);
  expect(bytes!.at).toBeLessThanOrEqual(parsed!.at);
});

test('coming back says whether the page can draw at all', async ({ page }) => {
  // The freeze after a screenshot or a trip to recents: the system brings
  // the app back and the page goes on believing it is hidden, so it never
  // runs another animation frame and never paints again -- while still
  // hearing touches and still scrolling under them. Nothing in the log said
  // so, because the heartbeat writes only while visible: the whole episode
  // was 86 seconds of nothing, and the shape of the hole was the only
  // evidence there was. These two lines are that hole filled in.
  await boot(page, { 'A.md': NOTE }, 'A.md');
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });

  const back = find(await read(page), 'app', 'came back');
  expect(back, 'coming back is written down').toBeTruthy();
  // What the page itself thinks, at the moment the system says it is back.
  expect(back!.facts?.visibility).toBe('visible');

  // And then the only question that matters: can it draw?
  await expect.poll(async () => find(await read(page), 'app', 'drew a frame after coming back'), { timeout: 5000 })
    .toBeTruthy();
  const drew = find(await read(page), 'app', 'drew a frame after coming back');
  expect(drew!.facts?.afterMs as number).toBeLessThan(1000);
});

test('two documents are kept, so swapping between two books reads neither again', async ({ page }) => {
  // From his log: he reads two books side by side, and one slot meant the
  // second evicted the first at every swap -- a 10.7 MB jozve read off the
  // disk again at 970, 995 and 1216 ms a time. The slot holds two now.
  await boot(page, { 'A.pdf': tinyPdf(4), 'B.pdf': tinyPdf(5), 'N.md': NOTE }, 'A.pdf');
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });
  const go = async (name: string): Promise<void> => {
    await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
    await page.locator('.mobile-tab-title').getByText(name, { exact: true }).click();
    await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
    await page.waitForTimeout(400);
  };
  await go('B.pdf');
  await page.evaluate(() => window.__satr.load('/src/log.ts').forget());
  await go('A.pdf');

  // A was read before B was: with one slot B pushed it out and this is a
  // read, with two it is still here.
  const lines = await read(page);
  const kept = find(lines, 'pdf', 'bytes kept');
  expect(kept, 'the first book is still in hand after the second was opened').toBeTruthy();
  expect(String(kept!.facts?.path)).toContain('A.pdf');
  expect(find(lines, 'pdf', 'bytes read'), 'and it was not read again').toBeFalsy();
});

test('coming back says which wiring said so, and is written down at once', async ({ page }) => {
  // Two wirings report the same resume -- Capacitor's appStateChange and the
  // page's own visibilitychange -- and they disagree, which is how the
  // freeze was found. A line that does not say which one wrote it cannot be
  // read when one of them goes missing, and in his log the frozen resumes
  // are exactly the ones where lines are missing.
  // A page that believes it is hidden is given no idle time, which is the
  // one thing this harness has in abundance: take it away, or the store
  // flushes on idle within a millisecond and the test proves nothing.
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'requestIdleCallback'); });
  await boot(page, { 'A.md': NOTE }, 'A.md');
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });

  const back = find(await read(page), 'app', 'came back');
  expect(back, 'coming back is written down').toBeTruthy();
  expect(back!.facts?.from, 'and says which wiring said so').toBe('page');

  // And it is in the database now, not within four seconds: a frozen resume
  // is one he ends by throwing the app out of recents, and anything still
  // waiting in memory dies with it. That is why the frozen resumes in his
  // log left no line at all while the ones that recovered left two. Read
  // straight out of IndexedDB, because the store's own reader flushes
  // before it looks and would pass against any build at all.
  const onDisk = async (): Promise<string[]> => page.evaluate(async () => new Promise<string[]>((resolve) => {
    const open = indexedDB.open('satr-log');
    open.onerror = () => resolve([]);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('lines')) { resolve([]); return; }
      const all = db.transaction('lines', 'readonly').objectStore('lines').getAll();
      all.onerror = () => resolve([]);
      all.onsuccess = () => resolve((all.result as { text: string }[]).map((line) => line.text));
    };
  }));
  // Well inside the four-second flush timer, which is the whole point.
  await expect.poll(onDisk, { timeout: 2500, intervals: [100, 200, 300] }).toContain('came back');
});

test('a resume that never paints builds the document again', async ({ page }) => {
  // "Any time the app is out of focus it breaks, maybe it should reload the
  // pdf and everything will get fixed? The issue only exists with pdf files
  // and not anything else of the app." A frozen resume is one where no
  // animation frame ever runs, so the frames are taken away here and the
  // app is left to notice on a timer -- the one clock a hidden page still
  // has.
  await page.addInitScript(() => {
    const real = window.requestAnimationFrame.bind(window);
    Object.assign(window, { __eatFrames: false });
    window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
      ((window as unknown as { __eatFrames: boolean }).__eatFrames ? 0 : real(callback));
  });
  await boot(page, { 'handout.pdf': tinyPdf(5) }, 'handout.pdf');
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });
  const parsedBefore = (await read(page)).filter((line) => line.text === 'document parsed').length;
  expect(parsedBefore).toBe(1);

  await page.evaluate(() => {
    Object.assign(window, { __eatFrames: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect.poll(async () => find(await read(page), 'app', 'came back and nothing painted: building the document again'),
    { timeout: 5000 }).toBeTruthy();
  // And it really is built again -- from the bytes in hand, with no read.
  await expect.poll(async () => (await read(page)).filter((line) => line.text === 'document parsed').length,
    { timeout: 5000 }).toBe(2);
  const lines = await read(page);
  expect(lines.filter((line) => line.text === 'bytes read').length, 'and no file is read to do it').toBe(1);
});

test('coming back does not build the document all over again', async ({ page }) => {
  // Every resume read the open file back as text, found a string that did
  // not match the one the tab was opened with -- a pdf is not text -- and
  // adopted the "new" version, which tears the whole viewer down and builds
  // it again. Lock the screen and unlock it and his book was re-parsed and
  // every page re-rasterised, on a phone already short of memory.
  await boot(page, { 'handout.pdf': tinyPdf(5) }, 'handout.pdf');
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });
  const pages = await page.locator('.pdf-page').count();

  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(1500); // past the 600ms nothing-painted backstop

  const lines = await read(page);
  expect(lines.filter((line) => line.text === 'document parsed').length, 'parsed once, at the open').toBe(1);
  expect(lines.filter((line) => line.text === 'bytes read').length, 'and read once').toBe(1);
  // And the backstop knows the difference between a resume that did not
  // paint and one that did: this one painted.
  expect(find(lines, 'app', 'came back and nothing painted: building the document again')).toBeFalsy();
  expect(await page.locator('.pdf-page').count(), 'the pages that were there are still there').toBe(pages);
});

test('opening a document does not build an empty reading view first', async ({ page }) => {
  // Every pdf open rendered markdown of an empty string before the bytes
  // arrived -- "reading view built chars=0" and an "edit to preview"
  // behind it, two measurements of nothing and a flash of an empty note in
  // front of the book.
  await boot(page, { 'handout.pdf': tinyPdf(5) }, 'handout.pdf');
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 15000 });

  const lines = await read(page);
  expect(lines.filter((line) => line.text === 'reading view built'), 'nothing is built for a document').toHaveLength(0);
  // And the check that the file is still there says it is a check.
  expect(find(lines, 'file', 'read'), 'a document is not read as text').toBeFalsy();
});

test('the engine is warmed before a book is asked for', async ({ page }) => {
  // 117 to 144 ms of wasm on his phone, paid inside the first open of a
  // run. Paid at launch instead, on idle, and only when a tab holds a
  // document at all.
  await boot(page, { 'A.md': NOTE, 'book.pdf': tinyPdf(3) }, 'A.md');
  await expect.poll(async () => find(await read(page), 'pdf', 'engine warmed'), { timeout: 10000 }).toBeTruthy();
  // The note is what is on screen: no document was opened to do it.
  expect(find(await read(page), 'pdf', 'document parsed'), 'and no document was opened').toBeFalsy();
});

test('the log says which build wrote it', async ({ page }) => {
  // Every log that has come back off the phone was a date and nothing
  // else, so which APK produced it was inferred -- by me, out loud, more
  // than once. CI already names each build (a tag, or the tag plus the run
  // number); the page carries the same name now.
  await boot(page, { 'A.md': NOTE }, 'A.md');
  const head = await page.evaluate(() => window.__satr.load('/src/log.ts').format('text').split('\n')[0]);
  expect(head, 'the first line names the build').toMatch(/^satr log — \S+ — \d{4}-/);
  const start = await read(page).then((lines) => find(lines, 'launch', 'cold start'));
  expect(start?.facts?.build, 'and so does the launch line').toBeTruthy();
});
