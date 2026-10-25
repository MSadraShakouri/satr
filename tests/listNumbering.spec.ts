import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

// Automatic numbering for ordered lists (the writer's request): a list is
// numbered from its head, one after another, on every change — `6.` then `3.`
// becomes `6. 7. 8.`, and the counting starts at the head's own number, never
// at 1. One list is written in one language: the head decides the digits (or
// the letters) and a marker typed in another script is written over at once.
// A line that leaves the list (deleted whole, joined upwards, or emptied)
// brings the numbers below it down, live, whatever key or button did it. A
// blank line, prose or another list ends the run; nested items number
// themselves and are stepped over, though a change inside one still belongs to
// the list it hangs under. A note being loaded and a list being pasted keep
// the numbers they came with: material from outside is not the writer typing.

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

type Action = 'enter' | 'button' | 'deleteLine' | 'selectAndDelete' | 'backspace' | 'none' |
  { changes: { from: number; to?: number; insert?: string }[] };

async function edit(page: Page, text: string, caret: number, action: Action): Promise<{ text: string; caret: number }> {
  return page.evaluate(async ({ text, caret, action }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    ed.setSelection(caret, caret);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    const view = ed.view;
    if (action === 'enter') {
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    } else if (action === 'button') {
      ed.run('lineBelow');
    } else if (action === 'deleteLine') {
      ed.run('deleteLine');
    } else if (action === 'none') {
      // Just the loaded note, nothing else.
    } else if (action === 'selectAndDelete' || action === 'backspace') {
      if (action === 'selectAndDelete') {
        const line = view.state.doc.lineAt(caret);
        ed.setSelection(line.from, line.to + 1);
        await new Promise((r) => setTimeout(r, 20));
      }
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    } else {
      view.dispatch({ changes: action.changes });
    }
    await new Promise((r) => setTimeout(r, 40));
    return { text: ed.getValue(), caret: ed.getSelection()[0] };
  }, { text, caret, action });
}

/** The writer typing a line again: the line's whole text is replaced, as a
 *  change of their own. */
async function retype(page: Page, text: string, line: number, replacement: string): Promise<string> {
  return page.evaluate(async ({ text, line, replacement }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    const lines = text.split('\n');
    const from = lines.slice(0, line - 1).reduce((total, value) => total + value.length + 1, 0);
    ed.setSelection(from, from + lines[line - 1].length);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    ed.view.dispatch({ changes: { from, to: from + lines[line - 1].length, insert: replacement }, userEvent: 'input.type' });
    await new Promise((r) => setTimeout(r, 40));
    return ed.getValue();
  }, { text, line, replacement });
}

test('Enter numbers the new item, and the items after it follow it', async ({ page }) => {
  const latin = '1. a\n2. b\n3. c';
  expect((await edit(page, latin, at(latin, 1, 'end'), 'enter')).text).toBe('1. a\n2. \n3. b\n4. c');
  // The digits keep the set they were written in.
  const persian = '۱. یک\n۲. دو\n۳. سه';
  expect((await edit(page, persian, at(persian, 1, 'end'), 'enter')).text).toBe('۱. یک\n۲. \n۳. دو\n۴. سه');
  const arabic = '٣. ثالث\n٤. رابع';
  expect((await edit(page, arabic, at(arabic, 1, 'end'), 'enter')).text).toBe('٣. ثالث\n٤. \n٥. رابع');
  // And the delimiter the writer used.
  const paren = '1) a\n2) b';
  expect((await edit(page, paren, at(paren, 1, 'end'), 'enter')).text).toBe('1) a\n2) \n3) b');
  // A task list keeps its boxes, and a new box is always empty — the item
  // under a finished one is a new thing to do (13).
  const tasks = '1. [ ] a\n2. [ ] b';
  expect((await edit(page, tasks, at(tasks, 1, 'end'), 'enter')).text).toBe('1. [ ] a\n2. [ ] \n3. [ ] b');
  const tasksDone = '1. [x] a\n2. [ ] b';
  expect((await edit(page, tasksDone, at(tasksDone, 1, 'end'), 'enter')).text).toBe('1. [x] a\n2. [ ] \n3. [ ] b');
  // A row that already counts on its own does not move.
  const running = '1. a\n2. b\n3. c';
  expect((await edit(page, running, at(running, 3, 'end'), 'enter')).text).toBe('1. a\n2. b\n3. c\n4. ');
  // The toolbar's new-line button numbers like Enter.
  expect((await edit(page, latin, at(latin, 1, 'end'), 'button')).text).toBe('1. a\n2. \n3. b\n4. c');
});

