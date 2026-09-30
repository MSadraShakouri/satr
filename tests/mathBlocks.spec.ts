import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

// A `$$ … $$` pair is a display block only while nothing between its dollars
// ends a maths block: a heading, a list item, a quote, a rule, a footnote
// definition or a fence. The editor's source styling and the reading view read
// the same spans (src/mathScan.ts), so the two can never disagree: what is not
// math in the source is not math in the preview, and its dollars are plain
// text rather than coloured delimiters.
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

async function draft(page: Page, text: string) {
  const pos = text.indexOf('|');
  await page.evaluate(async ({ text, pos }) => {
    window.testEditor.setValue(text.replace('|', ''));
    window.testEditor.setSelection(pos);
    window.testEditor.focus();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, { text, pos });
}

async function marks(page: Page) {
  return page.evaluate(() => {
    const dom = window.testEditor.view.dom;
    return {
      math: [...dom.querySelectorAll('.cm-math')].map((el) => el.textContent ?? ''),
      delims: [...dom.querySelectorAll('.cm-math-delim')].map((el) => el.textContent ?? ''),
    };
  });
}

test('a heading, a list or a quote inside $$ breaks the pair into plain text', async ({ page }) => {
  await draft(page, '$$\nx = 1\n# Heading\ny = 2\n$$|');
  expect(await marks(page)).toEqual({ math: [], delims: [] });

  await draft(page, '$$\na = b\n- item\n$$|');
  expect(await marks(page)).toEqual({ math: [], delims: [] });

  await draft(page, '$$\na\n> quote\n$$|');
  expect(await marks(page)).toEqual({ math: [], delims: [] });
});

test('a real block is monospace between its dollars only', async ({ page }) => {
  await draft(page, '$$\nx = 1\n$$|');
  const styled = await marks(page);
  expect(styled.math).toEqual(['x = 1']);
  expect(styled.delims).toEqual(['$$', '$$']);
});

test('the reading view renders a broken pair as the markdown it is', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { renderMarkdown } = await import('/src/markdown.ts');
    const host = document.createElement('article');
    const render = (text: string) => {
      host.innerHTML = renderMarkdown(text);
      return {
        displays: host.querySelectorAll('.math-display').length,
        headings: host.querySelectorAll('h1, h2').length,
        items: host.querySelectorAll('li').length,
        quotes: host.querySelectorAll('blockquote').length,
        text: host.textContent ?? '',
        // A placeholder the render step forgot to fill would sit in the page as
        // an empty block: that is how a "broken pair becomes one display block"
        // would look (1).
        placeholders: host.querySelectorAll('[data-satr-math]').length,
      };
    };
    return {
      broken: render('$$\nx = 1\n# Heading\ny = 2\n$$'),
      list: render('$$\na = b\n- item\n$$'),
      quote: render('$$\na\n> quote\n$$'),
      fence: render('$$\na\n```\ncode\n```\n$$'),
      block: render('$$\nx = 1\n$$'),
      empty: render('$$\n\n$$'),
      sameLine: render('$$x = 1$$'),
      unclosed: render('$$\nx = 1'),
      unclosedThenPair: render('$$\na\n$$\nb\n$$'),
      dollarsOnly: render('$$\n$$\n$$'),
      lone: render('one $$ two'),
      run: render('$$$$'),
      spaced: render('$$ $$'),
      price: render('$5 and $10'),
    };
  });
  // Nothing of a broken pair is display math; the markdown inside it renders.
  for (const broken of [report.broken, report.list, report.quote, report.fence]) {
    expect(broken.displays).toBe(0);
    expect(broken.text).toContain('$$');
  }
  expect(report.broken.headings).toBe(1);
  expect(report.list.items).toBe(1);
  expect(report.quote.quotes).toBe(1);
  // A pair that closes cleanly is still one display block.
  expect(report.block.displays).toBe(1);
  expect(report.empty.displays).toBe(1);
  expect(report.sameLine.displays).toBe(1);
  // An opener that never closes is text too — it must not become a block on
  // its own, and a pair that closes after it is still a block of its own.
  for (const unclosed of [report.unclosed, report.unclosedThenPair]) {
    expect(unclosed.text).toContain('$$');
    expect(unclosed.placeholders).toBe(0);
  }
  expect(report.unclosed.displays).toBe(0);
  expect(report.unclosedThenPair.displays).toBe(1);
  expect(report.dollarsOnly.displays).toBe(1);
  // No render ever leaves an unfilled placeholder behind.
  for (const one of Object.values(report)) expect(one.placeholders).toBe(0);
  // Lone and empty same-line dollars, and prices, are text.
  expect(report.lone.displays).toBe(0);
  expect(report.run.displays).toBe(0);
  expect(report.spaced.displays).toBe(0);
  expect(report.price.displays).toBe(0);
});
