// A marker pair keeps its look while a space is the last thing inside it.
//
// Reported: "forgiving not only for highlight, and the reason I want it is
// because it flickers with spaces."
//
// The flicker is per keystroke, and it is the parser being right: CommonMark
// says a closing delimiter may not be preceded by whitespace, so the moment a
// space is typed as the last character inside `==one two ==` the Highlight
// node disappears — the highlight colour goes, and (with the caret elsewhere)
// the two `==` come back as text — and the next letter brings both back. Every
// space typed inside a marker pair blinks it off and on.
//
// So the source view draws a pair whose content ends in a run of spaces anyway,
// provided the pair without that run would parse: `==one two ==` looks like
// `==one two==` while it is being written. The reading view is untouched — it
// keeps Obsidian's published rule, and a space before the closing `==` there
// still means no `<mark>`.
import { expect, test } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await window.__satr.load('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {});
    await document.fonts.ready;
  });
});

type Look = {
  /** The line as drawn, markers and all. A hidden marker is not in here. */
  text: string;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  highlight: boolean;
};

/** The line holding `needle`, as it is painted. `caret` puts the caret on that
 *  line — the writing state, where markers are shown — instead of leaving the
 *  editor unfocused, which is the state a finished note is left in. */
async function look(page: import('@playwright/test').Page, text: string, needle: string, caret?: number): Promise<Look> {
  return page.evaluate(async ({ text, needle, caret }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    if (caret === undefined) ed.view.contentDOM.blur();
    else {
      ed.view.focus();
      ed.view.dispatch({ selection: { anchor: caret } });
    }
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const lines = [...ed.view.contentDOM.querySelectorAll('.cm-line')] as HTMLElement[];
    const line = lines.find((one) => one.textContent!.includes(needle))!;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !(node.textContent ?? '').includes(needle)) node = walker.nextNode();
    const host = (node?.parentElement ?? line) as HTMLElement;
    const style = getComputedStyle(host);
    return {
      text: line.textContent ?? '',
      bold: Number(style.fontWeight) >= 600,
      italic: style.fontStyle === 'italic',
      strike: style.textDecorationLine.includes('line-through'),
      code: /mono/i.test(style.fontFamily),
      highlight: style.backgroundColor !== 'rgba(0, 0, 0, 0)',
    };
  }, { text, needle, caret });
}

// What a space before the closer does today, in both states the writer is in.
// The caret sits at the end of the line being written (the case that flickers
// per keystroke) and then leaves, which is where the markers hide.
for (const [name, line, needle, kind, mark] of [
  ['highlight', 'a ==one two == b', 'one two', 'highlight', '=='],
  ['bold', 'a **one two ** b', 'one two', 'bold', '**'],
  ['italic', 'a *one two * b', 'one two', 'italic', '*'],
  ['strike', 'a ~~one two ~~ b', 'one two', 'strike', '~~'],
] as const) {
  test(`${name} with a trailing space inside keeps its look while it is typed`, async ({ page }) => {
    const writing = await look(page, `${line}\nx`, needle, line.length + 2);
    expect(writing[kind], `${name}: the caret is on the line, between the marks`).toBe(true);
  });

  test(`${name} with a trailing space inside keeps its look when the caret leaves`, async ({ page }) => {
    const done = await look(page, `${line}\nx`, needle);
    expect(done[kind], `${name}: the caret is elsewhere`).toBe(true);
    expect(done.text, `${name}: the marks are hidden on a line the caret is not on`).not.toContain(mark);
    expect(done.text.trim(), `${name}: the words are still there`).toContain('one two');
  });
}

test('a code span already keeps a trailing space inside, in both states', async ({ page }) => {
  const writing = await look(page, 'a `one two ` b\nx', 'one two', 16);
  expect(writing.code, 'code: the caret is on the line').toBe(true);
  const done = await look(page, 'a `one two ` b\nx', 'one two');
  expect(done.code, 'code: the caret is elsewhere').toBe(true);
  expect(done.text, 'code: the backticks are hidden').not.toContain('`');
});

