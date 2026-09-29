import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});


test('a formula-heavy note round-trips its scroll between the two views', async ({ page }) => {
  const round = await page.evaluate(async () => {
    const { renderMarkdown } = await import('/src/markdown.ts');
    const { previewScroll, applyPreviewScroll, editorScroll, applyEditorScroll } = await import('/src/scrollSync.ts');
    const { SatrEditor } = await import('/src/editor.ts');
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
    const { renderMarkdown } = await import('/src/markdown.ts');
    const { previewScroll, applyPreviewScroll } = await import('/src/scrollSync.ts');
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
