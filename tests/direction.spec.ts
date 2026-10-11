import { expect, test } from '@playwright/test';

// Every case is a line with no letter of its own — a bare number, a date, an
// empty line — inside a note whose language the first prose decides. Such a
// line takes the NOTE'S language, not the line above it (the writer's call:
// a date under an English line came out English inside a Persian note, and
// flipped sides when its prose arrived). Math, code and metadata never vote;
// a line with letters keeps its own.
const cases = [
  { name: 'a bare date in a Persian note stays Persian under an English line', text: 'متن فارسی\n\n123 / 2026-09-28\n\nEnglish', dir: 'rtl' },
  { name: 'Persian digits count for nothing: the English-majority note decides', text: 'English\n\n۱۲۳ / ۱۴۰۵-۰۷-۰۶\n\nفارسی', dir: 'ltr' },
  { name: 'an English line above does not turn the number English', text: 'English\n\nفارسی\n\n123\n\nادامه', dir: 'rtl' },
  { name: 'the line above no longer decides: the note does', text: 'فارسی\n\nEnglish\n\n123\n\nادامه', dir: 'rtl' },
  { name: 'in an English-majority note the number is English', text: 'English\n\nفارسی\n\n123\n\nEnglish again', dir: 'ltr' },
  { name: 'math and code never vote (the remaining prose here is English)', text: 'فارسی\n\n$$\nx+y=z\n$$\n\n```js\n# Not a heading\nEnglish\n```\n\n123\n\nEnglish', dir: 'ltr' },
  { name: 'inline math and code supply no letters; the English prose decides', text: '$x$ فارسی `code`\n\n123\n\nEnglish', dir: 'ltr' },
  { name: 'a heading below claims nothing: the Persian note decides', text: '123\n\n# فارسی\n\nادامه', dir: 'rtl' },
  { name: 'no prose above: the note decides', text: '123\n\nفارسی', dir: 'rtl' },
  { name: 'the note decides, not the heading', text: '# English\n\nفارسی\n\n123\n\nEnglish', dir: 'ltr' },
  { name: 'a Persian-majority note keeps the number Persian under an English heading', text: 'فارسی\n\n# English\n\n123\n\n## فارسی', dir: 'rtl' },
  { name: 'setext headings are no boundary for a bare number', text: 'فارسی\n\nEnglish\n=======\n\n123\n\n# فارسی', dir: 'rtl' },
  { name: 'soft newlines change nothing for a bare number', text: 'فارسی\nEnglish\n\n123\n\nفارسی', dir: 'rtl' },
  { name: 'link destinations never vote (the English prose decides)', text: 'فارسی\n\n[123](https://example.com)\n\nEnglish', dir: 'ltr' },
  { name: 'task markers are not Latin letters (the English prose decides)', text: 'فارسی\n\n- [x] 123\n\nEnglish', dir: 'ltr' },
  { name: 'empty fences change nothing (the English prose decides)', text: '```\n```\n\nفارسی\n\n123\n\nEnglish', dir: 'ltr' },
  { name: 'reference-link metadata is not prose (the English prose decides)', text: 'فارسی\n\n[ref]: https://example.com "English title"\n\n[123][ref]\n\nEnglish', dir: 'ltr' },
  { name: 'a note with no letters at all safely falls back to LTR', text: '123\n\n۱۴۰۵/۰۷/۰۶', dir: 'ltr' },
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
      // 350 lines away is still the same note: the note's language decides.
      long: sourceDirections('متن فارسی و ادامه دارد\n' + '\n'.repeat(350) + '123\nEnglish').at(-2),
      math: sourceDirections('متن فارسی اینجا هست\n\n$$\n# English\n123'),
      matched: sourceDirections('فارسی\n\n$$\nx+y\n$$'),
      // If the fenced comment voted, the majority would be English.
      fence: sourceDirections('متن فارسی و ادامه دارد\n\n```js\n// a long English comment that must not vote\n```\n\n123\nEnglish').at(-2),
    };
  });
  expect(result.numbers).toEqual([null, null, null, null]);
  expect(result.prefix).toBe('rtl');
  expect(result.long).toBe('rtl');
  // A lone unpaired "$$" opens nothing: the text below it is ordinary prose
  // and keeps its own direction (only a matched $$ … $$ pair is math).
  expect(result.math.slice(2)).toEqual(['rtl', 'ltr', 'rtl']);
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
    window.testEditor.setValue('متن فارسی اینجا هست\n\n123\n\n$$\nx+y\n$$\n\nEnglish');
    await document.fonts.ready;
  });
  const line = page.locator('#direction-editor .cm-line').filter({ hasText: /^123$/ });
  await expect(line).toHaveAttribute('dir', 'rtl');
  await expect(line).toHaveCSS('direction', 'rtl');
  await expect(page.locator('#direction-editor .cm-line').filter({ hasText: /^x\+y$/ })).toHaveCSS('direction', 'ltr');
  await page.evaluate(() => window.testEditor.view.dispatch({ changes: { from: 0, to: 19, insert: 'English text' } }));
  await expect(line).toHaveAttribute('dir', 'ltr');
  await page.evaluate(async () => {
    const e = window.testEditor;
    e.setValue('متن فارسی و ادامه دارد\n' + '\n'.repeat(350) + '123\nEnglish');
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
    await exportPdf('Directions', '# English title\n\nفارسی و متن بیشتری اینجا هست[^date]\n\n$$x+y=z$$\n\n2026/09/28\n\n- ۱۲۳\n\nEnglish\n\n# فارسی\n\nادامه\n\n[^date]: ۱۴۰۵/۰۷/۰۶', '', { columns: 1, direction: 'ltr', mathAlign: 'center' });
    return window.__printedHtml;
  });
  await page.setContent(html!);
  await expect(page.locator('.pagedjs_page_content p').filter({ hasText: /^2026\/09\/28$/ })).toHaveCSS('direction', 'rtl');
  await expect(page.locator('.pagedjs_page_content li').filter({ hasText: '۱۲۳' })).toHaveCSS('direction', 'rtl');
  await expect(page.locator('.pagedjs_footnote_area .footnote').first()).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.math-display .katex').first()).toHaveCSS('direction', 'ltr');
});
