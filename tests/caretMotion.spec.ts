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

// The rule the writer asked for, and the one the platform's own fields follow:
// a press is ONE position, in the paragraph's own order — the visual right is
// the previous position in an RTL paragraph and the next one in an LTR
// paragraph — and the caret is painted on the line's side. No walking by
// drawing position: that is what a shift+→ used to skip a whole inline formula
// with, and it left the `$` signs unstoppable.

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

test('a press is one position through a mixed Persian/English line, with no bounce', async ({ page }) => {
  await draft(page, 'اب ABC د', 0);
  // RTL base: the visual left is forward, so ← walks 1, 2, 3 … one a press.
  const left = await walk(page, 'ArrowLeft', 8);
  expect(left.map((s) => s.pos), JSON.stringify(left)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  // Every step is painted on the line's own side — the whole line's, not the
  // run it happens to sit next to.
  for (const step of left) expect(step.assoc, JSON.stringify(left)).toBe(1);
  // Nothing is visited twice, and the way back retraces it exactly.
  const right = await walk(page, 'ArrowRight', 8);
  expect(right.map((s) => s.pos), JSON.stringify(right)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
});

test('an RTL run inside English text is walked one position a press', async ({ page }) => {
  await draft(page, 'abc אבג', 0);
  const right = await walk(page, 'ArrowRight', 6);
  expect(right.map((s) => s.pos), JSON.stringify(right)).toEqual([1, 2, 3, 4, 5, 6]);
  for (const step of right) expect(step.assoc, JSON.stringify(right)).toBe(1);
  const left = await walk(page, 'ArrowLeft', 6);
  expect(left.map((s) => s.pos), JSON.stringify(left)).toEqual([5, 4, 3, 2, 1, 0]);
});

test('plain Latin text still moves one glyph per press', async ({ page }) => {
  await draft(page, 'hello', 5);
  const left = await walk(page, 'ArrowLeft', 5);
  expect(left.map((s) => s.pos)).toEqual([4, 3, 2, 1, 0]);
});

test('shift+arrows extend the selection one character a press', async ({ page }) => {
  await draft(page, 'اب ABC د', 8);
  const steps = await walk(page, 'Shift+ArrowRight', 6);
  // RTL: shift+→ walks back, the head giving up one character each press.
  expect(steps.map((s) => s.pos), JSON.stringify(steps)).toEqual([7, 6, 5, 4, 3, 2]);
  const sel = await page.evaluate(() => window.testEditor.getSelection());
  expect(sel).toEqual([8, 2]); // anchor stays at 8, the head walks back to 2
});

// A paragraph wider than the editor wraps into several visual rows. One
// position a press still holds there: in an RTL paragraph forward IS the next
// line down, so the walk never climbs back up a row.
test('a wrapped paragraph is walked downwards, one position a press', async ({ page }) => {
  // Narrow the editor so the long line wraps into several visual rows.
  await page.evaluate(() => {
    const host = window.testEditor.view.dom.parentElement as HTMLElement;
    host.style.width = '260px';
    host.style.right = 'auto';
  });
  await draft(page, 'این یک خط فارسی است که باید بشکند و به سطر بعد برود و همینطور ادامه داشته باشد');
  const down = await walk(page, 'ArrowLeft', 40);
  for (let i = 1; i < down.length; i += 1) {
    expect(down[i].pos, JSON.stringify(down)).toBe(down[i - 1].pos + 1);
    // A formula or a large glyph may raise a caret a few pixels; a row is
    // about 30px. Downwards only.
    expect(down[i].top, JSON.stringify(down)).toBeGreaterThanOrEqual(down[i - 1].top - 4);
  }
  const rows = new Set(down.map((s) => s.top));
  expect(rows.size, 'the walk really crossed rows').toBeGreaterThan(1);
  const up = await walk(page, 'ArrowRight', 40);
  for (let i = 1; i < up.length; i += 1) {
    expect(up[i].pos, JSON.stringify(up)).toBe(up[i - 1].pos - 1);
    expect(up[i].top, JSON.stringify(up)).toBeLessThanOrEqual(up[i - 1].top + 4);
  }
  expect(new Set(up.map((s) => s.top)).size).toBeGreaterThan(1);
});
