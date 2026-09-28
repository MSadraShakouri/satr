import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/editor.ts';
    const { SatrEditor } = await import(path);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {});
    await document.fonts.ready;
  });
});

async function draft(page: Page, text: string) {
  const pos = text.indexOf('|');
  await page.evaluate(({ text, pos }) => {
    window.testEditor.setValue(text.replace('|', ''));
    window.testEditor.setSelection(pos);
    window.testEditor.focus();
  }, { text, pos });
}
async function contents(page: Page) {
  return page.evaluate(() => {
    const e = window.testEditor;
    const pos = e.getSelection()[1];
    return e.getValue().slice(0, pos) + '|' + e.getValue().slice(pos);
  });
}

test('typing and toolbar open a display writing line without swallowing input', async ({ page }) => {
  await draft(page, '|');
  await page.keyboard.insertText('$');
  expect(await contents(page)).toBe('$|$');
  await page.keyboard.insertText('$');
  expect(await contents(page)).toBe('$$\n|\n$$');
  await page.keyboard.insertText('$');
  expect(await contents(page)).toBe('$$\n$|\n$$');

  await draft(page, '|');
  await page.keyboard.insertText('$$'); // batched Android input
  expect(await contents(page)).toBe('$$\n|\n$$');
  await draft(page, '|');
  await page.evaluate(() => { window.testEditor.run('math'); window.testEditor.run('math'); });
  expect(await contents(page)).toBe('$$\n|\n$$');

  await draft(page, '$$ | $$');
  await page.keyboard.press('Enter');
  expect(await contents(page)).toBe('$$\n|\n$$');
  await draft(page, '$$\nx\n$$|');
  await page.keyboard.press('Enter');
  expect(await contents(page)).toBe('$$\nx\n$$\n|');
});

test('backspace deletes only tracked empty pairs, never half an existing delimiter', async ({ page }) => {
  for (const [before, after] of [
    ['$|$ text $$', '|$ text $$'],
    ['$$ text $|$', '$$ text |$'],
    ['*|* text **', '|* text **'],
    ['`$|$`', '`|$`'],
  ]) {
    await draft(page, before);
    await page.keyboard.press('Backspace');
    expect(await contents(page)).toBe(after);
  }
  for (const char of ['$', '*', '_', '~', '=', '%']) {
    await draft(page, '|');
    await page.keyboard.insertText(char);
    expect(await contents(page)).toBe(`${char}|${char}`);
    await page.keyboard.press('Backspace');
    expect(await contents(page)).toBe('|');
  }
});

test('code, math, escapes, words, and existing open/close marks are distinguished', async ({ page }) => {
  const cases = [
    ['`co|de`', '$', '`co$|de`'],
    ['`code`|', '*', '`code`*|*'],
    ['`$$`\n|', '*', '`$$`\n*|*'],
    ['\\$$\n|', '*', '\\$$\n*|*'],
    ['\\\\$x | y$', '*', '\\\\$x *| y$'],
    ['```\nco|de\n```', '*', '```\nco*|de\n```'],
    ['$x | y$', '*', '$x *| y$'],
    ['$$\nx | y\n$$', '_', '$$\nx _| y\n$$'],
    ['\\|', '$', '\\$|'],
    ['\\|', '*', '\\*|'],
    ['snake|case', '_', 'snake_|case'],
    ['cost |5', '$', 'cost $|5'],
    ['|$$ text $$', '$', '$|$$ text $$'],
    ['$x|$', '$', '$x$|'],
    ['$$text|$$', '$$', '$$text$$|'],
    ['*text|*', '*', '*text*|'],
    ['**text|**', '**', '**text**|'],
    ['~~text|~~', '~~', '~~text~~|'],
    ['==text|==', '==', '==text==|'],
  ];
  for (const [before, input, after] of cases) {
    await draft(page, before);
    await page.keyboard.insertText(input);
    expect(await contents(page), `${before} + ${input}`).toBe(after);
  }
});

