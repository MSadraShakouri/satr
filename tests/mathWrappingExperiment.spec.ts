import { test, expect } from '@playwright/test';

// Regression checks for the wrapping prototype. These are intentionally local
// to the experiment; corpus-wide before/after is recorded separately.
test('inline formulas move together, and are reset on a wider relayout', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath, clearMathLayout } = await window.__satr.load('/src/mathLayout.ts');
    const host = document.createElement('article');
    host.style.cssText = 'position:fixed;top:0;left:0;width:337px;font-size:16px;z-index:3';
    host.innerHTML = `<p><span style="display:inline-block;width:290px">prefix</span>${renderMath(String.raw`\varepsilon_1, \varepsilon_2 \to 0`, false)}</p>`;
    document.body.appendChild(host); await document.fonts.ready;
    layoutMath(host);
    const flow = host.querySelector<HTMLElement>('.math-flow')!;
    const narrow = { style: flow.style.display, starts: flow.querySelectorAll('.is-line-start').length };
    host.style.width = '500px'; clearMathLayout(); layoutMath(host);
    const wide = { style: flow.style.display, starts: flow.querySelectorAll('.is-line-start').length };
    return { narrow, wide };
  });
  expect(result.narrow).toEqual({ style: 'inline-block', starts: 0 });
  expect(result.wide).toEqual({ style: '', starts: 0 });
});

test('one extra display line keeps a written argument group intact', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath } = await window.__satr.load('/src/mathLayout.ts');
    const host = document.createElement('article');
    host.style.cssText = 'position:fixed;top:0;left:0;width:337px;font-size:16px;z-index:3';
    host.innerHTML = renderMath(String.raw`\Delta z = f(x,y) - f(x_0,y_0) = f_x(x_0,y_0)\Delta x + f_y(x_0,y_0)\Delta y + \varepsilon_1 \Delta x + \varepsilon_2 \Delta y`, true);
    document.body.appendChild(host); await document.fonts.ready; layoutMath(host);
    const box = host.querySelector<HTMLElement>('.math-display')!;
    const starts = [...box.querySelectorAll<HTMLElement>('.math-unit.is-line-start')];
    return { breaks: starts.length, priorities: starts.map(e => Number(e.dataset.break)), overflow: box.scrollWidth - box.clientWidth };
  });
  expect(result.breaks).toBe(2);
  expect(result.priorities.every(p => p < 5)).toBe(true);
  expect(result.overflow).toBeLessThanOrEqual(1);
});

test('angle brackets remain together where a relation fits', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath } = await window.__satr.load('/src/mathLayout.ts');
    const host = document.createElement('article');
    host.style.cssText = 'position:fixed;top:0;left:0;width:337px;font-size:16px;z-index:3';
    host.innerHTML = renderMath(String.raw`\langle (x-x_0,y-y_0),(a,b) \rangle = 0 \implies ax+by = ax_0+by_0`, true);
    document.body.appendChild(host); await document.fonts.ready; layoutMath(host);
    return [...host.querySelectorAll<HTMLElement>('.math-unit.is-line-start')].map(e => e.querySelector('.math-cont .katex-html')?.textContent);
  });
  expect(result.length).toBe(1);
  expect(result[0]?.trim().startsWith('=')).toBe(true);
});

test('paired delimiters use the same group priority, including nesting and intervals', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const pairs = [
      ['(', ')'], ['[', ']'], ['[', ')'], [String.raw`\{`, String.raw`\}`],
      [String.raw`\lparen`, String.raw`\rparen`], [String.raw`\lbrack`, String.raw`\rbrack`],
      [String.raw`\lbrace`, String.raw`\rbrace`], [String.raw`\langle`, String.raw`\rangle`],
      [String.raw`\lceil`, String.raw`\rceil`], [String.raw`\lfloor`, String.raw`\rfloor`],
      [String.raw`\lvert`, String.raw`\rvert`], [String.raw`\lVert`, String.raw`\rVert`],
      [String.raw`\lgroup`, String.raw`\rgroup`], [String.raw`\lmoustache`, String.raw`\rmoustache`],
      [String.raw`\lBrace`, String.raw`\rBrace`], [String.raw`\ulcorner`, String.raw`\urcorner`],
      [String.raw`\llcorner`, String.raw`\lrcorner`],
    ];
    const inspect = (tex: string) => {
      const doc = new DOMParser().parseFromString(renderMath(tex, true), 'text/html');
      return { priorities: [...doc.querySelectorAll<HTMLElement>('.math-unit[data-break]')].map(x => Number(x.dataset.break)), errors: doc.querySelectorAll('.katex-error').length };
    };
    return {
      pairs: pairs.map(([l,r]) => [l, r, inspect(`z = ${l} a,b ${r} + c`)] as const),
      nested: inspect(String.raw`z = \langle [a,b), \{(x,y), z\} \rangle + q`),
      sized: inspect(String.raw`z = \left\lceil a,b \right\rceil + q`),
    };
  });
  for (const [left, right, value] of result.pairs) {
    expect(value.errors, `${left}...${right} should render`).toBe(0);
    expect(value.priorities, `${left}...${right} has an internal comma`).toEqual([2, 6, 4]);
  }
  expect(result.nested.errors).toBe(0);
  expect(result.nested.priorities).toEqual([2, 6, 6, 6, 6, 4]);
  expect(result.sized.errors).toBe(0);
  expect(result.sized.priorities).toEqual([2, 11, 4]);
});

