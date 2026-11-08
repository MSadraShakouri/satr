import { test, expect, type Page } from '@playwright/test';

// Measure the real renderer with the bundled fonts; these are ordinary
// mathematical shapes, not copies of anyone's notes.
async function layouts(page: Page, samples: Array<{ tex: string; width: number }>) {
  return page.evaluate(async (cases) => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath, clearMathLayout } = await window.__satr.load('/src/mathLayout.ts');
    const warm = document.createElement('article');
    warm.innerHTML = cases.map(({ tex }) => renderMath(tex, true)).join('');
    document.body.appendChild(warm); await document.fonts.ready; warm.remove();
    return cases.map(({ tex, width }) => {
      const host = document.createElement('article');
      host.style.cssText = `position:fixed;top:0;left:0;width:${width}px;font-size:16px`;
      host.innerHTML = renderMath(tex, true);
      document.body.appendChild(host);
      clearMathLayout(); layoutMath(host);
      const box = host.querySelector<HTMLElement>('.math-display')!;
      const units = [...box.querySelectorAll<HTMLElement>('.math-unit')];
      const starts = units.flatMap((unit, i) => unit.classList.contains('is-line-start') ? [{
        kind: unit.dataset.cutKind, relation: unit.dataset.cutRelation,
        prior: units[i - 1]?.querySelector('.math-plain annotation')?.textContent ?? '',
        text: unit.querySelector('.math-cont .katex-html')?.textContent?.replace(/\s/g, '') ?? '',
      }] : []);
      const result = { starts, overflow: box.scrollWidth - box.clientWidth,
        errors: box.querySelectorAll('.katex-error').length,
        display: box.querySelector('.math-flow')?.getAttribute('style') ?? '',
        hasFlow: !!box.querySelector('.math-flow') };
      host.remove();
      return result;
    });
  }, samples);
}

test('a written colon gap keeps a quantified condition and its domain together', async ({ page }) => {
  await page.goto('/');
  const samples = ['\\forall', '\\exists', '∀'].flatMap(q => ['\\quad', '\\qquad'].map(gap => ({
    tex: `${q} a,b \\in F, ${q} (x,y) \\in V : ${gap} a \\cdot (b \\cdot (x,y)) = (ab) \\cdot (x,y)`,
    width: 300,
  })));
  const results = await layouts(page, samples);
  for (const [i, result] of results.entries()) {
    expect(result.errors, samples[i].tex).toBe(0);
    expect(result.overflow, samples[i].tex).toBeLessThanOrEqual(1);
    expect(result.starts, samples[i].tex).toHaveLength(1);
    expect(result.starts[0].kind).toBe('separator');
    expect(result.starts[0].prior).toMatch(/:\s*\\(?:quad|qquad)\s*\{\}\s*$/);
    expect(result.starts[0].text).toMatch(/^a/);
  }
});

test('products stay whole at fitting relations, even when that takes one extra line', async ({ page }) => {
  await page.goto('/');
  const samples = ['\\cdot', '\\times'].map(op => ({
    tex: `r ${op} x = O \\xrightarrow{r^{-1}} r^{-1} ${op} r ${op} x = r^{-1} ${op} O \\xrightarrow{q} 1 ${op} x = r^{-1} ${op} O \\implies x = O`,
    width: 300,
  }));
  const results = await layouts(page, samples);
  for (const [i, result] of results.entries()) {
    expect(result.errors, samples[i].tex).toBe(0);
    expect(result.overflow, samples[i].tex).toBeLessThanOrEqual(1);
    expect(result.starts, samples[i].tex).toHaveLength(2);
    expect(result.starts.every(s => s.kind !== 'product' && s.relation === 'assignment')).toBe(true);
    expect(result.starts.every(s => s.text.startsWith('='))).toBe(true);
  }
});

test('a quantified premise is not split into an extra line to protect a product', async ({ page }) => {
  await page.goto('/');
  const result = await layouts(page, [{
    tex: String.raw`\forall x \in F, \forall a,b \in V : x \cdot (a+b) = x \cdot a + x \cdot b`,
    width: 230,
  }]);
  // The two-line answer is preferred over a third line in the quantified
  // premise. On this width a product cut is still the honest fallback.
  expect(result[0].starts).toHaveLength(1);
  expect(result[0].starts[0].kind).toBe('product');
  expect(result[0].overflow).toBeLessThanOrEqual(1);
});

test('overwide indivisible fractions keep their existing shrink-and-scroll fallback', async ({ page }) => {
  await page.goto('/');
  const result = await layouts(page, [{
    tex: String.raw`\forall x \in F: \frac{abcdefghijklmnopqrstuvwxyabcdefghijklmnop}{abcdefghijk}`,
    width: 200,
  }]);
  expect(result[0].hasFlow).toBe(true);
  expect(result[0].display).toContain('85%');
  expect(result[0].starts).toHaveLength(1);
  expect(result[0].overflow).toBeGreaterThan(0);
});

test('a writer-aligned block remains an intact KaTeX display', async ({ page }) => {
  await page.goto('/');
  const result = await layouts(page, [{
    tex: String.raw`\begin{aligned} \forall x \in F : & x \cdot a = b \\ & x \cdot c = d \end{aligned}`,
    width: 200,
  }]);
  expect(result[0].errors).toBe(0);
  expect(result[0].hasFlow).toBe(false);
  expect(result[0].starts).toHaveLength(0);
});

test('a continuation beginning with equals does not gain an extra line for a product', async ({ page }) => {
  await page.goto('/');
  const result = await layouts(page, [{
    tex: String.raw`= (a+b,c+d) = t \cdot (a,b) + t \cdot (c,d) = \text{result}`,
    width: 210,
  }]);
  expect(result[0].starts).toHaveLength(1);
  expect(result[0].starts[0].kind).toBe('product');
  expect(result[0].overflow).toBeLessThanOrEqual(1);
});

test('a prose-labelled calculation keeps its existing relation breaks', async ({ page }) => {
  await page.goto('/');
  const result = await layouts(page, [{
    tex: String.raw`\text{result} = t \cdot (a,b) + t \cdot (c,d) = (ta,tb) + (tc,td) = (ta+tc,tb+td)`,
    width: 220,
  }]);
  expect(result[0].starts).toHaveLength(2);
  expect(result[0].starts[0].kind).toBe('product');
  expect(result[0].starts[1].relation).toBe('assignment');
  expect(result[0].overflow).toBeLessThanOrEqual(1);
});
