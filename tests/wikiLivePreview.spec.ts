import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testWikiEditor: SatrEditor; wikiOpened: { target: string; heading: string }[] } }

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = (window as any).__satr.load('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.wikiOpened = [];
    window.testWikiEditor = new SatrEditor(host, () => {}, { openLink: (target: string, heading: string) => window.wikiOpened.push({ target, heading }) });
    await document.fonts.ready;
  });
});

async function seed(page: Page, line: string) {
  await page.evaluate(async (line) => {
    const ed = window.testWikiEditor;
    ed.setValue(`${line}\noutside`);
    ed.view.focus();
    ed.view.dispatch({ selection: { anchor: line.length + 2 } });
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }, line);
}
async function lineText(page: Page): Promise<string> {
  return page.evaluate(() => window.testWikiEditor.view.contentDOM.querySelector('.cm-line')?.textContent ?? '');
}

test('ordinary link hides just its brackets away from the caret and preserves the source', async ({ page }) => {
  const source = 'read [[Lecture]] today';
  await seed(page, source);
  expect(await lineText(page)).toBe('read Lecture today');
  expect(await page.evaluate(() => window.testWikiEditor.getValue())).toBe(`${source}\noutside`);
  for (const pos of [source.indexOf('[['), source.indexOf('Lecture') + 2, source.indexOf(']]') + 2]) {
    await page.evaluate((head) => window.testWikiEditor.view.dispatch({ selection: { anchor: head } }), pos);
    expect(await lineText(page), `source is revealed at position ${pos}`).toBe(source);
  }
  await page.evaluate(() => window.testWikiEditor.view.dispatch({ selection: { anchor: window.testWikiEditor.getValue().length } }));
  expect(await lineText(page)).toBe('read Lecture today');
  await page.evaluate(() => window.testWikiEditor.view.contentDOM.blur());
  expect(await lineText(page)).toBe('read Lecture today');
});

test('an aliased link displays the alias and still opens the target and heading', async ({ page }) => {
  const source = 'see [[Lecture#Part|Class notes]] here';
  await seed(page, source);
  expect(await lineText(page)).toBe('see Class notes here');
  await page.locator('.cm-wikilink').filter({ hasText: 'Class notes' }).click();
  expect(await page.evaluate(() => window.wikiOpened)).toEqual([{ target: 'Lecture', heading: 'Part' }]);
  expect(await page.evaluate(() => window.testWikiEditor.getValue())).toBe(`${source}\noutside`);
  await page.evaluate((head) => { window.testWikiEditor.view.focus(); window.testWikiEditor.view.dispatch({ selection: { anchor: head } }); }, source.indexOf('Class') + 2);
  expect(await lineText(page)).toBe(source);
});

test('multiple links reveal only the one touched by the caret', async ({ page }) => {
  const source = '[[One]] and [[Two]]';
  await seed(page, source);
  expect(await lineText(page)).toBe('One and Two');
  await page.evaluate(() => window.testWikiEditor.view.dispatch({ selection: { anchor: 4 } }));
  expect(await lineText(page)).toBe('[[One]] and Two');
});

