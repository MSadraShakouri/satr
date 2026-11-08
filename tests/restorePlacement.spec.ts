import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
test.setTimeout(120000);

// Wrapped rows make CodeMirror change its height estimates during restoration.
// The saved band also has a nonzero gap, so a correction without it cannot
// silently agree with the correction that did use it.
const note = `# A long note\n\n${Array.from({ length: 400 }, (_, i) =>
  `## Part ${i + 1}\n\n- ${'a fairly long list item that wraps over more than one row of a phone screen '.repeat(2)}${i}\n- short ${i}\n\nA paragraph that also runs on for a while so that the rows below are not all the same height, number ${i}.\n`).join('\n')}`;

async function place(page: Page): Promise<{ line: number; gap: number }> {
  return page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const { editorPlace, typingTop } = await window.__satr.load('/src/scrollSync.ts');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    return editorPlace(view, typingTop(view));
  });
}

async function parkAndLeave(page: Page): Promise<{ line: number; gap: number }> {
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'long.md': 1, 'other.md': 1 }, folders: [] }));
    localStorage.setItem('satr:fs:file:long.md', text);
    localStorage.setItem('satr:fs:file:other.md', '# Other\n\nShort.\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'long.md' }, { path: 'other.md' }], active: 0 }));
    localStorage.setItem('satr:demoShown', '1');
  }, note);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('long');
  await page.waitForTimeout(800);
  await page.mouse.move(195, 500);
  for (let i = 0; i < 30; i += 1) await page.mouse.wheel(0, 500);
  await page.waitForTimeout(1500);
  const parked = await place(page);
  await switchTo(page, 1);
  await expect(page.locator('#app .cm-file-name')).toHaveText('other');
  await page.waitForTimeout(400);
  return parked;
}

async function switchTo(page: Page, index: number): Promise<void> {
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(1);
  await page.locator('.mobile-tab-card, .mobile-tab-title').nth(index).click();
}

test('restoring a saved editor place does not make late conflicting jumps', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.scrollTo;
    const data = window as unknown as { restoreTrace?: { start: number; writes: { t: number; from: number; to: number }[] } };
    Element.prototype.scrollTo = function (...args: [any, any?]) {
      const trace = data.restoreTrace;
      const target = typeof args[0] === 'object' ? args[0]?.top : args[1];
      if (trace && (this as HTMLElement).classList.contains('cm-scroller') && typeof target === 'number') {
        trace.writes.push({ t: performance.now() - trace.start, from: this.scrollTop, to: target });
      }
      return original.apply(this, args as [any, any]);
    };
  });
  const parked = await parkAndLeave(page);
  expect(parked.gap, 'the saved place has a nonzero gap').toBeGreaterThan(10);
  await page.evaluate(() => {
    (window as any).restoreTrace = { start: performance.now(), writes: [] };
  });
  await switchTo(page, 0);
  await expect(page.locator('#app .cm-file-name')).toHaveText('long');
  await page.waitForTimeout(900);
  const trace = await page.evaluate(() => (window as any).restoreTrace as { writes: { t: number; from: number; to: number }[] });
  // Different scrollTop values alone do not prove that words moved: unseen
  // estimates can change. This checks the actual competing app writes: a
  // late move away from a position immediately followed by a move back.
  const roundTrips = trace.writes.flatMap((first, i) => trace.writes.slice(i + 1).filter((second) =>
    first.t >= 100 && second.t - first.t < 80 && Math.abs(first.to - first.from) > 40 &&
    Math.abs(second.from - first.to) < 3 && Math.abs(second.to - first.from) < 3
  ).map((second) => ({ first, second })));
  expect(roundTrips, 'restoration should not move away and back after landing').toEqual([]);
  const top = await page.locator('#app .cm-scroller').evaluate((el) => el.scrollTop);
  expect(top, 'the long note restored deep into the document').toBeGreaterThan(10000);
  const restored = await place(page);
  expect(restored.line, 'the same source line').toBe(parked.line);
  expect(Math.abs(restored.gap - parked.gap), 'the same gap beside it').toBeLessThan(3);
});

test('a reader scroll cancels the remaining restore corrections', async ({ page }) => {
  await parkAndLeave(page);
  await switchTo(page, 0);
  await expect(page.locator('#app .cm-file-name')).toHaveText('long');
  await page.locator('.mobile-tab-switcher').waitFor({ state: 'detached' });
  const scroller = page.locator('#app .cm-scroller');
  const before = await scroller.evaluate((el) => el.scrollTop);
  await page.mouse.move(195, 500);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(100);
  const moved = await scroller.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(1200);
  const later = await scroller.evaluate((el) => el.scrollTop);
  expect(moved - before, 'the wheel moved the note').toBeGreaterThan(200);
  expect(Math.abs(later - moved), 'no restore correction takes it back').toBeLessThan(30);
});
