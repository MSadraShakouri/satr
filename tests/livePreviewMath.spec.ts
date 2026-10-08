import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { SatrEditor } = await window.__satr.load('/src/editor.ts');
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
    const math = [...line.querySelectorAll('.cm-math')];
    return {
      text: line.textContent,
      links: line.querySelectorAll('.cm-lp-link').length,
      code: line.querySelectorAll('.cm-lp-inline-code').length,
      footrefs: line.querySelectorAll('.cm-lp-footref').length,
      // The theme still colours the parser's link/code tokens inside the
      // formula (the markdown parser does not know it is inside dollars), so
      // the formula must win over it: one colour, one font, everywhere in it.
      families: [...new Set(math.flatMap((m) => [m, ...m.querySelectorAll('*')].map((el) => getComputedStyle(el).fontFamily)))],
      colours: [...new Set(math.flatMap((m) => [m, ...m.querySelectorAll('*')].map((el) => getComputedStyle(el).color)))],
    };
  });
  expect(report.text).toContain('[a](b)');
  expect(report.text).toContain('`c`');
  expect(report.footrefs).toBe(0);
  // The prose beside the formulas still renders normally.
  expect(report.links).toBe(0);
  expect(report.code).toBe(0);
  expect(report.families.length).toBe(1);
  expect(report.colours.length).toBe(1);
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

// Two formulas can hand the parser two marker-shaped characters to pair
// *across* the prose between them: `$*$ foo foo foo $*$` parses as emphasis,
// and the italic landed on every foo. A marker inside a formula is not a
// marker — the whole node is the parser's artefact — so the prose between the
// formulas stays prose and the source stays as typed (2).
test('a marker pair parked inside the formulas leaves the prose between them plain', async ({ page }) => {
  await draft(page, 'far away|$*$ foo foo foo $*$ and $**$ bar bar $**$ and $~~$ baz $~~$');
  const report = await page.evaluate(() => {
    const line = window.testEditor.view.dom.querySelector('.cm-line')!;
    const runs: { text: string; italic: string; weight: number; strike: boolean }[] = [];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent ?? '').trim()) continue;
      if (node.parentElement?.closest('.cm-math')) continue;
      const style = getComputedStyle(node.parentElement!);
      runs.push({
        text: (node.textContent ?? '').trim(),
        italic: style.fontStyle,
        weight: Number(style.fontWeight),
        strike: style.textDecorationLine.includes('line-through'),
      });
    }
    return { text: line.textContent ?? '', runs };
  });
  // Nothing is hidden: the markers are characters of the formula.
  expect(report.text).toBe('far away$*$ foo foo foo $*$ and $**$ bar bar $**$ and $~~$ baz $~~$');
  const prose = report.runs.filter((run) => /foo|bar|baz|and/.test(run.text));
  expect(prose.map((run) => run.text).join(' ')).toContain('foo foo foo');
  for (const run of prose) {
    expect(run.italic).toBe('normal');
    expect(run.weight).toBeLessThan(600);
    expect(run.strike).toBe(false);
  }
});
