import { expect, test, type Page } from '@playwright/test';

// Colour in the source, for the two things that were grey in it: a fenced
// code block and a formula.
//
// Obsidian paints both while you write — the editor loads a CodeMirror mode
// for the fence's language on demand, and runs the `stex` mode over the text
// between the dollars — while its reading view runs a different highlighter
// (Prism) over the same colours. Satr does the same split: Lezer here,
// highlight.js in the reading view, one --code-* palette.
//
// The formula goes further than Obsidian does, on purpose: `stex` calls
// \frac, \alpha, _ and ^ all one kind of thing and leaves + and = colourless,
// which is two hues under a fence using seven. A backslash word is sorted
// here into structure / function / symbol instead, so the formula is as
// told-apart as the code above it.
//
// What Obsidian does not do at all is say that a formula will not render:
// KaTeX renders with throwOnError: false, so a typo is a silent red formula
// in the preview and in the PDF. Here it is said in colour — never a
// squiggle — the moment the writer is not in the middle of spelling a
// command out.

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
  'Words: $\\begin{cases} y \\end{cases} \\text{so}$ too.',
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
    function: resolve('--code-function'),
    important: resolve('--code-important'),
    operator: resolve('--code-operator'),
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

test('a formula is told apart part by part, as densely as the fence above it', async ({ page }) => {
  await boot(page);
  // LaTeX's kinds are in WHICH command it is, not in the token name, so they
  // are sorted here: a command that takes something (\\frac) from one that IS
  // something (\\alpha) from the scaffolding (\\begin). The rest of the
  // formula gets the palette the reading view gives code, with the names
  // Obsidian uses: numbers --code-value, variables --code-property, _ and ^
  // --code-tag, braces --code-punctuation.
  const command = await paint(page, '\\frac', 'Sound:');
  expect(command.cls).toContain('cm-math-function');
  expect(command.colour).toBe(command.palette.function);
  const symbol = await paint(page, '\\alpha', 'Sound:');
  expect(symbol.cls).toContain('cm-math-symbol');
  expect(symbol.colour).toBe(symbol.palette.important);
  const sub = await paint(page, '_', 'Sound:');
  expect(sub.colour).toBe(sub.palette.tag);
  const plus = await paint(page, '+', 'Sound:');
  expect(plus.colour).toBe(plus.palette.operator);
  const brace = await paint(page, '{', 'Sound:');
  expect(brace.colour).toBe(brace.palette.punctuation);
  const number = await paint(page, '1', 'Sound:');
  expect(number.cls).toContain('cm-math-number');
  expect(number.colour).toBe(number.palette.value);
  const variable = await paint(page, 'x', 'Sound:');
  expect(variable.cls).toContain('cm-math-name');
  expect(variable.colour).toBe(variable.palette.property);
  // The formula uses as many of the palette as the fence does, which is the
  // whole point of sorting the commands.
  const hues = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#app .cm-content .cm-line')]
      .find((element) => (element.textContent ?? '').includes('Sound:'))!;
    return new Set([...row.querySelectorAll('.cm-math-token')]
      .map((element) => getComputedStyle(element).color)).size;
  });
  expect(hues).toBeGreaterThanOrEqual(5);
  // Still monospace and still italic: the colouring is added to what the
  // formula already looked like, not instead of it.
  const style = await page.evaluate(() => {
    const span = [...document.querySelectorAll('#app .cm-content .cm-math-function')]
      .find((element) => element.textContent === '\\frac') as HTMLElement;
    const seen = getComputedStyle(span);
    return { style: seen.fontStyle, family: seen.fontFamily };
  });
  expect(style.style).toBe('italic');
  expect(style.family.toLowerCase()).toMatch(/mono|vazir.?code/);
});

test('an environment is named, and the words inside \\text are words', async ({ page }) => {
  await boot(page);
  const begin = await paint(page, '\\begin', 'Words:');
  expect(begin.cls).toContain('cm-math-keyword');
  expect(begin.colour).toBe(begin.palette.keyword);
  const named = await paint(page, 'cases', 'Words:');
  expect(named.cls).toContain('cm-math-string');
  expect(named.colour).toBe(named.palette.string);
  const words = await paint(page, 'so', 'Words:');
  expect(words.cls).toContain('cm-math-string');
  expect(words.colour).toBe(words.palette.string);
});

test('a formula KaTeX cannot read says so in colour, and says where', async ({ page }) => {
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
    probe.style.color = 'var(--code-value)';
    const value = getComputedStyle(probe).color;
    probe.remove();
    const blamed = element.querySelector('.cm-math-wrong') as HTMLElement | null;
    const digit = [...element.querySelectorAll('.cm-math-token')]
      .find((span) => span.textContent === '1') as HTMLElement | undefined;
    const dollar = element.closest('.cm-line')?.querySelector('.cm-math-delim-wrong') as HTMLElement | null;
    return {
      error,
      value,
      wash: getComputedStyle(element).backgroundColor,
      blamed: blamed?.textContent ?? null,
      blamedColour: blamed ? getComputedStyle(blamed).color : null,
      digitColour: digit ? getComputedStyle(digit).color : null,
      dollarColour: dollar ? getComputedStyle(dollar).color : null,
      decoration: getComputedStyle(element).textDecorationLine,
    };
  });
  // A faint red behind the whole formula — the colour KaTeX will paint it in
  // the reading view and in the PDF — and the dollars in that red.
  expect(look.wash).not.toBe('rgba(0, 0, 0, 0)');
  expect(look.dollarColour).toBe(look.error);
  // The piece it choked on, named: \fracc, not "something in here".
  expect(look.blamed).toBe('\\fracc');
  expect(look.blamedColour).toBe(look.error);
  // ...and the rest of the formula keeps the colouring it was just given.
  expect(look.digitColour).toBe(look.value);
  // No spell-check underline anywhere near it.
  expect(look.decoration).toBe('none');
});

test('the verdict is instant, except on the word being spelled out', async ({ page }) => {
  await boot(page);
  const broken = page.locator('#app .cm-content .cm-math-error');
  await expect(broken).toHaveCount(1);
  // Break the good one by typing in it. \\fracqq is an undefined control
  // sequence the moment the second q lands — but the caret is still inside
  // the word, and \\a, \\al, \\alp are all undefined on the way to \\alpha.
  await place(page, '\\frac{1}', 5);
  await page.keyboard.type('qq');
  await page.waitForTimeout(300);
  expect(await broken.count()).toBe(1);
  // The caret leaving the word is enough — no pause to wait through.
  await page.keyboard.press('ArrowRight');
  await expect(broken).toHaveCount(2, { timeout: 500 });
  // And taking the typo out clears it just as fast.
  await place(page, '\\fracqq{1}', 7);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ArrowRight');
  await expect(broken).toHaveCount(1, { timeout: 500 });
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