test('formatting selections preserves direction, upgrades pairs, and supports undo', async ({ page }) => {
  await draft(page, '|word');
  await page.evaluate(() => window.testEditor.setSelection(4, 0));
  await page.keyboard.insertText('*');
  await page.keyboard.insertText('*');
  expect(await page.evaluate(() => ({ text: window.testEditor.getValue(), selection: window.testEditor.getSelection() })))
    .toEqual({ text: '**word**', selection: [6, 2] });
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.testEditor.getValue())).not.toBe('**word**');
  await draft(page, '|');
  await page.keyboard.insertText('*');
  await page.keyboard.insertText('*');
  expect(await contents(page)).toBe('**|**');
  await draft(page, '|');
  await page.keyboard.insertText('*');
  await page.keyboard.insertText(' ');
  expect(await contents(page)).toBe('* |');
});

test('selection rows do not overlap at normal or deliberately tight spacing', async ({ page }) => {
  for (const lineHeight of [1.85, 1.2]) {
    await draft(page, '|English text\nمتن فارسی با حروف بلند\nThird line\n\nLast line');
    await page.evaluate((lineHeight) => {
      document.documentElement.style.setProperty('--note-line-height', String(lineHeight));
      window.testEditor.setSelection(0, window.testEditor.getValue().length);
      window.testEditor.remeasure();
    }, lineHeight);
    await expect.poll(async () => page.evaluate(() => window.testEditor.view.dom.querySelectorAll('.cm-satr-selection').length)).toBeGreaterThanOrEqual(5);
    // Give CodeMirror's geometry pass a frame after the settings change.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const boxes = await page.evaluate(() => [...window.testEditor.view.dom.querySelectorAll('.cm-satr-selection')]
      .map((el) => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })).sort((a, b) => a.top - b.top));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].top - boxes[i - 1].bottom).toBeGreaterThanOrEqual(0.8);
  }
});

test('empty display math retains a visible blank line in preview', async ({ page }) => {
  const height = await page.evaluate(async () => {
    const path = '/src/markdown.ts';
    const { renderMarkdown } = await import(path);
    const preview = document.createElement('article');
    preview.id = 'preview';
    preview.innerHTML = renderMarkdown('$$ $$');
    document.body.appendChild(preview);
    return preview.querySelector('.math-display')!.getBoundingClientRect().height;
  });
  expect(height).toBeGreaterThan(10);
});

test('ordinary brackets, apostrophes and code-fence pairing still work', async ({ page }) => {
  await draft(page, '|');
  await page.keyboard.insertText('(');
  expect(await contents(page)).toBe('(|)');
  await page.keyboard.press('Backspace');
  expect(await contents(page)).toBe('|');
  await draft(page, "don|t");
  await page.keyboard.insertText("'");
  expect(await contents(page)).toBe("don'|t");
  await draft(page, '|');
  for (let i = 0; i < 3; i++) await page.keyboard.insertText('`');
  expect(await contents(page)).toBe('```|```');
});

test('spacing defaults migrate without resetting other chosen values', async ({ page }) => {
  const settings = await page.evaluate(async () => {
    const path = '/src/settings.ts';
    const { loadSettings } = await import(path);
    return [undefined, { version: 2, lineHeight: 1.5 }, { version: 2, lineHeight: 2.1 }, { version: 3, lineHeight: 1.5 }].map((value) => {
      if (value) localStorage.setItem('satr:settings', JSON.stringify(value));
      else localStorage.removeItem('satr:settings');
      return loadSettings().lineHeight;
    });
  });
  expect(settings).toEqual([1.85, 1.85, 2.1, 1.5]);
});

test('tab number uses the alignment from before 77171fe', async ({ page }) => {
  const count = page.locator('.mobile-navbar-tabs-number');
  await expect(count).toHaveCSS('display', 'flex');
  await expect(count).toHaveCSS('align-items', 'center');
  await expect(count).toHaveCSS('justify-content', 'center');
  await expect(count).toHaveCSS('top', '0px');
  await expect(count).toHaveCSS('transform', 'none');
});
