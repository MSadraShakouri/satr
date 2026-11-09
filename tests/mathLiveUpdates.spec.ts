import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

async function editor(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await window.__satr.load('/src/editor.ts');
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host); window.testEditor = new SatrEditor(host, () => {});
    window.testEditor.setValue('The value is '); window.testEditor.setSelection(13); window.testEditor.focus();
    await document.fonts.ready;
  });
}

test('a new inline formula is highlighted as soon as its first character is typed', async ({ page }) => {
  await editor(page);
  await page.keyboard.insertText('$');
  await page.keyboard.insertText('x');
  const state = await page.evaluate(async () => {
    const e = window.testEditor;
    const { mathSpans } = await window.__satr.load('/src/mathSource.ts');
    const { scanMath } = await window.__satr.load('/src/mathScan.ts');
    return { text: e.getValue(), cached: e.view.state.field(mathSpans), scanned: scanMath(e.getValue()), math: [...e.view.dom.querySelectorAll('.cm-math')].map(x => x.textContent), delims: e.view.dom.querySelectorAll('.cm-math-delim').length };
  });
  expect(state.text).toBe('The value is $x$');
  expect(state.cached).toEqual(state.scanned);
  expect(state.cached).toHaveLength(1);
  expect(state.math.join('')).toContain('x');
  expect(state.delims).toBe(2);
});

test('a command typed first is highlighted as soon as the closing dollar is no longer escaped', async ({ page }) => {
  await editor(page);
  await page.keyboard.insertText('$');
  await page.keyboard.insertText('\\');
  await page.keyboard.insertText('f');
  const state = await page.evaluate(async () => {
    const e = window.testEditor;
    const { mathSpans, mathFaultAt } = await window.__satr.load('/src/mathSource.ts');
    const { scanMath } = await window.__satr.load('/src/mathScan.ts');
    return { text: e.getValue(), cached: e.view.state.field(mathSpans), scanned: scanMath(e.getValue()), fault: mathFaultAt(e.view.state, e.view.state.selection.main.head), math: [...e.view.dom.querySelectorAll('.cm-math')].map(x => x.textContent) };
  });
  expect(state.text).toBe('The value is $\\f$');
  expect(state.cached).toEqual(state.scanned);
  expect(state.cached).toHaveLength(1);
  expect(state.math.join('')).toBe('\\f');
  expect(state.fault).toBe('\\f is not a command');
});

test('empty and nonempty inline pairs, and prices after a closer, update without another dollar', async ({ page }) => {
  await editor(page);
  const steps = await page.evaluate(async () => {
    const e = window.testEditor; const { mathSpans } = await window.__satr.load('/src/mathSource.ts');
    const { scanMath } = await window.__satr.load('/src/mathScan.ts');
    const records: { source: string; cached: unknown; scanned: unknown }[] = [];
    function check() { const source = e.getValue(); records.push({ source, cached: e.view.state.field(mathSpans), scanned: scanMath(source) }); }
    e.setValue('prefix $ $ suffix'); check();
    e.view.dispatch({ changes: { from: 8, insert: 'x' } }); check();
    e.view.dispatch({ changes: { from: 8, to: 9 } }); check();
    e.setValue('prefix $x$ suffix'); check();
    e.view.dispatch({ changes: { from: 10, insert: '5' } }); check();
    e.view.dispatch({ changes: { from: 10, to: 11 } }); check();
    e.setValue('$$\nvalue\n$$ then $ $ text'); check();
    const at = e.getValue().lastIndexOf('$ $') + 1;
    e.view.dispatch({ changes: { from: at, insert: 'x' } }); check();
    return records;
  });
  for (const step of steps) expect(step.cached, step.source).toEqual(step.scanned);
  expect(steps.map(x => (x.cached as unknown[]).length)).toEqual([0, 1, 0, 1, 0, 1, 1, 2]);
});

test('incremental spans agree with a full scan around math, prices and code', async ({ page }) => {
  await editor(page);
  const failures = await page.evaluate(async () => {
    const { mathSpans } = await window.__satr.load('/src/mathSource.ts');
    const { scanMath } = await window.__satr.load('/src/mathScan.ts');
    const samples = [
      'prefix $ $ suffix', 'prefix $$  $$ suffix', 'prefix $x$5 suffix',
      'prefix $\\$ suffix', 'prefix $\\f$ suffix', 'prefix $x\\$ suffix', 'prefix \\$x$ suffix',
      'prefix $5 and $10 suffix', 'prefix $x$ and $ $ tail', 'متن فارسی طولانی $ $ ادامه',
      '$$\nvalue\n$$ then $ $ text', 'prefix `code $ $` and $ $ tail',
      '```\nprefix $ $ suffix\n```\nend $ $', 'prefix \\$ $ and $ $ end',
    ];
    const bad: string[] = [];
    const view = window.testEditor.view;
    for (const source of samples) {
      const base = view.state.update({ changes: { from: 0, to: view.state.doc.length, insert: source } }).state;
      for (let at = 0; at <= source.length; at++) {
        for (const [removed, inserted] of [[0, 'x'], [0, '5'], [0, ' '], [1, ''], [1, 'x'], [1, '5'], [1, ' ']] as const) {
          if (at + removed > source.length) continue;
          const state = base.update({ changes: { from: at, to: at + removed, insert: inserted } }).state;
          const full = scanMath(state.doc.toString());
          if (JSON.stringify(state.field(mathSpans)) !== JSON.stringify(full)) {
            bad.push(`${JSON.stringify(source)} @${at} -${removed} +${JSON.stringify(inserted)}`);
          }
        }
      }
    }
    return bad;
  });
  expect(failures).toEqual([]);
});

