import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

// The space after a sign (src/autoSpace.ts). It is the lazy rule: nothing is
// inserted at the sign, only when the next letter is typed — which is what
// makes the cases Android's own keyboards get wrong (`example.com`,
// `https://…`) fall out of the design instead of needing a list of exceptions.
//
// Typing is done the way a keyboard does it: one `input` transaction per
// character, through CodeMirror's own input pipeline (page.keyboard uses the
// real DOM input path on a contenteditable).
async function mount(page: Page, text = '', at = -1): Promise<void> {
  await page.goto('/');
  await page.evaluate(async ({ text, at }) => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {}, { autoSpace: true });
    window.testEditor.setValue(text);
    window.testEditor.setSelection(at < 0 ? text.length : at);
    window.testEditor.focus();
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, { text, at });
}

const value = (page: Page): Promise<string> => page.evaluate(() => window.testEditor.getValue());

/** Type one character straight into the editable, as a keyboard would. */
async function keys(page: Page, chars: string): Promise<void> {
  for (const char of chars) {
    const code = char === ' ' ? 'Space' : char;
    await page.keyboard.press(code.length === 1 && code !== 'Space' ? code : code, { delay: 0 });
  }
}

test('a comma and the next word get one space between them', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('hello,world');
  expect(await value(page)).toBe('hello, world');
});

test('an exclamation, a colon and the Persian signs do it; a lower-case letter after a full stop does not', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('one.two!three:four؟five،six');
  // "one.two" stays a word — a full stop between lower-case letters is a
  // hostname's, not a sentence's (that is the next test's subject) — while the
  // signs that cannot be part of one put their space in.
  expect(await value(page)).toBe('one.two! three: four؟ five، six');
});

test('the space is not doubled when the writer types one as well', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('hello, ');
  expect(await value(page)).toBe('hello, ');
  await page.keyboard.type('world');
  expect(await value(page)).toBe('hello, world');
});

test('a number keeps its own signs: decimals, thousands and times', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('3.14 and 1,000 and 12:30');
  expect(await value(page)).toBe('3.14 and 1,000 and 12:30');
});

test('a web address is left alone, the way the keyboards cannot manage', async ({ page }) => {
  // Typed in the order the keyboard sees it: the sign, then a letter. Gboard's
  // eager rule turns this into "https: //example. com" — the case its own users
  // report. Here the "/" after the colon answers for the colon (a space is
  // only ever put in front of a letter), and the lower-case "c" after the
  // full stop answers for the full stop.
  await mount(page);
  await page.keyboard.type('https://example.com');
  expect(await value(page)).toBe('https://example.com');
  // A capital after a full stop is a sentence, and does get the space.
  await mount(page);
  await page.keyboard.type('Done.Next');
  expect(await value(page)).toBe('Done. Next');
});

test('a word being continued is not split: example.com', async ({ page }) => {
  // The sign is in the middle of the line, with the rest of the word already
  // after the caret: there is nothing missing to fix.
  await mount(page, 'read example.com today', 13);
  await page.keyboard.type('x');
  expect(await value(page)).toBe('read example.xcom today');
});

test('code and formulas keep their commas', async ({ page }) => {
  // The comma is the last thing on its line, so nothing but "this is code"
  // stands between the rule and a space.
  await mount(page, '```\nf(a,\n```\n', 8);
  await page.keyboard.type('c');
  expect(await value(page)).toBe('```\nf(a,c\n```\n');
  // The same inside a formula: `$a,$` with the caret between the comma and
  // the closing dollar.
  await mount(page, '$a,$', 3);
  await page.keyboard.type('c');
  expect(await value(page)).toBe('$a,c$');
});

test('a digit after the sign is not a word: no space', async ({ page }) => {
  await mount(page);
  await page.keyboard.type('1.2');
  expect(await value(page)).toBe('1.2');
});

test('the setting turns the whole rule off', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.testEditor.setAutoSpace(false));
  await page.keyboard.type('hello,world');
  expect(await value(page)).toBe('hello,world');
  await page.evaluate(() => window.testEditor.setAutoSpace(true));
  await page.keyboard.type('!again');
  expect(await value(page)).toBe('hello,world! again');
});

// The keyboard's own words are left alone: while an IME is composing — and for
// the characters CodeMirror marks as a composition — this rule steps aside.
// A space inserted into the document from underneath a live composition is
// what a WebView shows as spaces breaking and words repeating, and the space
// the keyboard owes is already in the text the keyboard commits.
test('nothing is inserted while the keyboard is holding a word', async ({ page }) => {
  await mount(page, 'hello,', 6);
  await page.evaluate(() => window.testEditor.view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart')));
  await page.evaluate(() => {
    const view = window.testEditor.view;
    view.dispatch({ changes: { from: 6, insert: 'w' }, selection: { anchor: 7 }, userEvent: 'input.type.compose' });
  });
  expect(await value(page)).toBe('hello,w');
  await page.evaluate(() => window.testEditor.view.contentDOM.dispatchEvent(new CompositionEvent('compositionend')));
  // The composition is over; the next plain character is this rule's again.
  await page.evaluate(() => {
    const view = window.testEditor.view;
    view.dispatch({ changes: { from: 7, insert: '!' }, selection: { anchor: 8 }, userEvent: 'input.type' });
  });
  await page.evaluate(() => {
    const view = window.testEditor.view;
    view.dispatch({ changes: { from: 8, insert: 'o' }, selection: { anchor: 9 }, userEvent: 'input.type' });
  });
  // The plain `!` is a sign like any other, so the rule is back on duty for
  // the letter after it — the composition only suspended it.
  expect(await value(page)).toBe('hello,w! o');
});

test('a composed character is left alone even without an open composition', async ({ page }) => {
  await mount(page, 'hello,', 6);
  await page.evaluate(() => {
    const view = window.testEditor.view;
    view.dispatch({ changes: { from: 6, insert: 'w' }, selection: { anchor: 7 }, userEvent: 'input.type.compose' });
  });
  expect(await value(page)).toBe('hello,w');
});