// The other half of the rule: forgiving a trailing space must not make a
// multiplication sign into italics, or a stray pair of marks into emphasis the
// reading view would never draw. The pair without its trailing run is what has
// to parse — `* b *` without it is still not emphasis, so it stays plain.
test('a space on both sides of the words is not forgiving', async ({ page }) => {
  const spaced = await look(page, 'a * b * c\nx', 'b');
  expect(spaced.italic, '`* b *` is a multiplication sign, not italics').toBe(false);
  const spacedBold = await look(page, 'a ** b ** c\nx', 'b');
  expect(spacedBold.bold, '`** b **` is not bold').toBe(false);
  const spacedMark = await look(page, 'a == b == c\nx', 'b');
  expect(spacedMark.highlight, '`== b ==` is not a highlight').toBe(false);
});

test('an escaped pair is not forgiving', async ({ page }) => {
  const escaped = await look(page, 'a \\==one two == b\nx', 'one two');
  expect(escaped.highlight, 'a backslash in front of the opening `==`').toBe(false);
});

test('a pair inside a formula stays a character of the formula', async ({ page }) => {
  const inMath = await look(page, 'a $==one two ==$ b\nx', 'one two');
  expect(inMath.highlight, 'inside `$…$` nothing is markdown').toBe(false);
});

test('a pair inside a fenced block stays code', async ({ page }) => {
  const fenced = await look(page, '```\n==one two ==\n```\nx', 'one two');
  expect(fenced.highlight, 'inside a fence nothing is markdown').toBe(false);
});

test('the look does not blink on each space while a pair is typed', async ({ page }) => {
  await page.evaluate(async () => {
    const ed = window.testEditor;
    ed.setValue('');
    ed.view.focus();
    ed.view.dispatch({ selection: { anchor: 0 } });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
  const samples: Array<{ typed: string; text: string; lit: boolean }> = [];
  for (const typed of '==one two three') {
    await page.keyboard.type(typed);
    await page.waitForTimeout(30);
    samples.push(await page.evaluate((typed) => {
      // The words themselves, in this editor — not the app's own note behind
      // it, and not the caret's little span: a caret is a coloured rectangle
      // too, and counting it would call every keystroke lit.
      const line = window.testEditor.view.contentDOM.querySelector('.cm-line') as HTMLElement;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let words: Text | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (/[^=\s]/.test(node.textContent ?? '')) { words = node as Text; break; }
      }
      const host = words?.parentElement ?? null;
      return {
        typed,
        text: line.textContent ?? '',
        lit: host ? getComputedStyle(host).backgroundColor !== 'rgba(0, 0, 0, 0)' : false,
      };
    }, typed));
  }
  // Every keystroke that leaves a word between the marks — including the ones
  // that leave a space there — has to be lit. On the day this was written the
  // spaces were dark: `==one ==` was not a highlight at all.
  const dark = samples.filter((one) => /==\S[\s\S]*==/.test(one.text) && !one.lit);
  expect(dark, `keystrokes where the highlight went out`).toEqual([]);
});

test('the reading view still refuses a space before the closing mark', async ({ page }) => {
  // The half that must not move: Obsidian's published output has no <mark> for
  // `==one two ==`, and neither does Satr's reading view. The editor is the
  // forgiving one, on purpose.
  const out = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    return renderMarkdown('a ==one two == b\n\na ==one two== b');
  });
  const marks = out.match(/<mark[^>]*>/g) ?? [];
  expect(marks.length, 'one <mark>, for the pair with no space before the closer').toBe(1);
  expect(out, 'the spaced pair stays as typed').toContain('==one two ==');
});

// The other half of the same complaint: "there's a difference between when
// there is a space or not when typing ... when there's not the == icons
// themselves get a little highlighted too, same with any other marker thing."
//
// The parser dresses the whole node, marks included, so with the caret on the
// line the `==` sits on the same yellow as the words it holds, a `**` is bold,
// a `~~` is struck. That is the look that already worked, and it stays. A
// forgiven pair has no node to dress it, so its marks used to carry nothing at
// all — and the two states of the same pair were two pictures. The marks of a
// forgiven pair are now dressed the same way, dimming included.

type Runs = Array<{ text: string; weight: string; style: string; deco: string; bg: string; opacity: string }>;

/** The line as painted, text run by text run, with the caret inside the pair
 *  so the marks are showing. */