test('wiki-looking text in inline code, fenced code, math and escaped syntax stays literal', async ({ page }) => {
  for (const line of ['`[[Code]]`', '$[[Math]]$', '\\[[Escaped]]', '![[Embed]]', '[[]]']) {
    await seed(page, line);
    expect(await lineText(page), line).toContain(line.includes('Code') ? '[[Code]]' : line.includes('Math') ? '[[Math]]' : line.replace('\\', ''));
  }
  await page.evaluate(async () => {
    const ed = window.testWikiEditor;
    ed.setValue('```\n[[Fence]]\n```\noutside');
    ed.view.focus(); ed.view.dispatch({ selection: { anchor: ed.getValue().length } });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
  expect(await page.evaluate(() => window.testWikiEditor.view.contentDOM.textContent)).toContain('[[Fence]]');
});

test('code files are not rewritten as wiki links', async ({ page }) => {
  await seed(page, 'const x = "[[Literal]]";');
  await page.evaluate(() => window.testWikiEditor.setFileLanguage('sample.js'));
  expect(await lineText(page)).toContain('[[Literal]]');
});

test('typing inside a revealed link changes only the source at the caret', async ({ page }) => {
  await seed(page, 'see [[Lecture]] end');
  await page.evaluate(() => window.testWikiEditor.view.dispatch({ selection: { anchor: 8 } }));
  await page.keyboard.type('X');
  expect(await page.evaluate(() => window.testWikiEditor.getValue())).toBe('see [[LeXcture]] end\noutside');
});

test('heading-only links and Persian aliases keep their intended visible words', async ({ page }) => {
  await seed(page, 'ببین [[#بخش]] و [[درس#فصل|یادداشت کلاس]]');
  expect(await lineText(page)).toBe('ببین بخش و یادداشت کلاس');
  expect(await page.evaluate(() => window.testWikiEditor.getValue())).toBe('ببین [[#بخش]] و [[درس#فصل|یادداشت کلاس]]\noutside');
  await page.locator('.cm-wikilink').filter({ hasText: 'یادداشت کلاس' }).click();
  expect(await page.evaluate(() => window.wikiOpened)).toEqual([{ target: 'درس', heading: 'فصل' }]);
});

test('empty or incomplete link text never disappears', async ({ page }) => {
  for (const line of ['[[]]', '[[  ]]', '[[Note|]]', '[[Note', '[[|Alias]]']) {
    await seed(page, line);
    expect(await lineText(page), line).toBe(line);
  }
});

test('a selection crossing a link reveals it and blurring hides it again', async ({ page }) => {
  const source = 'one [[Lecture]] two';
  await seed(page, source);
  await page.evaluate(() => window.testWikiEditor.view.dispatch({ selection: { anchor: 0, head: 10 } }));
  expect(await lineText(page)).toBe(source);
  await page.evaluate(() => window.testWikiEditor.view.contentDOM.blur());
  await expect.poll(() => lineText(page)).toBe('one Lecture two');
});

test('Enter after the visible end does not move closing wiki brackets to the new line', async ({ page }) => {
  const line = 'see [[Lecture]]';
  await seed(page, line);
  expect(await lineText(page)).toBe('see Lecture');
  await page.evaluate(() => window.testWikiEditor.view.dispatch({ selection: { anchor: 13 } }));
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.testWikiEditor.getValue())).toBe(`${line}\n\noutside`);
});

test('Enter at a literal wiki-looking closer in code, math or an escape stays where typed', async ({ page }) => {
  for (const line of ['`[[Code]]`', '$[[Math]]$', '\\[[Escaped]]']) {
    await seed(page, line);
    const close = line.indexOf(']]');
    await page.evaluate((head) => window.testWikiEditor.view.dispatch({ selection: { anchor: head } }), close);
    await page.keyboard.press('Enter');
    const result = await page.evaluate(() => window.testWikiEditor.getValue());
    expect(result, line).toBe(`${line.slice(0, close)}\n${line.slice(close)}\noutside`);
  }
});

test('an even number of backslashes does not escape a wiki link', async ({ page }) => {
  await seed(page, String.raw`\\[[Note]]`);
  expect(await lineText(page)).toContain('Note');
  expect(await lineText(page)).not.toContain('[[');
});

test('a tapped position just beyond the end keeps closing brackets when Enter is pressed', async ({ page }) => {
  const line = 'see [[Lecture]]';
  await seed(page, line);
  const point = await page.evaluate(() => {
    const first = window.testWikiEditor.view.contentDOM.querySelector('.cm-line')!;
    const range = document.createRange(); range.selectNodeContents(first);
    const box = range.getBoundingClientRect();
    return { x: box.right + 3, y: box.top + box.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.testWikiEditor.getValue())).toBe(`${line}\n\noutside`);
  expect(await page.evaluate(() => window.wikiOpened)).toEqual([]);
});
