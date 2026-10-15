// Copying a to-do item onto an empty to-do line.
//
// Reported: "copying an already to-do item to an empty to-do line should
// remove one of the to-dos, it pastes literally right now". Copying a line
// like `- [ ] milk` puts that text on the clipboard, box and all; pasting it
// onto a line holding an empty box left two to-dos on that line — the empty
// box still standing there, and CodeMirror's own line-wise paste pushing the
// copied item in beside it.
//
// The pasted item is the one that stays: its text, its box (`[x]` comes over
// done), and the line's own indent. The rule itself is a pure function
// (`pastedOverEmptyTask`: the line text and the clip in, the line that
// replaces it or null for "the platform's own paste"), so the boundary is
// pinned case by case here.
//
// The first fix was written into a `paste` DOM listener and only helped where
// the platform fires one — the desktop-shaped paste. On a phone the keyboard's
// own clipboard goes into the WebView as an ordinary input change, with no
// `paste` event at all, so the rule had nothing to run on. It runs on the
// *transaction* now (`taskPastedOnEmptyLine`), so every road a paste can take
// ends at the same place; the tests below drive each of them — the `paste`
// event with the clipboard on it, the input change the keyboard makes, a drop,
// and the app's own paste entry point.
import { expect, test, type Page } from '@playwright/test';
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

/** The offset of a column on a 1-based line. */
function at(text: string, line: number, col: number | 'end' = 0): number {
  const lines = text.split('\n');
  const start = lines.slice(0, line - 1).reduce((total, value) => total + value.length + 1, 0);
  return start + (col === 'end' ? lines[line - 1].length : col);
}

/** A real paste: the event the platform fires, clipboard and all. */
async function paste(page: Page, note: string, caret: number, clip: string): Promise<{ text: string; caret: number }> {
  return page.evaluate(async ({ note, caret, clip }) => {
    const ed = window.testEditor;
    ed.setValue(note);
    ed.setSelection(caret, caret);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', clip);
    ed.view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 40));
    return { text: ed.getValue(), caret: ed.view.state.selection.main.head };
  }, { note, caret, clip });
}

/** Copying, in the two ways a phone copies: with nothing selected — the whole
 *  line, CodeMirror's own line-wise copy — and with a selection. Returns what
 *  the platform put on the clipboard for the app to paste. */
async function copy(page: Page, note: string, caret: number, end?: number): Promise<string> {
  return page.evaluate(async ({ note, caret, end }) => {
    const ed = window.testEditor;
    ed.setValue(note);
    ed.setSelection(caret, end ?? caret);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    const clipboard = new DataTransfer();
    ed.view.contentDOM.dispatchEvent(new ClipboardEvent('copy', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    return clipboard.getData('text/plain');
  }, { note, caret, end: end ?? null });
}

/** Copy a to-do item and paste it onto another line — the writer's own two
 *  steps on the phone: copy the item, tap the line, paste. */
async function copyThenPaste(page: Page, note: string, from: number, to: number, end?: number): Promise<string> {
  const clip = await copy(page, note, from, end);
  return page.evaluate(async ({ note, to, clip }) => {
    const ed = window.testEditor;
    ed.setValue(note);
    ed.setSelection(to, to);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', clip);
    ed.view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 40));
    return ed.getValue();
  }, { note, to, clip });
}