test('ambiguous or unmatched bars and delimiters do not hide later cuts', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const inspect = (tex: string) => {
      const doc = new DOMParser().parseFromString(renderMath(tex, true), 'text/html');
      return [...doc.querySelectorAll<HTMLElement>('.math-unit[data-break]')].map(x => Number(x.dataset.break));
    };
    return [inspect(String.raw`x | y,z = w`), inspect(String.raw`x \vert y,z = w`),
      inspect(String.raw`\langle a,b = c`), inspect(String.raw`a,b \rangle = c`),
      inspect(String.raw`P(A|B,C) = q`), inspect(String.raw`x = \frac{a,b}{c} + z`)];
  });
  expect(result).toEqual([[1,2], [1,2], [1,2], [1,2], [6,2], [2,4]]);
});

test('adjacent complete groups are optional display cuts, not inline cuts', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const samples = [String.raw`(a+b)(c+d)`, String.raw`\lparen a+b\rparen\lparen c+d\rparen`,
      String.raw`[a+b]\langle c+d\rangle`, String.raw`\left(a+b\right)\left[c+d\right]`];
    return samples.map(tex => {
      const count = (display: boolean) => {
        const doc = new DOMParser().parseFromString(renderMath(tex, display), 'text/html');
        return { adjacent: doc.querySelectorAll('[data-cut-adjacent="1"]').length, errors: doc.querySelectorAll('.katex-error').length };
      };
      return [count(true), count(false)];
    });
  });
  for (const [display, inline] of result) {
    expect(display).toEqual({ adjacent: 1, errors: 0 });
    expect(inline).toEqual({ adjacent: 0, errors: 0 });
  }
});

test('cut metadata never treats TeX arguments as HTML attributes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const doc = new DOMParser().parseFromString(renderMath(String.raw`a \xrightarrow{\text{" onmouseover="bad}} b = c`, true), 'text/html');
    return { handlers: doc.querySelectorAll('[onmouseover]').length, cuts: [...doc.querySelectorAll<HTMLElement>('[data-cut-relation]')].map(x => x.dataset.cutRelation) };
  });
  expect(result.handlers).toBe(0);
  expect(result.cuts).toEqual(['other', 'assignment']);
});

test('plain absolute-value bars are grouped without confusing conditional bars', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const inspect = (tex: string) => {
      const doc = new DOMParser().parseFromString(renderMath(tex, true), 'text/html');
      return [...doc.querySelectorAll<HTMLElement>('.math-unit[data-break]')].map(x => Number(x.dataset.break));
    };
    return [inspect(String.raw`0 < |x-a| < \delta`), inspect(String.raw`|x+y| = z`),
      inspect(String.raw`P(A|B,C) = q`), inspect(String.raw`(|v_0|\cos\theta, -gt+|v_0|\sin\theta)`)];
  });
  expect(result).toEqual([[2,9,2], [9,2], [6,2], [6,9]]);
});

test('a chain of inline neighbors settles even when it needs more than three promotions', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath, clearMathLayout } = await window.__satr.load('/src/mathLayout.ts');
    const widths = [21,74,15,20,66,53,37,26,21,70];
    const host = document.createElement('article');
    host.style.cssText = 'position:fixed;top:0;left:0;font-size:16px;width:207px';
    host.innerHTML = '<p>' + widths.map((n, i) => `<span style="display:inline-block;width:${n}px">x</span>` +
      renderMath(String.raw`a_{${i}} = b + c`, false)).join('') + '</p>';
    document.body.appendChild(host); await document.fonts.ready; clearMathLayout(); layoutMath(host);
    const flows = [...host.querySelectorAll<HTMLElement>('.math-flow')];
    return { split: flows.filter(f => f.querySelector('.is-line-start')).length,
      promoted: flows.filter(f => f.style.display === 'inline-block').length };
  });
  expect(result).toEqual({ split: 0, promoted: 5 });
});

