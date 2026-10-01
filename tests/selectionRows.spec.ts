import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    // Tight spacing, where the rows' font boxes exceed the line pitch and
    // the highlight boxes must be trimmed against each other.
    document.documentElement.style.setProperty('--note-line-height', '1.1');
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {});
    await document.fonts.ready;
  });
});

type Box = { top: number; bottom: number; left: number };

async function selectionRows(page: Page, text: string, from: number, to: number): Promise<Box[]> {
  return page.evaluate(async ({ text, from, to }) => {
    window.testEditor.setValue(text);
    window.testEditor.setSelection(from, to);
    // The layer paints on the next measure cycle.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return [...document.querySelectorAll('.cm-satr-selection')].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left };
    }).sort((a, b) => a.top - b.top || a.left - b.left);
  }, { text, from, to });
}

test('selection rows meet at their midpoints without overlapping', async ({ page }) => {
  const text = 'one two three\nfour five six\nseven eight nine';
  const boxes = await selectionRows(page, text, 4, text.length - 3);
  expect(boxes.length).toBeGreaterThanOrEqual(3);
  // Group into visual rows by their tops.
  const rows: Box[][] = [];
  for (const box of boxes) {
    const row = rows.find((r) => Math.abs(r[0].top - box.top) < 2);
    if (row) row.push(box); else rows.push([box]);
  }
  expect(rows.length).toBe(3);
  for (let i = 1; i < rows.length; i += 1) {
    const above = Math.max(...rows[i - 1].map((b) => b.bottom));
    const below = Math.min(...rows[i].map((b) => b.top));
    // Neighbouring rows share their edge: no gap left behind, no overlap.
    expect(Math.abs(below - above), `rows ${i - 1} and ${i}`).toBeLessThanOrEqual(0.5);
    expect(below).toBeGreaterThanOrEqual(above - 0.5);
  }
});

test('the empty end of a selected line still meets its neighbours', async ({ page }) => {
  const text = 'first line of text\n\nthird line of text';
  const boxes = await selectionRows(page, text, 0, text.length);
  expect(boxes.length).toBeGreaterThanOrEqual(3);
  const rows: Box[][] = [];
  for (const box of boxes) {
    const row = rows.find((r) => Math.abs(r[0].top - box.top) < 2);
    if (row) row.push(box); else rows.push([box]);
  }
  for (let i = 1; i < rows.length; i += 1) {
    const above = Math.max(...rows[i - 1].map((b) => b.bottom));
    const below = Math.min(...rows[i].map((b) => b.top));
    expect(Math.abs(below - above), `rows ${i - 1} and ${i}`).toBeLessThanOrEqual(0.5);
  }
});

test('select-all covers every text line and never paints the file title', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    const editor = new SatrEditor(host, () => {}, { title: 'My Note' });
    editor.setValue('# Heading one\n\nA paragraph of text here\n\nlast line');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const nameEl = host.querySelector<HTMLElement>('.cm-file-name')!;
    const glyph = document.createRange();
    glyph.selectNodeContents(nameEl);
    const title = glyph.getBoundingClientRect();
    editor.setSelection(0, editor.getValue().length);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const boxes = [...host.querySelectorAll('.cm-satr-selection')].map((el) => el.getBoundingClientRect());
    const rows = new Set(boxes.map((b) => Math.round(b.top))).size;
    const mid = (title.top + title.bottom) / 2;
    const overTitle = boxes.some((b) => b.top < mid && b.bottom > mid);
    return { rows, overTitle };
  });
  expect(out.rows).toBe(5); // five text lines, each with its own row
  expect(out.overTitle).toBe(false);
});