test('the numbers run on from the head, however the items below were typed', async ({ page }) => {
  // 6. → 7., and the 8. below already says 8.
  const odd = '6. a\n8. b';
  expect((await edit(page, odd, at(odd, 1, 'end'), 'enter')).text).toBe('6. a\n7. \n8. b');
  // A 7. below the new 7. would repeat, so that one moves to 8. — and the 9.
  // after it already says 9.
  const repeat = '6. a\n7. b\n9. c';
  expect((await edit(page, repeat, at(repeat, 1, 'end'), 'enter')).text).toBe('6. a\n7. \n8. b\n9. c');
  // A number that runs backward is brought forward like any other: the head's
  // own number is where the counting starts, and every item after it follows.
  const backward = '6. a\n3. b';
  expect((await edit(page, backward, at(backward, 1, 'end'), 'enter')).text).toBe('6. a\n7. \n8. b');
  const skip = '1. a\n5. b';
  expect((await edit(page, skip, at(skip, 1, 'end'), 'enter')).text).toBe('1. a\n2. \n3. b');
  // The last item has nothing after it, so nothing else moves.
  const last = '1. a\n2. b';
  expect((await edit(page, last, at(last, 2, 'end'), 'enter')).text).toBe('1. a\n2. b\n3. ');
});

test('a blank line, prose, or another list ends the run', async ({ page }) => {
  const blank = '1. a\n\n2. b';
  expect((await edit(page, blank, at(blank, 1, 'end'), 'enter')).text).toBe('1. a\n2. \n\n2. b');
  const prose = '1. a\nprose\n3. c';
  expect((await edit(page, prose, at(prose, 1, 'end'), 'enter')).text).toBe('1. a\n2. \nprose\n3. c');
  // Two lists under two headings do not count each other.
  const two = '1. a\n2. b\n\n# t\n\n3. c\n4. d';
  expect((await edit(page, two, at(two, 1, 'end'), 'enter')).text).toBe('1. a\n2. \n3. b\n\n# t\n\n3. c\n4. d');
});

test('deleting a whole item shifts the items after it down by one', async ({ page }) => {
  const text = '1. a\n2. b\n3. c';
  // A selection that takes the line and its break.
  expect((await edit(page, text, at(text, 2), 'selectAndDelete')).text).toBe('1. a\n2. c');
  // The toolbar's delete-line button takes the break *above* the line; the
  // items after it still come down by one.
  expect((await edit(page, text, at(text, 2), 'deleteLine')).text).toBe('1. a\n2. c');
  // The deletion lands on the run: 4. and 5. come down to 3. and 4.
  const longer = '1. a\n2. b\n3. c\n4. d\n5. e';
  expect((await edit(page, longer, at(longer, 2), 'selectAndDelete')).text).toBe('1. a\n2. c\n3. d\n4. e');
  // With a blank line between, the list below is another list and keeps its
  // numbers.
  const apart = '1. a\n2. b\n\n3. c';
  expect((await edit(page, apart, at(apart, 2), 'deleteLine')).text).toBe('1. a\n\n3. c');
});

// A list's numbers are its own: a blank line (or prose) between two lists is
// the end of the first, and an item leaving brings the numbers *down*, never
// up (15).
test('a blank line ends the run, and an item leaving moves the numbers down', async ({ page }) => {
  const apart = '1. a\n2. b\n\n3. c';
  expect((await edit(page, apart, at(apart, 2, 'end'), 'enter')).text).toBe('1. a\n2. b\n3. \n\n3. c');
  const gap = '6. a\n\n8. b';
  expect((await edit(page, gap, at(gap, 1, 'end'), 'enter')).text).toBe('6. a\n7. \n\n8. b');
  const spaces = '1. a\n  \n3. c';
  expect((await edit(page, spaces, at(spaces, 1, 'end'), 'enter')).text).toBe('1. a\n2. \n  \n3. c');
  const prose = '1. a\n2. b\nprose\n5. c\n6. d';
  expect((await edit(page, prose, at(prose, 2, 'end'), 'enter')).text).toBe('1. a\n2. b\n3. \nprose\n5. c\n6. d');
  // Pressing Enter twice at the end of an item leaves the list: the marker is
  // dropped, and the items below come down — the empty item is not a new item
  // that pushes them up.
  const twice = await page.evaluate(async ({ text, caret }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    ed.setSelection(caret, caret);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    ed.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    const once = ed.getValue();
    ed.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    return { once, twice: ed.getValue() };
  }, { text: '1. a\n2. b\n3. c', caret: 4 });
  expect(twice.once).toBe('1. a\n2. \n3. b\n4. c');
  expect(twice.twice).toBe('1. a\n\n2. b\n3. c');
});

test('a line that leaves the list brings the numbers down, a line edited in place does not', async ({ page }) => {
  const text = '1. a\n2. b\n3. c';
  // Deleting the marker leaves a line that still stands: the numbers stay.
  expect((await edit(page, text, 0, { changes: [{ from: 5, to: 8 }] })).text).toBe('1. a\nb\n3. c');
  // Joining the line to the one above it takes the item out of the list.
  expect((await edit(page, text, 0, { changes: [{ from: 4, to: 5 }] })).text).toBe('1. a2. b\n2. c');
  // Replacing the line's text leaves a line behind: nothing moves.
  expect((await edit(page, text, 0, { changes: [{ from: 5, to: 9, insert: 'x' }] })).text).toBe('1. a\nx\n3. c');
  // Typing inside an item moves nothing either.
  expect((await edit(page, text, 0, { changes: [{ from: 9, insert: '!' }] })).text).toBe('1. a\n2. b!\n3. c');
});

