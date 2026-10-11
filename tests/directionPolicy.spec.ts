import { expect, test } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

// Items 17 and 18: a line has ONE direction, and the caret lives in it.
//
// 17 — the caret keeps the LINE's side, always: the side comes from the
//      line's first letter and never from the character just typed, so within
//      one line the caret never doubles back. In a Persian line it stays left
//      of the text the line just grew — through digits, spaces and English
//      words alike — and in an English line right of it, the way a phone's own
//      text fields behave.
// 18 — a new line continues the line above it (a `#`, a list marker or a
//      date never flips it), and a line's direction is only re-decided when
//      real prose of the other language appears in it.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await window.__satr.load('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000;font-size:16px';
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {});
    await document.fonts.ready;
  });
});

async function typeAt(page: import('@playwright/test').Page, before: string, text: string) {
  return page.evaluate(async ({ before, text }) => {
    const editor = window.testEditor;
    const pos = before.indexOf('|');
    editor.setValue(before.replace('|', ''));
    editor.setSelection(pos);
    editor.focus();
    await new Promise((r) => requestAnimationFrame(r));
    return pos;
  }, { before, text });
}

async function caret(page: import('@playwright/test').Page) {
  // The side is part of the edit's own transaction now, but CodeMirror draws
  // the caret on its next measure pass, so read a frame later.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => {
    const view = window.testEditor.view;
    const sel = view.state.selection.main;
    const rect = view.coordsAtPos(sel.head, sel.assoc);
    const left = view.coordsAtPos(sel.head, -1);
    const right = view.coordsAtPos(sel.head, 1);
    return {
      head: sel.head,
      x: rect ? Math.round(rect.left) : null,
      min: left && right ? Math.round(Math.min(left.left, right.left)) : null,
      max: left && right ? Math.round(Math.max(left.left, right.left)) : null,
      split: left && right ? Math.abs(left.left - right.left) >= 1 : false,
    };
  });
}

test('a digit typed in a Persian line keeps the caret on the line’s side', async ({ page }) => {
  // The complaint: writing Persian, the caret sits left of the text, but a
  // number pushed it to the right. A number is weak — it follows the line.
  await typeAt(page, 'سلام |', '');
  await page.keyboard.insertText('خ');
  await page.keyboard.insertText('5');
  const digit = await caret(page);
  await page.keyboard.insertText('6');
  const second = await caret(page);
  expect(await page.evaluate(() => window.testEditor.getValue())).toBe('سلام خ56');
  expect(digit.split).toBe(true);
  expect(digit.x, 'digit').toBe(digit.min); // the digit's left, the line's side
  expect(second.split).toBe(true);
  expect(second.x, 'second digit').toBe(second.min);

  // Even a Latin letter appended to the line does not flip the caret: the
  // line decides, so an English word typed inside Persian continues to the
  // left of the run the way the line flows.
  await page.keyboard.insertText('a');
  const latin = await caret(page);
  expect(await page.evaluate(() => window.testEditor.getValue())).toBe('سلام خ56a');
  expect(latin.x, 'Latin run').toBe(latin.min); // the line still decides
});

test('an English line keeps its caret on the right, even after a Persian word', async ({ page }) => {
  await typeAt(page, 'hello |', '');
  await page.keyboard.insertText('x');
  const first = await caret(page);
  await page.keyboard.insertText('ش');
  const persian = await caret(page);
  expect(await page.evaluate(() => window.testEditor.getValue())).toBe('hello xش');
  // An LTR line keeps the caret on the right of what it grew — the Persian
  // letter does not carry the caret over to the run's own side.
  for (const [name, state] of [['Latin', first], ['Persian word', persian]] as const) {
    if (!state.split) continue;
    expect(state.x, name).toBe(state.max);
  }
});

// The rule the writer asked for, as a property: within one line the caret
// never goes right and left. Typed one key at a time, a mixed Persian line's
// caret moves leftwards only, and an English line's rightwards only — for
// digits, spaces, Latin words and a Backspace across a Latin run alike.
test('typing a mixed line never doubles the caret back', async ({ page }) => {
  const walk = async (before: string, keys: string[]) => {
    await page.evaluate(({ before }) => {
      const pos = before.indexOf('|');
      window.testEditor.setValue(before.replace('|', ''));
      window.testEditor.setSelection(pos);
      window.testEditor.focus();
    }, { before });
    await page.waitForTimeout(50);
    const seen: { key: string; text: string; x: number; assoc: number }[] = [];
    for (const key of keys) {
      if (key === '\b') await page.keyboard.press('Backspace');
      else await page.keyboard.insertText(key);
      const state = await page.evaluate(() => {
        const view = window.testEditor.view;
        const sel = view.state.selection.main;
        const rect = view.coordsAtPos(sel.head, sel.assoc);
        return { x: rect ? rect.left : NaN, assoc: sel.assoc, text: view.state.doc.toString() };
      });
      seen.push({ key, ...state });
    }
    return seen;
  };

  const xs = (states: { x: number }[]) => JSON.stringify(states.map((s) => Math.round(s.x)));
  const persian = await walk('سلام |', ['خ', '5', '6', ' ', 'h', 'e', 'l', 'l', 'o', ' ', 'ب', '\b', 'ی']);
  expect(persian.at(-1)!.text).toBe('سلام خ56 hello ی'); // the Backspace ate the ب
  // Insertions only: the caret walks left, never back to the right. (A
  // deletion is allowed to move it — the line is shorter now — but the side
  // below must still hold through it.)
  let last = persian[0];
  for (const state of persian) {
    // The deletion step is the new baseline, not a move to be judged.
    if (state.key !== '\b') expect(state.x, `after ${JSON.stringify(state.key)}: ${xs(persian)}`).toBeLessThanOrEqual(last.x + 0.5);
    last = state;
  }
  // Every keystroke leaves the caret on the line's side, never on a run's.
  expect(persian.map((s) => s.assoc)).toEqual(persian.map(() => 1));

  const english = await walk('hello |', ['x', '1', '2', ' ', 'ش', 'ط', ' ', 'y']);
  expect(english.at(-1)!.text).toBe('hello x12 شط y');
  last = english[0];
  for (const state of english) {
    expect(state.x, `after ${JSON.stringify(state.key)}: ${xs(english)}`).toBeGreaterThanOrEqual(last.x - 0.5);
    last = state;
  }
  expect(english.map((s) => s.assoc)).toEqual(english.map(() => 1));
});