test('a widget at a selection endpoint is skipped, not painted', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    const editor = new SatrEditor(host, () => {}, { title: 'My Note' });
    editor.setValue('first line of the note\nsecond line');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const view = (editor as unknown as { view: { domAtPos(pos: number, side?: number): { node: Node; offset: number } } }).view;
    const titleText = host.querySelector('.cm-file-name')!.firstChild!;
    const original = view.domAtPos;
    // Simulate the endpoint resolving inside the title widget, which is how
    // a widget used to leak into the highlight (or kill the row entirely).
    view.domAtPos = (pos: number, side?: number) =>
      (pos === 0 ? { node: titleText, offset: 0 } : original.call(view, pos, side));
    editor.setSelection(0, 5);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    view.domAtPos = original;
    const title = host.querySelector<HTMLElement>('.cm-file-title')!.getBoundingClientRect();
    const boxes = [...host.querySelectorAll('.cm-satr-selection')].map((el) => el.getBoundingClientRect());
    return {
      painted: boxes.length,
      title: { top: Math.round(title.top), bottom: Math.round(title.bottom) },
      boxes: boxes.map((b) => ({ top: Math.round(b.top), bottom: Math.round(b.bottom) })),
    };
  });
  expect(out.painted).toBeGreaterThanOrEqual(1); // the text still highlights
  const mid = (out.title.top + out.title.bottom) / 2;
  // The widget's own glyphs are not painted.
  expect(out.boxes.some((b) => b.top < mid && b.bottom > mid), JSON.stringify(out)).toBe(false);
});

test('rows fall back to the caret geometry when text runs cannot be measured', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    const editor = new SatrEditor(host, () => {});
    editor.setValue('one two three\nfour five');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const view = (editor as unknown as { view: { domAtPos(pos: number, side?: number): { node: Node; offset: number } } }).view;
    const original = view.domAtPos;
    // Endpoints that resolve to nothing measurable (as a widget-only range
    // would): the text-run walk yields no geometry at all.
    const orphan = document.createElement('div');
    orphan.appendChild(document.createTextNode('detached'));
    view.domAtPos = () => ({ node: orphan.firstChild!, offset: 0 });
    editor.setSelection(0, 5);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    view.domAtPos = original;
    return [...document.querySelectorAll('.cm-satr-selection')].length;
  });
  expect(out).toBeGreaterThanOrEqual(1);
});

// Item 9: on the site, selecting the whole note must work every time — the
// document selection, the painted rows, and the native selection the browser
// copies from. (The app's own editor, not a bare test instance.)
test('select-all in the app selects every line and the native selection follows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const files = { 'Notes/A.md': 1 };
    localStorage.setItem('satr:fs:index', JSON.stringify({ files, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# Heading one\n\nA paragraph of text here\n\nSecond paragraph\n\nLast line');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await page.locator('#app .cm-content').click({ position: { x: 20, y: 60 } });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  await page.keyboard.press('Control+a');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const out = await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    const main = view.state.selection.main;
    return {
      from: main.from,
      to: main.to,
      length: view.state.doc.length,
      lines: view.state.doc.lines,
      rows: document.querySelectorAll('#app .cm-satr-selection').length,
      native: window.getSelection()?.toString() ?? '',
    };
  });
  expect(out.from).toBe(0);
  expect(out.to).toBe(out.length);
  // Every line is painted (a break mark on the blank ones) and the browser
  // can copy the text from its own selection.
  expect(out.rows).toBe(out.lines);
  expect(out.native).toContain('Last line');
  expect(out.native.length).toBeGreaterThan(50);
});

