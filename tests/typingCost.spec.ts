import { test, expect, type Page } from '@playwright/test';

// Typing in a big note used to cost what reading one did.
//
// Every keystroke re-scanned the whole document for formulas — twice. The
// editor's span field did it (`scanMath(tr.newDoc.toString())`), and the bar
// under the note did it again to count LaTeX-style formulas
// (`findLatexMath(editor.getValue())`). On 130kB of real notes that was 26ms
// of work per letter and a garbage collection every few words: 8 dropped
// frames in a 25-character sentence.
//
// Now a change that cannot move a formula's edges moves the spans it already
// has, and the document-wide count waits for the typing to stop.

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(120000);

/** A note big enough that scanning it is expensive: ~250kB, ~800 formulas,
 *  with display blocks that take three lines each. */
function longNote(sections: number): string {
  const out: string[] = ['# Term notes\n'];
  for (let i = 1; i <= sections; i += 1) {
    out.push(`\n## Section ${i}\n`);
    out.push(`Some prose for section ${i}, long enough to be a line or two on a phone and to leave room to type in the middle of it without being near either end of the line.\n`);
    out.push(`An inline formula $x_{${i}}^2 + y_{${i}}^2 = z^2$ inside a sentence, with more words after it.\n`);
    out.push('\n$$\n');
    out.push(`\\frac{a_{${i}}}{b_{${i}}} = \\sum_{k=1}^{${i}} \\sqrt{k}\n`);
    out.push('$$\n');
    out.push(`A closing line for section ${i} so the block is not the last thing in it.\n`);
  }
  return out.join('');
}

const NOTE = longNote(400);

async function boot(page: Page, text = NOTE): Promise<void> {
  await page.addInitScript((note) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'term.md': 1 }, folders: [] }));
    localStorage.setItem('satr:fs:file:term.md', note as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'term.md' }], active: 0 }));
    localStorage.setItem('satr:demoShown', '1');
  }, text);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/, { timeout: 30000 });
  await page.locator('.cm-content').click();
  await page.waitForTimeout(600);
}

/** Types into the middle of a prose line well down the note, the way a
 *  reader fixing a sentence does, and reports what it cost. */
async function typeInTheMiddle(page: Page, keys: number): Promise<{ median: number; kept: number; spans: number }> {
  return page.evaluate(async (count) => {
    const cm = (window as never as { __satr: { load(p: string): { EditorView: { findFromDOM(el: Element | null): { state: { doc: { length: number; lineAt(n: number): { from: number; to: number; length: number } } ; field(f: unknown): { from: number; to: number }[] }; dispatch(spec: unknown): void } | null } } } }).__satr.load('/node_modules/@codemirror/view/');
    const source = (window as never as { __satr: { load(p: string): { mathSpans: unknown } } }).__satr.load('/src/mathSource.ts');
    const view = cm.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    if (!view) throw new Error('no editor');
    const doc = view.state.doc;
    const line = doc.lineAt(Math.floor(doc.length * 0.6));
    const at = line.from + Math.max(8, Math.floor(line.length / 2));

    const before = view.state.field(source.mathSpans);
    const costs: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const t = performance.now();
      view.dispatch({ changes: { from: at + i, insert: 'x' } });
      costs.push(performance.now() - t);
    }
    const after = view.state.field(source.mathSpans);
    // A span the scan found again is a new object; one that was moved (or
    // did not move at all) is the very same object.
    let kept = 0;
    for (let i = 0; i < Math.min(before.length, after.length); i += 1) if (before[i] === after[i]) kept += 1;
    costs.sort((a, b) => a - b);
    return { median: costs[Math.floor(count / 2)], kept, spans: after.length };
  }, keys);
}

test('a letter typed into a big note does not read the whole note again', async ({ page }) => {
  await boot(page);
  const { median, kept, spans } = await typeInTheMiddle(page, 30);
  console.log(`median keystroke ${Math.round(median * 100) / 100}ms, ${kept} of ${spans} spans kept as they were`);
  // Re-scanning builds every span afresh, so none of them would survive.
  expect(kept).toBeGreaterThan(spans / 3);
  // And it shows: a scan of 250kB is tens of milliseconds, moving is not.
  expect(median).toBeLessThan(10);
});

test('a dollar typed in is still found at once', async ({ page }) => {
  await boot(page);
  const grew = await page.evaluate(() => {
    const cm = (window as never as { __satr: { load(p: string): { EditorView: { findFromDOM(el: Element | null): { state: { doc: { length: number; lineAt(n: number): { from: number; to: number; length: number } }; field(f: unknown): unknown[] }; dispatch(spec: unknown): void } | null } } } }).__satr.load('/node_modules/@codemirror/view/');
    const source = (window as never as { __satr: { load(p: string): { mathSpans: unknown } } }).__satr.load('/src/mathSource.ts');
    const view = cm.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    if (!view) throw new Error('no editor');
    const line = view.state.doc.lineAt(Math.floor(view.state.doc.length * 0.5));
    const before = view.state.field(source.mathSpans).length;
    view.dispatch({ changes: { from: line.to, insert: ' $q + 1$' } });
    return { before, after: view.state.field(source.mathSpans).length };
  });
  expect(grew.after).toBe(grew.before + 1);
});

test('a heading typed at the head of a line ends the block above it', async ({ page }) => {
  await boot(page, '# A note\n\nWords.\n\n$$\n\\frac{a}{b}\n$$\n\nMore words.\n');
  const spans = await page.evaluate(() => {
    const cm = (window as never as { __satr: { load(p: string): { EditorView: { findFromDOM(el: Element | null): { state: { doc: { line(n: number): { from: number } }; field(f: unknown): unknown[] }; dispatch(spec: unknown): void } | null } } } }).__satr.load('/node_modules/@codemirror/view/');
    const source = (window as never as { __satr: { load(p: string): { mathSpans: unknown } } }).__satr.load('/src/mathSource.ts');
    const view = cm.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    if (!view) throw new Error('no editor');
    const before = view.state.field(source.mathSpans).length;
    // line 6 is "\frac{a}{b}", inside the pair
    view.dispatch({ changes: { from: view.state.doc.line(6).from, insert: '# ' } });
    return { before, after: view.state.field(source.mathSpans).length };
  });
  expect(spans.before).toBe(1);
  expect(spans.after).toBe(0);
});

test('the offer to convert LaTeX-style formulas waits for the typing to stop', async ({ page }) => {
  await boot(page, '# A note\n\nPlain words, with no formula of any kind in them.\n');
  const pill = page.locator('#navbar [data-math-warning]');
  await expect(pill).toBeHidden();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' and \\(y + 1\\) too');
  // Counting means reading the whole note, which is not something to do for
  // every letter: at the moment the last key lands, it has not happened yet.
  await expect(pill).toBeHidden();
  // And then the typing stops, and the offer is there.
  await expect(pill).toContainText('1 LaTeX-style formula — tap to convert', { timeout: 5000 });
});
