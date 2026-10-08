import { expect, test, type Page } from '@playwright/test';

// The arrow keys: one position a press, the paragraph's own order and side.
//
// The reference is the platform's own field behaviour, read out of Chrome: in
// an RTL paragraph the visual right is the *previous* position, so → mirrors,
// and one press never skips a character — through an inline formula it walks
// character by character, exactly like a plain Persian text field. The keys
// answer while an IME composition is open, too (Gboard keeps a word composed
// until it commits, and that is where → used to be dead).

const LINES = [
  { text: 'hello world, this is plain English text', rtl: false },
  { text: 'سلام، این یک خط فارسی است', rtl: true },
  { text: 'Persian سلام and English mixed together', rtl: false },
  { text: 'x = $a^2 + b$ inside a sentence', rtl: false },
  { text: 'این یک فرمول است $a^2 + b$ و ادامه دارد', rtl: true },
  { text: 'سلام $x^2$ است و $y$', rtl: true },
];

async function boot(page: Page, text: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((note) => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', note);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, text);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
}

/** The caret: its head, the side it took, and where it is drawn. */
const caret = (page: Page) => page.evaluate(async () => {
  const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
  const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
  const main = view.state.selection.main;
  const at = view.coordsAtPos(main.head, main.assoc || -1);
  const line = view.state.doc.lineAt(main.head);
  return {
    head: main.head, assoc: main.assoc, from: main.from, to: main.to,
    lineFrom: line.from, lineTo: line.to,
    x: at ? Math.round(at.left) : NaN,
    ownSide: (() => { const r = view.coordsAtPos(main.head, 1); return r ? Math.round(r.left) : NaN; })(),
  };
});

const place = (page: Page, pos: number) => page.evaluate(async (p) => {
  const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
  const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
  view.dispatch({ selection: { anchor: p } });
  view.focus();
}, pos);

for (const line of LINES) {
  test(`a press is one position, mirrored in RTL: ${line.text.slice(0, 24)}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await boot(page, `${line.text}\n`);
    // Middle of the line, where there is room on both sides.
    const middle = Math.floor(line.text.length / 2);
    for (const [key, dir] of [['ArrowRight', 1], ['ArrowLeft', -1]] as const) {
      await place(page, middle);
      const before = await caret(page);
      await page.keyboard.press(key);
      const after = await caret(page);
      const step = line.rtl ? -dir : dir;
      expect(after.head, `${key} steps one position`).toBe(before.head + step);
      expect(after.assoc, `${key} keeps the line's own side`).toBe(1);
      expect(after.x, `${key} paints the position it moved to, on the line's side`).toBe(after.ownSide);
    }
  });
}

test('a shift press grows the selection by one character, through a formula', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  const text = 'این یک فرمول است $a^2 + b$ و ادامه دارد';
  await boot(page, text);

  // Just after the formula's closing $, growing right: into the formula and
  // across it, one character a press. (This is where a press used to swallow
  // the whole monospace run at once.)
  await place(page, 26);
  for (let k = 1; k <= 8; k += 1) {
    await page.keyboard.press('Shift+ArrowRight');
    const grew = await caret(page);
    expect(grew.to - grew.from, `shift+→ press ${k} adds one character`).toBe(k);
    expect(grew.to, `shift+→ press ${k} keeps the anchor`).toBe(26);
  }

  // Just before the opening $, growing left: from the other side.
  await place(page, 17);
  for (let k = 1; k <= 9; k += 1) {
    await page.keyboard.press('Shift+ArrowLeft');
    const grew = await caret(page);
    expect(grew.to - grew.from, `shift+← press ${k} adds one character`).toBe(k);
    expect(grew.from, `shift+← press ${k} keeps the anchor`).toBe(17);
  }
});

test('a plain walk visits every position of a formula, one a press', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await boot(page, 'این یک فرمول است $a^2 + b$ و ادامه دارد\n');
  await place(page, 26);
  const seen: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('ArrowRight');
    seen.push((await caret(page)).head);
  }
  // The visual right in an RTL line is the previous position: 25, 24 … 17, 16.
  expect(seen).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16]);
  const back: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('ArrowLeft');
    back.push((await caret(page)).head);
  }
  expect(back).toEqual([17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
});

test('the arrows answer while the IME is composing', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await page.addInitScript(() => localStorage.clear());
  await boot(page, 'سلام دنیا');
  await place(page, 9);

  // A word held by the IME, the way Gboard leaves it between keystrokes.
  await cdp.send('Input.imeSetComposition', { text: 'م', selectionStart: 1, selectionEnd: 1 });
  await page.keyboard.press('ArrowRight');
  const right = await caret(page);
  expect(right.head, '→ steps back through the paragraph while composing').toBe(9);
  await page.keyboard.press('ArrowRight');
  const again = await caret(page);
  expect(again.head, 'and again on the next press').toBe(8);
  await page.keyboard.press('ArrowLeft');
  const left = await caret(page);
  expect(left.head, '← steps the other way while composing').toBe(9);
  // The composed word is still the keyboard's, in the note.
  const doc = await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    return EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!.state.doc.toString();
  });
  expect(doc, 'moving the caret does not drop the composed word').toContain('م');
});

test('display math reads and moves left to right, whatever the note says', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await boot(page, 'فرمول:\n$$\na + \\text{سلام}\n$$\n');
  const dirOf = (page: Page, number: number) => page.evaluate(async (n) => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    const line = view.state.doc.line(n);
    const el = view.dom.querySelectorAll('.cm-line')[n - 1] as HTMLElement;
    return { attr: el.getAttribute('dir'), text: line.text, from: line.from };
  }, number);

  const formula = await dirOf(page, 3);
  expect(formula.attr, 'a display-math line is LTR even with Persian inside').toBe('ltr');
  // → on the formula line is the next position (LTR); on the Persian line above
  // it, the previous one (RTL).
  await place(page, formula.from + 2);
  const before = await caret(page);
  await page.keyboard.press('ArrowRight');
  expect((await caret(page)).head, '→ on the formula line moves forward').toBe(before.head + 1);
  const persian = await dirOf(page, 1);
  expect(persian.attr).toBe('rtl');
  await place(page, persian.from + 2);
  const p = await caret(page);
  await page.keyboard.press('ArrowRight');
  expect((await caret(page)).head, '→ on the Persian line moves back').toBe(p.head - 1);
});
