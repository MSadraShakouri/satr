import { test, expect, type Page } from '@playwright/test';

/** Source mode and the reading view put a block in the same place: a list, a
 *  task and a quote start at the same x in both, at every level, and a row
 *  that wraps comes back to the same x too. The numbers themselves live in
 *  one place — LIST_GUTTER_CH / LIST_INDENT_EM / QUOTE_STEP_PX in
 *  src/livePreview.ts, the matching rules in src/style.css — and this spec is
 *  what holds the two views to them. */

const NOTE = `Paragraph before, long enough that it has to wrap onto a second row of its own.

- BULLETONE item written long enough that it has to wrap onto a second row of the pane
- BULLETTWO
  - NESTEDBULLET item written long enough that it has to wrap onto a second row of the pane

1. NUMBERONE item written long enough that it has to wrap onto a second row of the pane
2. NUMBERTWO

- [ ] TASKUNDONE item written long enough that it has to wrap onto a second row of the pane
- [x] TASKDONE item written long enough that it has to wrap onto a second row of the pane

> QUOTEONE line written long enough that it has to wrap onto a second row of the pane

> > NESTEDQUOTE line written long enough that it has to wrap onto a second row of the pane
`;

/** Every word measured, and what it is. */
const WORDS = ['BULLETONE', 'NESTEDBULLET', 'NUMBERONE', 'TASKUNDONE', 'TASKDONE', 'QUOTEONE', 'NESTEDQUOTE'] as const;
type Word = (typeof WORDS)[number];
type Spot = { row1: number; row2: number | null; rows: number };

async function boot(page: Page, note: string = NOTE): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/parity.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/parity.md', text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/parity.md' }], active: 0 }));
  }, note);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('parity');
  // The start-up cover is a styled copy of the note: measuring while it is up
  // measures the copy, not the editor (src/snapshot.ts).
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.waitForTimeout(300);
}

/** Where each word starts in a pane, and where its wrapped row starts. */
function measure(page: Page, pane: string): Promise<Record<Word, Spot>> {
  return page.evaluate(({ pane, words }) => {
    const root = document.querySelector(pane) as HTMLElement;
    const base = root.getBoundingClientRect();
    const found: Record<string, Spot> = {};
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (const word of words) {
        const at = text.indexOf(word);
        if (at < 0 || found[word]) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, text.length);
        const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 1);
        if (!rects.length) continue;
        // One row can report more than one rect (a space hanging at the end
        // of a row is its own), so a row is a top, and where it starts is the
        // leftmost of the rects sitting on it.
        const byRow = new Map<number, number>();
        for (const rect of rects) {
          const top = Math.round(rect.top);
          byRow.set(top, Math.min(byRow.get(top) ?? Infinity, rect.left));
        }
        const starts = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, left]) => Math.round(left - base.left));
        found[word] = { row1: starts[0], row2: starts[1] ?? null, rows: starts.length };
      }
    }
    return found;
  }, { pane, words: WORDS as unknown as string[] }) as Promise<Record<Word, Spot>>;
}

test('a list, a task and a quote start at the same x in both views', async ({ page }) => {
  await boot(page);
  const editor = await measure(page, '#editor-pane .cm-content');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
  await page.waitForTimeout(600);
  const reading = await measure(page, '#preview-pane');

  for (const word of WORDS) {
    expect(editor[word], `${word} in source mode`).toBeTruthy();
    expect(reading[word], `${word} in the reading view`).toBeTruthy();
    // the first row starts in the same place...
    expect(Math.abs(editor[word].row1 - reading[word].row1), `${word}: x ${editor[word].row1} in source mode, ${reading[word].row1} in the reading view`).toBeLessThanOrEqual(1);
    // ...and so does the row it wraps onto
    expect(editor[word].rows, `${word} wraps in source mode`).toBeGreaterThan(1);
    expect(reading[word].rows, `${word} wraps in the reading view`).toBeGreaterThan(1);
    expect(Math.abs((editor[word].row2 ?? -1) - (reading[word].row2 ?? -2)), `${word}: wrapped row at ${editor[word].row2} in source mode, ${reading[word].row2} in the reading view`).toBeLessThanOrEqual(1);
  }
});

