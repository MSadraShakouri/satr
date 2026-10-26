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
  // The caret takes the side of the line's own script. Stepping off the
  // Persian onto `ABC`, at position 3, it belongs to the Persian behind it: it
  // is painted against that word (966) rather than at the far edge of the
  // English (936), where a reader would read it as "after ABC". At the run's
  // other end, position 6, the Persian is ahead of it and it paints there.
  for (const step of left) expect(step.assoc, JSON.stringify(left)).toBe(step.pos === 3 ? -1 : 1);
  const x = (pos: number) => left.find((s) => s.pos === pos)!.x;
  expect(Math.abs(x(3) - x(2)), JSON.stringify(left)).toBeLessThan(Math.abs(x(3) - x(4)));
  // Nothing is visited twice, and the way back retraces it exactly.
  const right = await walk(page, 'ArrowRight', 8);
  expect(right.map((s) => s.pos), JSON.stringify(right)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
});

test('an RTL run inside English text is walked one position a press', async ({ page }) => {
  await draft(page, 'abc אבג', 0);
  const right = await walk(page, 'ArrowRight', 6);
  expect(right.map((s) => s.pos), JSON.stringify(right)).toEqual([1, 2, 3, 4, 5, 6]);
  // Mirrored, with no double standard: in an English line the caret at the
  // start of the Hebrew word belongs to the English behind it.
  for (const step of right) expect(step.assoc, JSON.stringify(right)).toBe(step.pos === 4 ? -1 : 1);
  const x = (pos: number) => right.find((s) => s.pos === pos)!.x;
  expect(Math.abs(x(4) - x(3)), JSON.stringify(right)).toBeLessThan(Math.abs(x(4) - x(5)));
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

test('arrows walk through digits of a date on a Persian line', async ({ page }) => {
  const persian = 'سلام این یک خط فارسی است';
  const date = '2026/10/11';
  await draft(page, `${persian} ${date}`, persian.length + 1);
  const xs: number[] = [];
  for (let i = 0; i < date.length; i += 1) {
    const x = await page.evaluate(() => {
      const view = window.testEditor.view;
      const r = view.coordsAtPos(view.state.selection.main.head, 1);
      return r ? Math.round(r.left) : NaN;
    });
    xs.push(x);
    await page.keyboard.press('ArrowLeft');
  }
  const moved = new Set(xs).size;
  expect(moved, `caret must move through the date: ${JSON.stringify(xs)}`).toBeGreaterThan(3);
});

// A markdown link or image inside an RTL line is one run of its own: `!`, `[`,
// `]`, `(` and `)` are neutrals — the language they are written in gives them
// no direction — and a neutral beside the paragraph's edge takes the
// paragraph's own direction, so `![Screenshot…](_res/shot.png)` on a Persian
// line drew as `) …png(] … ![`: the picture's `!` at the line's right edge, the
// closing `)` at its left, the brackets between them. An isolate of its own
// settles them where the markdown wrote them — the same one the digit runs get.
// The characters are read off the painted boxes of the line, in document
// order, so the test measures what the reader sees (the test editor draws in
// its own host; the app's editor is behind it).
async function paintedLine(page: Page, lineOf: string) {
  return page.evaluate((needle) => {
    const view = window.testEditor.view as unknown as { contentDOM: HTMLElement };
    const line = [...view.contentDOM.querySelectorAll('.cm-line')]
      .find((el) => (el.textContent ?? '').includes(needle)) as HTMLElement | undefined;
    if (!line) return { missing: needle, text: [...view.contentDOM.querySelectorAll('.cm-line')].map((el) => el.textContent) };
    const chars: { c: string; x: number }[] = [];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const text = node.textContent ?? '';
      for (let i = 0; i < text.length; i += 1) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        chars.push({ c: text[i], x: Math.round(range.getBoundingClientRect().left) });
      }
    }
    return { dir: line.getAttribute('dir'), chars };
  }, lineOf);
}

const rising = (run: { c: string; x: number }[]): boolean => run.every((p, i) => i === 0 || p.x >= run[i - 1].x);

test('a markdown image on an RTL line reads left to right', async ({ page }) => {
  const image = '![Screenshot_20261014-082559](_res/Screenshot_20261014-082559.png)';
  await draft(page, `خط فارسی\n${image}\n`);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const painted = await paintedLine(page, image.slice(0, 12));
  expect(painted.dir, JSON.stringify(painted)).toBe('rtl'); // the line really is RTL
  const chars = painted.chars!;
  expect(chars.map((p) => p.c).join('')).toBe(image);
  // The construct's own order: every character further right than the one
  // before it, from the `!` to the closing `)` — the "end of it" the reader
  // asked for, at the end.
  expect(rising(chars), JSON.stringify(chars.map((p) => `${p.c}@${p.x}`))).toBe(true);
  expect(chars.at(-1)!.x - chars[0].x).toBeGreaterThan(100);
});

