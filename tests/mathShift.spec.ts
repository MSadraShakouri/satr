import { expect, test, type Page } from '@playwright/test';

// The source and the preview of the same note are two different geometries:
// a `$$…$$` block is three lines of monospace on one side and a rendered
// formula (often a different height) on the other, a table likewise, and an
// image placeholder has no source height at all. Switching between them must
// land on the same place *and stay there* once the KaTeX fonts, the rendered
// table and the app's own box fitting have settled — reported as "sometimes
// math preview and source shift positions".
//
// The app's own switch is driven here (the floating button), not a synthetic
// pane: this is the path with the settle passes, the images pass and the
// editor's hold in it.
const LINES: string[] = [];
for (let i = 0; i < 12; i += 1) {
  LINES.push(`paragraph ${i}: enough words to wrap onto a second visual row in a narrow phone column`);
  LINES.push('');
  LINES.push('$$');
  LINES.push(String.raw`x_{${i}} = \frac{\dfrac{a_{${i}} + b}{c}}{d} = \sum_{k=1}^{${i + 1}} k^2`);
  LINES.push('$$');
  LINES.push('');
  if (i === 4) {
    LINES.push('| left | right |');
    LINES.push('| --- | --- |');
    for (let row = 0; row < 6; row += 1) LINES.push(`| row ${row} | value ${row} |`);
    LINES.push('');
    LINES.push('![a picture that is not there](missing.png)');
    LINES.push('');
  }
}
const NOTE = LINES.join('\n');

async function boot(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/Math.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/Math.md', text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/Math.md' }], active: 0 }));
  }, NOTE);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('Math');
  await page.evaluate(() => document.fonts.ready);
}

test('the source and the preview keep the same place, math and tables and all', async ({ page }) => {
  await boot(page);
  const steps = await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>('#editor .cm-scroller')!;
    const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
    const toggle = (): void => document.querySelector<HTMLButtonElement>('#preview-toggle')!.click();
    const out: { target: number; back: number; previewHeight: number }[] = [];
    // The app's own restore (the remembered line) settles on its own timers;
    // let it have its moment before the reader starts scrolling.
    await wait(800);
    // A wheel is how the reader says "I am driving": the app holds the
    // restored line for a moment after a note opens and puts back anything
    // that moves without it (main.ts holdEditorPosition).
    const nudge = (): void => {
      document.querySelector('#editor .cm-editor')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      document.querySelector('#preview-pane')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    };
    for (const target of [500, 1200, 2100, 3000]) {
      nudge();
      scroller.scrollTop = target;
      await wait(300);
      const before = scroller.scrollTop;
      const pane = document.querySelector<HTMLElement>('#preview-pane')!;
      const preview = document.querySelector<HTMLElement>('#preview')!;
      const { previewScroll } = await window.__satr.load('/src/scrollSync.ts');
      toggle(); // to the preview
      await wait(600); // the mapping's own settle passes (120ms, 350ms, fonts)
      const previewLine = previewScroll(pane, preview);
      toggle(); // back to the source
      await wait(1400); // settle passes, fonts and the app's own corrections
      out.push({ target: before, back: scroller.scrollTop, previewHeight: Math.round(previewLine * 100) / 100 });
    }
    return { out };
  });
  // Every round trip comes back to where it started. The slack is the
  // mapping's own: inside one section the preview interpolates by source-line
  // fraction, and a section holding a display formula spends most of its
  // rendered height on one of its five source lines, so the round trip can
  // land up to a line and a half from where it left (measured here, not
  // guessed: 2, 0, 0 and 42px on the four steps).
  const list = steps.out;
  // The premise of the walk: the scroll really moved (not clamped, not undone
  // by the app's own restore).
  for (const step of list) expect(step.target, JSON.stringify(steps)).toBeGreaterThan(100);
  for (const step of list) {
    expect(Math.abs(step.back - step.target), JSON.stringify(steps)).toBeLessThan(46);
  }
  // And the preview really was somewhere else — a mapping that always answers
  // "the top" would trivially pass the assertion above.
  expect(list[list.length - 1].previewHeight, JSON.stringify(steps)).toBeGreaterThan(list[0].previewHeight + 20);
});

test('a formula settled late does not move the place the reader is at', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>('#editor .cm-scroller')!;
    const pane = document.querySelector<HTMLElement>('#preview-pane')!;
    const preview = document.querySelector<HTMLElement>('#preview')!;
    const { previewScroll, applyPreviewScroll } = await window.__satr.load('/src/scrollSync.ts');
    const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
    scroller.scrollTop = 1600;
    await wait(150);
    document.querySelector<HTMLButtonElement>('#preview-toggle')!.click();
    await wait(500);
    const before = previewScroll(pane, preview);
    // What the Android grow-box pass does after the switch: a display formula
    // turns out taller than the box it was painted in.
    const displays = [...preview.querySelectorAll<HTMLElement>('.math-display')];
    for (const box of displays.slice(0, 3)) box.style.minHeight = `${box.getBoundingClientRect().height + 120}px`;
    await wait(700);
    const after = previewScroll(pane, preview);
    // The mapping is asked to hold the same source line; a stale geometry
    // would leave the reader 2+ lines away from where they were.
    return { before: Math.round(before * 100) / 100, after: Math.round(after * 100) / 100, displays: displays.length };
  });
  expect(out.displays).toBeGreaterThan(3);
  expect(Math.abs(out.after - out.before), JSON.stringify(out)).toBeLessThan(0.6);
});
