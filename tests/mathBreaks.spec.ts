import { expect, test } from '@playwright/test';

// قضیه دوم انتگرال. These are sentences written as display math. Spaces live
// inside \text{}, which used to be one unbreakable unit, so the custom breaker
// (relations and word spaces) never fired and the line overflowed the screen.
const THEOREM = String.raw`### قضیه دوم انتگرال

<div dir=ltr>

$$ \text{If } f \text{ is continuous on the closed interval } [a, b] $$

$$ \text{and there exists a function } G \text{ such that } G'(x) = f(x), $$

$$ \text{then} $$

$$ \int_{a}^{b} f(x) \, dx = G(b) - G(a) $$
</div>
`;

const LINES = [
  String.raw`\text{If } f \text{ is continuous on the closed interval } [a, b]`,
  String.raw`\text{and there exists a function } G \text{ such that } G'(x) = f(x),`,
  String.raw`\text{then}`,
  String.raw`\int_{a}^{b} f(x) \, dx = G(b) - G(a)`,
];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
});

test('word spaces inside text commands are break points', async ({ page }) => {
  const result = await page.evaluate(async (lines) => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const inspect = (tex: string) => {
      const html = renderMath(tex, true);
      const texes = [...html.matchAll(/<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/g)].map((m) => m[1]);
      return {
        units: Number(html.match(/data-units="(\d+)"/)?.[1] ?? 1),
        error: html.includes('katex-error'),
        texes,
      };
    };
    return {
      lines: lines.map(inspect),
      fraction: inspect(String.raw`\frac{\text{hello world}}{2}`),
      delimited: inspect(String.raw`\left( \text{hello world} \right)`),
      plus: inspect('a + b + c + d'),
      words: inspect('hello world'),
      bold: inspect(String.raw`\textbf{bold words}`),
      manual: renderMath(String.raw`\text{hello world} \\ \text{again}`, true).includes('newline'),
    };
  }, LINES);

  expect(result.lines[0].error).toBe(false);
  expect(result.lines[0].units).toBeGreaterThanOrEqual(5);
  expect(result.lines[0].texes.some((tex) => tex.includes('\\text{continuous}'))).toBe(true);
  expect(result.lines[0].texes.some((tex) => tex.includes('\\text{interval }'))).toBe(true);
  // A word that continues a line keeps the space; the form that starts a line drops it.
  expect(result.lines[0].texes).toContain('\\displaystyle \\ \\text{continuous}');
  expect(result.lines[0].texes).toContain('\\displaystyle \\text{continuous}');

  expect(result.lines[1].units).toBeGreaterThanOrEqual(5);
  expect(result.lines[1].texes.some((tex) => tex.includes('=') && tex.includes('f(x)'))).toBe(true);
  expect(result.lines[2].units).toBe(1);
  expect(result.lines[3].units).toBe(2);
  expect(result.lines[3].texes.some((tex) => tex.includes('=') && tex.includes('G(b)'))).toBe(true);
  expect(result.lines[3].texes.join(' ')).not.toContain('+');

  // Still never inside math structure, and never at +.
  expect(result.fraction.units).toBe(1);
  expect(result.delimited.units).toBe(1);
  expect(result.plus.units).toBe(1);
  expect(result.words.units).toBe(2);
  expect(result.bold.units).toBe(2);
  expect(result.manual).toBe(true);
});

