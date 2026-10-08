import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await window.__satr.load('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {});
    await document.fonts.ready;
  });
});

async function draft(page: Page, text: string, caret = 0) {
  await page.evaluate(({ text, caret }) => {
    window.testEditor.setValue(text.replace('|', ''));
    window.testEditor.setSelection(caret);
    window.testEditor.focus();
  }, { text, caret });
}

// The stepwise combinator: press a motion key one step at a time and record
// where the caret is, logically and visually.
async function walk(page: Page, key: string, steps: number) {
  const out: { pos: number; x: number; top: number }[] = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press(key);
    out.push(await page.evaluate(() => {
      const e = window.testEditor;
      const view = (e as unknown as { view: { state: { selection: { main: { head: number; assoc: number } } }; coordsAtPos(pos: number, side?: number): { left: number; top: number } | null } }).view;
      const sel = view.state.selection.main;
      const rect = view.coordsAtPos(sel.head, sel.assoc);
      return { pos: sel.head, x: Math.round(rect?.left ?? -1), top: Math.round(rect?.top ?? -1), assoc: sel.assoc, px: rect?.left };
    }));
  }
  return out;
}

test('arrows step through a mixed Persian/English line without bouncing', async ({ page }) => {
  await draft(page, 'اب ABC د', 0);
  const left = await walk(page, 'ArrowLeft', 8);
  // Every step moves strictly leftward; the caret never jumps back.
  for (let i = 1; i < left.length; i += 1) expect(left[i].x, JSON.stringify(left)).toBeLessThan(left[i - 1].x);
  // And the walk covers the whole line.
  expect(new Set(left.map((s) => s.pos)).size).toBe(8);

  // The way back retraces the same stops.
  const right = await walk(page, 'ArrowRight', 8);
  for (let i = 1; i < right.length; i += 1) expect(right[i].x, JSON.stringify(right)).toBeGreaterThan(right[i - 1].x);
  expect(right.map((s) => s.pos).slice(0, -1)).toEqual([...left].reverse().map((s) => s.pos).slice(1));
  expect(right.at(-1)!.pos).toBe(0);
});

test('an RTL run inside English text walks without jumps', async ({ page }) => {
  await draft(page, 'abc אבג', 0);
  const right = await walk(page, 'ArrowRight', 7);
  for (let i = 1; i < right.length; i += 1) expect(right[i].x, JSON.stringify(right)).toBeGreaterThan(right[i - 1].x);
  expect(new Set(right.map((s) => s.pos)).size).toBe(7);
  const left = await walk(page, 'ArrowLeft', 7);
  for (let i = 1; i < left.length; i += 1) expect(left[i].x, JSON.stringify(left)).toBeLessThan(left[i - 1].x);
  expect(left.map((s) => s.pos).slice(0, -1)).toEqual([...right].reverse().map((s) => s.pos).slice(1));
  expect(left.at(-1)!.pos).toBe(0);
});

test('plain Latin text still moves one glyph per press', async ({ page }) => {
  await draft(page, 'hello', 5);
  const left = await walk(page, 'ArrowLeft', 5);
  expect(left.map((s) => s.pos)).toEqual([4, 3, 2, 1, 0]);
});

test('shift+arrows extend the selection with the same stepping', async ({ page }) => {
  await draft(page, 'اب ABC د', 8);
  const steps = await walk(page, 'Shift+ArrowRight', 6);
  // The head retraces the left walk backwards, growing the selection.
  for (let i = 1; i < steps.length; i += 1) expect(steps[i].x, JSON.stringify(steps)).toBeGreaterThan(steps[i - 1].x);
  const sel = await page.evaluate(() => window.testEditor.getSelection());
  expect(sel).toEqual([8, 2]); // anchor stays at 8, the head walks back to 2
});

// A line wider than the editor wraps into several visual rows, and the same x
// exists on every row. A step must stay on the caret's own row: matching a
// stop by x alone sent the caret up or down instead of along the line (3).
test('a wrapped line is walked row by row, never jumping to another row', async ({ page }) => {
  // Narrow the editor so the long mixed line wraps into several visual rows.
  await page.evaluate(() => {
    const host = window.testEditor.view.dom.parentElement as HTMLElement;
    host.style.width = '260px';
    host.style.right = 'auto';
  });
  // An English line (LTR base) with Persian runs: the caret walks rightwards
  // along each row and on into the next one below.
  await draft(page, 'abc ابج def abc ابج def abc ابج def abc ابج def abc');
  const right = await walk(page, 'ArrowRight', 40);
  const tops = right.map((s) => s.top);
  // The walk really crossed rows (otherwise the test proves nothing)…
  expect(new Set(tops).size).toBeGreaterThan(1);
  // …and when it did, it went downwards only: matching a stop by x alone
  // found the same x on the row above and sent the caret back up.
  for (let i = 1; i < tops.length; i += 1) expect(tops[i], JSON.stringify(right)).toBeGreaterThanOrEqual(tops[i - 1] - 2);
  // Coming back, the rows are crossed upwards only.
  const left = await walk(page, 'ArrowLeft', 40);
  const back = left.map((s) => s.top);
  for (let i = 1; i < back.length; i += 1) expect(back[i], JSON.stringify(left)).toBeLessThanOrEqual(back[i - 1] + 2);
  expect(new Set(back).size).toBeGreaterThan(1);
});
