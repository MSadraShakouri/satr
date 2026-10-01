import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

// The small, day-to-day details of the note: list numbers the writer typed,
// the direction of a \text run inside a formula, the room under the last
// line, a tap below the text, Enter bringing the new line into view, and the
// toolbar's new-line button behaving exactly like Enter at the line's end.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    window.testEditor = new SatrEditor(host, () => {});
    await document.fonts.ready;
  });
});

async function setText(page: Page, text: string, caret = -1) {
  await page.evaluate(async ({ text, caret }) => {
    window.testEditor.setValue(text);
    window.testEditor.setSelection(caret < 0 ? text.length : caret);
    window.testEditor.focus();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, { text, caret });
}

test('the writer’s own list number is kept, in both digit sets', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { renderMarkdown } = await import('/src/markdown.ts');
    const host = document.createElement('article');
    const read = (text: string) => {
      host.innerHTML = renderMarkdown(text);
      const list = host.querySelector('ol');
      return {
        start: list ? Number(list.getAttribute('start') ?? '1') : null,
        persian: list?.querySelector(':scope > li')?.getAttribute('data-persian-number') ?? null,
        persianClass: list?.classList.contains('persian-ordered') ?? false,
        items: host.querySelectorAll('ol > li').length,
      };
    };
    return {
      latin: read('2. second'),
      persian: read('۲. دوم'),
      arabic: read('٣. ثالث'),
      list: read('1. one\n2. two'),
    };
  });
  // A single "2." is the writer's 2, not a 1.
  expect(report.latin.start).toBe(2);
  expect(report.persian.start).toBe(2);
  expect(report.persian.persianClass).toBe(true);
  expect(report.persian.persian).toBe('۲');
  expect(report.arabic.start).toBe(3);
  // And a list that goes 1, 2 keeps counting as before.
  expect(report.list.start).toBe(1);
  expect(report.list.items).toBe(2);
});

// A Persian word in a formula is Persian: it reads right to left (and upright)
// even without `\text{…}`, wherever it sits — a fraction's argument, a root, a
// plain run — while the formula around it stays left to right (23).
test('every Persian run in a formula reads right to left, the formula LTR', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { renderMath } = await import('/src/math.ts');
    const { layoutMath } = await import('/src/mathLayout.ts');
    const host = document.createElement('div');
    host.className = 'preview-pane';
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;background:white;width:520px;';
    host.style.setProperty('display', 'block', 'important');
    document.body.appendChild(host);
    await document.fonts.ready;
    const read = (tex: string) => {
      host.innerHTML = renderMath(tex, false);
      layoutMath(host);
      const runs = [...host.querySelectorAll<HTMLElement>('.katex .text')];
      const textNode = (run: HTMLElement): Text | null => {
        const walker = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node instanceof Text && node.data.trim().length > 0) return node;
        }
        return null;
      };
      const directions = runs.map((run) => {
        // A line-broken formula keeps two forms of each unit (plain and
        // continued) and hides one of them, so only the visible form has
        // rectangles to measure.
        if (run.getBoundingClientRect().width <= 0) return null;
        const text = textNode(run);
        if (!text) return null;
        const first = document.createRange();
        first.setStart(text, 0);
        first.setEnd(text, 1);
        const last = document.createRange();
        last.setStart(text, text.length - 1);
        last.setEnd(text, text.length);
        return {
          text: text.data,
          bidi: getComputedStyle(run).unicodeBidi,
          firstX: first.getBoundingClientRect().left,
          lastX: last.getBoundingClientRect().left,
        };
      }).filter(Boolean);
      const flow = host.querySelector<HTMLElement>('.math-flow') ?? host.querySelector('.katex');
      return { runs: directions, flowDirection: flow ? getComputedStyle(flow).direction : null };
    };
    return {
      plain: read(String.raw`سرعت`),
      withMath: read(String.raw`سرعت = \frac{d}{t}`),
      inFraction: read(String.raw`v = \frac{سلام}{2}`),
      inRoot: read(String.raw`\sqrt{سلام}`),
      explicitText: read(String.raw`x = \text{سلام} + 1`),
      latin: read(String.raw`v = \frac{d}{t}`),
      mixed: read(String.raw`x = 2 \text{ و } y`),
    };
  });
  for (const name of ['plain', 'withMath', 'inFraction', 'inRoot', 'explicitText', 'mixed'] as const) {
    const entry = report[name];
    expect(entry.runs.length, name).toBeGreaterThan(0);
    for (const run of entry.runs) {
      expect(run!.bidi, `${name}: dir="auto"`).toBe('plaintext');
      expect(run!.firstX, `${name}: ${run!.text} reads right to left`).toBeGreaterThan(run!.lastX);
    }
    expect(entry.flowDirection, `${name}: the formula stays LTR`).toBe('ltr');
  }
  // A formula with no Persian at all is left exactly as it was.
  expect(report.latin.runs.length).toBe(0);
  expect(report.latin.flowDirection).toBe('ltr');
});