// Deleting the line by hand — Backspace, a selection, whatever the keyboard
// sends — is checked on every edit, not only when the toolbar's button ran.
test('backspacing an item away renumbers the list as the writer works', async ({ page }) => {
  const text = '1. a\n2. b\n3. c';
  const walk = await page.evaluate(async ({ text }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    // The end of "2. b".
    ed.setSelection(9, 9);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    const steps: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      ed.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      steps.push(ed.getValue());
    }
    return steps;
  }, { text });
  // The line goes as it is typed away; the 3. comes down the moment the line
  // holds nothing at all.
  expect(walk[0]).toBe('1. a\n2. \n3. c');
  expect(walk[3]).toBe('1. a\n\n2. c');
  // Backspace at the start of the line joins it to the line above: the item is
  // gone too.
  const merged = await edit(page, text, at(text, 2), 'backspace');
  expect(merged.text).toBe('1. a2. b\n2. c');
  // A selection that takes the line's whole text is the same moment.
  const selected = await page.evaluate(async ({ text }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    ed.setSelection(5, 9);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    ed.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    return ed.getValue();
  }, { text });
  expect(selected).toBe('1. a\n\n2. c');
});

test('a nested list numbers itself and does not stand between the items above it', async ({ page }) => {
  const nested = '1. a\n    1. n1\n    2. n2\n3. c';
  // Enter on the outer item 1: the outer 3. already counts after the new 2.,
  // so it stays, and the nested numbers never move.
  expect((await edit(page, nested, at(nested, 1, 'end'), 'enter')).text).toBe('1. a\n2. \n    1. n1\n    2. n2\n3. c');
  // Deleting outer item 2: the nested list is stepped over, and the outer
  // numbers run on under it — 3. comes down to 2. Only outer items count.
  const withTwo = '1. a\n2. b\n    1. n1\n    2. n2\n3. c';
  expect((await edit(page, withTwo, at(withTwo, 2), 'selectAndDelete')).text).toBe('1. a\n    1. n1\n    2. n2\n2. c');
});

// A note arriving whole — a file opened, a session coming back, a reload — is
// not an edit in it, and a paste brings its own numbers with it. Neither is
// renumbered: the rule counts what the writer writes, and these arrive written.
test('loading a note or pasting a list keeps the numbers it came with', async ({ page }) => {
  const odd = '5. a\n9. b';
  expect((await edit(page, odd, at(odd, 1, 'end'), 'none')).text).toBe(odd);
  const list = '1. a\n2. b';
  const pasted = await page.evaluate(async ({ text }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    ed.setSelection(text.length, text.length);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    ed.view.dispatch({ changes: { from: text.length, insert: '\n4. d\n5. e' }, userEvent: 'input.paste' });
    await new Promise((r) => setTimeout(r, 40));
    return ed.getValue();
  }, { text: list });
  expect(pasted).toBe('1. a\n2. b\n4. d\n5. e');
});

test('undo puts the numbering back with the edit', async ({ page }) => {
  const text = '1. a\n2. b\n3. c';
  const after = await page.evaluate(async ({ text, caret }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    ed.setSelection(caret, caret);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    ed.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    const numbered = ed.getValue();
    ed.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    return { numbered, undone: ed.getValue() };
  }, { text, caret: at(text, 1, 'end') });
  expect(after.numbered).toBe('1. a\n2. \n3. b\n4. c');
  expect(after.undone).toBe(text);
});

// The writer's list can already hold an item with nothing written on it. Enter
// moves into that item — the caret lands where the text goes — instead of
// making a second empty one and pushing every number below it (15).
test('Enter uses an empty item already waiting below', async ({ page }) => {
  const withWaiting = await page.evaluate(async ({ text }) => {
    const ed = window.testEditor;
    ed.setValue(text);
    // The end of "1. a".
    ed.setSelection(4, 4);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    ed.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    const key = { text: ed.getValue(), caret: ed.getSelection()[0] };
    ed.setValue(text);
    ed.setSelection(4, 4);
    ed.focus();
    await new Promise((r) => setTimeout(r, 30));
    ed.run('lineBelow');
    await new Promise((r) => setTimeout(r, 40));
    return { key, button: { text: ed.getValue(), caret: ed.getSelection()[0] } };
  }, { text: '1. a\n2. \n3. c' });
  // Nothing is written and nothing below moves: the empty item was waiting.
  expect(withWaiting.key.text).toBe('1. a\n2. \n3. c');
  expect(withWaiting.key.caret).toBe(8);
  // The button is the same chain.
  expect(withWaiting.button.text).toBe(withWaiting.key.text);
  expect(withWaiting.button.caret).toBe(withWaiting.key.caret);
  // The writer's own number on that line is left alone.
  const other = '1. a\n5. \n6. c';
  const kept = await edit(page, other, at(other, 1, 'end'), 'enter');
  expect(kept.text).toBe(other);
  expect(kept.caret).toBe(8);
  // A waiting to-do box is used the same way.
  const todo = '1. [x] a\n2. [ ] \n3. c';
  const box = await edit(page, todo, at(todo, 1, 'end'), 'enter');
  expect(box.text).toBe(todo);
  expect(box.caret).toBe(todo.indexOf('\n') + 1 + '2. [ ] '.length);
  // A different kind of marker, or another indent, is not this list: Enter
  // continues the list it is on.
  const mixed = '1. a\n- \n3. c';
  expect((await edit(page, mixed, at(mixed, 1, 'end'), 'enter')).text).toBe('1. a\n2. \n- \n3. c');
  const nested = '1. a\n    2. \n3. c';
  expect((await edit(page, nested, at(nested, 1, 'end'), 'enter')).text).toBe('1. a\n2. \n    2. \n3. c');
  // And Enter on the empty item itself still leaves the list.
  const leaving = '1. a\n2. \n3. c';
  expect((await edit(page, leaving, at(leaving, 2, 'end'), 'enter')).text).toBe('1. a\n\n2. c');
});

