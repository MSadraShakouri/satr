import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('math digits can be forced to one set across the whole formula', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { renderMath, setMathDigits } = await window.__satr.load('/src/math.ts');
    const tex = 'x = 12 \\text{ سال 3 } \\tag{7}';
    setMathDigits('auto');
    const auto = renderMath(tex, true);
    setMathDigits('persian');
    const persian = renderMath(tex, true);
    setMathDigits('english');
    const english = renderMath('x = \\frac{۱۲}{۳}', true);
    setMathDigits('auto');
    return { auto, persian, english, source: tex };
  });
  // "Auto" keeps what the writer typed.
  expect(out.auto).toContain('12');
  expect(out.auto).not.toContain('۱');
  // Persian forces every digit — numbers, \text and \tag alike.
  expect(out.persian).toContain('۱۲');
  expect(out.persian).toContain('۳');
  expect(out.persian).toContain('۷');
  expect(out.persian).not.toContain('>12<');
  // English forces Persian digits back to Latin.
  expect(out.english).toContain('12');
  expect(out.english).toContain('3');
  expect(out.english).not.toContain('۱');
  // Display-only: the formula text itself is never rewritten.
  expect(out.source).toBe('x = 12 \\text{ سال 3 } \\tag{7}');
});

test('inline math follows the digits setting too', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { renderMath, setMathDigits } = await window.__satr.load('/src/math.ts');
    setMathDigits('persian');
    const html = renderMath('a_1 + b_2', false);
    setMathDigits('auto');
    return html;
  });
  expect(out).toContain('۱');
  expect(out).toContain('۲');
});