test('a Persian \\text run inside a formula reads right to left, the formula LTR', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { renderMath } = await import('/src/math.ts');
    const { layoutMath } = await import('/src/mathLayout.ts');
    const host = document.createElement('div');
    host.className = 'preview-pane';
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;background:white;width:400px;';
    host.style.setProperty('display', 'block', 'important');
    host.innerHTML = renderMath(String.raw`x = \text{سلام} + 1`, false);
    document.body.appendChild(host);
    await document.fonts.ready;
    layoutMath(host);
    const run = host.querySelector<HTMLElement>('.katex .text');
    const flow = host.querySelector<HTMLElement>('.math-flow') ?? host.querySelector('.katex');
    if (!run) return null;
    const text = run.firstChild as Text;
    const first = document.createRange();
    first.setStart(text, 0);
    first.setEnd(text, 1);
    const last = document.createRange();
    last.setStart(text, text.length - 1);
    last.setEnd(text, text.length);
    return {
      bidi: getComputedStyle(run).unicodeBidi,
      firstX: first.getBoundingClientRect().left,
      lastX: last.getBoundingClientRect().left,
      flowDirection: flow ? getComputedStyle(flow).direction : null,
    };
  });
  expect(report).not.toBeNull();
  // dir="auto" for the run: the Persian text inside it runs right to left…
  expect(report!.bidi).toBe('plaintext');
  expect(report!.firstX).toBeGreaterThan(report!.lastX);
  // …while the formula stays left to right.
  expect(report!.flowDirection).toBe('ltr');
});

test('there is room under the last line, and Enter brings the new line into view', async ({ page }) => {
  const host = page.locator('.cm-editor').first();
  await page.evaluate(() => {
    const outer = window.testEditor.view.dom.parentElement as HTMLElement;
    outer.style.height = '300px';
  });
  await setText(page, Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'));
  const room = await page.evaluate(async () => {
    const view = window.testEditor.view;
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
    await new Promise((r) => requestAnimationFrame(r));
    const last = view.coordsAtPos(view.state.doc.length, 1)!;
    const box = view.scrollDOM.getBoundingClientRect();
    return box.bottom - last.bottom;
  });
  expect(room).toBeGreaterThan(80);
  // Enter on the last line keeps the new line inside the visible box.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const visible = await page.evaluate(() => {
    const view = window.testEditor.view;
    const caret = view.coordsAtPos(view.state.selection.main.head, 1)!;
    const box = view.scrollDOM.getBoundingClientRect();
    return caret.top < box.bottom - 4 && caret.bottom > box.top + 4;
  });
  expect(visible).toBe(true);
});

