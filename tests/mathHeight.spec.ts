import { expect, test } from '@playwright/test';

// Display math is clipped to KaTeX's strut box (overflow-y: hidden, and a
// short line box on a wrapped unit). A large fraction paints past that box.
// The app grows the box to the content; the site path must not, the PDF is
// already fine without it.
const TALL = String.raw`\dfrac{\dfrac{a+b}{c}}{\dfrac{d}{e}}`;
const SPLIT = String.raw`x = \dfrac{\dfrac{a}{b}}{\dfrac{c}{d}}`;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
});

test('a display formula grows to its content instead of the strut height', async ({ page }) => {
  const report = await page.evaluate(async ({ tall, split }) => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { fitDisplayMath, layoutMath } = await window.__satr.load('/src/mathLayout.ts');
    const host = document.createElement('div');
    host.style.cssText = 'width: 420px; position: fixed; left: 0; top: 0; font-size: 16px; background: white;';
    host.innerHTML = renderMath(tall, true) + renderMath(split, true) + renderMath('a = b', true);
    document.body.appendChild(host);
    await document.fonts.ready;

    const boxes = [...host.querySelectorAll<HTMLElement>('.math-display')];
    const frame = boxes[0].querySelector<HTMLElement>(':scope > .katex-display')!;
    const before = { scroll: frame.scrollHeight, client: frame.clientHeight };
    fitDisplayMath(host);
    const fraction = boxes[1].querySelectorAll<HTMLElement>(':scope > .math-flow > .math-unit');
    const plain = boxes[2].querySelectorAll<HTMLElement>(':scope > .math-flow > .math-unit');
    const grown = {
      minHeight: frame.style.minHeight,
      client: frame.clientHeight,
      extra: frame.scrollHeight - frame.clientHeight,
      box: Math.round(boxes[0].getBoundingClientRect().height),
    };
    const fractionMin = [...fraction].map((unit) => unit.style.minHeight);
    const fractionExtra = [...fraction].map((unit) => unit.scrollHeight - unit.clientHeight);
    const plainMin = [...plain].map((unit) => unit.style.minHeight);
    // A second pass must not keep growing: the box already holds the content.
    fitDisplayMath(host);
    const again = frame.style.minHeight;

    // The site path (layoutMath, not the app) leaves the strut box alone.
    frame.style.minHeight = '';
    fraction.forEach((unit) => { unit.style.minHeight = ''; });
    layoutMath(host);
    return { before, grown, again, fractionMin, fractionExtra, plainMin, siteMin: frame.style.minHeight };
  }, { tall: TALL, split: SPLIT });

  expect(report.before.scroll - report.before.client).toBeGreaterThan(1);
  expect(report.grown.client).toBeGreaterThanOrEqual(report.before.scroll);
  expect(report.grown.extra).toBeLessThanOrEqual(1);
  expect(report.grown.box).toBeGreaterThan(report.before.client);
  expect(report.grown.minHeight.endsWith('px')).toBe(true);
  expect(report.again).toBe(report.grown.minHeight);

  // The tall piece of a split formula grows; a piece that already fits does not.
  expect(report.fractionMin.some((min) => min.endsWith('px'))).toBe(true);
  expect(report.fractionMin.some((min) => min === '')).toBe(true);
  expect(report.fractionExtra.every((extra) => extra <= 1)).toBe(true);
  expect(report.plainMin.every((min) => min === '')).toBe(true);
  expect(report.siteMin).toBe('');
});

test('KaTeX SVG signs carry their em sizes in CSS so they scale with the text', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath } = await window.__satr.load('/src/mathLayout.ts');
    const host = document.createElement('div');
    host.style.cssText = 'width: 380px; position: fixed; left: 0; top: 0; background: white;';
    host.innerHTML = renderMath('\\vec{u} + \\sqrt{2} + \\left(\\frac{a}{b}\\right)', true);
    document.body.appendChild(host);
    await document.fonts.ready;
    layoutMath(host);
    const styled = [...host.querySelectorAll('svg')]
      .filter((svg) => svg.hasAttribute('width') || svg.hasAttribute('height'))
      .map((svg) => ({
        width: svg.style.getPropertyValue('width'),
        height: svg.style.getPropertyValue('height'),
        attrWidth: svg.getAttribute('width'),
        attrHeight: svg.getAttribute('height'),
      }));
    const measure = () => {
      const arrow = host.querySelector<SVGElement>('.accent-body svg')!.getBoundingClientRect();
      const u = host.querySelector('.mord.mathnormal')!.getBoundingClientRect();
      return { arrowOverLetter: arrow.width / u.width, arrowWidth: arrow.width, arrowHeight: arrow.height, letterWidth: u.width };
    };
    const at16 = measure();
    host.style.fontSize = '32px';
    const at32 = measure();
    return { styled, at16, at32 };
  });
  expect(report.styled.length).toBeGreaterThan(0);
  for (const s of report.styled) {
    // The sign's box is sized in CSS (inline style), not only in attributes.
    if (s.attrWidth) expect(s.width).toBe(s.attrWidth);
    if (s.attrHeight) expect(s.height).toBe(s.attrHeight);
  }
  // The letters grow with the text, and so do the drawn signs: the arrow is
  // the same size relative to its letter at any text size, and it really got
  // bigger (that is the Android system font scale's job on a phone).
  expect(report.at32.letterWidth / report.at16.letterWidth).toBeGreaterThan(1.9);
  expect(report.at32.arrowWidth / report.at16.arrowWidth).toBeGreaterThan(1.9);
  expect(report.at32.arrowHeight / report.at16.arrowHeight).toBeGreaterThan(1.9);
  expect(Math.abs(report.at32.arrowOverLetter - report.at16.arrowOverLetter)).toBeLessThan(0.01);
});
