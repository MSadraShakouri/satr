// Switching to the reading view lands where the source was, and stays there.
//
// Reported: "before you did something that made the source to preview shift
// less obvious and I think it's back or I never tested these extreme cases".
//
// The mapping itself was not off — it places within a tenth of a line at any
// depth of a note. What the reader saw was the second move: the reading view
// draws no section it cannot see (content-visibility), so every section below
// the fold stands on an estimate — 1.85em a source line until enough of the
// note has been measured to learn better. The estimate is small change per
// section and a page of error over a long note, so the switch landed short
// and the correction dragged it the rest of the way a moment later: on a note
// of thirty formulas, switching three quarters of the way down landed 2550px
// above where it belonged and then slid there in front of the reader.
//
// The editor has just measured those very lines, wrapping and all. Its block
// heights are handed to the sections before the placement reads them
// (seedSectionHeights in src/main.ts), so the first landing is the right one.
import { expect, test, type Page } from '@playwright/test';

const MATHY = Array.from({ length: 30 }, (_, i) =>
  `## بخش ${i}\n\nمتن پیش از فرمول با کمی طول برای آنکه بپیچد و جا بگیرد.\n\n$$\n\\int_0^{${i}} x^2\\,dx = \\frac{${i}^3}{3} + \\sum_{k=1}^{${i}} \\frac{1}{k^2}\n$$\n\n> ۱. پس از فرمول\n> ۲. دوم\n> \n> ۵. پنجم\n`).join('\n');

async function boot(page: Page, body: string): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/m.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/m.md', text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/m.md' }], active: 0 }));
  }, body);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.waitForTimeout(500);
}

/** Where the source is, as the switch itself reads it. */
const sourceLine = (page: Page) => page.evaluate(async () => {
  const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
  const { editorScroll, typingTop } = await window.__satr.load('/src/scrollSync.ts');
  const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
  return editorScroll(view, typingTop(view));
});

/** Where the reading view says it is, in source lines. */
const previewLine = (page: Page) => page.evaluate(async () => {
  const { previewScroll } = await window.__satr.load('/src/scrollSync.ts');
  return previewScroll(document.querySelector('#preview-pane') as HTMLElement, document.querySelector('#preview') as HTMLElement, 72);
});

const paneTop = (page: Page) => page.evaluate(() => (document.querySelector('#preview-pane') as HTMLElement).scrollTop);

for (const place of [0.4, 0.75]) {
  test(`the reading view lands where the source was and does not move after — ${place} down a note of formulas`, async ({ page }) => {
    await boot(page, MATHY);
    // Math keeps growing as the editor measures it: scroll until it sticks.
    for (let tries = 0; tries < 6; tries += 1) {
      await page.evaluate(async (fraction) => {
        const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
        const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
        view.scrollDOM.scrollTo({ top: Math.round((view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight) * fraction), behavior: 'instant' as ScrollBehavior });
      }, place);
      await page.waitForTimeout(400);
      if (await page.evaluate(() => (document.querySelector('.cm-scroller') as HTMLElement).scrollTop) > 100) break;
    }
    await page.waitForTimeout(400);
    const before = await sourceLine(page);
    expect(before, 'the note is long enough to be scrolled into').toBeGreaterThan(50);

    // The first frame the reader could see: the switch places the pane inside
    // the click itself, so this is where the reading view appears.
    await page.evaluate(() => (document.querySelector('#preview-toggle') as HTMLElement).click());
    const landed = await paneTop(page);
    const landedAt = await previewLine(page);
    // Let every correction the switch schedules run (settle: two frames, then
    // 120ms, 350ms, and once the fonts are ready).
    await page.waitForTimeout(1400);
    const settled = await paneTop(page);
    const settledAt = await previewLine(page);

    // It lands on the line the source was on…
    expect(Math.abs((landedAt ?? 0) - before), `landed on line ${landedAt?.toFixed(1)}, source was on ${before.toFixed(1)}`).toBeLessThan(2);
    expect(Math.abs((settledAt ?? 0) - before)).toBeLessThan(2);
    // …and the page does not slide out from under the reader afterwards. A
    // tolerance of one line: a formula settling may still cost a pixel or two.
    expect(Math.abs(settled - landed), `landed at ${landed}px and settled at ${settled}px`).toBeLessThan(25);
  });
}
