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
  '// a greeting',
  'const greeting = "hello";',
  'let n = 42 + count;',
  '```',
  '',
  'Sound: $\\frac{1}{2} + \\alpha_1 x^2$ stands.',
  '',
  'Words: $\\begin{cases} y \\end{cases} \\text{so}$ too.',
  '',
  'Others: $\u0645\u062a\u0646 + \u03b1 + 2$ as well.',
  '',
  'Typo: $\\fracc{1}{2}$ does not.',
  '',
  'Empty: $\\frac$ has no parts at all.',
  '',
  '```toml',
  'key = "value"',
  '```',
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

/** Every character of the fenced code, grouped into runs of one colour:
 *  [['const', 'keyword'], [' greeting = ', 'plain'], …]. Two highlighters
 *  will never agree on where a span starts, so the comparison is made per
 *  character and the runs are rebuilt afterwards. */
const fencePaint = (page: Page, root: string, lines: string[]) => page.evaluate(({ where, want }) => {
  const probe = document.createElement('span');
  document.body.appendChild(probe);
  const paint: Record<string, string> = {};
  for (const name of ['keyword', 'function', 'important', 'operator', 'value', 'string', 'tag', 'property', 'punctuation', 'comment']) {
    probe.style.color = `var(--code-${name})`;
    paint[getComputedStyle(probe).color] = name;
  }
  probe.style.color = 'var(--text-normal)';
  paint[getComputedStyle(probe).color] = 'plain';
  probe.remove();
  const out: [string, string][][] = [];
  for (const wanted of want) {
    const host = [...document.querySelectorAll(where)]
      .find((element) => (element.textContent ?? '').includes(wanted));
    const runs: [string, string][] = [];
    const walk = (node: Node, colour: string): void => {
      if (node.nodeType === 3) {
        for (const ch of node.textContent ?? '') {
          if (!ch.trim()) continue; // the two lay their whitespace out differently
          const last = runs[runs.length - 1];
          if (last && last[1] === colour) last[0] += ch;
          else runs.push([ch, colour]);
        }
        return;
      }
      const own = paint[getComputedStyle(node as HTMLElement).color] ?? 'other';
      for (const child of node.childNodes) walk(child, own);
    };
    if (host) {
      // Only the line that was asked for, out of the block it sits in.
      const row = host.textContent ?? '';
      const line = row.split('\n').find((piece) => piece.includes(wanted)) ?? '';
      walk(host, 'plain');
      const text = runs.map(([run]) => run).join('');
      const only = line.replace(/\s+/g, '');
      const at = text.indexOf(only);
      let seen = 0;
      const kept: [string, string][] = [];
      for (const [run, colour] of runs) {
        const from = Math.max(at - seen, 0);
        const to = Math.min(at + only.length - seen, run.length);
        if (to > from) kept.push([run.slice(from, to), colour]);
        seen += run.length;
      }
      out.push(kept);
    } else out.push([]);
  }
  return out;
}, { where: root, want: lines });

test('a fence is one picture: the source and the reading view paint it the same', async ({ page }) => {
  await boot(page);
  // The language is fetched when the fence asks for it, so the keyword is
  // not painted on the first frame.
  await expect.poll(async () => (await paint(page, 'const', 'const greeting')).colour)
    .toBe((await paint(page, 'const', 'const greeting')).palette.keyword);
  const rows = ['// a greeting', 'const greeting', 'let n = 42'];
  const source = await fencePaint(page, '#app .cm-content .cm-line', rows);
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#app .preview-pane pre code').first()).toBeVisible();
  const reading = await fencePaint(page, '#app .preview-pane pre code', rows);
  // One highlighter, one palette: the reading view runs the editor's own
  // Lezer grammars over the editor's own table of colours
  // (src/codeHighlight.ts). Keywords, strings, numbers, functions,
  // properties and comments are named; punctuation, operators and bare names
  // are left as text. The same fence cannot be two pictures.
  expect(source).toEqual(reading);
  expect(source[1]).toEqual([['const', 'keyword'], ['greeting=', 'plain'], ['"hello"', 'string'], [';', 'plain']]);
});

