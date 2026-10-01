import { expect, test, type Page } from '@playwright/test';

// What is left of the phone's selection work once the bar itself is gone:
// Markor's whole-line action — **Line** — on the two surfaces that are not the
// app's own menu.
//
// Android raises its own bar (Cut / Copy / Paste / Select all) for a selection
// the WebView made, and the selection is the WebView's now (see the note in
// tests/touchSelection.spec.ts), so there is no second menu for the app to
// bring. What Markor adds to *its* bar is one item — the whole-line selection
// (`TextViewUtils.getLineSelection` behind a `☰` item, frontend/textview/
// HighlightingEditor.java) — and Satr adds the same item to Android's bar in
// Java (android/…/SatrWebView.java), whose handler is the page call tested
// here. The same action is on the keyboard toolbar, for a caret, where Markor
// keeps it too.
test.use({ hasTouch: true });

const NOTE = [
  '# Heading',
  '',
  'A paragraph with some words in it, so there is something to select.',
  '',
  '- [ ] a task line to select whole',
].join('\n');

async function boot(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/Note.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/Note.md', text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/Note.md' }], active: 0 }));
  }, NOTE);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('Note');
  await page.evaluate(() => document.fonts.ready);
}

/** A word selected the way the platform makes one: a real DOM selection over
 *  the note's text (what a double tap or a long press leaves behind). */
async function selectWord(page: Page, word: string): Promise<void> {
  await page.evaluate((word) => {
    const content = document.querySelector<HTMLElement>('#app .cm-content')!;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    for (let next = walker.nextNode() as Text | null; next; next = walker.nextNode() as Text | null) {
      if ((next.nodeValue ?? '').includes(word)) { node = next; break; }
    }
    if (!node) throw new Error(`no ${word} in the note`);
    const at = (node.nodeValue ?? '').indexOf(word);
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + word.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, word);
  await page.waitForTimeout(60);
}

test('the note is the platform’s to select: nothing tells it to keep its hands off', async ({ page }) => {
  await boot(page);
  const style = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('#app .cm-content')!;
    const computed = getComputedStyle(content);
    return {
      userSelect: computed.userSelect,
      // No touch-action override, as Obsidian has none on its editor: the
      // double-tap zoom is forbidden in the viewport meta instead.
      touchAction: computed.touchAction,
      callout: computed.getPropertyValue('-webkit-touch-callout').trim(),
    };
  });
  expect(style.userSelect).toBe('text');
  expect(style.touchAction).toBe('auto');
  expect(style.callout === '' || style.callout === 'default').toBe(true);
  // And the app brings no menu of its own any more: no bar, no handles.
  await selectWord(page, 'paragraph');
  await expect(page.locator('.selection-bar')).toHaveCount(0);
  await expect(page.locator('.selection-handles')).toHaveCount(0);
});

test('Android’s own Line item — Markor’s ☰ — grows the selection to the whole line', async ({ page }) => {
  await boot(page);
  await selectWord(page, 'task');
  const line = await page.evaluate(async () => {
    const before = window.getSelection()?.toString() ?? '';
    window.satrSelectionAction!('line');
    await new Promise((r) => window.setTimeout(r, 60));
    return { before, after: window.getSelection()?.toString() ?? '' };
  });
  expect(line.before).toBe('task');
  expect(line.after).toBe('- [ ] a task line to select whole');
});

test('the toolbar’s whole-line action does the same for a caret', async ({ page }) => {
  await boot(page);
  // A real click on the task line: the caret goes where the finger's would,
  // in the editor's own state.
  const line = page.locator('#app .cm-line', { hasText: 'task line to select whole' });
  const box = (await line.boundingBox())!;
  await page.mouse.click(box.x + 30, box.y + box.height / 2);
  await expect(page.locator('#app .cm-content')).toBeFocused();
  // The toolbar's own click path (its listener calls editor.run('line')); the
  // strip itself sits over the note and is not hit-testable in a headless run.
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#edit-toolbar-list button[data-command="line"]')!.click());
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('- [ ] a task line to select whole');
});
