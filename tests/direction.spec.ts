import { expect, test } from '@playwright/test';

const cases = [
  { name: 'unanimous RTL above beats English below', text: 'متن فارسی\n\n123 / 2026-09-28\n\nEnglish', dir: 'rtl' },
  { name: 'Persian digits are neutral, not strong Arabic', text: 'English\n\n۱۲۳ / ۱۴۰۵-۰۷-۰۶\n\nفارسی', dir: 'ltr' },
  { name: 'agreeing RTL neighbours in mixed prose', text: 'English\n\nفارسی\n\n123\n\nادامه', dir: 'rtl' },
  { name: 'mixed neighbours prefer preceding English', text: 'فارسی\n\nEnglish\n\n123\n\nادامه', dir: 'ltr' },
  { name: 'mixed neighbours prefer preceding Persian', text: 'English\n\nفارسی\n\n123\n\nEnglish again', dir: 'rtl' },
  { name: 'math and code do not vote', text: 'فارسی\n\n$$\nx+y=z\n$$\n\n```js\n# Not a heading\nEnglish\n```\n\n123\n\nEnglish', dir: 'rtl' },
  { name: 'inline math and code do not supply a first letter', text: '$x$ فارسی `code`\n\n123\n\nEnglish', dir: 'rtl' },
  { name: 'following heading is not a neighbour', text: '123\n\n# فارسی\n\nادامه', dir: 'ltr' },
  { name: 'look below when there is no prose above', text: '123\n\nفارسی', dir: 'rtl' },
  { name: 'heading is fallback, not a vote against body prose', text: '# English\n\nفارسی\n\n123\n\nEnglish', dir: 'rtl' },
  { name: 'headings stop previous-section leakage', text: 'فارسی\n\n# English\n\n123\n\n## فارسی', dir: 'ltr' },
  { name: 'setext headings form the same boundary', text: 'فارسی\n\nEnglish\n=======\n\n123\n\n# فارسی', dir: 'ltr' },
  { name: 'soft newlines do not hide mixed context', text: 'فارسی\nEnglish\n\n123\n\nفارسی', dir: 'ltr' },
  { name: 'Markdown link destinations do not vote', text: 'فارسی\n\n[123](https://example.com)\n\nEnglish', dir: 'rtl' },
  { name: 'task markers do not count as Latin letters', text: 'فارسی\n\n- [x] 123\n\nEnglish', dir: 'rtl' },
  { name: 'empty fences do not swallow subsequent context', text: '```\n```\n\nفارسی\n\n123\n\nEnglish', dir: 'rtl' },
  { name: 'reference-link metadata is not prose', text: 'فارسی\n\n[ref]: https://example.com \"English title\"\n\n[123][ref]\n\nEnglish', dir: 'rtl' },
  { name: 'neutral file safely falls back to LTR', text: '123\n\n۱۴۰۵/۰۷/۰۶', dir: 'ltr' },
];

test('shared contextual policy: source lines and rendered blocks', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async (cases) => {
    const directionPath = '/src/direction.ts', markdownPath = '/src/markdown.ts';
    const { sourceDirections } = await window.__satr.load(directionPath);
    const { renderMarkdown } = await window.__satr.load(markdownPath);
    return cases.map(({ text }) => {
      const lines = text.split('\n');
      const index = lines.findIndex((line) => /123|۱۲۳/.test(line));
      const root = document.createElement('article');
      root.className = 'preview-pane';
      root.innerHTML = renderMarkdown(text);
      document.body.append(root);
      const block = [...root.querySelectorAll('p,li')].find((el) => /123|۱۲۳/.test(el.textContent ?? ''))!;
      const result = { source: sourceDirections(text)[index], rendered: block.getAttribute('dir'), computed: getComputedStyle(block).direction, bidi: getComputedStyle(block).unicodeBidi };
      root.remove(); return result;
    });
  }, cases);
  cases.forEach(({ name, dir }, index) => {
    expect(results[index], name).toEqual({ source: dir, rendered: dir, computed: dir, bidi: 'isolate' });
  });
});