// One list, one language (the writer's request): the head decides the digits
// and a marker that arrives in the other script is written over at once. The
// writer types in whatever script their keyboard happened to be on; the list
// stays itself, and it goes on counting from the head's own number.
test('one list, one language: the head decides and the other script is written over', async ({ page }) => {
  // A Persian marker typed under an English head is English at once — and it
  // is the second item, so it says 2 whatever number came in.
  expect(await retype(page, '1. a\n2. b', 2, '۲. b')).toBe('1. a\n2. b');
  expect(await retype(page, '1. a\n2. b', 2, '٣. b')).toBe('1. a\n2. b');
  // And an English one under a Persian head is Persian.
  expect(await retype(page, '۱. a\n۲. b', 2, '2. b')).toBe('۱. a\n۲. b');
  expect(await retype(page, '۱. a\n۲. b', 2, '٣. b')).toBe('۱. a\n۲. b');
  // The head is the writer's own and is left exactly as they wrote it — even
  // when they change it, which moves the whole run to its number.
  expect(await retype(page, '1. a\n۲. b', 1, '۳. a')).toBe('۳. a\n۴. b');
  expect(await retype(page, 'الف. a\nب. b', 1, 'ج. a')).toBe('ج. a\nد. b');
  // Every item follows the head, in order, one after another: from ۵. the
  // list runs ۶. and ۷., whatever the items said when they were typed.
  expect(await retype(page, '۵. a\n9. b\n۲. c', 1, '۵. a')).toBe('۵. a\n۶. b\n۷. c');
});

// Lettered lists (the writer's request): the marker is typed like any other
// and Enter carries it on — ابجد by default, and a letter that only the
// Persian order has (a پ) turns the whole list to ابپتث. Nothing new in the
// toolbar: the letters are the interface.
test('a lettered list carries on in its own order', async ({ page }) => {
  const abjad = 'ا. a';
  expect((await edit(page, abjad, at(abjad, 1, 'end'), 'enter')).text).toBe('ا. a\nب. ');
  // A list that starts further in counts from where it starts.
  const jim = 'ج. c';
  expect((await edit(page, jim, at(jim, 1, 'end'), 'enter')).text).toBe('ج. c\nد. ');
  // الف is the first letter written out, and it is kept as the writer wrote it.
  const alef = 'الف. a';
  expect((await edit(page, alef, at(alef, 1, 'end'), 'enter')).text).toBe('الف. a\nب. ');
  // The default is ابجد: after ا and ب comes ج.
  const two = 'ا. a\nب. b';
  expect((await edit(page, two, at(two, 2, 'end'), 'enter')).text).toBe('ا. a\nب. b\nج. ');
  // A پ anywhere in the run is proof of the Persian order, and the list turns
  // ابپتث — the ج the writer had is written over.
  expect(await retype(page, 'ا. a\nب. b\nج. c', 3, 'پ. c')).toBe('ا. a\nب. b\nپ. c');
  // And it carries on there: after پ comes ت.
  const pe = 'ا. a\nب. b\nپ. p';
  expect((await edit(page, pe, at(pe, 3, 'end'), 'enter')).text).toBe('ا. a\nب. b\nپ. p\nت. ');
  // A ج is proof of ابجد, and the list turns back.
  expect(await retype(page, 'ا. a\nب. b\nپ. p', 3, 'ج. c')).toBe('ا. a\nب. b\nج. c');
  // Past the last letter a list counts in Persian numbers rather than
  // starting its letters over.
  const gh = 'غ. a';
  expect((await edit(page, gh, at(gh, 1, 'end'), 'enter')).text).toBe('غ. a\n۲۹. ');
  // Under a digit head a letter is still a number: the head decides.
  expect(await retype(page, '1. a\n2. b', 2, 'ب. b')).toBe('1. a\n2. b');
  // The English alphabet, in either case, is a list of its own.
  const lower = 'a. one';
  expect((await edit(page, lower, at(lower, 1, 'end'), 'enter')).text).toBe('a. one\nb. ');
  const upper = 'A. one';
  expect((await edit(page, upper, at(upper, 1, 'end'), 'enter')).text).toBe('A. one\nB. ');
  // Past z the list counts in English numbers rather than starting over.
  const zed = 'z. one';
  expect((await edit(page, zed, at(zed, 1, 'end'), 'enter')).text).toBe('z. one\n27. ');
  // And one list is one case: a number typed under a letter head is a letter,
  // and a lower-case letter under an upper-case head is upper case. (A lone
  // `A.` is a sentence, though — the run has to read as a list already.)
  expect(await retype(page, 'a. one\n2. two', 2, '2. two')).toBe('a. one\nb. two');
  expect(await retype(page, 'A. Smith\nA. Jones', 2, 'A. Jones')).toBe('A. Smith\nA. Jones');
  expect(await retype(page, 'A. one\nB. two', 2, 'b. two')).toBe('A. one\nB. two');
  expect(await retype(page, 'a. one\nb. two', 1, 'A. one')).toBe('A. one\nB. two');
});