test('a task lines up with a bullet, and a level steps the same way in both views', async ({ page }) => {
  await boot(page);
  const editor = await measure(page, '#editor-pane .cm-content');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
  await page.waitForTimeout(600);
  const reading = await measure(page, '#preview-pane');

  for (const [view, spots] of [['source mode', editor], ['the reading view', reading]] as const) {
    // a checkbox hangs in the strip: its text starts where a bullet's does
    expect(Math.abs(spots.TASKUNDONE.row1 - spots.BULLETONE.row1), `task vs bullet in ${view}`).toBeLessThanOrEqual(1);
    expect(Math.abs(spots.TASKDONE.row1 - spots.BULLETONE.row1), `done task vs bullet in ${view}`).toBeLessThanOrEqual(1);
    // a number's text starts there too, whatever the number is
    expect(Math.abs(spots.NUMBERONE.row1 - spots.BULLETONE.row1), `number vs bullet in ${view}`).toBeLessThanOrEqual(1);
    // one level of nesting is one step, the same step in both views
    expect(spots.NESTEDBULLET.row1 - spots.BULLETONE.row1, `one list level in ${view}`).toBeGreaterThan(30);
    expect(spots.NESTEDQUOTE.row1 - spots.QUOTEONE.row1, `one quote level in ${view}`).toBeGreaterThan(20);
  }
  expect(editor.NESTEDBULLET.row1 - editor.BULLETONE.row1).toBe(reading.NESTEDBULLET.row1 - reading.BULLETONE.row1);
  expect(editor.NESTEDQUOTE.row1 - editor.QUOTEONE.row1).toBe(reading.NESTEDQUOTE.row1 - reading.QUOTEONE.row1);
});

/** The text of each measured word's row, up to where the row breaks. */
function firstRows(page: Page, pane: string): Promise<Record<Word, string>> {
  return page.evaluate(({ pane, words }) => {
    const root = document.querySelector(pane) as HTMLElement;
    const found: Record<string, string> = {};
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (const word of words) {
        const at = text.indexOf(word);
        if (at < 0 || found[word]) continue;
        const topOf = (i: number): number => {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          return Math.round(range.getBoundingClientRect().top);
        };
        const first = topOf(at);
        let fits = at;
        for (let i = at + 1; i < text.length; i += 1) {
          if (topOf(i) !== first) break;
          fits = i;
        }
        found[word] = text.slice(at, fits + 1).trimEnd();
      }
    }
    return found;
  }, { pane, words: WORDS as unknown as string[] }) as Promise<Record<Word, string>>;
}

test('a row breaks at the same word in both views', async ({ page }) => {
  // CodeMirror's wrapped mode asks for `white-space: break-spaces`, which
  // makes the space after the last word of a row have to fit on that row:
  // source mode dropped a word the reading view kept. style.css puts the
  // lines back on `pre-wrap`, where the space hangs as it does in HTML.
  await boot(page);
  const editor = await firstRows(page, '#editor-pane .cm-content');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
  await page.waitForTimeout(600);
  const reading = await firstRows(page, '#preview-pane');
  for (const word of WORDS) {
    expect(editor[word], `${word} breaks at the same word`).toBe(reading[word]);
  }
});

/** A lettered list, in both scripts, written so each list's first item has to
 *  wrap, with a paragraph above each to measure the text's own column from.
 *  `a.` fits the platform's strip; `الف.` is a word and needs a wider one —
 *  the reading view has always widened it, and source mode now widens it to
 *  the same measurement (src/markerWidth.ts). */
const LETTERED = `متن ساده برای اندازه‌گیری

الف. یک آیتم با متن به اندازه کافی بلند که حتماً به سطر دوم می‌رود و باید زیر متن بیفتد
ب. دو

plain paragraph to measure from

a. one item written long enough that it has to wrap onto a second row of the pane
b. two
`;

/** How far a word's row begins from the note's own margin — the paragraph
 *  above it, read from the side its script starts on. The two panes keep
 *  their own padding, so each view is measured against its own text column.
 */