// Item 9: select-all must work every time, not just when the note already has
// the focus. After a tap on the chrome (the site leaves the focus on the
// page), Ctrl+A still means "the whole note" — while a field with its own
// select-all (the find bar) keeps it.
test('select-all works while the note itself is not focused, and never steals a field', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# Heading one\n\nA paragraph of text here\n\nSecond paragraph\n\nLast line');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await page.locator('#app .cm-content').click({ position: { x: 20, y: 60 } });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  // A tap on the chrome (the file title, the top bar) takes the focus away.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const focused = await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    return EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!.hasFocus;
  });
  expect(focused).toBe(false);

  await page.keyboard.press('Control+a');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const out = await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    const main = view.state.selection.main;
    return {
      from: main.from,
      to: main.to,
      length: view.state.doc.length,
      lines: view.state.doc.lines,
      rows: document.querySelectorAll('#app .cm-satr-selection').length,
      focused: view.hasFocus,
      native: window.getSelection()?.toString() ?? '',
    };
  });
  expect(out.from).toBe(0);
  expect(out.to).toBe(out.length);
  expect(out.rows).toBe(out.lines);
  expect(out.focused).toBe(true);
  expect(out.native).toContain('Last line');

  // The find bar's own field keeps its select-all.
  await page.keyboard.press('Control+f');
  const input = page.locator('.document-search-input input').first();
  await input.fill('Heading');
  await page.keyboard.press('Control+a');
  const kept = await page.evaluate(() => ({
    active: (document.activeElement as HTMLElement | null)?.tagName,
    inputValue: (document.activeElement as HTMLInputElement | null)?.value ?? '',
  }));
  expect(kept.active).toBe('INPUT');
  expect(kept.inputValue).toBe('Heading');
});

// Task 4: the native Android selection bar's "Select all" does not dispatch a
// keydown at all — it manipulates the DOM selection directly. Since the editor
// opted out of EditContext, the caret lives in that selection, so whatever the
// bar leaves there is the note's selection; nothing may quietly reset it on
// the next frame. (The device half of this — the bar itself — is manual, and
// is recorded in ROADMAP.md.)
test('a programmatic whole-document selection survives two frames', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# Heading one\n\nA paragraph of text here\n\nSecond paragraph\n\nLast line');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await page.locator('#app .cm-content').click({ position: { x: 20, y: 60 } });
  const out = await page.evaluate(async () => {
    // The contenteditable the bar acts on: the whole DOM contents, as the
    // platform's own select-all would take them.
    const content = document.querySelector<HTMLElement>('#app .cm-content')!;
    const range = document.createRange();
    range.selectNodeContents(content);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    const main = view.state.selection.main;
    return {
      native: window.getSelection()?.toString().length ?? 0,
      from: main.from,
      to: main.to,
      length: view.state.doc.length,
      rows: document.querySelectorAll('#app .cm-satr-selection').length,
      lines: view.state.doc.lines,
    };
  });
  // The selection is still there, whole, two frames later: the DOM's copy and
  // the editor's agree, and every line is painted.
  expect(out.native).toBeGreaterThan(50);
  expect(out.from).toBe(0);
  expect(out.to).toBe(out.length);
  expect(out.rows).toBe(out.lines);
});

