import { expect, test, type Page } from '@playwright/test';

// Colour in the source, for the two things that were grey in it: a fenced
// code block and a formula.
//
// Obsidian paints both while you write — the editor loads a CodeMirror mode
// for the fence's language on demand, and runs the `stex` mode over the text
// between the dollars — while its reading view runs a different highlighter
// (Prism) over the same colours. Satr does the same split: Lezer here,
// highlight.js in the reading view, one --code-* palette. What Obsidian does
// not do is say that a formula will not render: KaTeX renders with
// throwOnError: false, so a typo is a silent red formula in the preview and
// in the PDF. Here it is underlined where it stands, with KaTeX's own
// complaint on it — except while the caret is inside it, because half of
// what is being typed is briefly wrong.

const NOTE = [
  '# Colour',
  '',
  'A **bold** word and 42 in plain prose.',
  '',
  '```js',
  'const greeting = "hello";',
  '```',
  '',
  'Sound: $\\frac{1}{2} + \\alpha_1 x^2$ stands.',
  '',
  'Typo: $\\fracc{1}{2}$ does not.',
  '',
].join('\n');

async function boot(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((note) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', note);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, NOTE);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
}

/** The colour a piece of text is painted in the editor, with the palette it
 *  should be matched against. `within` picks the line, so the "1" of a
 *  formula is not confused with the "1" of a code block. */
const paint = (page: Page, needle: string, within: string) => page.evaluate(({ text, line }) => {
  const probe = document.createElement('span');
  document.body.appendChild(probe);
  const resolve = (name: string): string => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const palette = {
    keyword: resolve('--code-keyword'),
    value: resolve('--code-value'),
    string: resolve('--code-string'),
    tag: resolve('--code-tag'),
    property: resolve('--code-property'),
    punctuation: resolve('--code-punctuation'),
    comment: resolve('--code-comment'),
    error: resolve('--text-error'),
    normal: resolve('--text-normal'),
  };
  probe.remove();
  const row = [...document.querySelectorAll('#app .cm-content .cm-line')]
    .find((element) => (element.textContent ?? '').includes(line));
  const span = [...(row?.querySelectorAll('span') ?? [])]
    .find((element) => element.textContent === text && !element.querySelector('span')) as HTMLElement | undefined;
  return { palette, colour: span ? getComputedStyle(span).color : null, cls: span?.className ?? null };
}, { text: needle, line: within });

/** Put the caret at an offset into the note's text. */
const place = (page: Page, find: string, plus: number) => page.evaluate(async ({ needle, offset }) => {
  const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
  const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(needle) + offset } });
  view.focus();
}, { needle: find, offset: plus });

test('a fenced block is coloured in the source, in the reading view\'s own code colours', async ({ page }) => {
  await boot(page);
  // The language is fetched when the fence asks for it, so the keyword is
  // not painted on the first frame.
  await expect.poll(async () => (await paint(page, 'const', 'const greeting')).colour)
    .toBe((await paint(page, 'const', 'const greeting')).palette.keyword);
  const string = await paint(page, '"hello"', 'const greeting');
  expect(string.colour).toBe(string.palette.string);
});

test('prose keeps its own colour: the code palette stops at the fence', async ({ page }) => {
  await boot(page);
  await expect.poll(async () => (await paint(page, 'const', 'const greeting')).colour)
    .toBe((await paint(page, 'const', 'const greeting')).palette.keyword);
  // tags.number paints a number inside code. A number in a sentence is a
  // sentence, and the markdown markers around **bold** keep the faint grey
  // they always had.
  const prose = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#app .cm-content .cm-line')]
      .find((element) => (element.textContent ?? '').includes('in plain prose'))!;
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    probe.style.color = 'var(--code-value)';
    const value = getComputedStyle(probe).color;
    probe.remove();
    const coloured = [...row.querySelectorAll('span')]
      .filter((element) => getComputedStyle(element).color === value)
      .map((element) => element.textContent);
    return { value, coloured, text: row.textContent };
  });
  expect(prose.coloured).toEqual([]);
});