// The rule on its own. (Empty line, clip → the line that replaces it, or null
// for a paste the app leaves to the platform.)
const RULE: [string, string, string | null][] = [
  // An empty box takes the item it was given: one to-do, not two.
  ['- [ ] ', '- [ ] milk\n', '- [ ] milk'],
  ['- [ ] ', '- [ ] milk', '- [ ] milk'],
  ['- [x] ', '- [ ] milk\n', '- [ ] milk'], // an emptied done box is a slot too: the clip's own box comes over
  ['* [ ] ', '* [ ] milk\n', '* [ ] milk'],
  ['- [x] ', '- [x] milk\n', '- [x] milk'], // the pasted state is kept
  ['1. [ ] ', '2. [ ] milk\n', '2. [ ] milk'], // the pasted item's own number is kept
  ['- [ ] \t', '- [ ] milk\n', '- [ ] milk'], // trailing space is the line's
  ['    - [ ] ', '    - [x] milk\n', '    - [x] milk'], // indent: the line's, once
  ['    - [ ] ', '- [ ] milk\n', '    - [ ] milk'], // the clip's own indent is dropped
  ['\t- [ ] ', '\t- [ ] milk\n', '\t- [ ] milk'],
  ['- [ ] ', '- [x] milk\r\n', '- [x] milk'], // CRLF from a desktop copy
  ['- [ ] ', '- [x] milk\r', '- [x] milk'], // and a lone CR
  // A space the keyboard sent as a no-break space reads as a space — in the
  // line the item lands on, and in the item itself, which is written out as a
  // to-do the note can read back.
  ['- [\u00A0]\u00A0', '- [ ] milk\n', '- [ ] milk'],
  ['- [ ] ', '- [\u00A0] milk\n', '- [ ] milk'],
  ['- [ ] ', '- [ ] milk\u00A0eggs\n', '- [ ] milk eggs'],
  ['- [ ] ', '- [ ] a\n- [\u202F] b\n', '- [ ] a\n- [ ] b'],
  // The rest of a copied list follows under the item it landed on.
  ['- [ ] ', '- [ ] milk\n- [x] bread\n- [ ] eggs\n', '- [ ] milk\n- [x] bread\n- [ ] eggs'],
  ['1. [ ] ', '1. [ ] a\n1. [ ] b', '1. [ ] a\n1. [ ] b'],
  ['    - [ ] ', '- [ ] a\n- [ ] b\n', '    - [ ] a\n    - [ ] b'],
  ['- [ ] ', '- [ ] a\n\n- [ ] b\n', '- [ ] a\n\n- [ ] b'], // a blank line stays blank
  ['- [ ] ', '- [ ] a\n\n\n', '- [ ] a'], // the platform's trailing breaks are not kept
  // Not this paste: the platform's own, so nothing is replaced.
  ['- [ ] milk\n', '- [ ] eggs\n', null], // the line already says something
  ['- ', '- [ ] milk\n', null], // a plain item is not a to-do line
  ['- ', '- milk\n', null],
  ['-', '- [ ] milk\n', null], // a marker with no room for a box
  ['text', '- [ ] milk\n', null], // prose line
  ['- [ ] ', 'milk and eggs\n', null], // prose clip
  ['- [ ] ', '- milk\n', null], // a plain item pasted
  ['- [ ] ', '- [ ]milk\n', null], // box without its space: plain text
  ['- [ ] ', '[] milk\n', null],
  ['- [ ] ', 'A note\n\n- [ ] milk\n', null], // a whole note: not a to-do item
  ['- [ ] ', 'text\n- [ ] milk\n', null],
  ['- [ ] ', '', null], // nothing on the clipboard
  ['[ ] ', '- [ ] milk\n', null], // a box with no marker is not an item
];

test('the rule: an empty box takes the pasted item, everything else is the platform\'s paste', async ({ page }) => {
  const results = await page.evaluate(async (rule) => {
    const editor = await window.__satr.load('/src/editor.ts') as unknown as {
      pastedOverEmptyTask: (line: string, clip: string) => string | null;
    };
    return rule.map(([line, clip]) => editor.pastedOverEmptyTask(line, clip));
  }, RULE as [string, string, string | null][]);
  RULE.forEach(([line, clip, want], index) => {
    expect(results[index], `${JSON.stringify(line)} + ${JSON.stringify(clip)}`).toBe(want);
  });
});

test('copying a to-do item onto an empty to-do line leaves one to-do, not two', async ({ page }) => {
  const note = 'Shopping:\n\n- [ ] \n';
  const result = await paste(page, note, at(note, 3, 'end'), '- [ ] milk\n');
  expect(result.text).toBe('Shopping:\n\n- [ ] milk\n');
  // The caret sits after the pasted item, ready to keep writing.
  expect(result.caret).toBe(at('Shopping:\n\n- [ ] milk\n', 3, 'end'));
});