// Line numbers follow the caret's line (the writer's request): a Persian line
// counts in Persian digits, an English line in English digits. One formatter
// draws the column, so it turns together when the caret crosses over.
test('the line numbers are drawn in the script of the caret’s line', async ({ page }) => {
  const gutter = await page.evaluate(async () => {
    const ed = window.testEditor;
    ed.setLineNumbers(true);
    const read = async (text: string, caret: number) => {
      ed.setValue(text);
      ed.setSelection(caret, caret);
      ed.focus();
      await new Promise((r) => setTimeout(r, 40));
      return [...ed.view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
        .filter((element) => (element as HTMLElement).style.visibility !== 'hidden')
        .map((element) => element.textContent).join(',');
    };
    return {
      persian: await read('سلام\nدنیا\nخوب', 0),
      latin: await read('hello\nworld', 0),
      // The caret sits on the English line first, then on the Persian one.
      mixedEnglish: await read('hello\nدنیا', 0),
      mixedPersian: await read('hello\nدنیا', 6),
    };
  });
  expect(gutter.persian).toBe('۱,۲,۳');
  expect(gutter.latin).toBe('1,2');
  expect(gutter.mixedEnglish).toBe('1,2');
  expect(gutter.mixedPersian).toBe('۱,۲');
});

// The reading view draws the markers the writer wrote, item by item: `الف`
// stays `الف`, `٣` stays `٣`, and a nested list keeps its own numbers. Every
// item is read from its own source line, so one note's lists cannot take
// another's place.
test('the reading view draws each item’s own marker', async ({ page }) => {
  const read = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const host = document.createElement('article');
    const one = (text: string) => {
      host.innerHTML = renderMarkdown(text);
      return [...host.querySelectorAll('ol')].map((list) => ({
        lettered: list.classList.contains('lettered-ordered'),
        numbered: list.classList.contains('persian-ordered'),
        labels: [...list.querySelectorAll<HTMLElement>(':scope > li')].map((item) => item.getAttribute('data-persian-number')),
      }));
    };
    return {
      abjad: one('ا. یک\nب. دو\nج. سه'),
      alef: one('الف. یک\nب. دو'),
      abpats: one('ا. یک\nب. دو\nپ. سه'),
      arabic: one('٣. ثالث\n٤. رابع'),
      nested: one('۱. یک\n    ۲. دو\n    ۳. سه'),
      letters: one('a. one\nb. two'),
      upper: one('A. one\nB. two'),
      latin: one('1. one\n2. two'),
      // A formula on its own line, with the list right under it: the list is
      // still a list (the block used to run on and swallow it).
      underMath: one('$$x$$\n۱. یک\n۲. دو'),
      underMathLetters: one('$$x$$\nا. یک\nب. دو'),
      // Two lists, one above the other: each keeps its own markers.
      above: one('1. one\n2. two\n\nprose\n\nا. یک\nب. دو'),
    };
  });
  expect(read.abjad).toEqual([{ lettered: true, numbered: true, labels: ['ا', 'ب', 'ج'] }]);
  expect(read.alef[0].labels).toEqual(['الف', 'ب']);
  expect(read.abpats[0].labels).toEqual(['ا', 'ب', 'پ']);
  expect(read.arabic[0].labels).toEqual(['٣', '٤']);
  expect(read.nested[1].labels).toEqual(['۲', '۳']);
  expect(read.letters[0].labels).toEqual(['a', 'b']);
  expect(read.upper[0].labels).toEqual(['A', 'B']);
  // An English list is the platform's own and is left alone.
  expect(read.latin[0].numbered).toBe(false);
  expect(read.latin[0].lettered).toBe(false);
  expect(read.underMath[0].labels).toEqual(['۱', '۲']);
  expect(read.underMathLetters[0].labels).toEqual(['ا', 'ب']);
  expect(read.above[1].labels).toEqual(['ا', 'ب']);
});

