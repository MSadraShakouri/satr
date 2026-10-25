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

// A note of long wrapped items — the author's own plan note is one, and it
// is where he saw this: "the prediction is really off sometimes, once it
// drops to the bottom from the top, sometimes it's just a bit down".
//
// Neither view knows how long such a note is until it has drawn it. The
// reading view draws no section it cannot see, so the rest stand on an
// estimate made from their source lines — and these sections are four
// source lines that wrap into twenty rows. The editor is no better: its
// off-screen lines are estimated from the average line on screen.
//
// So the place was being worked out inside a note three times shorter than
// the real one, and the foot of that short note is a third of the way down
// the real one. A place below it was clamped there: the reader asked for
// the middle of the note and arrived at its end.
const LONGFORM = Array.from({ length: 40 }, (_, i) => [
  `## بخش ${i}`,
  '',
  `- ${'یک جملهٔ بلند برای آنکه این مورد چند سطر بپیچد و بخش را بلند کند. '.repeat(3)}`,
  `- ${'مورد دوم همین فهرست، باز هم به اندازهٔ کافی بلند برای پیچیدن. '.repeat(3)}`,
  '',
  `پاراگراف پایانی بخش ${i} که آن هم می‌پیچد. ${'ادامهٔ متن همین پاراگراف. '.repeat(5)}`,
].join('\n')).join('\n\n');

/** The note's real length: every section laid out, containment and all. */
const realHeight = (page: Page) => page.evaluate(async () => {
  const style = document.createElement('style');
  style.textContent = '#preview > .md-section { content-visibility: visible !important; contain: layout style paint !important; }';
  document.head.appendChild(style);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const height = document.querySelector<HTMLElement>('#preview-pane')!.scrollHeight;
  style.remove();
  return height;
});

const wheelDown = async (page: Page, steps: number): Promise<void> => {
  await page.mouse.move(195, 500);
  for (let i = 0; i < steps; i += 1) await page.mouse.wheel(0, 500);
  await page.waitForTimeout(700);
};

test('the switch lands in the whole note, not in the part of it that has been drawn', async ({ page }) => {
  await boot(page, LONGFORM);
  await wheelDown(page, 20);
  const before = await sourceLine(page);
  expect(before, 'deep enough into the note to matter').toBeGreaterThan(40);

  await page.evaluate(() => (document.querySelector('#preview-toggle') as HTMLElement).click());
  const landed = await paneTop(page);
  const landedAt = await previewLine(page);
  const page1 = await page.evaluate(() => document.querySelector<HTMLElement>('#preview-pane')!.scrollHeight);

  // The note it landed in is the note, not a third of it.
  const real = await realHeight(page);
  expect(Math.abs(page1 - real) / real, `landed in a page of ${page1}px, the note is ${real}px`).toBeLessThan(0.05);
  // And so the place is the reader's place, not the end of a short page.
  expect(Math.abs((landedAt ?? 0) - before), `landed on line ${landedAt?.toFixed(1)}, source was on ${before.toFixed(1)}`).toBeLessThan(2);
  const max = await page.evaluate(() => { const p = document.querySelector<HTMLElement>('#preview-pane')!; return p.scrollHeight - p.clientHeight; });
  expect(landed, 'not clamped to the foot of the note').toBeLessThan(max - 200);
});

test('one note, one length, wherever the switch is made from', async ({ page }) => {
  await boot(page, LONGFORM);
  await page.evaluate(() => (document.querySelector('#preview-toggle') as HTMLElement).click());
  await page.waitForTimeout(900);
  const fromTop = await page.evaluate(() => document.querySelector<HTMLElement>('#preview-pane')!.scrollHeight);

  await page.evaluate(() => (document.querySelector('#preview-toggle') as HTMLElement).click());
  await page.waitForTimeout(500);
  await wheelDown(page, 20);
  await page.evaluate(() => (document.querySelector('#preview-toggle') as HTMLElement).click());
  await page.waitForTimeout(900);
  const fromDeep = await page.evaluate(() => document.querySelector<HTMLElement>('#preview-pane')!.scrollHeight);

  // It used to be 22 196px switched into from the top and 15 369px switched
  // into from two thirds down — the same note, two lengths, and a reader
  // placed in whichever one the switch happened to build.
  expect(Math.abs(fromTop - fromDeep) / fromTop, `${fromTop}px from the top, ${fromDeep}px from deep`).toBeLessThan(0.03);
});

// Sections of wildly unequal size, which is what the editor's own estimate
// cannot survive: it prices every line it has not drawn at the average of
// the lines on screen, so a screenful of one-line headings says the note is
// short and a screenful of table says it is enormous.
const VARIED = Array.from({ length: 24 }, (_, i) => (i % 3 === 0
  ? `## بخش ${i}\n\nکوتاه.\n`
  : i % 3 === 1
    ? `## بخش ${i}\n\n| ستون یک | ستون دو | ستون سه |\n| --- | --- | --- |\n${Array.from({ length: 12 }, (_, r) => `| ردیف ${r} | مقدار ${r} | توضیح ${r} |`).join('\n')}\n`
    : `## بخش ${i}\n\n${Array.from({ length: 8 }, (_, k) => `- ${'یک مورد بلند که چند سطر می‌پیچد و بخش را بلند می‌کند. '.repeat(3)} (${k})`).join('\n')}\n`)).join('\n');

test('the editor comes back to the line the reading view was on, deep in a long note', async ({ page }) => {
  await boot(page, VARIED);
  await page.evaluate(() => (document.querySelector('#preview-toggle') as HTMLElement).click());
  await page.waitForTimeout(800);
  await wheelDown(page, 20);
  const before = await previewLine(page);
  expect(before ?? 0, 'deep enough into the note to matter').toBeGreaterThan(40);

  // Back to the editor, whose own off-screen lines are estimates: it has to
  // measure its way there rather than jump to where it guesses the line is.
  await page.evaluate(() => (document.querySelector('#preview-toggle') as HTMLElement).click());
  await page.waitForTimeout(1400);
  // Asked of the screen, not of the heights: which line is actually drawn
  // at the typing band. Reading it back through the same estimates that
  // placed it agrees with itself however wrong the landing was.
  const after = await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    const box = view.scrollDOM.getBoundingClientRect();
    const pos = view.posAtCoords({ x: box.left + box.width / 2, y: box.top + 80 }, false);
    return view.state.doc.lineAt(pos).number - 1;
  });
  expect(Math.abs(after - (before ?? 0)), `the line on the screen is ${after}, the reading view was on ${before?.toFixed(1)}`).toBeLessThan(3);
});