async function app(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'A.md': 1 }, folders: [] }));
    localStorage.setItem('satr:fs:file:A.md', 'The value is $\\alpha$ here.');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'A.md' }], active: 0 }));
    localStorage.setItem('satr:demoShown', '1');
  });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const v = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    const at = v.state.doc.toString().indexOf('\\alpha') + '\\alpha'.length;
    v.dispatch({ selection: { anchor: at } }); v.focus();
  });
}

test('the math font is prepared during idle before the first formula is typed', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'A.md': 1 }, folders: [] }));
    localStorage.setItem('satr:fs:file:A.md', 'A short note without a formula.');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'A.md' }], active: 0 }));
    localStorage.setItem('satr:demoShown', '1');
    const fonts = document.fonts;
    const original = fonts.load.bind(fonts);
    (window as any).fontRequests = [];
    fonts.load = (font, text) => { (window as any).fontRequests.push(font); return original(font, text); };
  });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await expect.poll(() => page.evaluate(() => (window as any).fontRequests.includes('16px VazirCode'))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px VazirCode'))).toBe(true);
});

test('the checker warm-up exercises both valid and invalid formulas', async ({ page }) => {
  await page.goto('/');
  const checked = await page.evaluate(async () => {
    const { warmMathChecker } = await window.__satr.load('/src/mathSource.ts');
    const { default: katex } = await window.__satr.load('/node_modules/katex');
    const original = katex.renderToString;
    const seen: string[] = [];
    katex.renderToString = (text: string, options: object) => { seen.push(text); return original(text, options); };
    try { warmMathChecker(); } finally { katex.renderToString = original; }
    return seen;
  });
  expect(checked).toEqual(['z', '\\znotacommand']);
});

test('a newly typed invalid formula gets highlighting and a live error in the app', async ({ page }) => {
  await app(page);
  await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const v = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'The value is ' }, selection: { anchor: 13 } });
    v.focus();
  });
  await page.keyboard.insertText('$');
  await page.keyboard.insertText('x');
  await expect(page.locator('#app .cm-math')).toContainText('x');
  await page.keyboard.insertText('\\bad');
  await expect(page.locator('#app .cm-math-error')).toHaveCount(1);
  await expect(page.locator('.notice')).toHaveText('\\bad is not a command');
});

test('changing a live error replaces its message in one steady notice', async ({ page }) => {
  await app(page);
  await page.keyboard.insertText('q');
  await expect(page.locator('.notice')).toHaveText('\\alphaq is not a command');
  await page.waitForTimeout(250);
  await page.evaluate(() => { (window as any).firstMathNotice = document.querySelector('.notice'); });
  const frames = [];
  for (const ch of ['r', 's', 't']) {
    await page.keyboard.insertText(ch);
    frames.push(await page.evaluate(() => ({
      notices: [...document.querySelectorAll<HTMLElement>('.notice')].map(e => e.textContent),
      same: document.querySelector('.notice') === (window as any).firstMathNotice,
      opacity: Number(getComputedStyle(document.querySelector<HTMLElement>('.notice')!).opacity),
    })));
    await page.waitForTimeout(30);
  }
  for (const f of frames) { expect(f.notices).toHaveLength(1); expect(f.same).toBe(true); expect(f.opacity).toBeGreaterThan(0.9); }
  expect(frames[2].notices).toEqual(['\\alphaqrst is not a command']);
});

test('unrelated notices are not replaced by changing math errors', async ({ page }) => {
  await app(page);
  await page.evaluate(async () => { const { showNotice } = await window.__satr.load('/src/notice.ts'); showNotice('Another notice', 60000); });
  await page.keyboard.insertText('q');
  await page.keyboard.insertText('r');
  await expect(page.locator('.notice')).toHaveCount(2);
  await expect(page.locator('.notice').filter({ hasText: 'Another notice' })).toHaveCount(1);
  await expect(page.locator('.notice').filter({ hasText: '\\alphaqr is not a command' })).toHaveCount(1);
});

test('a new error during fade-out reuses the same notice without jumping', async ({ page }) => {
  await app(page);
  await page.keyboard.insertText('q');
  await expect(page.locator('.notice')).toHaveText('\\alphaq is not a command');
  await page.waitForTimeout(250);
  const result = await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const v = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    const first = document.querySelector<HTMLElement>('.notice')!;
    let h = v.state.selection.main.head;
    v.dispatch({ changes: { from: h - 1, to: h }, selection: { anchor: h - 1 }, userEvent: 'delete.backward' });
    await new Promise(r => setTimeout(r, 35));
    const during = Number(getComputedStyle(first).opacity);
    h = v.state.selection.main.head;
    v.dispatch({ changes: { from: h, insert: 'z' }, selection: { anchor: h + 1 }, userEvent: 'input.type' });
    const all = [...document.querySelectorAll<HTMLElement>('.notice')];
    return { during, count: all.length, same: all[0] === first, text: all[0]?.textContent, after: Number(getComputedStyle(all[0]).opacity) };
  });
  expect(result.count).toBe(1);
  expect(result.same).toBe(true);
  expect(result.text).toBe('\\alphaz is not a command');
  expect(Math.abs(result.after - result.during)).toBeLessThan(0.2);
});