test('a Persian label keeps its direction and its address in one piece', async ({ page }) => {
  const image = '![تصویر ۱۴۰۵](_res/Screenshot_20261014.png)';
  await draft(page, `خط دیگر\n${image}\n`);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const painted = await paintedLine(page, 'تصویر');
  const chars = painted.chars!;
  expect(chars.map((p) => p.c).join('')).toBe(image);
  const label = chars.slice(2, 2 + 'تصویر ۱۴۰۵'.length);
  const address = chars.slice(chars.length - '(_res/Screenshot_20261014.png)'.length);
  // The label is Persian: it reads right to left, as it should.
  expect(label[0].x, JSON.stringify(label)).toBeGreaterThan(label.at(-1)!.x);
  // The address and its parentheses are one LTR run, in order.
  expect(address.map((p) => p.c).join('')).toBe('(_res/Screenshot_20261014.png)');
  expect(rising(address), JSON.stringify(address.map((p) => `${p.c}@${p.x}`))).toBe(true);
});

test('the caret on the empty line between two math blocks sits at the left', async ({ page }) => {
  // The reader's report: `$$ … $$`, one empty line, `$$ … $$` — the caret on
  // that empty line stuck to the right, because the line carried the direction
  // of the Persian prose above it. It is between two LTR blocks: it belongs to
  // them, and the caret starts where they start.
  await draft(page, ['متن فارسی', '', '$$x = 1$$', '', '$$y = 2$$', ''].join('\n'));
  const report = await page.evaluate(() => {
    const view = window.testEditor.view as unknown as {
      state: { doc: { line(n: number): { from: number } } };
      dispatch(spec: unknown): void;
      coordsAtPos(pos: number, side?: number): { left: number } | null;
      contentDOM: HTMLElement;
    };
    const line = view.state.doc.line(4); // 1-based: the empty line between them
    view.dispatch({ selection: { anchor: line.from } });
    const el = view.contentDOM.querySelectorAll('.cm-line')[3] as HTMLElement;
    const box = el.getBoundingClientRect();
    const caret = view.coordsAtPos(line.from, 1);
    return { dir: el.getAttribute('dir'), caret: caret ? Math.round(caret.left) : -1, left: Math.round(box.left), right: Math.round(box.right) };
  });
  expect(report.dir, JSON.stringify(report)).toBe('ltr');
  expect(Math.abs(report.caret - report.left), JSON.stringify(report)).toBeLessThan(4);
});

// The full stop after a number belongs to the line, not to the number. In an
// RTL line `۲` then `.` reads full-stop-left — how a sentence ending in a
// number and a list marker both look in the reading view. Only a separator
// with a digit on *both* sides is part of the number (a date, a decimal), so
// only that is isolated: isolating `۲.` drew `.۲`.
test('a full stop after a number stays on the line’s side', async ({ page }) => {
  await draft(page, 'خط فارسی ۲.\n');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const painted = await paintedLine(page, '۲.');
  expect(painted.dir, JSON.stringify(painted)).toBe('rtl');
  const chars = painted.chars!;
  const digit = chars.find((p) => p.c === '۲')!;
  const dot = chars.find((p) => p.c === '.')!;
  expect(digit.x, JSON.stringify(chars.map((p) => `${p.c}@${p.x}`))).toBeGreaterThan(dot.x);
});

test('a list marker keeps its full stop on the line’s side', async ({ page }) => {
  await draft(page, '۲. خط فهرست\n');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const painted = await paintedLine(page, 'خط فهرست');
  expect(painted.dir, JSON.stringify(painted)).toBe('rtl');
  const chars = painted.chars!;
  const digit = chars.find((p) => p.c === '۲')!;
  const dot = chars.find((p) => p.c === '.')!;
  expect(digit.x, JSON.stringify(chars.map((p) => `${p.c}@${p.x}`))).toBeGreaterThan(dot.x);
});

// An isolate is a neutral to the text around it, so one standing beside a word
// of the other script is handed to the paragraph (UAX #9, N2) and carried over
// that word: the version number of `از Satr 2.0 استفاده کن` drew to the left of
// `Satr`, where the reading view and every browser draw it to the right. Beside
// a word of the other script nothing needs isolating — Unicode keeps the digits
// with the word on its own (W7) — so the isolates stay away from there.
test('a version number stays with the English word beside it', async ({ page }) => {
  await draft(page, 'از Satr 2.0 استفاده کن\n');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const painted = await paintedLine(page, 'Satr');
  expect(painted.dir, JSON.stringify(painted)).toBe('rtl');
  const chars = painted.chars!;
  const word = chars.find((p) => p.c === 'S')!;
  const number = chars.find((p) => p.c === '2')!;
  expect(word.x, JSON.stringify(chars.map((p) => `${p.c}@${p.x}`))).toBeLessThan(number.x);
});

test('a link stays beside the English word before it', async ({ page }) => {
  await draft(page, 'در Satr [Wikipedia](https://x.org) ببین\n');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const painted = await paintedLine(page, 'Wikipedia');
  expect(painted.dir, JSON.stringify(painted)).toBe('rtl');
  const chars = painted.chars!;
  const word = chars.find((p) => p.c === 'S')!;
  const link = chars.find((p) => p.c === 'W')!;
  expect(word.x, JSON.stringify(chars.map((p) => `${p.c}@${p.x}`))).toBeLessThan(link.x);
});