function indentOf(page: Page, pane: string, pairs: string[][]): Promise<Array<{ row1: number; row2: number | null }>> {
  return page.evaluate(({ pane, pairs }) => {
    const root = document.querySelector(pane) as HTMLElement;
    const starts = (word: string): number[] => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        const at = text.indexOf(word);
        if (at < 0) continue;
        const rtl = getComputedStyle(node.parentElement as HTMLElement).direction === 'rtl';
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, text.length);
        const byRow = new Map<number, number>();
        for (const rect of range.getClientRects()) {
          if (rect.width <= 1) continue;
          const top = Math.round(rect.top);
          const edge = rtl ? -rect.right : rect.left;
          byRow.set(top, Math.min(byRow.get(top) ?? Infinity, edge));
        }
        return [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, edge]) => edge);
      }
      return [];
    };
    return pairs.map(([margin, item]) => {
      const from = starts(margin)[0];
      const rows = starts(item);
      return {
        row1: Math.round(rows[0] - from),
        row2: rows[1] === undefined ? null : Math.round(rows[1] - from),
      };
    });
  }, { pane, pairs });
}

const LETTER_ROWS = [['متن ساده', 'یک آیتم'], ['plain paragraph', 'one item']];

test('a lettered list is laid out as a list in both views, in both scripts', async ({ page }) => {
  // Reported: "for letter lists both systems, it would be so much better".
  // CommonMark has no lettered list for the parser to read, so source mode
  // drew these as prose — the text started right after the marker and a
  // wrapped row went back to the margin — while the reading view drew them
  // as the lists they are. The editor draws the strip and the hanging indent
  // itself now, from the same measurement the reading view uses.
  await boot(page, LETTERED);
  const editor = await indentOf(page, '#editor-pane .cm-content', LETTER_ROWS);
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
  await page.waitForTimeout(600);
  const reading = await indentOf(page, '#preview-pane', LETTER_ROWS);

  for (const [i, script] of ['Persian', 'English'].entries()) {
    // the text is carried in past the marker — a list, not prose
    expect(editor[i].row1, `${script}: a lettered item is indented in source mode`).toBeGreaterThan(20);
    // ...by the same step as in the reading view
    expect(Math.abs(editor[i].row1 - reading[i].row1), `${script}: indent ${editor[i].row1} in source mode, ${reading[i].row1} in the reading view`).toBeLessThanOrEqual(1);
    // ...and the row it wraps onto comes back under the text, not to the margin
    expect(editor[i].row2, `${script} wraps in source mode`).not.toBeNull();
    expect(Math.abs((editor[i].row2 ?? 0) - editor[i].row1), `${script}: wrapped row at ${editor[i].row2}, text at ${editor[i].row1}`).toBeLessThanOrEqual(1);
    expect(Math.abs((editor[i].row2 ?? -1) - (reading[i].row2 ?? -2)), `${script}: wrapped row in both views`).toBeLessThanOrEqual(1);
  }
  // `الف.` is a word: its list keeps a wider strip than `a.` does, in both views
  expect(editor[0].row1, 'الف. needs more room than a.').toBeGreaterThan(editor[1].row1 + 2);
  expect(reading[0].row1 - reading[1].row1, 'and the same more in both views').toBe(editor[0].row1 - editor[1].row1);
});

/** A list that reaches ten: the markers are no longer all the same width. */
const WIDE = `plain paragraph to measure from

8. eight
9. nine
10. ten
11. eleven

متن ساده برای اندازه‌گیری

۸. هشت
۹. نه
۱۰. ده
۱۱. یازده
`;

const WIDE_ROWS = [['plain paragraph', 'eight'], ['plain paragraph', 'eleven'], ['متن ساده', 'هشت'], ['متن ساده', 'یازده']];

test('every item of a list begins in one column, however wide its marker', async ({ page }) => {
  // Reported: "I wanted the text after the x. or x) to be aligned like how
  // it is in preview, it seems like even English numbers aren't."
  // The strip was a floor under each line's own marker, so `10.` carried its
  // own text in by the width it overran — 1px for `10.`, 2px for `10)` —
  // while the reading view hangs every marker in one strip, the list's. The
  // strip is the run's now, measured where the reading view measures its
  // own, and a marker too wide for the platform's 3ch hangs out of it in
  // both views rather than moving the text.
  await boot(page, WIDE);
  const editor = await indentOf(page, '#editor-pane .cm-content', WIDE_ROWS);
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
  await page.waitForTimeout(600);
  const reading = await indentOf(page, '#preview-pane', WIDE_ROWS);

  for (const [view, rows] of [['source mode', editor], ['the reading view', reading]] as const) {
    expect(rows[1].row1, `English: 8. at ${rows[0].row1}, 11. at ${rows[1].row1} in ${view}`).toBe(rows[0].row1);
    expect(rows[3].row1, `Persian: ۸. at ${rows[2].row1}, ۱۱. at ${rows[3].row1} in ${view}`).toBe(rows[2].row1);
  }
  for (const [i, what] of ['English 8.', 'English 11.', 'Persian ۸.', 'Persian ۱۱.'].entries()) {
    expect(Math.abs(editor[i].row1 - reading[i].row1), `${what}: ${editor[i].row1} in source mode, ${reading[i].row1} in the reading view`).toBeLessThanOrEqual(1);
  }
});

