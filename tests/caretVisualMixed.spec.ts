import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';
import sharp from 'sharp';

declare global { interface Window { visualCaretEditor: SatrEditor } }

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await window.__satr.load('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.visualCaretEditor = new SatrEditor(host, () => {});
    await document.fonts.ready;
  });
});

async function setup(page: Page, text: string, head = 0) {
  await page.evaluate(({ text, head }) => {
    visualCaretEditor.setValue(text);
    visualCaretEditor.setSelection(head);
    visualCaretEditor.focus();
  }, { text, head });
  await page.waitForTimeout(100);
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const view = visualCaretEditor.view;
    const s = view.state.selection.main;
    const r = view.coordsAtPos(s.head, s.assoc);
    return { head: s.head, anchor: s.anchor, assoc: s.assoc, x: r?.left ?? NaN, y: r?.top ?? NaN };
  });
}

async function walk(page: Page, key: string, steps: number) {
  const out = [await snapshot(page)];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press(key);
    out.push(await snapshot(page));
  }
  return out;
}

test('right crosses Persian and an embedded decimal without a loop', async ({ page }) => {
  const text = 'hello فارسی 12.34 done';
  await setup(page, text);
  const steps = await walk(page, 'ArrowRight', text.length);
  expect(steps.at(-1)?.head, JSON.stringify(steps)).toBe(text.length);
  for (let i = 1; i < steps.length; i++) {
    expect(steps[i].x, JSON.stringify(steps)).toBeGreaterThan(steps[i - 1].x + 0.5);
  }
});

test('left walks every position through an RTL-line time', async ({ page }) => {
  const text = 'سلام 12:30 تست';
  await setup(page, text);
  const steps = await walk(page, 'ArrowLeft', text.length);
  expect(steps.map(s => s.head), JSON.stringify(steps)).toEqual([0, 1, 2, 3, 4, 5, 9, 8, 7, 6, 10, 11, 12, 13, 14]);
  for (let i = 1; i < steps.length; i++) {
    expect(steps[i].x, JSON.stringify(steps)).toBeLessThan(steps[i - 1].x - 0.5);
  }
});

test('ordinary arrows inside inline math point visually', async ({ page }) => {
  const text = 'سلام $abcd$ بعد';
  await setup(page, text, 8); // $ab|cd$
  const [start, left] = await walk(page, 'ArrowLeft', 1);
  expect(left.head).toBe(7); // $a|bcd$
  expect(left.x).toBeLessThan(start.x);
  const [backStart, right] = await walk(page, 'ArrowRight', 1);
  expect(right.head).toBe(8);
  expect(right.x).toBeGreaterThan(backStart.x);
});

test('shift selects one whole grapheme at a time', async ({ page }) => {
  await setup(page, '👩‍💻a');
  const steps = await walk(page, 'Shift+ArrowRight', 2);
  expect(steps.map(s => s.head)).toEqual([0, 5, 6]);
  expect(steps.map(s => s.anchor)).toEqual([0, 0, 0]);
});


// DOM Range rectangles do not carry the native bidi caret affinity. At a
// number boundary they can be at the far side even when Chrome draws the
// caret on the near side. Measure the red caret pixels, not Range geometry.
test('the native caret stays on the left while typing an RTL-line time', async ({ page }) => {
  await setup(page, 'سلام ', 5);
  await page.addStyleTag({ content: `.cm-editor .cm-content, .cm-editor .cm-line {
    caret-color: rgb(255, 0, 0) !important; color: black !important; font-size: 24px !important;
  }` });
  for (const char of '12:30') {
    await page.keyboard.type(char);
    const position = await page.evaluate(() => {
      const view = visualCaretEditor.view;
      const line = view.contentDOM.querySelector('.cm-line') as HTMLElement;
      const rect = line.getBoundingClientRect();
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let left = Infinity;
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        for (let i = 0; i < node.length; i++) {
          if (!/[0-9:]/.test(node.data[i])) continue;
          const range = document.createRange();
          range.setStart(node, i); range.setEnd(node, i + 1);
          left = Math.min(left, range.getBoundingClientRect().left);
        }
      }
      return { left, line: { x: Math.floor(rect.left), y: Math.floor(rect.top),
        width: Math.ceil(rect.width), height: Math.ceil(rect.height) },
        nativeColor: getComputedStyle(line).caretColor,
        customCaret: !!view.dom.querySelector('.cm-cursor-primary') };
    });
    expect(position.nativeColor).toBe('rgb(255, 0, 0)');
    expect(position.customCaret).toBe(false);
    const png = await page.screenshot({ caret: 'initial', animations: 'disabled', clip: position.line });
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const xs: number[] = [];
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] > 220 && data[i + 1] < 50 && data[i + 2] < 50) xs.push((i / info.channels) % info.width);
    }
    expect(xs.length, `native caret is painted after ${char}`).toBeGreaterThan(5);
    const paintedX = position.line.x + Math.min(...xs);
    expect(Math.abs(paintedX - position.left), `left of the number after ${char}`).toBeLessThan(3);
  }
  expect(await page.evaluate(() => visualCaretEditor.getValue())).toBe('سلام 12:30');
});