// The room under the note is for scrolling by hand: the view must not spend it
// while typing. At the end of a note the caret walks down through the room
// instead of the page chasing it; in the middle of a note, where the next
// lines are already below the caret, nothing moves at all.
test('typing does not spend the room under the note', async ({ page }) => {
  await page.evaluate(() => {
    const outer = window.testEditor.view.dom.parentElement as HTMLElement;
    outer.style.height = '420px';
  });
  const measure = async (lines: string[]) => {
    await setText(page, lines.join('\n'));
    await page.evaluate(async () => {
      const view = window.testEditor.view;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
      await new Promise((r) => requestAnimationFrame(r));
    });
    const start = await page.evaluate(() => ({
      top: window.testEditor.view.scrollDOM.scrollTop,
      line: window.testEditor.view.defaultLineHeight,
    }));
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.insertText('typing a line of prose');
      await page.waitForTimeout(120);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
    }
    const end = await page.evaluate(() => {
      const view = window.testEditor.view;
      const caret = view.coordsAtPos(view.state.selection.main.head, 1)!;
      const box = view.scrollDOM.getBoundingClientRect();
      return { top: view.scrollDOM.scrollTop, visible: caret.top < box.bottom && caret.bottom > box.top, gap: box.bottom - caret.top };
    });
    return { moved: end.top - start.top, line: start.line, ...end };
  };
  // At the end of the note: the four lines cost about four lines of scrolling,
  // not the extra room as well, and the caret never leaves the view.
  const atEnd = await measure(Array.from({ length: 24 }, (_, i) => `line ${i}`));
  expect(atEnd.moved, `scrolled ${atEnd.moved}px for 4 lines`).toBeLessThanOrEqual(atEnd.line * 6);
  expect(atEnd.visible).toBe(true);
  // The room is still there to scroll into by hand.
  expect(atEnd.gap).toBeGreaterThan(atEnd.line);

  // In the middle of a note the next lines are already below the caret, so
  // adding a line moves nothing at all.
  const middle = await measure(Array.from({ length: 60 }, (_, i) => `line ${i}`));
  expect(middle.moved, `scrolled ${middle.moved}px with lines below`).toBeLessThanOrEqual(2);
  expect(middle.visible).toBe(true);
});

test('a tap below the last line puts the caret at the end of the note', async ({ page }) => {
  await setText(page, 'first line\nsecond line\nthird');
  const box = await page.evaluate(() => {
    const view = window.testEditor.view;
    const scroll = view.scrollDOM.getBoundingClientRect();
    const end = view.coordsAtPos(view.state.doc.length, 1)!;
    return { x: scroll.left + 40, y: Math.min(scroll.bottom - 6, end.bottom + 30), bottom: scroll.bottom, endBottom: end.bottom };
  });
  expect(box.y).toBeGreaterThan(box.endBottom - 1);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(120);
  const head = await page.evaluate(() => window.testEditor.view.state.selection.main.head);
  expect(head).toBe(await page.evaluate(() => window.testEditor.view.state.doc.length));
});