test('a phone-width theorem wraps between words and does not overflow', async ({ page }) => {
  const report = await page.evaluate(async (lines) => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath } = await window.__satr.load('/src/mathLayout.ts');
    const host = document.createElement('article');
    host.id = 'math-break-host';
    host.style.cssText = 'width: 240px; position: fixed; inset: 0 auto auto 0; background: white; z-index: 5; font-size: 18px;';
    host.innerHTML = lines.map((tex) => renderMath(tex, true)).join('');
    document.body.appendChild(host);
    await document.fonts.ready;
    layoutMath(host);
    return [...host.querySelectorAll<HTMLElement>('.math-display')].map((box) => {
      const flow = box.querySelector<HTMLElement>('.math-flow');
      const units = [...(flow?.querySelectorAll<HTMLElement>(':scope > .math-unit') ?? [])];
      const shown = (units.length ? units.map((unit) => {
        const start = unit.classList.contains('is-line-start');
        return (unit.querySelector(start ? '.math-cont' : '.math-plain')?.textContent ?? '').replace(/\u00a0/g, ' ');
      }).join('') : (box.textContent ?? '')).replace(/\u00a0/g, ' ');
      return {
        breaks: flow?.querySelectorAll('br.math-br').length ?? 0,
        lines: new Set(units.map((unit) => Math.round(unit.getBoundingClientRect().top))).size,
        overflow: Math.round(box.scrollWidth - box.clientWidth),
        shown,
        starts: units.filter((unit) => unit.classList.contains('is-line-start')).map((unit) => (unit.querySelector('.math-cont')?.textContent ?? '').replace(/\u00a0/g, ' ')),
      };
    });
  }, LINES);

  expect(report[0].breaks).toBeGreaterThanOrEqual(1);
  expect(report[0].lines).toBeGreaterThanOrEqual(2);
  expect(report[0].overflow).toBeLessThanOrEqual(1);
  expect(report[0].shown).toContain('If');
  expect(report[0].shown).toContain('continuous');
  expect(report[0].shown).toContain('interval');
  expect(report[0].shown).toContain('a');
  expect(report[0].starts.every((text) => !text.startsWith(' '))).toBe(true);

  expect(report[1].breaks).toBeGreaterThanOrEqual(1);
  expect(report[1].overflow).toBeLessThanOrEqual(1);
  expect(report[1].shown).toContain('function');
  expect(report[1].shown).toContain('=');
  expect(report[1].shown).toContain('f(x)');

  expect(report[2].breaks).toBe(0);
  expect(report[2].shown).toContain('then');

  expect(report[3].overflow).toBeLessThanOrEqual(1);
  expect(report[3].shown.replace(/\s/g, '')).toContain('G(b)−G(a)');
  // The minus stays with its term; a continued line repeats =, it does not start at −.
  expect(report[3].starts.every((text) => !text.trimStart().startsWith('−') && !text.trimStart().startsWith('-'))).toBe(true);
});

test('the theorem note keeps each display line and wraps the sentences', async ({ page }) => {
  const html = await page.evaluate(async (markdown) => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    return renderMarkdown(markdown);
  }, THEOREM);
  expect(html).toContain('dir="ltr"');
  expect(html.match(/class="math-display"/g)?.length).toBe(4);
  expect(html).toContain('data-units="');
  expect(html).toContain('continuous');
  expect(html).not.toContain('katex-error');
});

test('break points carry their preference: line ends, then commas, then relations, then spaces', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const breaks = (tex: string) => [...renderMath(tex, true).matchAll(/<span class="math-unit"(?: data-first)?(?: data-break="(\d)")?/g)]
      .map((m) => m[1] ?? 'first');
    return {
      lines: breaks('a = b\nc = d'),
      comma: breaks('a, b'),
      commaLine: breaks('x = y,\nz = w'),
      words: breaks('hello world'),
    };
  });
  expect(result.lines).toEqual(['first', '2', '0', '2']);
  expect(result.comma).toEqual(['first', '1']);
  // A comma at the writer's line end breaks at the line end (0), comma stays.
  expect(result.commaLine).toEqual(['first', '2', '0', '2']);
  expect(result.words).toEqual(['first', '3']);
});

test('a source line end wins over an equal sign when both can break', async ({ page }) => {
  const starts = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath } = await window.__satr.load('/src/mathLayout.ts');
    const host = document.createElement('article');
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;background:white;';
    host.innerHTML = renderMath('aaa = bbb\ncc', true);
    document.body.appendChild(host);
    await document.fonts.ready;
    const flow = host.querySelector<HTMLElement>('.math-flow')!;
    const units = [...flow.querySelectorAll<HTMLElement>(':scope > .math-unit')];
    const widths = units.map((u) => u.getBoundingClientRect().width);
    // The first two units fit on one line; all three do not. Breaking at the
    // line end is less even than breaking at the "=", yet preferred.
    (host.querySelector<HTMLElement>('.math-display')!).style.width = `${widths[0] + widths[1] + 2}px`;
    layoutMath(host);
    return units.map((u) => u.classList.contains('is-line-start'));
  });
  expect(starts).toEqual([false, false, true]);
});