test('the actually painted caret walks left through a time', async ({ page }) => {
  const text = 'سلام 12:30 تست';
  await setup(page, text);
  await page.addStyleTag({ content: `.cm-editor .cm-content, .cm-editor .cm-line {
    caret-color: rgb(255, 0, 0) !important; color: black !important; font-size: 24px !important;
  }` });
  const rect = await page.locator('.cm-editor').last().locator('.cm-line').first().boundingBox();
  if (!rect) throw new Error('line is not on screen');
  const clip = { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  const xs: number[] = [];
  for (let i = 0; i < text.length; i++) {
    await page.keyboard.press('ArrowLeft');
    const image = await page.screenshot({ caret: 'initial', animations: 'disabled', clip });
    const {data, info} = await sharp(image).removeAlpha().raw().toBuffer({resolveWithObject: true});
    const red: number[] = [];
    for (let k = 0; k < data.length; k += info.channels) {
      if (data[k] > 220 && data[k + 1] < 50 && data[k + 2] < 50) red.push((k / info.channels) % info.width);
    }
    expect(red.length, `native caret is visible at step ${i + 1}`).toBeGreaterThan(5);
    xs.push(Math.min(...red));
  }
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i], `each painted step goes left: ${JSON.stringify(xs)}`).toBeLessThan(xs[i - 1]);
    expect(xs[i - 1] - xs[i], `one glyph, not a jump: ${JSON.stringify(xs)}`).toBeLessThan(30);
  }
});

test('a mixed-script boundary has only the browser caret', async ({ page }) => {
  await setup(page, 'اب ABC د', 3); // after the space, before ABC
  await page.addStyleTag({ content: `.cm-editor .cm-content, .cm-editor .cm-line {
    caret-color: rgb(255, 0, 0) !important; color: black !important; font-size: 24px !important;
  }` });
  const geometry = await page.evaluate(() => {
    const v = visualCaretEditor.view;
    const line = v.contentDOM.querySelector('.cm-line')!;
    const text = line.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2); range.setEnd(text, 3); // preceding space
    const rect = line.getBoundingClientRect();
    return { x: range.getBoundingClientRect().left,
      clip: { x: Math.floor(rect.left), y: Math.floor(rect.top),
        width: Math.ceil(rect.width), height: Math.ceil(rect.height) },
      customCaret: !!v.dom.querySelector('.cm-cursor-primary') };
  });
  expect(geometry.customCaret, 'there is no second caret to disagree with the platform').toBe(false);
  const png = await page.screenshot({ caret: 'initial', animations: 'disabled', clip: geometry.clip });
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const xs: number[] = [];
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] > 220 && data[i + 1] < 50 && data[i + 2] < 50) xs.push((i / info.channels) % info.width);
  }
  expect(xs.length, 'browser paints a visible caret').toBeGreaterThan(5);
  expect(Math.abs(geometry.clip.x + Math.min(...xs) - geometry.x)).toBeLessThan(3);
  await page.keyboard.type('x');
  expect(await page.evaluate(() => visualCaretEditor.getValue())).toBe('اب xABC د');
});

test('the native caret remains enabled and the custom text highlight remains', async ({ page }) => {
  await setup(page, 'hello world', 5);
  const state = await page.evaluate(() => {
    const v = visualCaretEditor.view;
    v.dispatch({ selection: { anchor: 0, head: 5 } });
    const line = v.contentDOM.querySelector('.cm-line')!;
    return { caretColor: getComputedStyle(line).caretColor,
      selectionBg: getComputedStyle(line, '::selection').backgroundColor,
      customCaret: !!v.dom.querySelector('.cm-cursor-primary') };
  });
  expect(state.caretColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(state.selectionBg).toBe('rgba(0, 0, 0, 0)');
  expect(state.customCaret).toBe(false);
  await expect.poll(() => page.locator('.cm-satr-selection').count()).toBeGreaterThan(0);
});

test('Shift selection follows the arrow visually through mixed scripts', async ({ page }) => {
  await setup(page, 'اب ABC د', 8);
  const steps = await walk(page, 'Shift+ArrowRight', 8);
  expect(steps.map(s => s.head), JSON.stringify(steps)).toEqual([8, 7, 6, 4, 5, 6, 2, 1, 0]);
  for (let i = 1; i < steps.length; i++) {
    expect(steps[i].x, JSON.stringify(steps)).toBeGreaterThan(steps[i - 1].x);
    expect(steps[i].anchor).toBe(8);
  }
});

test('mixed-direction selection does not paint unselected letters between visual fragments', async ({ page }) => {
  await setup(page, 'abc אבג def');
  await page.evaluate(() => visualCaretEditor.setSelection(0, 5));
  await page.waitForTimeout(100);
  const out = await page.evaluate(() => {
    const v = visualCaretEditor.view;
    const node = v.contentDOM.querySelector('.cm-line')!.firstChild!;
    const chars = [...node.textContent!].map((char, i) => {
      const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1);
      const b = r.getBoundingClientRect(); return { char, x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
    });
    const boxes = [...v.dom.querySelectorAll('.cm-satr-selection')].map(e => {
      const b = e.getBoundingClientRect(); return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};
    });
    return {chars,boxes};
  });
  for (let i = 0; i < out.chars.length; i++) {
    const c = out.chars[i];
    if (c.char === ' ') continue;
    const painted = out.boxes.some(b => c.x > b.left && c.x < b.right && c.y > b.top && c.y < b.bottom);
    expect(painted, `${c.char} at ${i}: ${JSON.stringify(out)}`).toBe(i < 5);
  }
});
