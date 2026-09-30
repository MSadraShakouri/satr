import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

// The small, day-to-day details of the note: list numbers the writer typed,
// the direction of a \text run inside a formula, the room under the last
// line, a tap below the text, and Enter bringing the new line into view.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {});
    await document.fonts.ready;
  });
});

async function setText(page: Page, text: string, caret = -1) {
  await page.evaluate(async ({ text, caret }) => {
    window.testEditor.setValue(text);
    window.testEditor.setSelection(caret < 0 ? text.length : caret);
    window.testEditor.focus();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, { text, caret });
}

test('the writer’s own list number is kept, in both digit sets', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { renderMarkdown } = await import('/src/markdown.ts');
    const host = document.createElement('article');
    const read = (text: string) => {
      host.innerHTML = renderMarkdown(text);
      const list = host.querySelector('ol');
      return {
        start: list ? Number(list.getAttribute('start') ?? '1') : null,
        persian: list?.querySelector(':scope > li')?.getAttribute('data-persian-number') ?? null,
        persianClass: list?.classList.contains('persian-ordered') ?? false,
        items: host.querySelectorAll('ol > li').length,
      };
    };
    return {
      latin: read('2. second'),
      persian: read('۲. دوم'),
      arabic: read('٣. ثالث'),
      list: read('1. one\n2. two'),
    };
  });
  // A single "2." is the writer's 2, not a 1.
  expect(report.latin.start).toBe(2);
  expect(report.persian.start).toBe(2);
  expect(report.persian.persianClass).toBe(true);
  expect(report.persian.persian).toBe('۲');
  expect(report.arabic.start).toBe(3);
  // And a list that goes 1, 2 keeps counting as before.
  expect(report.list.start).toBe(1);
  expect(report.list.items).toBe(2);
});

test('a Persian \\text run inside a formula reads right to left, the formula LTR', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { renderMath } = await import('/src/math.ts');
    const { layoutMath } = await import('/src/mathLayout.ts');
    const host = document.createElement('div');
    host.className = 'preview-pane';
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;background:white;width:400px;';
    host.style.setProperty('display', 'block', 'important');
    host.innerHTML = renderMath(String.raw`x = \text{سلام} + 1`, false);
    document.body.appendChild(host);
    await document.fonts.ready;
    layoutMath(host);
    const run = host.querySelector<HTMLElement>('.katex .text');
    const flow = host.querySelector<HTMLElement>('.math-flow') ?? host.querySelector('.katex');
    if (!run) return null;
    const text = run.firstChild as Text;
    const first = document.createRange();
    first.setStart(text, 0);
    first.setEnd(text, 1);
    const last = document.createRange();
    last.setStart(text, text.length - 1);
    last.setEnd(text, text.length);
    return {
      bidi: getComputedStyle(run).unicodeBidi,
      firstX: first.getBoundingClientRect().left,
      lastX: last.getBoundingClientRect().left,
      flowDirection: flow ? getComputedStyle(flow).direction : null,
    };
  });
  expect(report).not.toBeNull();
  // dir="auto" for the run: the Persian text inside it runs right to left…
  expect(report!.bidi).toBe('plaintext');
  expect(report!.firstX).toBeGreaterThan(report!.lastX);
  // …while the formula stays left to right.
  expect(report!.flowDirection).toBe('ltr');
});

test('there is room under the last line, and Enter brings the new line into view', async ({ page }) => {
  const host = page.locator('.cm-editor').first();
  await page.evaluate(() => {
    const outer = window.testEditor.view.dom.parentElement as HTMLElement;
    outer.style.height = '300px';
  });
  await setText(page, Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'));
  const room = await page.evaluate(async () => {
    const view = window.testEditor.view;
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
    await new Promise((r) => requestAnimationFrame(r));
    const last = view.coordsAtPos(view.state.doc.length, 1)!;
    const box = view.scrollDOM.getBoundingClientRect();
    return box.bottom - last.bottom;
  });
  expect(room).toBeGreaterThan(80);
  // Enter on the last line keeps the new line inside the visible box.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const visible = await page.evaluate(() => {
    const view = window.testEditor.view;
    const caret = view.coordsAtPos(view.state.selection.main.head, 1)!;
    const box = view.scrollDOM.getBoundingClientRect();
    return caret.top < box.bottom - 4 && caret.bottom > box.top + 4;
  });
  expect(visible).toBe(true);
});

test('a tap below the last line puts the caret at the end of the note', async ({ page }) => {
  await setText(page, 'first line\nsecond line\nthird');
  const box = await page.evaluate(() => {
    const view = window.testEditor.view;
    const scroll = view.scrollDOM.getBoundingClientRect();
    const end = view.coordsAtPos(view.state.doc.length, 1)!;
    return { x: scroll.left + 40, y: Math.min(scroll.bottom - 6, end.bottom + 30), bottom: scroll.bottom, endBottom: end.bottom };
  });
  expect(box.y).toBeGreaterThan(box.endBottom - 1);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(120);
  const head = await page.evaluate(() => window.testEditor.view.state.selection.main.head);
  expect(head).toBe(await page.evaluate(() => window.testEditor.view.state.doc.length));
});
