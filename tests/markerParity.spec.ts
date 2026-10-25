// A marker is a marker in either script, wherever a list may sit.
//
// Reported: "the `> ۱.` is a list and even gets treated as one in display, but
// in source mode it isn't… where else isn't it like this? Do tables have
// lists? I think right now `۱.` is only treated as a list in a new line rather
// than other places unlike `1.`"
//
// Where it stood: CommonMark counts an ordered list by ASCII digits only, so
// the editor's parser read `۱. یک` as a paragraph — no hanging indent, no
// marker strip, nothing but a dimmed marker the editor painted itself. And a
// list inside a quote was skipped by the live preview on purpose, in both
// scripts. The reading view had neither split, because src/markdown.ts
// rewrites a marker to ASCII before marked sees it. The parser does the same
// now (src/markerParse.ts), so there is one definition of a list again.
//
// What a table cell does is not a gap: markdown has no block lists in cells,
// `1.` is plain text there, and `۱.` is plain text with it. That parity is the
// answer, not a feature to invent.
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

/** What the editor makes of a line: the classes it gives it, how far a
 *  wrapped row is carried in, and whether the marker got the strip. */
async function look(page: import('@playwright/test').Page, text: string, line: number) {
  return page.evaluate(async ({ text, line }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const target = ed.view.state.doc.line(line);
    const dom = ed.view.domAtPos(target.from).node as HTMLElement;
    const el = (dom.nodeType === 3 ? dom.parentElement! : dom).closest('.cm-line') as HTMLElement;
    const style = getComputedStyle(el);
    return {
      classes: [...el.classList].filter((one) => one !== 'cm-line').sort().join(' '),
      indent: style.paddingInlineStart,
      hanging: style.textIndent,
      strip: Boolean(el.querySelector('.cm-lp-marker')),
    };
  }, { text, line });
}

// One row per place a marker can legally stand. Each is written twice, once
// in each script, and the two have to come out the same.
const CONTEXTS: Array<[string, string, string, number]> = [
  ['on its own line', '1. one\n2. two', '۱. یک\n۲. دو', 1],
  ['indented', '  1. one\n  2. two', '  ۱. یک\n  ۲. دو', 1],
  ['under a bullet', '- a\n    1. one', '- a\n    ۱. یک', 2],
  ['in a quote', '> 1. one\n> 2. two', '> ۱. یک\n> ۲. دو', 1],
  ['in a quote in a quote', '> > 1. one', '> > ۱. یک', 1],
  ['written with a paren', '1) one\n2) two', '۱) یک\n۲) دو', 1],
  ['in a table cell', '| x | y |\n| --- | --- |\n| 1. one | z |', '| x | y |\n| --- | --- |\n| ۱. یک | z |', 3],
];

for (const [where, english, persian, line] of CONTEXTS) {
  test(`a number is a list marker in either script: ${where}`, async ({ page }) => {
    const latin = await look(page, english, line);
    const farsi = await look(page, persian, line);
    expect(farsi, where).toEqual(latin);
  });
}

test('a list in a quote is a list, and keeps both indents', async ({ page }) => {
  const quoted = await look(page, '> 1. one is a long enough line to wrap more than once in this pane\n> 2. two', 1);
  // The quote's step (26px) carries the text past the rule, the list's
  // gutter (3ch) carries a wrapped row under the text.
  expect(quoted.classes).toBe('cm-lp-list-line cm-lp-quote');
  expect(quoted.strip).toBe(true);
  expect(quoted.indent).toBe('53px');
  expect(quoted.hanging).toBe('-53px');
  // And a second quote is a second step.
  const deeper = await look(page, '> > 1. one\n> > 2. two', 1);
  expect(deeper.indent).toBe('79px');
});

test('a table cell is prose in both scripts — the same prose', async ({ page }) => {
  const latin = await look(page, '| x | y |\n| --- | --- |\n| 1. one | z |', 3);
  expect(latin.strip).toBe(false);
  expect(latin.classes).toBe('');
});

/** Press Enter where the caret is. */
async function enterAt(page: import('@playwright/test').Page, text: string, caret: number): Promise<string> {
  return page.evaluate(async ({ text, caret }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    ed.focus();
    ed.setSelection(caret);
    await new Promise((r) => requestAnimationFrame(r));
    ed.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    return ed.getValue();
  }, { text, caret });
}

test('Enter carries a quoted list on, quote marks and all', async ({ page }) => {
  expect(await enterAt(page, '> 1. one', 8)).toBe('> 1. one\n> 2. ');
  expect(await enterAt(page, '> ۱. یک', 7)).toBe('> ۱. یک\n> ۲. ');
  expect(await enterAt(page, '> - one', 7)).toBe('> - one\n> - ');
  expect(await enterAt(page, '> - [ ] one', 11)).toBe('> - [ ] one\n> - [ ] ');
});

test('Enter on an empty quoted item clears the item, not the quote', async ({ page }) => {
  // Leaving a list inside a quote leaves the list, not the quote.
  expect(await enterAt(page, '> 1. one\n> 2. ', 14)).toBe('> 1. one\n> ');
  expect(await enterAt(page, '> - ', 4)).toBe('> ');
  // Outside a quote there is nothing to keep, as before.
  expect(await enterAt(page, '- one\n- ', 8)).toBe('- one\n');
});

test('a quoted list numbers itself', async ({ page }) => {
  // The run answers for a new item the same inside a quote as outside it.
  expect(await enterAt(page, '> 1. one\n> 5. five', 8)).toBe('> 1. one\n> 2. \n> 3. five');
  expect(await enterAt(page, '> ۱. یک\n> ۵. پنج', 7)).toBe('> ۱. یک\n> ۲. \n> ۳. پنج');
  // And a list outside a quote is not the quoted one's business.
  expect(await enterAt(page, '> 1. one\n2. two', 8)).toBe('> 1. one\n> 2. \n2. two');
});

test('the caret on an item with nothing on it yet stands where its text will', async ({ page }) => {
  // Reported: the caret "rests behind" on an empty `- ` or `- [ ] ` line. The
  // marker strip is wider than the marker written in it, and the room left
  // over used to sit after the text, so the caret was drawn against the
  // bullet and the first letter landed somewhere else.
  const places = await page.evaluate(async () => {
    const ed = window.testEditor;
    const out: Record<string, { caret: number; typed: number }> = {};
    for (const [name, text, at] of [
      ['bullet', '- ', 2], ['task', '- [ ] ', 6], ['number', '1. ', 3], ['persian', '۱. ', 3],
    ] as Array<[string, string, number]>) {
      ed.setValue(text);
      ed.focus();
      ed.setSelection(at);
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const line = ed.view.coordsAtPos(0)!;
      const caret = ed.view.coordsAtPos(at)!.left - line.left;
      ed.view.dispatch({ changes: { from: at, insert: 'W' }, selection: { anchor: at } });
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      out[name] = { caret: Math.round(caret), typed: Math.round(ed.view.coordsAtPos(at)!.left - line.left) };
    }
    return out;
  });
  for (const [name, place] of Object.entries(places)) {
    expect(place.caret, `${name}: the caret stands where the next letter lands`).toBe(place.typed);
  }
});