// The toolbar's "new line below" is Enter at the end of the line — not an
// empty line under the text. It continues a list with the writer's own number,
// carries a to-do line's checkbox, continues a quote, and reveals the marker
// the way Enter does. Run against the real Enter key for every case, so the
// button and the key can never drift apart.
test('the new-line button is Enter at the end of the line', async ({ page }) => {
  const drafts = ['hello', '- item', '1. item', '۲. دوم', '- [x] done', '- [ ] open', '> quoted', '# title', '3. third'];
  const report = await page.evaluate(async (drafts) => {
    const run = async (text: string, how: 'key' | 'button') => {
      window.testEditor.setValue(text);
      window.testEditor.setSelection(text.length);
      window.testEditor.focus();
      await new Promise((r) => setTimeout(r, 40));
      if (how === 'button') window.testEditor.run('lineBelow');
      else {
        const view = window.testEditor.view;
        // The keymap's own Enter chain, exactly as the key runs it.
        const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
        view.contentDOM.dispatchEvent(event);
      }
      await new Promise((r) => setTimeout(r, 40));
      return { text: window.testEditor.getValue(), selection: window.testEditor.getSelection() };
    };
    const out: Record<string, unknown> = {};
    for (const draft of drafts) {
      out[draft] = { key: await run(draft, 'key'), button: await run(draft, 'button') };
    }
    return out;
  }, drafts);
  for (const [draft, both] of Object.entries(report) as Array<[string, { key: { text: string; selection: [number, number] }; button: { text: string; selection: [number, number] } }]>) {
    expect(both.button.text, `${draft}: the button and Enter agree`).toBe(both.key.text);
    expect(both.button.selection, `${draft}: the caret lands where Enter leaves it`).toEqual(both.key.selection);
  }
  // And the behaviour itself, spelled out: the writer's number continues, the
  // checkbox is carried, and the caret is ready to write the next item.
  expect(report['1. item'].button.text).toBe('1. item\n2. ');
  expect(report['۲. دوم'].button.text).toBe('۲. دوم\n۳. ');
  // A to-do line continues with a to-do line — and the new box is empty, the
  // item below a finished one being a new thing to do (13).
  expect(report['- [x] done'].button.text).toBe('- [x] done\n- [ ] ');
  expect(report['- [ ] open'].button.text).toBe('- [ ] open\n- [ ] ');
  expect(report['> quoted'].button.text).toBe('> quoted\n> ');
  // A plain line gets a plain new line — the button is not forbidden from
  // making one, it just never makes an empty line under a list item.
  expect(report['hello'].button.text).toBe('hello\n');
});

// A Persian phrase inside a formula is a phrase, not a run of maths atoms: its
// words must read right to left as a whole. Handing the browser the words as
// separate boxes laid them out left to right (23).
test('a Persian phrase in a formula keeps its word order, right to left', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { renderMath } = await import('/src/math.ts');
    const { layoutMath } = await import('/src/mathLayout.ts');
    const host = document.createElement('div');
    host.className = 'preview-pane';
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;background:white;width:520px;';
    host.style.setProperty('display', 'block', 'important');
    document.body.appendChild(host);
    await document.fonts.ready;
    const read = (tex: string, first: string, second: string) => {
      host.innerHTML = renderMath(tex, false);
      layoutMath(host);
      const run = [...host.querySelectorAll<HTMLElement>('.katex .text')]
        .find((el) => el.getBoundingClientRect().width > 0 && (el.textContent ?? '').includes(first + ' ') || (el.textContent ?? '').includes(`${first}\u00a0`));
      if (!run) return { found: false };
      const walker = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
      let node: Text | null = null;
      for (let next = walker.nextNode(); next; next = walker.nextNode()) {
        if (next instanceof Text && next.data.includes(first) && /[\s\u00a0]/.test(next.data)) { node = next; break; }
      }
      if (!node) return { found: false };
      const at = node.data.search(/[\s\u00a0]/);
      const box = (from: number, to: number) => {
        const range = document.createRange();
        range.setStart(node!, from);
        range.setEnd(node!, to);
        return range.getBoundingClientRect();
      };
      const one = box(0, at);
      const two = box(at + 1, node.data.length);
      return { found: true, text: node.data, firstLeft: one.left, secondLeft: two.left, runs: host.querySelectorAll('.katex .text').length };
    };
    return {
      explicit: read(String.raw`v = \text{سلام دنیا}`, 'سلام', 'دنیا'),
      bare: read(String.raw`v = سلام دنیا`, 'سلام', 'دنیا'),
      inFraction: read(String.raw`v = \frac{سلام دنیا}{2}`, 'سلام', 'دنیا'),
      mixed: read(String.raw`x = \text{سلام hello}`, 'سلام', 'hello'),
      latin: (() => {
        host.innerHTML = renderMath(String.raw`v = \text{hello world}`, false);
        layoutMath(host);
        const word = (value: string) => [...host.querySelectorAll<HTMLElement>('.katex .text')]
          .filter((el) => el.getBoundingClientRect().width > 0 && (el.textContent ?? '').includes(value))
          .map((el) => el.getBoundingClientRect().left)[0];
        return { found: true, firstLeft: word('hello')!, secondLeft: word('world')! };
      })(),
    };
  });
  for (const name of ['explicit', 'bare', 'inFraction', 'mixed'] as const) {
    const entry = report[name];
    expect(entry.found, `${name}: the phrase stays in one piece`).toBe(true);
    // The first word of the phrase sits to the RIGHT of the second one.
    expect(entry.firstLeft, `${name}: ${entry.text} reads right to left`).toBeGreaterThan(entry.secondLeft!);
  }
  // A Latin text command is still a left-to-right phrase, and still offers its
  // own words as break points (two atoms, in reading order).
  expect(report.latin.firstLeft).toBeLessThan(report.latin.secondLeft!);
});