test('the bullet stands the same distance from the text in both views', async ({ page }) => {
  // Reported: "for bullet lists, source mode is preferred because it has
  // more space between the text and bullet". The reading view asked the
  // platform for its disc, which each engine places by its own marker box;
  // it draws the editor's own dot now — 0.3em across, its centre 0.75em into
  // the strip — so the two cannot drift apart.
  await boot(page);
  const editor = await page.evaluate(() => {
    const bullet = document.querySelector('.cm-lp-bullet') as HTMLElement;
    const strip = bullet.closest('.cm-lp-marker') as HTMLElement;
    const dot = getComputedStyle(bullet, '::after');
    // from the dot's centre to where the text starts: the strip, less how
    // far into it the dot stands
    const into = parseFloat(dot.insetInlineStart) + parseFloat(dot.marginInlineStart) + parseFloat(dot.width) / 2;
    return { gap: strip.getBoundingClientRect().width - into, size: parseFloat(dot.width) };
  });
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
  await page.waitForTimeout(600);
  const reading = await page.evaluate(() => {
    const item = document.querySelector('#preview-pane ul > li') as HTMLElement;
    const dot = getComputedStyle(item, '::before');
    const task = document.querySelector('#preview-pane li:has(> input[type="checkbox"])') as HTMLElement;
    return {
      gap: parseFloat(dot.marginInlineEnd) + parseFloat(dot.width) / 2,
      size: parseFloat(dot.width),
      onATask: getComputedStyle(task, '::before').content,
    };
  });
  expect(reading.size, 'the same dot').toBeCloseTo(editor.size, 1);
  expect(reading.gap, `dot to text: ${editor.gap} in source mode, ${reading.gap} in the reading view`).toBeCloseTo(editor.gap, 1);
  // a task draws its box instead, and no dot with it
  expect(reading.onATask).toBe('none');
});

/** A checklist's box stands in the same column in both views, at any text
 *  size. Reported after 0.15.0: "the checkbox moves a bit to the side when
 *  switching from source to preview... in the APK it's a lot more visible".
 *
 *  It was two numbers for one column. Source mode draws the box from the
 *  list gutter (3ch, src/livePreview.ts); the reading view had it pulled
 *  back by a hard-coded -25.5px, which is 3ch of the font the spec was
 *  written at and nothing in particular at any other size. On a phone with
 *  its font scale turned up the two drifted a dozen pixels apart — hence
 *  the APK. One gutter now, shared by both (--list-gutter in src/style.css),
 *  and the box is set into it by the same inset in both views. */
