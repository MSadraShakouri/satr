import { expect, test, type Page } from '@playwright/test';

// The phone's own selection bar (src/selectionBar.ts).
//
// Android's bar appears for a selection the WebView made itself; Satr's double
// tap finds the word on its own, and a platform will not raise its bar for a
// selection it did not make — so the app brings the same actions itself, plus
// Markor's Line ("expand selection of cursor to whole line"). The finger's
// selection is made here the way the app makes it (its own double tap on a
// synthetic touch: a synthetic touch makes no selection of its own).
test.use({ hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });

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

/** Two taps on a word in the note: the app's own word selection, which is what
 *  a finger does on the phone where the WebView makes no selection of its own. */
async function doubleTapWord(page: Page, word: string): Promise<void> {
  await page.evaluate(async (word) => {
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
    const rect = range.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const fire = (type: string): void => {
      const touch = new Touch({ identifier: 1, target: content, clientX: x, clientY: y });
      const live = type !== 'touchend';
      content.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: live ? [touch] : [], targetTouches: live ? [touch] : [], changedTouches: [touch],
      }));
    };
    fire('touchstart');
    fire('touchend');
    fire('touchstart');
    fire('touchend');
    await new Promise((r) => window.setTimeout(r, 200));
  }, word);
}

test('a word selected with a finger gets the app\'s own bar, with the menu\'s actions', async ({ page }) => {
  await boot(page);
  const bar = page.locator('.selection-bar');
  await expect(bar).toBeHidden();
  await doubleTapWord(page, 'paragraph');
  await expect(bar).toBeVisible();
  // The four Android actions and Markor's Line.
  for (const label of ['Line', 'Cut', 'Copy', 'Paste', 'Select all']) {
    await expect(bar.getByText(label, { exact: true })).toBeVisible();
  }
  // Over the selection, not over the whole screen.
  const box = (await bar.boundingBox())!;
  const rect = await page.evaluate(() => window.getSelection()?.getRangeAt(0).getBoundingClientRect() ?? null);
  expect(rect).not.toBeNull();
  expect(box.y + box.height).toBeLessThanOrEqual(rect!.top + 1);
});

test('Line grows the selection to the whole line, and Copy copies that', async ({ page }) => {
  await boot(page);
  await doubleTapWord(page, 'task');
  await page.locator('.selection-bar button', { hasText: 'Line' }).click();
  await page.locator('.selection-bar button', { hasText: 'Copy' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // The whole line, marker and all — Markor's full-line selection, so a line
  // can be copied or deleted whole without dragging handles.
  expect(copied).toBe('- [ ] a task line to select whole');
});

test('the bar follows the note and gets out of the way', async ({ page }) => {
  await boot(page);
  await doubleTapWord(page, 'paragraph');
  const bar = page.locator('.selection-bar');
  await expect(bar).toBeVisible();
  // A tap somewhere else collapses the selection: nothing to have a bar for.
  await page.locator('#app .cm-content').click();
  await expect(bar).toBeHidden();
});

test('a press on the bar lets the note\'s focus go, so no keyboard comes with the menu', async ({ page }) => {
  await boot(page);
  await page.locator('#app .cm-content').click();
  expect(await page.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false)).toBe(true);
  await page.locator('#nav-menu').tap();
  // The tap is the bar's, not the note's: the editable is let go, so the
  // WebView has no focused field to bring a keyboard up for.
  expect(await page.evaluate(() => document.activeElement?.className ?? '')).not.toContain('cm-content');
});

test('the note is the platform\'s to select, not the app\'s', async ({ page }) => {
  // The Android menu can only appear for a selection the WebView itself
  // recognises, so nothing about the note may tell the platform to keep its
  // hands off the text: the content is selectable, a long press may raise its
  // callout, and the one gesture the page has taken for itself is the double
  // tap's zoom — panning, pinching and the platform's selection all stay.
  await boot(page);
  const style = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('#app .cm-content')!;
    const computed = getComputedStyle(content);
    return {
      userSelect: computed.userSelect,
      touchAction: computed.touchAction,
      callout: computed.getPropertyValue('-webkit-touch-callout').trim(),
    };
  });
  expect(style.userSelect).not.toBe('none');
  expect(style.touchAction).toBe('manipulation');
  expect(style.callout).not.toBe('none');
});

// One menu at a time. The platform raises its own bar and handles for a
// selection it made from a gesture it recognised — a long press in the app, a
// double click or a drag of its own on the site. Ours is for the selections
// the platform did not make, which are the app's own; standing beside the
// platform's was two pop-ups at once ("site-native and Android pop-up showing
// at the same time").
test('a selection the platform made keeps the platform’s menu, not ours', async ({ page }) => {
  await boot(page);
  await doubleTapWord(page, 'paragraph');
  await expect(page.locator('.selection-bar')).toBeVisible();
  // The same text, selected by the engine rather than by the app (this is
  // what a browser drag or double click does): ours stands down.
  await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('#app .cm-content')!;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node && !(node.nodeValue ?? '').includes('paragraph')) node = walker.nextNode() as Text | null;
    const range = document.createRange();
    const length = Math.min(9, node?.nodeValue?.length ?? 0);
    range.setStart(node!, 0);
    range.setEnd(node!, length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await expect(page.locator('.selection-bar')).toBeHidden();
  await expect(page.locator('.selection-handles')).toBeHidden();
});

