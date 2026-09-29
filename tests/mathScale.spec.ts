import { expect, test } from '@playwright/test';

// KaTeX sizes its SVG signs (the \vec arrow, stretchy brackets, roots) in em
// lengths written as width/height attributes. Android's WebView scales CSS
// text but not those attribute lengths, so in the app preview the signs stayed
// at 1x while the letters grew — the vec arrow ended up sitting on its letter,
// and the same formula looked right in the PDF (rendered at text zoom 100).
// layoutMath() now writes the lengths as pixels computed from the element's
// own computed font size, and runs again on every font-scale change
// (native.ts dispatches satr:font-scale-change → main.ts → layoutMath).
const VEC = String.raw`\vec{u}`;
const ROOT = String.raw`\sqrt{x}`;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
});

test('SVG signs follow the computed font size, not the attribute length', async ({ page }) => {
  const report = await page.evaluate(async ({ vec, root }) => {
    const { renderMath } = await import('/src/math.ts');
    const { layoutMath } = await import('/src/mathLayout.ts');
    const host = document.createElement('article');
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;background:white;font-size:16px;';
    host.innerHTML = renderMath(vec, false) + renderMath(root, false);
    document.body.appendChild(host);
    await document.fonts.ready;
    const sign = () => [...host.querySelectorAll<SVGElement>('svg[width], svg[height]')].map((svg) => ({
      width: svg.style.getPropertyValue('width'),
      height: svg.style.getPropertyValue('height'),
      box: Math.round(svg.getBoundingClientRect().width * 100) / 100,
    }));
    const read = (size: string) => {
      host.style.fontSize = size;
      layoutMath(host);
      return sign();
    };
    return {
      attributes: [...host.querySelectorAll('svg[width], svg[height]')].map((svg) => ({
        width: svg.getAttribute('width'),
        height: svg.getAttribute('height'),
      })),
      first: sign(),
      small: read('16px'),
      large: read('32px'),
    };
  }, { vec: VEC, root: ROOT });

  // KaTeX's own em values stay in the attributes as a fallback.
  expect(report.attributes[0].width).toMatch(/em$/);
  expect(report.attributes[0].height).toMatch(/em$/);
  // The vec arrow (a plain-sized sign) is written in pixels taken from its
  // own computed font size — the letter it sits on is 16px tall in ems.
  expect(report.small[0].width).toMatch(/^\d+(\.\d+)?px$/);
  expect(Number.parseFloat(report.small[0].width)).toBeCloseTo(0.471 * 16, 2);
  expect(Number.parseFloat(report.small[0].height)).toBeCloseTo(0.714 * 16, 1);
  // The stretchy root keeps KaTeX's own 400em clipping rule for width, and
  // still gets a pixel height, so it cannot slip out of scale either.
  expect(report.small[1].width).toBe('');
  expect(Number.parseFloat(report.small[1].height)).toBeCloseTo(1.08 * 16, 1);
  // Doubling the font size doubles every drawn sign, exactly like the letters.
  for (let index = 0; index < report.small.length; index += 1) {
    expect(report.large[index].box / report.small[index].box).toBeCloseTo(2, 1);
  }
});

test('re-running the layout re-derives the pixel sizes', async ({ page }) => {
  const sizes = await page.evaluate(async (vec) => {
    const { renderMath } = await import('/src/math.ts');
    const { layoutMath } = await import('/src/mathLayout.ts');
    const host = document.createElement('article');
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;background:white;font-size:16px;';
    host.innerHTML = renderMath(vec, false);
    document.body.appendChild(host);
    await document.fonts.ready;
    layoutMath(host);
    const before = host.querySelector('svg')!.style.getPropertyValue('height');
    // The phone's font size changed: native.ts dispatches the event, main.ts
    // re-runs the layout, and the sizes must follow the new font size.
    host.style.fontSize = '24px';
    window.dispatchEvent(new CustomEvent('satr:font-scale-change', { detail: { scale: 1.5, previous: 1 } }));
    layoutMath(host);
    const after = host.querySelector('svg')!.style.getPropertyValue('height');
    layoutMath(host); // idempotent
    return { before, after, again: host.querySelector('svg')!.style.getPropertyValue('height') };
  }, VEC);
  expect(Number.parseFloat(sizes.before)).toBeCloseTo(0.714 * 16, 1);
  expect(Number.parseFloat(sizes.after)).toBeCloseTo(0.714 * 24, 1);
  expect(sizes.again).toBe(sizes.after);
});
