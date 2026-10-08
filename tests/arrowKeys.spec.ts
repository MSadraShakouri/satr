import { expect, test, type Page } from '@playwright/test';

// The arrow keys move the caret one step a press, in every kind of line, and
// ← and → both work (the phone's keyboard sends the same keys as a desktop).

const LINES = [
  'hello world, this is plain English text',
  'سلام، این یک خط فارسی است',
  'Persian سلام and English mixed together',
  'x = $a^2 + b$ inside a sentence',
  'این یک فرمول است $a^2 + b$ و ادامه دارد',
  'سلام $x^2$ است و $y$',
];

async function boot(page: Page, text: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((note) => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', note);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, text);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
}

/** The caret's head and where it is drawn (x on the screen). */
const state = (page: Page) => page.evaluate(async () => {
  const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
  const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
  const head = view.state.selection.main.head;
  const at = view.coordsAtPos(head, view.state.selection.main.assoc || -1);
  return { head, x: at?.left ?? NaN, top: at ? Math.round(at.top) : NaN };
});

/** Put the caret at the leftmost place drawn on the line: where a visual
 *  right-arrow has somewhere to go, whatever the line's direction. */
const placeLeftmost = (page: Page) => page.evaluate(async () => {
  const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
  const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
  const line = view.state.doc.line(1);
  let best = line.from;
  let bestX = Infinity;
  for (let p = line.from; p <= line.to; p += 1) {
    const x = view.coordsAtPos(p, 1)?.left;
    if (x !== undefined && x < bestX) { bestX = x; best = p; }
  }
  view.dispatch({ selection: { anchor: best } });
  view.focus();
});

// A formula makes its line a few pixels taller, so a caret can sit 4px off its
// neighbour without changing row; a real row is about 30px.
const ROW = 12;

/** Presses the key until the caret stops moving, and returns each drawn x. */
async function walk(page: Page, key: 'ArrowRight' | 'ArrowLeft', lineLen: number, max = 150): Promise<{ x: number; top: number }[]> {
  const steps: { x: number; top: number }[] = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(key);
    const { head, x, top } = await state(page);
    // Past the end of the line: the walk along the line is over (a line's edge
    // goes to the next line, as in any paragraph).
    if (head > lineLen) break;
    steps.push({ x, top });
    const n = steps.length;
    if (n > 2 && steps[n - 1].x === steps[n - 2].x && steps[n - 2].x === steps[n - 3].x && steps[n - 1].top === steps[n - 2].top) break;
  }
  return steps;
}

for (const line of LINES) {
  test(`arrows walk the line one way and back, without bouncing: ${line.slice(0, 24)}`, async ({ page }) => {
    await boot(page, `${line}\n`);
    await placeLeftmost(page);
    const start = await state(page);
    const right = await walk(page, 'ArrowRight', line.length);
    // On one row every → moves the caret further right on the screen. A soft
    // wrap is the only jump back, and it goes down a row.
    expect(right[0].x, 'the first → moves right').toBeGreaterThan(start.x);
    let prev = { x: start.x, top: start.top };
    right.forEach((step, i) => {
      if (Math.abs(step.top - prev.top) < ROW) expect(step.x, `→ press ${i + 1} on its row`).toBeGreaterThanOrEqual(prev.x);
      else expect(step.top, `→ press ${i + 1} wraps down`).toBeGreaterThan(prev.top);
      prev = step;
    });
    const left = await walk(page, 'ArrowLeft', line.length);
    prev = right[right.length - 1];
    left.forEach((step, i) => {
      if (Math.abs(step.top - prev.top) < ROW) expect(step.x, `← press ${i + 1} on its row`).toBeLessThanOrEqual(prev.x);
      else expect(step.top, `← press ${i + 1} wraps up`).toBeLessThan(prev.top);
      prev = step;
    });
    if (left.length > 0 && (await state(page)).head <= line.length) expect(left[left.length - 1].x).toBeCloseTo(start.x, 0);
  });
}