test('a language only the editor used to know is painted in the page too', async ({ page }) => {
  await boot(page);
  // highlight.js's common bundle knew 36 languages; the editor's grammars
  // number about 150. toml was one of the ~110 that were painted while
  // writing and flat grey when read.
  await expect.poll(async () => (await paint(page, 'key', 'key = ')).colour)
    .toBe((await paint(page, 'key', 'key = ')).palette.property);
  const source = await fencePaint(page, '#app .cm-content .cm-line', ['key = "value"']);
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#app .preview-pane pre code').first()).toBeVisible();
  await expect.poll(() => fencePaint(page, '#app .preview-pane pre code', ['key = "value"'])).toEqual(source);
  expect(source[0]).toEqual([['key', 'property'], ['=', 'plain'], ['"value"', 'string']]);
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

test('a formula is written in more than Latin, and is coloured in more than Latin', async ({ page }) => {
  await boot(page);
  // A Latin-only test for "is this a letter" left a Persian formula — and a
  // Greek character typed straight in rather than spelled \\alpha — with no
  // colour at all. Arabic-script runs are not variables: renderMath wraps
  // them in \\text{…} before KaTeX sees them, so they are words in the
  // formula and they are coloured as words.
  const persian = await paint(page, '\u0645\u062a\u0646', 'Others:');
  expect(persian.cls).toContain('cm-math-string');
  expect(persian.colour).toBe(persian.palette.string);
  const greek = await paint(page, '\u03b1', 'Others:');
  expect(greek.cls).toContain('cm-math-name');
  expect(greek.colour).toBe(greek.palette.property);
  const digit = await paint(page, '2', 'Others:');
  expect(digit.colour).toBe(digit.palette.value);
});

test('a formula KaTeX cannot read says so in colour, and says where', async ({ page }) => {
  await boot(page);
  const broken = page.locator('#app .cm-content .cm-math-error');
  await expect(broken).toHaveCount(2);
  const typo = broken.filter({ hasText: 'fracc' });
  await expect(typo).toHaveAttribute('title', '\\fracc is not a command');
  const look = await typo.evaluate((element) => {
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

test('a complaint with no width still points at something', async ({ page }) => {
  await boot(page);
  // "\\frac" with no arguments is reported by KaTeX at the END of the
  // formula, with a length of zero — a point with nothing under it. The
  // formula went red with nothing in it marked, which says no more than
  // "something here is wrong". It is pinned on the last token before the
  // point instead, which here is \\frac itself.
  const empty = page.locator('#app .cm-content .cm-math-error').filter({ hasText: 'frac' }).last();
  await expect(empty).toHaveText('\\frac');
  await expect(empty.locator('.cm-math-wrong')).toHaveText('\\frac');
});

test('the reason is readable without a mouse, at the top of the screen', async ({ page }) => {
  await boot(page);
  // The colour says WHERE. KaTeX's reason rides in a `title`, and a title is
  // a hover, which this device does not have — so it is said at the top, for
  // as long as the caret is in the formula, and in as few words as it can be
  // said in: one line, nowhere near the hands or the line being written.
  const said = page.locator('.notice');
  await place(page, 'in plain prose', 2);
  await expect(said).toHaveCount(0);
  await place(page, '\\fracc{1}', 8);
  await expect(said).toHaveText('\\fracc is not a command');
  await place(page, 'in plain prose', 2);
  await expect(said).toHaveCount(0);
});

test('the verdict is instant, and no caret position hides it', async ({ page }) => {
  await boot(page);
  const broken = page.locator('#app .cm-content .cm-math-error');
  await expect(broken).toHaveCount(2);
  // Typing a bad command name says so on the keystroke that makes it bad,
  // with the caret still inside the word — which is exactly where the
  // writer is standing when they want to be told.
  await place(page, '\\frac{1}', 5);
  await page.keyboard.type('qq');
  await expect(broken).toHaveCount(3, { timeout: 400 });
  // And no caret position anywhere in a marked formula takes the mark away.
  // Two goes at "do not nag while it is being written" — a pause after the
  // last keystroke, then a test for the word the caret was in the middle of
  // — both failed in the same place: the caret is inside the bad word
  // exactly when the writer has gone there to look at it, so the complaint
  // disappeared on the line being worked on and came back once they left.
  const gone = await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    const doc = view.state.doc.toString();
    const from = doc.indexOf('$\\fracc');
    const to = doc.indexOf('$', from + 1) + 1;
    const wait = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const missing: string[] = [];
    for (let at = from; at <= to; at += 1) {
      view.dispatch({ selection: { anchor: at } });
      await wait();
      if (document.querySelectorAll('#app .cm-content .cm-math-error').length < 3) {
        missing.push(`${at - from}${JSON.stringify(doc.slice(at, at + 1))}`);
      }
    }
    view.dispatch({ selection: { anchor: 0 } });
    return missing;
  });
  expect(gone).toEqual([]);
});

test('fixing the typo clears the colour', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#app .cm-content .cm-math-error')).toHaveCount(2);
  await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    const at = view.state.doc.toString().indexOf('\\fracc') + 5;
    view.dispatch({ changes: { from: at, to: at + 1 } });
    view.dispatch({ selection: { anchor: 2 } });
  });
  await expect(page.locator('#app .cm-content .cm-math-error')).toHaveCount(1);
});
