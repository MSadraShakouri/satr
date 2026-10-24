import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});


test('a formula-heavy note round-trips its scroll between the two views', async ({ page }) => {
  const round = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const { previewScroll, applyPreviewScroll, editorScroll, applyEditorScroll } = await window.__satr.load('/src/scrollSync.ts');
    const { SatrEditor } = await window.__satr.load('/src/editor.ts');
    const src: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      src.push(`paragraph ${i} with enough words to wrap onto a second visual row in a narrow column`);
      src.push('');
      src.push(`$$\\frac{${i} + 1}{2} = x^${i} + y$$`);
      src.push('');
    }
    const source = src.join('\n');
    const pane = document.createElement('div');
    pane.style.cssText = 'position:fixed;inset:0 auto auto 0;width:320px;height:200px;overflow:auto;background:white';
    const preview = document.createElement('div');
    preview.innerHTML = renderMarkdown(source);
    pane.appendChild(preview);
    document.body.appendChild(pane);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0 0 auto 340px;width:320px;height:200px;overflow:hidden';
    document.body.appendChild(host);
    const editor = new SatrEditor(host, () => {});
    editor.setValue(source);
    await document.fonts.ready;
    const view = (editor as unknown as { view: Parameters<typeof editorScroll>[0] }).view;
    const out: { p: number; back: number; eback: number }[] = [];
    for (const p of [2, 3.5, 4, 8, 12, 16]) {
      applyPreviewScroll(pane, preview, p);
      const back = previewScroll(pane, preview);
      applyEditorScroll(view, p);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.push({ p, back: Math.round(back * 100) / 100, eback: Math.round(editorScroll(view) * 100) / 100 });
    }
    return out;
  });
  for (const step of round) {
    expect(Math.abs(step.back - step.p), JSON.stringify(round)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(step.eback - step.p), JSON.stringify(round)).toBeLessThanOrEqual(0.1);
  }
});

test('the switch re-measures math heights and compensates the scroll', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const { previewScroll, applyPreviewScroll } = await window.__satr.load('/src/scrollSync.ts');
    const src: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      src.push(`paragraph ${i} with enough words to wrap onto a second visual row in a narrow column`);
      src.push('');
      src.push(`$$\\frac{${i} + 1}{2} = x^${i} + y$$`);
      src.push('');
    }
    const source = src.join('\n');
    const pane = document.createElement('div');
    pane.style.cssText = 'position:fixed;inset:0 auto auto 0;width:320px;height:200px;overflow:auto;background:white';
    const preview = document.createElement('div');
    preview.innerHTML = renderMarkdown(source);
    pane.appendChild(preview);
    document.body.appendChild(pane);
    await document.fonts.ready;
    // Switch to the preview at a position past the second formula…
    const position = 12;
    applyPreviewScroll(pane, preview, position, () => true, true);
    // …and then a formula grows, as KaTeX fonts or the Android grow-box pass
    // do after the jump. Without compensation the scroll would stay stale.
    const displays = [...preview.querySelectorAll<HTMLElement>('.math-display')];
    displays[0].style.height = '240px';
    await new Promise((r) => setTimeout(r, 300));
    return { after: Math.round(previewScroll(pane, preview) * 100) / 100 };
  });
  expect(Math.abs(out.after - 12)).toBeLessThanOrEqual(0.2);
});

test('read and place at the typing band round-trip the same source line', async ({ page }) => {
  const round = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const { previewScroll, applyPreviewScroll, editorScroll, applyEditorScroll, typingTop } = await window.__satr.load('/src/scrollSync.ts');
    const { SatrEditor } = await window.__satr.load('/src/editor.ts');
    const src: string[] = [];
    for (let i = 0; i < 16; i += 1) {
      src.push(`paragraph ${i} with enough words to wrap onto a second visual row in a narrow column`);
      src.push('');
    }
    const source = src.join('\n');
    const pane = document.createElement('div');
    pane.style.cssText = 'position:fixed;inset:0 auto auto 0;width:320px;height:400px;overflow:auto;background:white';
    const preview = document.createElement('div');
    preview.innerHTML = renderMarkdown(source);
    pane.appendChild(preview);
    document.body.appendChild(pane);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0 0 auto 340px;width:320px;height:400px;overflow:hidden';
    document.body.appendChild(host);
    const editor = new SatrEditor(host, () => {});
    editor.setValue(source);
    await document.fonts.ready;
    const view = (editor as unknown as { view: Parameters<typeof editorScroll>[0] }).view;
    const y = typingTop(view);
    const out: { p: number; back: number; eback: number }[] = [];
    for (const p of [4, 10, 16]) {
      applyPreviewScroll(pane, preview, p, () => true, false, y);
      const back = previewScroll(pane, preview, y);
      applyEditorScroll(view, p, () => true, false, y);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.push({ p, back: Math.round(back * 100) / 100, eback: Math.round(editorScroll(view, y) * 100) / 100 });
    }
    return out;
  });
  for (const step of round) {
    expect(Math.abs(step.back - step.p), JSON.stringify(round)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(step.eback - step.p), JSON.stringify(round)).toBeLessThanOrEqual(0.15);
  }
});