test('the pasted item brings its own state: a done box stays done', async ({ page }) => {
  const note = '- [ ] \n- [ ] another\n';
  const result = await paste(page, note, at(note, 1, 'end'), '- [x] already done\n');
  expect(result.text).toBe('- [x] already done\n- [ ] another\n');
});

test('the empty line keeps its own indentation, and a copied indent does not double it', async ({ page }) => {
  const nested = '1. a\n    - [ ] \n2. b\n';
  expect((await paste(page, nested, at(nested, 2, 'end'), '- [ ] milk\n')).text)
    .toBe('1. a\n    - [ ] milk\n2. b\n');
  const flat = '- [ ] \n';
  expect((await paste(page, flat, at(flat, 1, 'end'), '    - [ ] milk\n')).text)
    .toBe('- [ ] milk\n');
});

test('the rest of a copied list follows under the item it landed on, at its indent', async ({ page }) => {
  const note = '1. a\n    - [ ] \n2. b\n';
  const clip = '- [ ] milk\n- [x] bread\n- [ ] eggs\n';
  expect((await paste(page, note, at(note, 2, 'end'), clip)).text)
    .toBe('1. a\n    - [ ] milk\n    - [x] bread\n    - [ ] eggs\n2. b\n');
});

test('a line with text on it, and a plain item, are left to the platform', async ({ page }) => {
  // The platform's own paste is not this rule's business; what matters is that
  // the rule stays out of it (checked above) and the empty box is not removed.
  const written = '- [ ] milk\n';
  expect((await paste(page, written, at(written, 1, 'end'), '- [ ] eggs\n')).text).toContain('- [ ] milk');
  const plain = '- \n';
  expect((await paste(page, plain, at(plain, 1, 'end'), '- [ ] milk\n')).text).toContain('- ');
});

test('the writer\'s own two steps — copy the item, paste it onto an empty to-do line — leave one to-do', async ({ page }) => {
  // The report as it happens on the phone: the item is copied from the note
  // (long-press on the line copies the line whole), then pasted onto an empty
  // to-do line. Both of the ways a copy can come read the same afterwards.
  const note = '- [ ] milk\n- [ ] bread\n- [ ] \n- [ ] \n';
  const linewise = await copyThenPaste(page, note, at(note, 2), at(note, 3, 'end'));
  expect(linewise).toBe('- [ ] milk\n- [ ] bread\n- [ ] bread\n- [ ] \n');
  const selected = await copyThenPaste(page, note, at(note, 2), at(note, 3, 'end'), at(note, 2, 'end'));
  expect(selected).toBe('- [ ] milk\n- [ ] bread\n- [ ] bread\n- [ ] \n');
});

test('a paste the keyboard makes — an input change with no paste event — is fixed too', async ({ page }) => {
  // What Android hands the WebView when the writer pastes from the keyboard's
  // own clipboard: the text arrives as an input change, `input.type`, with the
  // caret where it was. Nothing about it looks like a paste except what it
  // does to the line.
  const asInput = (note: string, caret: number, insert: string, at?: number) => page.evaluate(async ({ note, caret, insert, at }) => {
    const ed = window.testEditor;
    ed.setValue(note);
    ed.setSelection(caret, caret);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    ed.view.dispatch({ changes: { from: at ?? caret, insert }, userEvent: 'input.type' });
    await new Promise((r) => setTimeout(r, 30));
    return ed.getValue();
  }, { note, caret, insert, at: at ?? null });

  // The item at the caret, the way a single-line clip arrives — the report
  // itself: `- [ ] ` with `- [ ] milk` pasted at the end of it.
  const note = 'Shopping:\n\n- [ ] \n';
  expect(await asInput(note, at(note, 3, 'end'), '- [ ] milk')).toBe('Shopping:\n\n- [ ] milk\n');
  // And where the writer's own text was written into it: the box goes, the
  // pasted item — text, done state and all — takes its place.
  const written = '- [ ] \n';
  expect(await asInput(written, at(written, 1, 'end'), '- [ ] milk')).toBe('- [ ] milk\n');
  // The whole line pushed in at the line's start with its break, the way the
  // keyboard's line copy arrives.
  const flat = '- [ ] \n- [ ] later\n';
  expect(await asInput(flat, at(flat, 1), '- [ ] milk\n', at(flat, 1))).toBe('- [ ] milk\n- [ ] later\n');
});