test('full-document inference ignores metadata and fenced headings; a lone $$ is text', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/direction.ts';
    const { sourceDirections, strongDirection } = await window.__satr.load(path);
    return {
      numbers: ['123', '۱۲۳', '١٢٣', '...'].map(strongDirection),
      prefix: sourceDirections('---\ntitle: English\n---\n123\n\nفارسی')[3],
      long: sourceDirections('فارسی\n' + '\n'.repeat(350) + '123\nEnglish').at(-2),
      math: sourceDirections('فارسی\n\n$$\n# English\n123'),
      matched: sourceDirections('فارسی\n\n$$\nx+y\n$$'),
      fence: sourceDirections('فارسی\n\n```\n# English\n```\n\n123\nEnglish').at(-2),
    };
  });
  expect(result.numbers).toEqual([null, null, null, null]);
  expect(result.prefix).toBe('rtl');
  expect(result.long).toBe('rtl');
  // A lone unpaired "$$" opens nothing: the text below it is ordinary prose
  // and keeps its own direction (only a matched $$ … $$ pair is math).
  expect(result.math.slice(2)).toEqual(['rtl', 'ltr', 'ltr']);
  expect(result.matched.slice(2)).toEqual(['ltr', 'ltr', 'ltr']);
  expect(result.fence).toBe('rtl');
});

test('editor updates context beyond its viewport and keeps math LTR', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/editor.ts';
    const { SatrEditor } = await window.__satr.load(path);
    const host = document.createElement('div');
    host.id = 'direction-editor'; host.style.cssText = 'position:fixed;inset:0;z-index:1000;background:white';
    document.body.append(host);
    window.testEditor = new SatrEditor(host, () => {});
    window.testEditor.setValue('فارسی\n\n123\n\n$$\nx+y\n$$\n\nEnglish');
    await document.fonts.ready;
  });
  const line = page.locator('#direction-editor .cm-line').filter({ hasText: /^123$/ });
  await expect(line).toHaveAttribute('dir', 'rtl');
  await expect(line).toHaveCSS('direction', 'rtl');
  await expect(page.locator('#direction-editor .cm-line').filter({ hasText: /^x\+y$/ })).toHaveCSS('direction', 'ltr');
  await page.evaluate(() => window.testEditor.view.dispatch({ changes: { from: 0, to: 5, insert: 'English' } }));
  await expect(line).toHaveAttribute('dir', 'ltr');
  await page.evaluate(async () => {
    const e = window.testEditor;
    e.setValue('فارسی\n' + '\n'.repeat(350) + '123\nEnglish');
    const path = '/src/scrollSync.ts'; const { applyEditorScroll } = await window.__satr.load(path);
    applyEditorScroll(e.view, 348);
  });
  await expect(line).toHaveAttribute('dir', 'rtl');
});

test('print retains inferred dates, list items and footnotes without changing math direction', async ({ page }) => {
  await page.addInitScript(() => { window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; }; });
  await page.goto('/');
  const html = await page.evaluate(async () => {
    const path = '/src/exportPdf.ts'; const { exportPdf } = await window.__satr.load(path);
    await exportPdf('Directions', '# English title\n\nفارسی[^date]\n\n$$x+y=z$$\n\n2026/09/28\n\n- ۱۲۳\n\nEnglish\n\n# فارسی\n\nادامه\n\n[^date]: ۱۴۰۵/۰۷/۰۶', '', { columns: 1, direction: 'ltr', mathAlign: 'center' });
    return window.__printedHtml;
  });
  await page.setContent(html!);
  await expect(page.locator('.pagedjs_page_content p').filter({ hasText: /^2026\/09\/28$/ })).toHaveCSS('direction', 'rtl');
  await expect(page.locator('.pagedjs_page_content li').filter({ hasText: '۱۲۳' })).toHaveCSS('direction', 'rtl');
  await expect(page.locator('.pagedjs_footnote_area .footnote').first()).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.math-display .katex').first()).toHaveCSS('direction', 'ltr');
});