// What brings the caret into view, and what must not. A focus arriving on its
// own is not a reason for the note to move: the WebView re-focuses the
// editable region by itself (a checkbox tapped further down the note, a link,
// the keyboard restarting), and the focus handler used to glide the view back
// to the caret each time — measured at up to 1688px of jump for a tap the
// writer never meant as a caret placement. A caret that actually moved still
// comes into view.
test('a focus on its own does not drag the note back to the caret', async ({ page }) => {
  await page.evaluate(() => {
    const outer = window.testEditor.view.dom.parentElement as HTMLElement;
    outer.style.height = '420px';
  });
  await setText(page, Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n'), 0);
  const away = await page.evaluate(async () => {
    const view = window.testEditor.view;
    view.scrollDOM.scrollTop = 1600;
    view.contentDOM.blur();
    await new Promise((r) => requestAnimationFrame(r));
    view.contentDOM.focus(); // the WebView's own re-focus: nothing changed
    await new Promise((r) => setTimeout(r, 400));
    return view.scrollDOM.scrollTop;
  });
  expect(away, `the view moved to ${away}`).toBeGreaterThan(1500);

  // And the same focus, after the caret really moved, does bring it in.
  const afterMove = await page.evaluate(async () => {
    const view = window.testEditor.view;
    view.contentDOM.blur();
    view.dispatch({ selection: { anchor: 0 } });
    view.contentDOM.focus();
    await new Promise((r) => setTimeout(r, 1500)); // a glide, not a jump
    const caret = view.coordsAtPos(0)!;
    const box = view.scrollDOM.getBoundingClientRect();
    return { top: view.scrollDOM.scrollTop, visible: caret.top >= box.top - 1 && caret.top < box.bottom };
  });
  expect(afterMove.visible, `caret at ${afterMove.top}px`).toBe(true);
});

// A command that selects the whole note is not a reason to glide either: the
// selection's head sits at the note's end, so a reveal would take the writer
// to the bottom of a note they had not moved in.
test('Select all leaves the view where the writer was', async ({ page }) => {
  await page.evaluate(() => {
    const outer = window.testEditor.view.dom.parentElement as HTMLElement;
    outer.style.height = '420px';
  });
  await setText(page, Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n'), 0);
  const out = await page.evaluate(async () => {
    const view = window.testEditor.view;
    view.scrollDOM.scrollTop = 900;
    await new Promise((r) => requestAnimationFrame(r));
    const before = view.scrollDOM.scrollTop;
    window.testEditor.selectAll();
    await new Promise((r) => setTimeout(r, 600));
    return { before, after: view.scrollDOM.scrollTop, selected: view.state.selection.main.to, length: view.state.doc.length };
  });
  expect(out.selected).toBe(out.length); // the whole note, in fact
  expect(Math.abs(out.after - out.before), `moved to ${out.after} from ${out.before}`).toBeLessThan(40);
});