async function runs(page: import('@playwright/test').Page, line: string): Promise<{ drawn: string; runs: Runs }> {
  return page.evaluate(async (line) => {
    const ed = window.testEditor;
    ed.setValue(line);
    ed.view.focus();
    ed.view.dispatch({ selection: { anchor: line.indexOf('one') + 1 } });
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const el = ed.view.contentDOM.querySelector('.cm-line') as HTMLElement;
    const out: Runs = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const host = (node.parentElement ?? el) as HTMLElement;
      const style = getComputedStyle(host);
      out.push({
        text: node.textContent ?? '',
        weight: style.fontWeight,
        style: style.fontStyle,
        deco: style.textDecorationLine,
        bg: style.backgroundColor,
        opacity: style.opacity,
      });
    }
    return { drawn: el.textContent ?? '', runs: out };
  }, line);
}

/** The one property a pair's look is made of. */
function lookOf(run: Runs[number], kind: string): string {
  if (kind === 'highlight') return run.bg;
  if (kind === 'bold') return run.weight;
  if (kind === 'italic') return run.style;
  return run.deco;
}

for (const [name, pair, mark, kind] of [
  ['highlight', 'a ==one== b', '==', 'highlight'],
  ['bold', 'a **one** b', '**', 'bold'],
  ['italic', 'a *one* b', '*', 'italic'],
  ['strike', 'a ~~one~~ b', '~~', 'strike'],
] as const) {
  test(`the ${name} marks wear the same look as the words`, async ({ page }) => {
    // Both states of the pair, because the one with a space in front of its
    // closer is the one being brought up to the other.
    for (const line of [pair, pair.replace(`one${mark}`, `one ${mark}`)]) {
      const { runs: painted } = await runs(page, line);
      const marker = painted.filter((one) => one.text === mark);
      const words = painted.find((one) => one.text.startsWith('one'));
      expect(marker.length, `${name}: both marks are on the line in ${JSON.stringify(line)}`).toBe(2);
      expect(words, `${name}: the words are one run`).toBeTruthy();
      for (const one of marker) {
        expect(lookOf(one, kind), `${name}: a mark is dressed like the words it holds in ${JSON.stringify(line)}`).toBe(lookOf(words!, kind));
        expect(one.opacity, `${name}: and dimmed, as the parser's own mark is`).toBe('0.42');
      }
    }
  });

  test(`the ${name} marks look the same with a space inside the pair or without`, async ({ page }) => {
    // The reported difference, measured on the same word in the same place,
    // with one space in front of the closer.
    const closed = await runs(page, pair);
    const spaced = await runs(page, pair.replace(`one${mark}`, `one ${mark}`));
    const marksOf = (painted: Runs) => painted.filter((one) => one.text === mark)
      .map(({ weight, style, deco, bg, opacity }) => ({ weight, style, deco, bg, opacity }));
    expect(marksOf(spaced.runs).length, `${name}: the spaced pair still has two marks`).toBe(2);
    expect(marksOf(spaced.runs), `${name}: the marks are drawn identically either way`).toEqual(marksOf(closed.runs));
    const wordsOf = (painted: Runs) => painted.find((one) => one.text.startsWith('one'));
    expect(wordsOf(spaced.runs)!.bg, `${name}: the words keep their look too`).toBe(wordsOf(closed.runs)!.bg);
  });
}

test('the spaces inside a highlight are part of it', async ({ page }) => {
  // "The spaces too should be highlighted, no exception for them": the colour
  // runs from one `==` to the other, so there is no untinted gap in front of
  // the closer.
  const spaced = await runs(page, 'a ==one two == b');
  const lit = spaced.runs.filter((one) => one.bg !== 'rgba(0, 0, 0, 0)');
  expect(lit.length, 'three tinted runs: the two == and everything between them').toBe(3);
  expect(lit[1].text, 'the tinted run reaches the space before the closer').toBe('one two ');
  const closed = await runs(page, 'a ==one two== b');
  expect(closed.runs.filter((one) => one.bg !== 'rgba(0, 0, 0, 0)')[1].text, 'and without a space, the words alone').toBe('one two');
});

test('the spaces are covered in a strike too', async ({ page }) => {
  // The same inside, so the line through a struck pair is one line and not one
  // with a gap at the end of it.
  const spaced = await runs(page, 'a ~~one two ~~ b');
  expect(spaced.runs.filter((one) => one.deco.includes('line-through'))[1].text).toBe('one two ');
});