test('a checklist box stands in the same column in both views, at any text size', async ({ page }) => {
  await boot(page, '- [ ] کار یکم\n- [x] کار دوم\n\n- [ ] first task\n- [x] second task\n');
  const boxes = () => page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('#preview-pane');
    const showing = pane && pane.offsetParent !== null ? pane : document.querySelector<HTMLElement>('#editor-pane .cm-content')!;
    return [...showing.querySelectorAll('.cm-lp-task, input[type=checkbox]')].map((box) => {
      const rect = box.getBoundingClientRect();
      const row = box.closest('li, .cm-line');
      const rtl = getComputedStyle(row ?? box).direction === 'rtl';
      // The square the reader sees. In the reading view that is the input
      // itself; in source mode the marker is a zero-width span and the
      // square is the ::before it draws, a margin in from the span's edge.
      const drawn = box.matches('input') ? null : getComputedStyle(box, '::before');
      const inset = drawn ? parseFloat(drawn.marginInlineStart) || 0 : 0;
      const width = drawn ? parseFloat(drawn.width) || 0 : rect.width;
      return {
        text: (row?.textContent ?? '').trim().slice(0, 10),
        // The edge the row starts from, so the two scripts are read the same way.
        edge: Math.round((rtl ? -(rect.right - inset) : rect.left + inset) * 10) / 10,
        width: Math.round(width * 10) / 10,
      };
    });
  });
  for (const rem of [16, 24]) {
    // Android hands the WebView its own root rem when the reader turns the
    // phone's font scale up, and the note is sized in rem.
    await page.evaluate((px) => { document.documentElement.style.fontSize = `${px}px`; }, rem);
    await page.waitForTimeout(400);
    const source = await boxes();
    await page.evaluate(() => (document.querySelector('#preview-toggle') as HTMLElement).click());
    await page.waitForTimeout(500);
    const reading = await boxes();
    expect(reading.length, `four boxes at ${rem}px`).toBe(source.length);
    for (const [i, box] of source.entries()) {
      expect(Math.abs(reading[i].edge - box.edge), `"${box.text}" at ${rem}px: source ${box.edge}, reading ${reading[i].edge}`).toBeLessThanOrEqual(1);
      expect(Math.abs(reading[i].width - box.width), `"${box.text}" box width at ${rem}px`).toBeLessThanOrEqual(1);
    }
    await page.evaluate(() => (document.querySelector('#preview-toggle') as HTMLElement).click());
    await page.waitForTimeout(400);
  }
});

test('a formula and a code span stand on the same side of a Persian line in both views', async ({ page }) => {
  // A formula is one thing, not a run of Latin letters that happens to sit in
  // a sentence: it is isolated, so on a Persian line it stands apart from the
  // English words around it instead of being swept up into their run. The
  // reading view and the PDF have always drawn it that way (a rendered
  // formula is a box, and a box is a neutral object in an RTL paragraph); the
  // editor was the odd one out, writing the formula between سلام and the
  // English. Both views put it on the far side of the English now.
  const note = 'سلام Inline math: $a^2 + b^2 = c^2$.\n\nسلام Inline code: `const x = 1`.\n';
  await boot(page, note);
  const source = await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    const at = (p: number) => view.coordsAtPos(p, 1)!.left;
    // `Inline` on each line, then the formula's and the code span's content.
    return { word: [at(5), at(43)], inner: [Math.max(at(19), at(33)), Math.max(at(57), at(67))] };
  });
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
  const reading = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('#preview-pane p'));
    const word = (p: Element) => {
      const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walk.nextNode())) {
        const i = (n.textContent || '').indexOf('Inline');
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + 'Inline'.length);
        return r.getBoundingClientRect().left;
      }
      return NaN;
    };
    return {
      word: [word(ps[0]), word(ps[1])],
      inner: [ps[0].querySelector('.math-flow')!.getBoundingClientRect().right, ps[1].querySelector('code')!.getBoundingClientRect().right],
    };
  });
  for (const [view, spots] of [['source mode', source], ['the reading view', reading]] as const) {
    for (const [k, what] of [[0, 'a formula'], [1, 'a code span']] as const) {
      expect(spots.inner[k], `${view}: ${what} stands past the English, not between it and سلام`)
        .toBeLessThan(spots.word[k]);
    }
  }
});

test('code is set the same in both views: one row step, one set of colours', async ({ page }) => {
  // A <pre> left at the prose size keeps a prose-sized strut, and the page
  // spaced code rows 29.6px apart against the editor's 26px — the same block,
  // visibly looser when read. The block is set at the code size in both.
  await boot(page, '```js\nlet a = 1;\nlet b = 2;\n```\n');
  const rows = (where: string) => page.evaluate((root) => {
    const tops = [...document.querySelectorAll(root)]
      .filter((element) => element.textContent === 'let' && !element.querySelector('span'))
      .map((element) => Math.round(element.getBoundingClientRect().top));
    return tops.length === 2 ? tops[1] - tops[0] : null;
  }, where);
  await expect.poll(() => rows('#app .cm-content span')).toBe(26);
  const colour = (where: string) => page.evaluate((root) => {
    const span = [...document.querySelectorAll(root)]
      .find((element) => element.textContent === 'let' && !element.querySelector('span')) as HTMLElement;
    return getComputedStyle(span).color;
  }, where);
  const source = await colour('#app .cm-content span');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane pre code')).toBeVisible();
  await expect.poll(() => rows('#preview-pane pre code span')).toBe(26);
  expect(await colour('#preview-pane pre code span')).toBe(source);
});