test('a formula is told apart in the source, the way Obsidian tells it apart', async ({ page }) => {
  await boot(page);
  // Obsidian's own map, read out of its app.css: .cm-tag → --code-tag for a
  // command and for the _ and ^ that carry one, .cm-bracket →
  // --code-punctuation, .cm-number → --code-value, .cm-variable-2 →
  // --code-property. Which needs the `stexMath` mode, not plain `stex`:
  // outside the dollars the mode only ever sees commands and braces.
  const command = await paint(page, '\\frac', 'Sound:');
  expect(command.cls).toContain('cm-math-command');
  expect(command.colour).toBe(command.palette.tag);
  const sub = await paint(page, '_', 'Sound:');
  expect(sub.colour).toBe(sub.palette.tag);
  const brace = await paint(page, '{', 'Sound:');
  expect(brace.colour).toBe(brace.palette.punctuation);
  const number = await paint(page, '1', 'Sound:');
  expect(number.cls).toContain('cm-math-number');
  expect(number.colour).toBe(number.palette.value);
  const variable = await paint(page, 'x', 'Sound:');
  expect(variable.cls).toContain('cm-math-name');
  expect(variable.colour).toBe(variable.palette.property);
  // Still monospace and still italic: the colouring is added to what the
  // formula already looked like, not instead of it.
  const style = await page.evaluate(() => {
    const span = [...document.querySelectorAll('#app .cm-content .cm-math-command')]
      .find((element) => element.textContent === '\\frac') as HTMLElement;
    const seen = getComputedStyle(span);
    return { style: seen.fontStyle, family: seen.fontFamily };
  });
  expect(style.style).toBe('italic');
  expect(style.family.toLowerCase()).toMatch(/mono|vazir.?code/);
});

test('a formula KaTeX cannot read goes the colour it will be, not a squiggle', async ({ page }) => {
  await boot(page);
  const broken = page.locator('#app .cm-content .cm-math-error');
  await expect(broken).toHaveCount(1);
  await expect(broken).toHaveText('\\fracc{1}{2}');
  await expect(broken).toHaveAttribute('title', /undefined control sequence/i);
  const look = await broken.evaluate((element) => {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    probe.style.color = 'var(--text-error)';
    const error = getComputedStyle(probe).color;
    probe.remove();
    const token = element.querySelector('.cm-math-token') as HTMLElement;
    return {
      error,
      colour: getComputedStyle(element).color,
      tokenColour: token ? getComputedStyle(token).color : null,
      decoration: getComputedStyle(element).textDecorationLine,
    };
  });
  // The colour KaTeX will paint it in the reading view and in the PDF —
  // and the parts inside give up their own colours to it, so the formula
  // reads as one red thing rather than a half-coloured one.
  expect(look.colour).toBe(look.error);
  expect(look.tokenColour).toBe(look.error);
  // No spell-check underline anywhere near it.
  expect(look.decoration).toBe('none');
});

test('the formula being typed is left alone until the writing stops', async ({ page }) => {
  await boot(page);
  const broken = page.locator('#app .cm-content .cm-math-error');
  await expect(broken).toHaveCount(1);
  // Break the good one by typing in it: nothing is said while the keys are
  // still coming.
  await place(page, '\\frac{1}', 5);
  await page.keyboard.type('qq');
  expect(await broken.count()).toBe(1);
  // ...and once the writing stops, it is said — caret still inside it.
  await expect(broken).toHaveCount(2, { timeout: 3000 });
  // Taking the typo out clears it again, after the same pause.
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(broken).toHaveCount(1, { timeout: 3000 });
});

test('fixing the typo clears the colour', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#app .cm-content .cm-math-error')).toHaveCount(1);
  await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    const at = view.state.doc.toString().indexOf('\\fracc') + 5;
    view.dispatch({ changes: { from: at, to: at + 1 } });
    view.dispatch({ selection: { anchor: 2 } });
  });
  await expect(page.locator('#app .cm-content .cm-math-error')).toHaveCount(0);
});