test('a text connector between written gaps stays with the expression that follows', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath, clearMathLayout } = await window.__satr.load('/src/mathLayout.ts');
    const host = document.createElement('article');
    host.style.cssText = 'position:fixed;top:0;left:0;font-size:16px;width:280px';
    host.innerHTML = renderMath(String.raw`|v|^2 (\sin^2 a + \cos^2 a) = |w|^2 (\sin^2 b + \cos^2 b) \quad \text{so} \quad |v| = |w|`, true);
    document.body.appendChild(host); await document.fonts.ready; clearMathLayout(); layoutMath(host);
    const units = [...host.querySelectorAll<HTMLElement>('.math-unit')];
    const text = units.findIndex(u => u.querySelector('annotation')?.textContent?.includes(String.raw`\text{so}`));
    return { connectorStartsLine: units[text]?.classList.contains('is-line-start'), nextStartsLine: units[text+1]?.classList.contains('is-line-start') };
  });
  expect(result).toEqual({ connectorStartsLine: true, nextStartsLine: false });
});

test('single-variable quantified predicates are not rebalanced through their absolute value', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath, clearMathLayout } = await window.__satr.load('/src/mathLayout.ts');
    await document.fonts.ready;
    return ['forall', 'exists'].map(q => {
      const host = document.createElement('article'); host.style.cssText = 'position:fixed;top:0;left:0;font-size:16px;width:350px';
      host.innerHTML = renderMath(String.raw`\text{ such that } \${q} x, 0 < |x-a| < \delta \Rightarrow |f(x)-L| < \varepsilon`, true);
      document.body.appendChild(host); clearMathLayout(); layoutMath(host);
      const starts = [...host.querySelectorAll<HTMLElement>('.math-unit.is-line-start')].map(e => e.querySelector('.math-plain annotation')?.textContent ?? '');
      host.remove(); return starts;
    });
  });
  expect(result).toHaveLength(2);
  for (const starts of result) {
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatch(/0\s*</);
  }
});

test('an extra display line does not introduce an isolated left-hand side', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath, clearMathLayout } = await window.__satr.load('/src/mathLayout.ts');
    const tex = String.raw`\text{result} = t \cdot ((x_1,y_1)+(x_2,y_2)) = t \cdot (x_1+x_2,y_1+y_2) = (t(x_1+x_2),t(y_1+y_2))`;
    const warm = document.createElement('article'); warm.innerHTML = renderMath(tex, true); document.body.appendChild(warm); await document.fonts.ready; warm.remove();
    return [235].map(width => {
      const host = document.createElement('article'); host.style.cssText = `position:fixed;top:0;left:0;font-size:16px;width:${width}px`;
      host.innerHTML = renderMath(tex, true); document.body.appendChild(host); clearMathLayout(); layoutMath(host);
      const units = [...host.querySelectorAll<HTMLElement>('.math-unit')];
      const firstBreak = units.findIndex(u => u.classList.contains('is-line-start'));
      const result = { width, isolatedLabel: firstBreak === 1 && units[1].dataset.cutRelation === 'assignment' };
      host.remove(); return result;
    });
  });
  for (const result of results) expect(result.isolatedLabel, `at ${result.width}px`).toBe(false);
});

test('optional cuts around sized groups preserve KaTeX spacing when unbroken', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath, clearMathLayout } = await window.__satr.load('/src/mathLayout.ts');
    const samples = [String.raw`(a)(b)`, String.raw`(a)\left(b\right)`,
      String.raw`\left(a\right)(b)`, String.raw`\left(a\right)\left[b\right]`,
      String.raw`\langle a\rangle\lceil b\rceil`, String.raw`(2)\left(\tfrac{1}{\sqrt2}\right)`];
    const host = document.createElement('article'); host.style.cssText = 'position:fixed;top:0;left:0;width:500px;font-size:16px';
    host.innerHTML = samples.map(tex => `<p>${renderMath(tex, false)}</p>${renderMath(tex, true)}`).join('');
    document.body.appendChild(host); await document.fonts.ready; clearMathLayout(); layoutMath(host);
    const flows = [...host.querySelectorAll<HTMLElement>('.math-flow')];
    return samples.map((tex, i) => ({ tex, inline: flows[i*2].getBoundingClientRect().width,
      display: flows[i*2+1].getBoundingClientRect().width, breaks: flows[i*2+1].querySelectorAll('.is-line-start').length }));
  });
  for (const r of results) {
    expect(r.breaks, r.tex).toBe(0);
    expect(Math.abs(r.display-r.inline), r.tex).toBeLessThan(0.6);
  }
});