test('a comma wins over an equal sign when both can break', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath } = await window.__satr.load('/src/mathLayout.ts');
    const host = document.createElement('article');
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;background:white;';
    host.innerHTML = renderMath('aaa = bbb, ccc', true);
    document.body.appendChild(host);
    await document.fonts.ready;
    const flow = host.querySelector<HTMLElement>('.math-flow')!;
    const units = [...flow.querySelectorAll<HTMLElement>(':scope > .math-unit')];
    const widths = units.map((u) => u.getBoundingClientRect().width);
    (host.querySelector<HTMLElement>('.math-display')!).style.width = `${widths[0] + widths[1] + 2}px`;
    layoutMath(host);
    return {
      starts: units.map((u) => u.classList.contains('is-line-start')),
      commaEndsLine: (units[1].querySelector('.math-plain')?.textContent ?? '').trim().endsWith(','),
    };
  });
  expect(report.starts).toEqual([false, false, true]);
  expect(report.commaEndsLine).toBe(true);
});

// A group in plain parentheses is a step behind every other break point: it
// is never broken while the line can hold it, and a group too wide for the
// line breaks inside itself at its own commas or relations instead of at
// whatever atom the browser would otherwise split (8).
test('an overwide group breaks at its own punctuation, never at an arbitrary atom', async ({ page }) => {
  const tex = String.raw`g(\alpha, \beta, \gamma, \delta, \epsilon, \zeta, \eta, \theta, \iota, \kappa) = \lambda, \mu, \nu, \xi, o, \pi, \rho, \sigma`;
  const report = await page.evaluate(async (tex) => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath } = await window.__satr.load('/src/mathLayout.ts');
    const read = (width: number) => {
      const host = document.createElement('article');
      host.style.cssText = `position:fixed;inset:0 auto auto 0;width:${width}px;background:white;font-size:18px;`;
      host.innerHTML = renderMath(tex, true);
      document.body.appendChild(host);
      layoutMath(host);
      const box = host.querySelector<HTMLElement>('.math-display')!;
      const flow = box.querySelector<HTMLElement>('.math-flow')!;
      const units = [...flow.querySelectorAll<HTMLElement>(':scope > .math-unit')];
      const text = (unit: HTMLElement) => (unit.querySelector(unit.classList.contains('is-line-start') ? '.math-cont' : '.math-plain')?.textContent ?? '').trim();
      const lines: string[] = [];
      units.forEach((unit, index) => {
        if (index === 0 || unit.classList.contains('is-line-start')) lines.push('');
        lines[lines.length - 1] += text(unit);
      });
      const out = {
        wrapped: flow.classList.contains('is-wrapped'),
        overwide: units.filter((unit) => unit.classList.contains('is-overwide')).length,
        lineCount: lines.length,
        lines,
        balanced: (lines.join('').match(/\(/g) ?? []).length === (lines.join('').match(/\)/g) ?? []).length,
        overflow: Math.round(box.scrollWidth - box.clientWidth),
      };
      host.remove();
      return out;
    };
    return { narrow: read(200), wide: read(1600) };
  }, tex);
  // Wide enough: one line, nothing is split — the group's own break points
  // are not used just because they exist.
  expect(report.wide.wrapped).toBe(false);
  expect(report.wide.lineCount).toBe(1);
  expect(report.wide.overwide).toBe(0);
  // Narrow: the group breaks, but only at its own commas and the relation.
  expect(report.narrow.wrapped).toBe(true);
  expect(report.narrow.lineCount).toBeGreaterThanOrEqual(2);
  expect(report.narrow.overwide).toBe(0);
  expect(report.narrow.overflow).toBeLessThanOrEqual(1);
  expect(report.narrow.lines.slice(0, -1).every((line) => line.endsWith(','))).toBe(true);
  expect(report.narrow.balanced).toBe(true);
  expect(report.narrow.lines.join(' ')).toContain('κ');
});
