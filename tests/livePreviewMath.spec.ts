import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

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

async function draft(page: Page, text: string) {
  const pos = text.indexOf('|');
  await page.evaluate(async ({ text, pos }) => {
    window.testEditor.setValue(text.replace('|', ''));
    window.testEditor.setSelection(pos);
    window.testEditor.focus();
    // Live preview redraws on the focus change.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, { text, pos });
}

// With the caret far away, live preview renders normally — except inside math.
test('math source is never bold, struck, or highlighted', async ({ page }) => {
  await draft(page, 'far away|$x**y**$ and $z==w==$ and $s~~t~~$');
  const report = await page.evaluate(() => {
    const line = window.testEditor.view.dom.querySelector('.cm-line')!;
    const math = [...line.querySelectorAll('.cm-math')];
    const styles = math.flatMap((m) => [m, ...m.querySelectorAll('*')].map((el) => getComputedStyle(el)));
    return {
      starsVisible: line.textContent?.includes('**') ?? false,
      tildesVisible: line.textContent?.includes('~~') ?? false,
      bold: styles.some((s) => Number(s.fontWeight) >= 600),
      strike: styles.some((s) => s.textDecorationLine.includes('line-through')),
      hilite: styles.some((s) => s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent' && s.backgroundColor !== ''),
      italic: math.map((m) => getComputedStyle(m).fontStyle),
    };
  });
  // The markers stay visible source — nothing is rendered away.
  expect(report.starsVisible).toBe(true);
  expect(report.tildesVisible).toBe(true);
  // And nothing inside the formula is styled as prose.
  expect(report.bold).toBe(false);
  expect(report.strike).toBe(false);
  expect(report.hilite).toBe(false);
  for (const style of report.italic) expect(style).toBe('italic');
});

test('prose emphasis still renders outside math on the same line', async ({ page }) => {
  await draft(page, 'far away| and **bold** plus ==mark==');
  const report = await page.evaluate(() => {
    const line = window.testEditor.view.dom.querySelector('.cm-line')!;
    return {
      starsHidden: !(line.textContent?.includes('**') ?? true),
      bold: [...line.querySelectorAll('*')].some((el) => Number(getComputedStyle(el).fontWeight) >= 600),
    };
  });
  expect(report.starsHidden).toBe(true);
  expect(report.bold).toBe(true);
});

// Anything that would hide a marker or restyle text must leave a formula
// alone: a link, a code span or a footnote reference in `$…$` is part of the
// formula, not markdown (11).
test('links, code spans and footnote references stay source inside math', async ({ page }) => {
  await draft(page, 'far away| and $x [a](b)$ and $y `c`$ and $z[^1]$');
  const report = await page.evaluate(() => {
    const line = window.testEditor.view.dom.querySelector('.cm-line')!;
    return {
      text: line.textContent,
      links: line.querySelectorAll('.cm-lp-link').length,
      code: line.querySelectorAll('.cm-lp-inline-code').length,
      footrefs: line.querySelectorAll('.cm-lp-footref').length,
    };
  });
  expect(report.text).toContain('[a](b)');
  expect(report.text).toContain('`c`');
  expect(report.footrefs).toBe(0);
  // The prose beside the formulas still renders normally.
  expect(report.links).toBe(0);
  expect(report.code).toBe(0);
});

test('prose links and code spans outside math still render', async ({ page }) => {
  await draft(page, 'far away| [a](b) and `c`');
  const report = await page.evaluate(() => {
    const line = window.testEditor.view.dom.querySelector('.cm-line')!;
    return {
      text: line.textContent,
      links: line.querySelectorAll('.cm-lp-link').length,
      code: line.querySelectorAll('.cm-lp-inline-code').length,
    };
  });
  expect(report.text).not.toContain('](');
  expect(report.links).toBe(1);
  expect(report.code).toBe(1);
});