// The punctuation is the writer's, as the number is: `۱)` is drawn `۱)` and
// never `۱.`, in the item and in the list the browser draws itself — and a
// list of `1)` keeps the paren where the platform would have put a dot.
test('a marker keeps the punctuation it was typed with', async ({ page }) => {
  const read = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const host = document.createElement('article');
    host.className = 'preview-pane';
    document.body.appendChild(host);
    const one = (text: string) => {
      host.innerHTML = renderMarkdown(text);
      return {
        lists: [...host.querySelectorAll('ol')].map((list) => list.getAttribute('data-delimiter')),
        items: [...host.querySelectorAll<HTMLElement>('ol > li')].map((item) => ({
          label: item.getAttribute('data-persian-number'),
          delimiter: item.getAttribute('data-persian-delimiter'),
          drawn: getComputedStyle(item, '::before').content,
        })),
        prose: host.querySelector('ol') === null,
      };
    };
    return {
      paren: one('۱) یک\n۲) دو'),
      dot: one('۱. یک\n۲. دو'),
      latinParen: one('1) one\n2) two'),
      latinDot: one('1. one\n2. two'),
      lettered: one('a. one\nb) two'),
      mixed: one('a. one\nb. two\n\nprose\n\nA. Smith'),
    };
  });
  expect(read.paren.lists).toEqual([null]);
  expect(read.paren.items.map((item) => item.drawn)).toEqual(['"۱)"', '"۲)"']);
  expect(read.dot.items.map((item) => item.drawn)).toEqual(['"۱."', '"۲."']);
  // A list the platform draws keeps the paren through its own counter.
  expect(read.latinParen.lists).toEqual([')']);
  expect(read.latinDot.lists).toEqual([null]);
  // An English letter keeps its own punctuation too.
  expect(read.lettered.items.map((item) => item.drawn)).toEqual(['"a."', '"b)"']);
  // `A. Smith` is prose: no list, and nothing drawn beside it.
  expect(read.mixed.prose).toBe(false);
});

// Every list marker is drawn the same, whoever draws it. A number is the
// parser's in both scripts (src/markerParse.ts), so `۱.` is dimmed by the
// same style as `1.`; a letter is nobody's — CommonMark has no lettered
// lists — so those keep the editor's own dim, and only where the reading
// view reads them as markers: `A. Smith` is a sentence and stays at full
// strength, exactly as the reading view keeps it.
test('a marker is dimmed wherever it is written, in either script', async ({ page }) => {
  const marks = await page.evaluate(async () => {
    const ed = window.testEditor;
    ed.setValue('a. one\nb. two\n\nA. Smith\n\n۱. یک\n\n> ۱. یک\n\n- dash\n\n1. one');
    ed.focus();
    await new Promise((r) => setTimeout(r, 40));
    return [...ed.view.contentDOM.querySelectorAll('.cm-line')].map((line) => ({
      text: line.textContent,
      // The editor's own fallback, for the markers no parser knows.
      marks: [...line.querySelectorAll<HTMLElement>('.cm-live-marker')].map((mark) => ({
        text: mark.textContent,
        opacity: getComputedStyle(mark).opacity,
      })),
      // What the marker itself is drawn at, whichever hand drew it.
      drawn: [...line.querySelectorAll<HTMLElement>('span')]
        .filter((span) => /^[-0-9۰-۹a-zA-Zالفب]+[.)]?$/.test(span.textContent ?? '') && !span.className.includes('cm-lp-marker'))
        .map((span) => `${span.textContent} ${getComputedStyle(span).opacity}`),
    }));
  });
  const line = (text: string) => marks.find((one) => one.text === text);
  const on = (text: string) => line(text)?.marks ?? [];
  expect(on('a. one')).toEqual([{ text: 'a.', opacity: '0.42' }]);
  expect(on('b. two')).toEqual([{ text: 'b.', opacity: '0.42' }]);
  // A sentence, not a list.
  expect(on('A. Smith')).toEqual([]);
  // What the parser knows is the parser's: no second dim on top of its own.
  expect(on('1. one')).toEqual([]);
  expect(on('- dash')).toEqual([]);
  expect(on('۱. یک')).toEqual([]);
  // And it draws both scripts the same, in a quote as on its own line.
  expect(line('1. one')?.drawn).toEqual(['1. 0.42']);
  expect(line('۱. یک')?.drawn).toEqual(['۱. 0.42']);
  expect(line('> ۱. یک')?.drawn).toEqual(['۱. 0.42']);
});

