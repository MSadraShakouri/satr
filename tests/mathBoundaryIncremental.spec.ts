import { expect, test } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { boundaryEditor: SatrEditor } }

const cases = [
  { name: 'removing a deeply indented list marker', source: '$$\n        - item\n$$', find: '- item', remove: 1, insert: '' },
  { name: 'adding a deeply indented list marker', source: '$$\n        item\n$$', find: 'item', remove: 0, insert: '- ' },
  { name: 'removing a deeply indented quote marker', source: '$$\n        > item\n$$', find: '> item', remove: 1, insert: '' },
  { name: 'removing a deeply indented footnote marker', source: '$$\n        [^foot]: item\n$$', find: '[^foot]', remove: 1, insert: '' },
  { name: 'adding a long Latin ordered marker', source: '$$\n123456789 item\n$$', find: ' item', remove: 0, insert: '.' },
  { name: 'adding a long Persian ordered marker', source: '$$\n۱۲۳۴۵۶۷۸۹ item\n$$', find: ' item', remove: 0, insert: '.' },
  { name: 'blanking an indented line inside a multiline code span', source: '`code\n        x\ninside $y$` and $z$', find: 'x\n', remove: 1, insert: '' },
  { name: 'making a blank line inside an open code span nonblank', source: '`code\n        \ninside $y$` and $z$', find: '\ninside', remove: 0, insert: 'x' },
  { name: 'removing a trailing word from a closing fence', source: '```\n```    x\n$y$\n```', find: 'x\n$y$', remove: 1, insert: '' },
  { name: 'adding a trailing word to a closing fence', source: '```\n```    \n$y$\n```', find: '\n$y$', remove: 0, insert: 'x' },
];

for (const example of cases) {
  test(`incremental math: ${example.name}`, async ({ page }) => {
    await page.goto('/');
    const state = await page.evaluate(async ({ source, find, remove, insert }) => {
      const { SatrEditor } = await window.__satr.load('/src/editor.ts');
      const { mathSpans } = await window.__satr.load('/src/mathSource.ts');
      const { scanMath } = await window.__satr.load('/src/mathScan.ts');
      const host = document.createElement('div'); document.body.append(host);
      const editor = new SatrEditor(host, () => {}); window.boundaryEditor = editor;
      editor.setValue(source);
      const at = source.indexOf(find);
      editor.view.dispatch({ changes: { from: at, to: at + remove, insert } });
      const text = editor.getValue();
      return { text, cached: editor.view.state.field(mathSpans), scanned: scanMath(text) };
    }, example);
    expect(state.cached, state.text).toEqual(state.scanned);
  });
}

test('line-boundary edits agree with a fresh scan across surrounding syntax', async ({ page }) => {
  await page.goto('/');
  const failures = await page.evaluate(async () => {
    const { SatrEditor } = await window.__satr.load('/src/editor.ts');
    const { mathSpans } = await window.__satr.load('/src/mathSource.ts');
    const { scanMath } = await window.__satr.load('/src/mathScan.ts');
    const host = document.createElement('div'); document.body.append(host);
    const editor = new SatrEditor(host, () => {}); window.boundaryEditor = editor;
    const middles = ['        - item', '        > item', '        [^foot]: item', '123456789. item',
      '۱۲۳۴۵۶۷۸۹. item', '        x', '        ', '    abc', 'paragraph', '```    x', '```    ', '~~~    x'];
    const samples = middles.flatMap((line) => [
      `$$\n${line}\n$$ tail $z$`,
      `\`code\n${line}\ninside $y$\` and $z$`,
      `before $x$\n${line}\nafter $z$`,
      `\`\`\`\n${line}\n$y$\n\`\`\` and $z$`,
    ]);
    const bad: string[] = [];
    for (const source of samples) {
      const base = editor.view.state.update({ changes: { from: 0, to: editor.view.state.doc.length, insert: source } }).state;
      for (let at = 0; at <= source.length; at += 1) {
        for (const [removed, inserted] of [[0, 'x'], [0, ' '], [0, '.'], [1, ''], [1, 'x']] as const) {
          if (at + removed > source.length) continue;
          const state = base.update({ changes: { from: at, to: at + removed, insert: inserted } }).state;
          if (JSON.stringify(state.field(mathSpans)) !== JSON.stringify(scanMath(state.doc.toString()))) {
            if (bad.length < 30) bad.push(`${JSON.stringify(source)} @${at} -${removed} +${JSON.stringify(inserted)}`);
          }
        }
      }
    }
    return bad;
  });
  expect(failures).toEqual([]);
});

test('source highlighting follows an indented boundary as it is removed and restored', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await window.__satr.load('/src/editor.ts');
    const host = document.createElement('div'); host.id = 'boundary-test-editor';
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.append(host);
    const editor = new SatrEditor(host, () => {}); window.boundaryEditor = editor;
    editor.setValue('$$\n        - item\n$$');
  });
  await expect(page.locator('#boundary-test-editor .cm-math')).toHaveCount(0);
  await page.evaluate(() => {
    const editor = window.boundaryEditor; const at = editor.getValue().indexOf('- item');
    editor.view.dispatch({ changes: { from: at, to: at + 1 } });
  });
  await expect(page.locator('#boundary-test-editor .cm-math')).toContainText(['         item']);
  await page.evaluate(() => {
    const editor = window.boundaryEditor; const at = editor.getValue().indexOf(' item');
    editor.view.dispatch({ changes: { from: at, insert: '-' } });
  });
  await expect(page.locator('#boundary-test-editor .cm-math')).toHaveCount(0);
});