// A reading view shorter than the screen, which is what a short note with a
// table in it is on a tall phone. The article keeps half a screen of padding
// below the note, so the pane still scrolls. The place has to be kept here
// too: clamping such a note to its own foot is the top of it for every line,
// which is the jump from the source that a reader reports as "it went back to
// the beginning".
test('a note that fits the screen still keeps the place it is sent to', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const out = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const { applyPreviewScroll } = await window.__satr.load('/src/scrollSync.ts');
    const src = ['# Expenses', '', 'a short opening line', '', '| item | cost |', '| --- | --- |'];
    for (let i = 0; i < 6; i += 1) src.push(`| thing ${i} | ${i * 12} |`);
    src.push('', 'and a closing line');
    const pane = document.createElement('div');
    // Shorter than the screen it is on, like the note pane under a toolbar: the
    // note fits inside it, and the half-screen of padding is what it scrolls.
    pane.style.cssText = 'position:fixed;inset:0 auto auto 0;width:390px;height:500px;overflow:auto;background:white';
    const preview = document.createElement('div');
    preview.innerHTML = renderMarkdown(src.join('\n'));
    preview.style.cssText = 'padding-bottom:50vh';
    pane.appendChild(preview);
    document.body.appendChild(pane);
    await document.fonts.ready;
    const noteEnds = [...preview.querySelectorAll<HTMLElement>('[data-line]')].pop()!.getBoundingClientRect().bottom - pane.getBoundingClientRect().top;
    const canScroll = pane.scrollHeight - pane.clientHeight;
    const landings: number[] = [];
    for (const line of [0, 4, 8, 12]) {
      pane.scrollTop = 0;
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      applyPreviewScroll(pane, preview, line);
      landings.push(Math.round(pane.scrollTop));
    }
    pane.remove();
    return { landings, canScroll, noteEnds: Math.round(noteEnds), fits: noteEnds <= 500 };
  });
  const why = JSON.stringify(out);
  expect(out.fits, why).toBe(true);
  expect(out.canScroll, why).toBeGreaterThan(0);
  expect(out.landings[0], 'the first line is the top').toBe(0);
  expect(out.landings[3], 'the end of a short note is not its beginning').toBeGreaterThan(0);
  for (let i = 1; i < out.landings.length; i += 1) expect(out.landings[i], why).toBeGreaterThanOrEqual(out.landings[i - 1]);
  expect(Math.max(...out.landings), 'never further than the pane can honestly go').toBeLessThanOrEqual(out.canScroll);
});

// Two places in the same note must be measured against the same end of it.
// They were not: a line past the point where the pane could still scroll fell
// onto a second rule and was pulled to the foot of the note, so a line further
// down the page landed higher up the screen than the line before it.
test('a line further down a note never lands higher up the screen', async ({ page }) => {
  const runs = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const { applyPreviewScroll } = await window.__satr.load('/src/scrollSync.ts');
    const src: string[] = [];
    for (let i = 0; i < 14; i += 1) { src.push(`## Part ${i}`, '', `paragraph ${i} with enough words in it to wrap onto a second row of a narrow column`, ''); }
    const source = src.join('\n');
    const pane = document.createElement('div');
    pane.style.cssText = 'position:fixed;inset:0 auto auto 0;width:390px;overflow:auto;background:white';
    const preview = document.createElement('div');
    preview.innerHTML = renderMarkdown(source);
    preview.style.cssText = 'padding-bottom:50vh';
    pane.appendChild(preview);
    document.body.appendChild(pane);
    await document.fonts.ready;
    const out: { height: number; landings: number[]; foot: number }[] = [];
    for (const height of [844, 600, 400]) {
      pane.style.height = `${height}px`;
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const noteEnds = [...preview.querySelectorAll<HTMLElement>('[data-line]')].pop()!.getBoundingClientRect().bottom - pane.getBoundingClientRect().top + pane.scrollTop;
      const landings: number[] = [];
      for (let line = 0; line < 56; line += 4) {
        pane.scrollTop = 0;
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        applyPreviewScroll(pane, preview, line);
        landings.push(Math.round(pane.scrollTop));
      }
      out.push({ height, landings, foot: Math.round(Math.max(0, noteEnds - height)) });
    }
    pane.remove();
    return out;
  });
  for (const run of runs) {
    const why = JSON.stringify(run);
    for (let i = 1; i < run.landings.length; i += 1) {
      expect(run.landings[i], why).toBeGreaterThanOrEqual(run.landings[i - 1]);
    }
    // and never past the note's own foot, which is the empty screen below it
    expect(Math.max(...run.landings), why).toBeLessThanOrEqual(run.foot + 1);
  }
});