// A formula that opens an item stands on the marker's line: `الف. $$x$$` is
// one line, not the marker with a blank line under it. A formula after prose
// keeps the room a display formula takes. (The second item is there because a
// letter is a marker only in a run of letters — src/listMarkers.ts.)
test('a formula that opens an item stands on the marker’s line', async ({ page }) => {
  const geometry = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const host = document.createElement('article');
    host.className = 'preview-pane';
    host.style.cssText = 'position:fixed;left:0;top:0;width:600px;font-size:18px';
    document.body.appendChild(host);
    const measure = (text: string) => {
      host.innerHTML = renderMarkdown(text);
      const item = host.querySelector('li') as HTMLElement;
      const math = item.querySelector(':scope > .math-display') as HTMLElement;
      const itemBox = item.getBoundingClientRect();
      const mathBox = math.getBoundingClientRect();
      return {
        head: item.hasAttribute('data-math-head'),
        gap: +(mathBox.top - itemBox.top).toFixed(1),
        margin: getComputedStyle(math).marginBlockStart,
      };
    };
    return {
      opens: measure('الف. $$x$$\nب. دوم'),
      afterProse: measure('الف. یک $$x$$ دو\nب. دوم'),
    };
  });
  // The formula's own top margin is the blank line: gone, and the formula
  // starts where the item does.
  expect(geometry.opens.head).toBe(true);
  expect(geometry.opens.margin).toBe('0px');
  expect(geometry.opens.gap).toBeLessThan(3);
  expect(geometry.afterProse.head).toBe(false);
  expect(geometry.afterProse.margin).toBe('18px');
});

// A marker hangs beside its text: the text of a `۱.` item starts where the
// text of a platform `1.` item starts, and the marker sits in the strip
// before it — the marker was indented by 3ch and the text by 3ch and 1.8em
// more, which was the extra indent the writer saw.
test('a drawn marker hangs beside its text, not on top of another indent', async ({ page }) => {
  const box = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const host = document.createElement('article');
    host.className = 'preview-pane';
    host.style.cssText = 'position:fixed;left:0;top:0;width:600px;font-size:18px';
    document.body.appendChild(host);
    // How far the item sits from its list's inline start, and its text from
    // the item's own (left to right and right to left alike).
    const measure = (item: HTMLElement) => {
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      let node: Node | null = null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.trim()) continue;
        if (node.parentElement?.closest('li') !== item) continue;
        break;
      }
      const range = document.createRange();
      range.selectNodeContents(node as Node);
      const text = range.getBoundingClientRect();
      const own = item.getBoundingClientRect();
      const list = item.parentElement!.getBoundingClientRect();
      const rtl = getComputedStyle(item).direction === 'rtl';
      return {
        fromList: +Math.abs(rtl ? own.right - list.right : own.left - list.left).toFixed(1),
        textFromItem: +Math.abs(rtl ? own.right - text.right : text.left - own.left).toFixed(1),
        padding: getComputedStyle(item).paddingInlineStart,
        width: +own.width.toFixed(1),
        right: +own.right.toFixed(1),
      };
    };
    const list = (markdown: string) => {
      host.innerHTML = renderMarkdown(markdown);
      const items = [...host.querySelectorAll('li')] as HTMLElement[];
      return items.map(measure);
    };
    const nested = list('۱. بیرونی\n    ۱. درونی\n۲. بیرونی');
    return {
      painted: list('۱. یک')[0],
      platform: list('1. one')[0],
      nestedOuter: nested[0],
      nestedInner: nested[1],
      nestedWidth: nested[1].width,
    };
  });
  // Same margin and no padding: the text of a drawn list starts where the
  // platform's own list text starts.
  expect(box.painted.textFromItem).toBe(box.platform.textFromItem);
  expect(box.painted.fromList).toBe(box.platform.fromList);
  expect(box.painted.padding).toBe('0px');
  // A nested item still steps in from its parent, by a whole indent.
  expect(box.nestedOuter.right - box.nestedInner.right).toBeGreaterThan(30);
  expect(box.nestedWidth).toBeLessThan(box.painted.width);
});