// The same "Select all", from the other side: the platform's own command.
// Blink's SelectAll — the selection bar's item, a key binding, a WebView's
// selectAll() — runs *before* the selection moves, and it says so: it
// dispatches a cancelable selectstart on the editable root. That is the whole
// fix for "Select all works sometimes". Left alone, the platform turns "the
// whole editable element" into a caret at the note's end and CodeMirror
// faithfully copies that down, so the note looked deselected; whether the
// command had worked came down to which of the two won the race.
test('the platform\u2019s own Select all ends up as the whole note, every time', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# Heading one\n\nA paragraph of text here\n\nSecond paragraph\n\nLast line');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await page.locator('#app .cm-content').click({ position: { x: 20, y: 60 } });

  const read = () => page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    const main = view.state.selection.main;
    return { from: main.from, to: main.to, length: view.state.doc.length };
  });
  const setSelection = (anchor: number, head = anchor) => page.evaluate(async ({ anchor, head }) => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    view.dispatch({ selection: { anchor, head } });
  }, { anchor, head });
  // What the platform does to announce it: cancelable selectstart, root as target.
  const platformSelectAll = () => page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('#app .cm-content')!;
    return content.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true }));
  });

  // 1. From a word selection, and then again from a bare caret: the platform's
  //    command is not a coin toss about where the caret happened to be.
  await page.waitForTimeout(200); // the tap above used a finger; a command is not one
  await setSelection(9, 22);
  const announcedWithSelection = await platformSelectAll();
  expect(await read()).toEqual({ from: 0, to: (await read()).length, length: (await read()).length });
  // It was answered, not merely witnessed: Blink skips its own selection step
  // when the event is canceled.
  expect(announcedWithSelection).toBe(false);

  await setSelection(4);
  await platformSelectAll();
  const second = await read();
  expect(second).toEqual({ from: 0, to: second.length, length: second.length });

  // 2. A finger that came down in the editor is not a command: the platform's
  //    own touch selection keeps that selectstart, and the caret stays put.
  //    The command's own re-assert lands one frame after it, so let that frame
  //    pass first: what is being tested here is the finger, not the frame.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await setSelection(0, 11);
  await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('#app .cm-content')!;
    content.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
    content.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true }));
  });
  expect(await read()).toEqual({ from: 0, to: 11, length: (await read()).length });

  // 3. And the WebView that only moves the DOM selection — collapsed, but
  //    covering the whole region from the note's first character to its last.
  const viaDomSelection = await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    view.dispatch({ selection: { anchor: 2, head: 8 } });
    const content = view.contentDOM;
    const lines = content.querySelectorAll('.cm-line');
    const range = document.createRange();
    range.setStart(lines[0].firstChild!, 0);
    range.setEnd(lines[lines.length - 1].lastChild!, lines[lines.length - 1].lastChild!.textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const main = view.state.selection.main;
    return { from: main.from, to: main.to, length: view.state.doc.length };
  });
  expect(viaDomSelection).toEqual({ from: 0, to: viaDomSelection.length, length: viaDomSelection.length });

  // 4. A selection that is *not* the whole region is never taken for the note:
  //    it stays the small selection it is — here, the two characters the
  //    platform marked — and is not widened to the whole note. (That the
  //    editor then reads that selection back as its own is CodeMirror doing
  //    its job, and is what the native drag handles rely on.)
  const untouched = await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    view.dispatch({ selection: { anchor: 2, head: 8 } });
    const line = view.contentDOM.querySelector('.cm-line')!;
    // A line's first child may be a preview wrapper, not the text itself.
    const textOf = (node: Node): Node => (node.nodeType === Node.TEXT_NODE || !node.firstChild ? node : textOf(node.firstChild));
    const text = textOf(line);
    const range = document.createRange();
    const textLength = text.textContent?.length ?? 0;
    range.setStart(text, 0);
    range.setEnd(text, Math.min(2, textLength));
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const main = view.state.selection.main;
    return { from: main.from, to: main.to, length: view.state.doc.length };
  });
  expect(untouched.to - untouched.from).toBeLessThan(10);
  expect(untouched.to).toBeGreaterThan(0);
});

// The platform's *other* shape of "Select all", which is the one the report
// describes: a WebView whose command resolves against the page instead of the
// note (Blink's own hidden-selection case), so the selection it leaves is
// rooted at `body`. Both mean the same thing to a writer, so both end as the
// note — and neither a field's own selection nor the reading view's is
// mistaken for it.
test('a Select all that lands on the page, not on the note, still means the note', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# Heading one\n\nA paragraph of text here\n\nSecond paragraph\n\nLast line');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);

  const state = () => page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    const main = view.state.selection.main;
    return { from: main.from, to: main.to, length: view.state.doc.length };
  });

  // The note is on screen but the caret is not in it (the writer has tapped the
  // title): this is exactly when the platform's command resolves to the page.
  await page.locator('#app .cm-file-name').click();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.body);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForTimeout(60);
  const after = await state();
  expect(after).toEqual({ from: 0, to: after.length, length: after.length });

  // A field's own selection is anchored in the field, and is left alone.
  await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    view.dispatch({ selection: { anchor: 3, head: 9 } });
    const input = document.createElement('input');
    input.value = 'find bar text';
    document.body.appendChild(input);
    input.focus();
    input.select();
  });
  await page.waitForTimeout(60);
  expect(await state()).toEqual({ from: 3, to: 9, length: (await state()).length });
});