test('the two-todos-on-one-line shape is put right whatever the change looked like', async ({ page }) => {
  // The same paste, described by the reader as a change that put the item
  // where the box already was: the empty box goes, the item and its own box
  // stay, and the rest of the line keeps its place.
  const repair = (note: string, caret: number, insert: string) => page.evaluate(async ({ note, caret, insert }) => {
    const ed = window.testEditor;
    ed.setValue(note);
    ed.setSelection(caret, caret);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    ed.view.dispatch({ changes: { from: caret, insert }, userEvent: 'input.type' });
    await new Promise((r) => setTimeout(r, 30));
    return ed.getValue();
  }, { note, caret, insert });

  const note = '- [ ] \n';
  expect(await repair(note, at(note, 1, 'end'), '- [ ] milk')).toBe('- [ ] milk\n');
  // A line that already said something, with the paste landing right after
  // its box: one to-do, the writer's own word still on it.
  const spoken = '- [ ] x\n';
  expect(await repair(spoken, at(spoken, 1, 5), '- [ ] milk')).toBe('- [ ] milk x\n');
  expect(await repair(spoken, at(spoken, 1, 6), '- [ ] milk')).toBe('- [ ] milkx\n');
  // An indented line keeps its indent, and a done box comes over done.
  const nested = '    - [ ] \n';
  expect(await repair(nested, at(nested, 1, 'end'), '- [x] milk')).toBe('    - [x] milk\n');
});

test('a note being loaded, and the app\'s own rewrites, are left exactly as they are', async ({ page }) => {
  // No user event means no paste: whatever text lands on an empty to-do line
  // this way is not the writer's clipboard and the rule stays out of it.
  const untouched = await page.evaluate(async () => {
    const ed = window.testEditor;
    ed.setValue('- [ ] \n');
    // End of the to-do line — the spot the rule watches — but with no user
    // event, which is how a note is loaded and how an external reload lands.
    ed.view.dispatch({ changes: { from: ed.view.state.doc.line(1).to, insert: '- [ ] milk' } });
    await new Promise((r) => setTimeout(r, 20));
    const literal = ed.getValue();
    ed.setValue('- [ ] milk\n- [x] bread\n');
    return { literal, loaded: ed.getValue() };
  });
  expect(untouched.literal).toBe('- [ ] - [ ] milk\n');
  expect(untouched.loaded).toBe('- [ ] milk\n- [x] bread\n');
});

test('the paste is one edit: undo puts the empty item back in one step', async ({ page }) => {
  const note = '- [ ] \n';
  const after = await page.evaluate(async ({ caret }) => {
    const ed = window.testEditor;
    ed.setValue('- [ ] \n');
    ed.setSelection(caret, caret);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', '- [x] milk\n');
    ed.view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 40));
    const pasted = ed.getValue();
    ed.run('undo');
    await new Promise((r) => setTimeout(r, 40));
    return { pasted, undone: ed.getValue() };
  }, { caret: at(note, 1, 'end') });
  expect(after.pasted).toBe('- [x] milk\n');
  expect(after.undone).toBe('- [ ] \n');
});

test('pasting prose onto an empty to-do line still types the prose into it', async ({ page }) => {
  // The box is not in the way of an ordinary paste: the text goes where the
  // caret is, which is what the writer expects of any other paste.
  const note = '- [ ] \n';
  const result = await paste(page, note, at(note, 1, 'end'), 'milk and eggs');
  expect(result.text).toBe('- [ ] milk and eggs\n');
});