// A list keeps room for the widest marker it holds. `الف.` is wider than the
// 3ch strip the platform hangs `1.` in, and what did not fit the strip was
// painted outside the section — where the reading view clips it
// (content-visibility, src/style.css), so `الف.` came out as `ف` and a pasted
// `۱۲۳۴۵.` lost three of its digits. The strip is the widest marker in that
// list plus the hair of space before the text (src/markdown.ts measures it),
// so the markers still end on one line against the text and none of them
// reaches past the list's own edge. A list whose markers fit keeps the
// platform's strip, to the pixel.
test('a list keeps room for its widest marker', async ({ page }) => {
  const measured = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const host = document.createElement('article');
    host.className = 'preview-pane';
    host.style.cssText = 'position:fixed;left:0;top:0;width:600px;font-size:18px';
    document.body.appendChild(host);
    await document.fonts.ready;
    const paint = document.createElement('canvas').getContext('2d')!;
    const list = (markdown: string) => {
      host.innerHTML = renderMarkdown(markdown);
      const ordered = host.querySelector('ol')!;
      const listBox = ordered.getBoundingClientRect();
      const items = [...ordered.children] as HTMLElement[];
      return items.map((item) => {
        const style = getComputedStyle(item);
        const box = item.getBoundingClientRect();
        const rtl = style.direction === 'rtl';
        paint.font = `${style.fontSize} ${style.fontFamily}`;
        const drawn = paint.measureText((item.dataset.persianNumber ?? '') + (item.dataset.persianDelimiter ?? '')).width;
        const gap = 0.4 * parseFloat(style.fontSize);
        // Where the far end of the marker falls, and how far that is past the
        // list's own edge (negative is inside, where it belongs).
        const outer = rtl ? box.right + gap + drawn : box.left - gap - drawn;
        return {
          gutter: +parseFloat(style.marginInlineStart).toFixed(1),
          drawn: +drawn.toFixed(1),
          gap: +gap.toFixed(1),
          past: +(rtl ? outer - listBox.right : listBox.left - outer).toFixed(1),
        };
      });
    };
    return {
      platform: list('1. one\n2. two'),
      digits: list('۱. یک\n۲. دو\n۳. سه'),
      letters: list('الف. الف\nب. ب\nج. ج'),
      wide: list('۱۲۳۴۵. عدد\n۱۲۳۴۶. عدد'),
    };
  });
  // Nothing a list draws is painted outside the list.
  for (const [name, items] of Object.entries(measured)) {
    for (const item of items) expect(item.past, `${name} keeps its marker inside`).toBeLessThanOrEqual(0);
  }
  // Markers that fit the platform's strip leave the strip alone.
  expect(measured.digits[0].gutter).toBe(measured.platform[0].gutter);
  // Wider ones take exactly the room they need, and every item of one list
  // keeps the same strip, so the text is a straight edge.
  for (const list of [measured.letters, measured.wide]) {
    const widest = Math.max(...list.map((item) => item.drawn));
    expect(list[0].gutter).toBeGreaterThan(measured.platform[0].gutter);
    // Exactly the room the widest marker asks for, within the pixel the font
    // rounds by: the width is measured from the font's own metrics and kept
    // in em, and a renderer rounds an advance to the size it draws at.
    expect(list[0].gutter).toBeGreaterThanOrEqual(widest + list[0].gap - 0.1);
    expect(list[0].gutter).toBeLessThan(widest + list[0].gap + 1.5);
    expect(new Set(list.map((item) => item.gutter)).size).toBe(1);
  }
});

// A blank line between items is air, not a new list.
//
// Asked for: "I want loose lists" — the blank line the writer put between two
// items is theirs, and the reader should see it. The parser already says so
// by giving every item of such a list a paragraph of its own; the spacing was
// then taken straight back off by the stylesheet, so a list with a gap in the
// middle arrived as one unbroken block of numbers. Obsidian draws a loose
// list exactly like a tight one — its own CSS zeroes those paragraphs'
// margins — which is where the rule came from in the first place.
test('a list written with blank lines keeps the air, in either script', async ({ page }) => {
  const space = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const host = document.createElement('article');
    host.className = 'preview-pane';
    host.style.cssText = 'position:fixed;left:0;top:0;width:380px;background:white;z-index:9999';
    document.body.appendChild(host);
    /** The room between one item's text and the next item's text: the air a
     *  loose list is given is the items' own padding, which sits inside
     *  their boxes, so the boxes themselves still touch. */
    const gaps = async (text: string) => {
      host.innerHTML = renderMarkdown(text);
      await document.fonts.ready;
      const boxes = [...host.querySelectorAll('li')].map((item) => {
        const range = document.createRange();
        range.selectNodeContents(item);
        return range.getBoundingClientRect();
      });
      return boxes.slice(1).map((box, index) => Math.round(box.top - boxes[index].bottom));
    };
    const out = {
      tightPersian: await gaps('۱. یک\n۲. دو\n۳. سه'),
      loosePersian: await gaps('۱. یک\n\n۲. دو\n\n۳. سه'),
      tightLatin: await gaps('1. one\n2. two\n3. three'),
      looseLatin: await gaps('1. one\n\n2. two\n\n3. three'),
      quotedGap: await gaps('> ۱. یک\n> ۲. دو\n> \n> ۵. پنج'),
      tightBullets: await gaps('- یک\n- دو\n- سه'),
      looseBullets: await gaps('- یک\n\n- دو\n\n- سه'),
      looseTasks: await gaps('- [ ] یک\n\n- [x] دو'),
    };
    host.remove();
    return out;
  });
  // Written one line under the next: the hair of space a list has always
  // had between its items, and nothing more.
  for (const tight of [space.tightPersian, space.tightLatin, space.tightBullets]) {
    expect(tight.every((gap) => gap < 6)).toBe(true);
  }
  // Written with a blank line: the blank line is there to see — a paragraph's
  // worth — and it is the same room in either script, under any marker.
  expect(space.loosePersian.every((gap) => gap >= 12)).toBe(true);
  expect(space.looseLatin).toEqual(space.loosePersian);
  expect(space.looseBullets).toEqual(space.loosePersian);
  expect(space.looseTasks).toEqual(space.loosePersian.slice(0, 1));
  // The quoted list he wrote: one list, with the gap he typed in it.
  expect(space.quotedGap.every((gap) => gap >= 12)).toBe(true);
});