test('a line with no letters of its own continues the line above it', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { sourceDirections } = await window.__satr.load('/src/direction.ts');
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const dir = (text: string, line: number) => sourceDirections(text)[line];
    const rendered = (text: string) => {
      const host = document.createElement('article');
      host.innerHTML = renderMarkdown(text);
      return [...host.querySelectorAll('p,li,h1,h2,h3')].map((el) => ({ dir: el.getAttribute('dir'), text: el.textContent?.slice(0, 24) ?? '' }));
    };
    return {
      blankAfterPersian: [dir('متن فارسی\n\n123\n\nادامه', 2), dir('متن فارسی\n\n123', 2)],
      blankLineThenText: dir('متن فارسی\n\n\n123', 3),
      headingEnglish: dir('# یادداشت\n\n123\n\nمتن', 2),
      headingLatin: dir('متن\n\n# Title\n\n123', 4),
      headingLatinAfter: dir('متن\n\n# Title\n\n123\n\nEnglish', 4),
      listPersian: dir('متن فارسی\n\n- 123\n\nادامه', 2),
      newLineKeeps: [dir('متن فارسی\n', 1), dir('این یک متن است\n', 1)],
      // Real prose of the other language still proves the line is the other way.
      provenLatin: dir('متن فارسی\n\n123\n\nEnglish', 2),
      // And a line that already had a direction keeps it.
      provenStays: dir('English\n\nفارسی\n\n123\n\nادامه', 4),
      renderedBlank: rendered('متن فارسی\n\n123'),
      renderedNew: rendered('متن فارسی\n\n123\n\nادامه'),
    };
  });
  // A date-only line has no letters: it follows the Persian above it…
  expect(report.blankAfterPersian).toEqual(['rtl', 'rtl']);
  // …even across an empty line, and under an English-looking heading of a
  // Persian note (`#` proves nothing, and the heading itself is Persian).
  expect(report.blankLineThenText).toBe('rtl');
  expect(report.headingEnglish).toBe('rtl');
  // A Latin heading in a Persian note is still an English line: the bare
  // number under it follows that line, and only English prose proves it.
  expect(report.headingLatin).toBe('ltr');
  expect(report.headingLatinAfter).toBe('ltr');
  expect(report.listPersian).toBe('rtl');
  expect(report.newLineKeeps).toEqual(['rtl', 'rtl']);
  // Prose of the other language still decides: it is what proves it.
  expect(report.provenLatin).toBe('rtl'); // the Persian above is unanimous
  expect(report.provenStays).toBe('rtl');
  // The reading view agrees with the source.
  expect(report.renderedBlank[1].dir).toBe('rtl');
  expect(report.renderedNew[1].dir).toBe('rtl');
});

test('the outline’s current heading is the one two thirds down the pane', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const { previewScroll, editorScroll } = await window.__satr.load('/src/scrollSync.ts');
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0 0 auto 0;height:400px;overflow:hidden;background:white;z-index:1000';
    document.body.appendChild(host);
    const pane = document.createElement('div');
    pane.style.cssText = 'position:absolute;inset:0;overflow:auto';
    const preview = document.createElement('div');
    preview.innerHTML = renderMarkdown(Array.from({ length: 60 }, (_, i) => (i % 10 === 0 ? `## Heading ${i / 10}\n\n` : '') + `Paragraph ${i} with some words in it.`).join('\n\n'));
    pane.appendChild(preview);
    host.appendChild(pane);
    await new Promise((r) => requestAnimationFrame(r));
    pane.scrollTop = 600;
    await new Promise((r) => requestAnimationFrame(r));
    const top = previewScroll(pane, preview);
    const lower = previewScroll(pane, preview, pane.clientHeight * (2 / 3));
    return { top: Math.round(top * 10) / 10, lower: Math.round(lower * 10) / 10, height: pane.clientHeight };
  });
  // The anchored reading is further down the note than the top-of-pane one.
  expect(report.lower).toBeGreaterThan(report.top);
});