test('Line is a step: a second press gives the finger’s own selection back', async ({ page }) => {
  await boot(page);
  await doubleTapWord(page, 'task');
  const word = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(word).toBe('task');
  await page.locator('.selection-bar button', { hasText: 'Line' }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('- [ ] a task line to select whole');
  // Markor's whole line is how a line gets copied whole without dragging
  // handles — and the way back is the same button.
  await page.locator('.selection-bar button', { hasText: 'Line' }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe(word);
});

test('the selection carries its own handles, and dragging one moves that end', async ({ page }) => {
  await boot(page);
  await doubleTapWord(page, 'paragraph');
  const handles = page.locator('.selection-handles');
  await expect(handles).toBeVisible();
  const start = page.locator('.selection-handle[data-edge="start"]');
  const end = page.locator('.selection-handle[data-edge="end"]');
  await expect(start).toBeVisible();
  await expect(end).toBeVisible();
  // Under the two ends of the selection they belong to.
  const ends = await page.evaluate(() => {
    const range = window.getSelection()!.getRangeAt(0);
    const boxes = range.getClientRects();
    return { first: boxes[0].left, last: boxes[boxes.length - 1].right, bottom: range.getBoundingClientRect().bottom };
  });
  const startBox = (await start.boundingBox())!;
  const endBox = (await end.boundingBox())!;
  expect(Math.abs(startBox.x + startBox.width / 2 - ends.first)).toBeLessThanOrEqual(3);
  expect(Math.abs(endBox.x + endBox.width / 2 - ends.last)).toBeLessThanOrEqual(3);
  expect(startBox.y).toBeGreaterThanOrEqual(ends.bottom);
  // The end handle is dragged to the end of the line: the selection grows
  // with the finger instead of having to be started over.
  const target = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('#app .cm-content')!;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const at = (node.nodeValue ?? '').indexOf('something');
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + 'something'.length);
      range.setEnd(node, at + 'something'.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left, y: (rect.top + rect.bottom) / 2 };
    }
    throw new Error('no something in the note');
  });
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('paragraph with some words in it, so there is something');
});

// "The bottom hamburger sometimes triggers the keyboard": a WebView re-opens
// the keyboard for the editable that still has focus when a button in the page
// is tapped, so a finger on the bar lets the note's focus go first. A mouse is
// the other way round — on a desktop the focus *is* what the writer is typing
// into, and there is no keyboard to bring up — so the mouse keeps it.
test('a finger on the ≡ lets the note’s focus go, a mouse keeps it', async ({ page }) => {
  await boot(page);
  const focused = (): Promise<boolean> => page.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false);
  const press = (pointerType: string): Promise<void> => page.evaluate((pointerType) => {
    document.querySelector('#navbar')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType }));
  }, pointerType);
  await page.locator('#app .cm-content').click();
  expect(await focused()).toBe(true);
  // The mouse: the note keeps the focus it is being typed into.
  await press('mouse');
  expect(await focused()).toBe(true);
  await press('pen');
  expect(await focused()).toBe(true);
  // The finger: the note is let go, so the WebView has no focused field to
  // bring a keyboard up for.
  await press('touch');
  expect(await focused()).toBe(false);
});

// Android's own bar can ask for the line as well: "Line" is appended to the
// WebView's selection menu in Java, and its handler is this one call into the
// page (android/…/SatrWebView.java, Markor's ☰ item). The selection it makes
// belongs to the platform, so the app's bar stays down and Android's menu is
// the one on screen.
test('Android’s own Line item grows the selection without raising ours', async ({ page }) => {
  await boot(page);
  const line = await page.evaluate(async () => {
    const view = document.querySelector<HTMLElement>('#app .cm-content')!;
    const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node && !(node.nodeValue ?? '').includes('task')) node = walker.nextNode() as Text | null;
    const range = document.createRange();
    const at = (node!.nodeValue ?? '').indexOf('task');
    range.setStart(node!, at);
    range.setEnd(node!, at + 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await new Promise((r) => window.setTimeout(r, 60));
    const before = selection.toString();
    window.satrSelectionAction!('line');
    await new Promise((r) => window.setTimeout(r, 60));
    return { before, after: window.getSelection()?.toString() ?? '' };
  });
  expect(line.before).toBe('task');
  expect(line.after).toBe('- [ ] a task line to select whole');
  await expect(page.locator('.selection-bar')).toBeHidden();
});
