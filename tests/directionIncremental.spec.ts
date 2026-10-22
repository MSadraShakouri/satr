import { expect, test } from '@playwright/test';

// The editor keeps the last direction pass and skips it when a keystroke
// cannot change any line (src/direction.ts, directionsAfter). This pins that
// shortcut to the honest thing: after every keystroke — letters, a digit, a
// hyphen, dollars, backticks, Enter — what the lines are painted with is what
// a fresh whole-note pass says they should be.
test('after every keystroke the painted dirs equal a fresh recompute', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await window.__satr.load('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.append(host);
    (window as any).ed = new SatrEditor(host, () => {});
    const ed = (window as any).ed;
    ed.setValue('# سلام دنیا\n\nاین یک خط فارسی است\n\n$$\nx = 1\n$$\n\nhello world\n\n- یک نکته');
    ed.setSelection(ed.getValue().length);
    ed.focus();
    await document.fonts.ready;
  });

  const mismatch = async () => page.evaluate(async () => {
    const { sourceDirections } = await window.__satr.load('/src/direction.ts');
    const ed = (window as any).ed;
    const view = ed.view;
    const fresh = sourceDirections(view.state.doc.toString());
    const bad: string[] = [];
    for (const el of [...view.contentDOM.querySelectorAll('.cm-line')] as HTMLElement[]) {
      const pos = view.posAtDOM(el, 0);
      const n = view.state.doc.lineAt(pos).number;
      const painted = el.getAttribute('dir');
      if (painted !== fresh[n - 1]) bad.push(`line ${n} (${JSON.stringify(view.state.doc.line(n).text.slice(0, 30))}): painted ${painted}, fresh ${fresh[n - 1]}`);
    }
    return bad;
  });

  const keys = ['ب', 'ا', ' ', 'م', '۲', '-', ' ', '$', 'x', '$', '\n', '`', 'a', '`', '\n', 'س'];
  const failures: string[] = [];
  for (const key of keys) {
    if (key === '\n') await page.keyboard.press('Enter');
    else await page.keyboard.insertText(key);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    failures.push(...(await mismatch()).map((m) => `${JSON.stringify(key)}: ${m}`));
  }
  console.log(failures.length ? failures.join('\n') : 'all lines agree after every keystroke');
  expect(failures).toEqual([]);
});
