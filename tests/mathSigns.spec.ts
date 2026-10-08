import { expect, test, type Page } from '@playwright/test';

// KaTeX draws its signs — the \vec arrow, roots, stretchy brackets — as SVG
// sized in em in a presentation attribute. Android's WebView scales text (its
// text zoom follows Configuration.fontScale), and a length that lives only in
// an attribute did not follow it there: the letters grew and the signs stayed
// put, so \vec{u} ended up with its arrow touching the letter. The web and the
// PDF are fine, which is what made it look like a math bug rather than a
// WebView one.
//
// src/mathLayout.ts therefore (1) carries the attribute's em into CSS, which is
// all a browser needs, then (2) *measures* every sign against the formula's own
// text and forces the size when the box is not following, and (3) scales the
// drawing if even the box is ignored. These tests pin all three rungs: the
// first must not disturb a browser that already works, the second must undo a
// WebView whose signs are stuck at the size they had before the system font
// scale grew the text, and the third is the decision itself.
const FORMULAS = String.raw`\vec{u} = \sqrt{2} + \left(\frac{a}{b}\right) + \widehat{xy}`;
/** The text is drawn 30% larger, the way Android's text zoom draws it at a
 *  fontScale of 1.3. */
const SCALE = 1.3;
const BASE = 20;

/** Render `tex` at `fontSize`, run the layout pass, and report every sign. When
 *  `frozen`, each sign is first pinned in px at the size it has at BASE — a
 *  WebView that lays a sign out from its attribute, at the text size from
 *  before the system font scale grew it, whatever the CSS says. An author
 *  !important rule is as close as a desktop browser gets to that. */
async function measure(page: Page, fontSize: number, options: { frozen?: boolean; layout?: boolean } = {}) {
  const { frozen = false, layout = true } = options;
  return page.evaluate(async ({ tex, fontSize, frozen, layout, base }) => {
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { layoutMath } = await window.__satr.load('/src/mathLayout.ts');
    const render = (size: number) => {
      const probe = document.createElement('div');
      probe.style.cssText = `position: absolute; visibility: hidden; left: 0; top: 0; font-size: ${size}px;`;
      probe.innerHTML = renderMath(tex, false);
      document.body.appendChild(probe);
      return probe;
    };
    const sheet = frozen ? document.createElement('style') : null;
    if (sheet) {
      const unscaled = render(base);
      const rules = new Map<string, string>();
      for (const svg of unscaled.querySelectorAll<SVGElement>('svg')) {
        const w = svg.getAttribute('width');
        const h = svg.getAttribute('height');
        if (!w || !h) continue;
        const rect = svg.getBoundingClientRect();
        if (rect.width < 0.5 || rect.height < 0.5) continue; // a clipped slice
        rules.set(`${w}|${h}`, `${rect.width}px|${rect.height}px`);
      }
      unscaled.remove();
      sheet.textContent = [...rules]
        .map(([key, value]) => {
          const [w, h] = key.split('|');
          const [pw, ph] = value.split('|');
          return `.katex svg[width="${w}"][height="${h}"] { width: ${pw} !important; height: ${ph} !important; }`;
        })
        .join('\n');
      document.head.appendChild(sheet);
    }
    const host = render(fontSize);
    host.style.visibility = 'visible';
    host.style.width = '420px';
    host.style.background = 'white';
    host.style.position = 'fixed';
    await document.fonts.ready;
    if (layout) layoutMath(host);
    const strut = host.querySelector<HTMLElement>('.strut')!;
    const oneEm = strut.getBoundingClientRect().height / Number(/[\d.]+/.exec(strut.style.height)![0]);
    const signs = [...host.querySelectorAll<SVGElement>('svg')]
      .filter((svg) => svg.hasAttribute('height'))
      .map((svg) => {
        const rect = svg.getBoundingClientRect();
        return {
          em: Number(/[\d.]+/.exec(svg.getAttribute('height')!)[0]),
          style: svg.style.getPropertyValue('height'),
          priority: svg.style.getPropertyPriority('height'),
          transform: svg.style.getPropertyValue('transform'),
          widthStyle: svg.style.getPropertyValue('width'),
          widthPriority: svg.style.getPropertyPriority('width'),
          paintedHeight: rect.height,
          paintedWidth: rect.width,
        };
      });
    const arrow = host.querySelector<SVGElement>('.accent-body svg')!.getBoundingClientRect();
    const letter = host.querySelector<HTMLElement>('.mord.mathnormal')!.getBoundingClientRect();
    const report = {
      oneEm,
      signs,
      onScreen: signs.filter((sign) => sign.paintedHeight > 0 || sign.paintedWidth > 0),
      arrowHeight: arrow.height,
      arrowWidth: arrow.width,
      letterWidth: letter.width,
      // What the reader sees: the arrow against the letter it belongs to.
      arrowOverLetter: arrow.width / letter.width,
    };
    sheet?.remove();
    host.remove();
    return report;
  }, { tex: FORMULAS, fontSize, frozen, layout, base: BASE });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
});

test('a sign that follows the text keeps its em size and is never frozen in px', async ({ page }) => {
  const report = await measure(page, BASE * SCALE);
  expect(report.onScreen.length).toBeGreaterThan(1);
  for (const sign of report.onScreen) {
    // The same numbers KaTeX wrote, in CSS, still in em: no px, no !important,
    // no transform. A browser that resolves em against the scaled text keeps
    // every sign the right size by itself, and nothing can go stale.
    expect(sign.style).not.toBe('');
    expect(sign.priority).toBe('');
    expect(sign.transform).toBe('');
    expect(sign.paintedHeight).toBeCloseTo(sign.em * report.oneEm, 1);
  }
});

test('signs left at the size they had before the system font scale are forced back', async ({ page }) => {
  // The same formula at the same text scale, with a WebView whose signs did
  // not follow: the arrow is drawn for the text size from before.
  const before = await measure(page, BASE * SCALE, { frozen: true, layout: false });
  const unscaled = await measure(page, BASE);
  expect(before.arrowHeight).toBeCloseTo(unscaled.arrowHeight, 0);
  expect(before.arrowWidth).toBeCloseTo(unscaled.arrowWidth, 0);
  // The bug: the arrow is a good deal smaller than the letter it belongs to.
  expect(before.arrowOverLetter).toBeLessThan(unscaled.arrowOverLetter * 0.85);

  const after = await measure(page, BASE * SCALE, { frozen: true });
  for (const sign of after.onScreen) {
    // Satr measured the sign against its own formula and wrote the size in px,
    // important so it beats the rule the WebView insists on.
    expect(sign.priority).toBe('important');
    expect(sign.style.endsWith('px')).toBe(true);
    expect(Number.parseFloat(sign.style)).toBeCloseTo(sign.em * after.oneEm, 0);
    expect(sign.paintedHeight).toBeCloseTo(sign.em * after.oneEm, 0);
  }
  // The sign is the size of the text it belongs to again: exactly what the
  // formula looks like with a WebView that keeps its em, and what the PDF
  // shows, since the print WebView is pinned at setTextZoom(100).
  expect(after.arrowHeight).toBeCloseTo(before.arrowHeight * SCALE, 0);
  expect(after.arrowOverLetter).toBeCloseTo(unscaled.arrowOverLetter, 1);
});

test('the arrow keeps its size relative to its letter at any text size', async ({ page }) => {
  const small = await measure(page, 16);
  const large = await measure(page, 32);
  // The letters doubled, and the drawn sign doubled with them: that is the
  // system font scale's job on a phone, and the reason the PDF (rendered at a
  // fixed scale) is the reference the preview is measured against.
  expect(large.letterWidth / small.letterWidth).toBeGreaterThan(1.9);
  expect(large.arrowWidth / small.arrowWidth).toBeGreaterThan(1.9);
  expect(large.arrowHeight / small.arrowHeight).toBeGreaterThan(1.9);
  expect(large.arrowOverLetter).toBeCloseTo(small.arrowOverLetter, 2);
});

test('the correction is only made for a sign that is really the wrong size', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { emSize, signSizeCorrection } = await window.__satr.load('/src/mathLayout.ts');
    return {
      em: [emSize('0.471em'), emSize('400em'), emSize(' 1.08em '), emSize('50%'), emSize('1.08px'), emSize(null), emSize('')],
      right: signSizeCorrection(11.4, 11.4),
      rounding: signSizeCorrection(11.4, 11.45),
      frozen: signSizeCorrection(11.4, 8.7),
      grown: signSizeCorrection(11.4, 14.8),
      hidden: signSizeCorrection(11.4, 0),
      unknown: signSizeCorrection(0, 11.4),
    };
  });
  expect(report.em).toEqual([0.471, 400, 1.08, null, null, null, null]);
  // A sign the size its own em asks for is left alone, and so is one that is
  // out by a rounding error: this runs on every formula of every note.
  expect(report.right).toBeNull();
  expect(report.rounding).toBeNull();
  // A sign left behind by the old font scale is measured and forced back, and
  // the scale says by how much it has to be stretched if the box is ignored.
  expect(report.frozen).toEqual({ px: 11.4, scale: 11.4 / 8.7 });
  expect(report.grown!.px).toBe(11.4);
  expect(report.grown!.scale).toBeLessThan(1);
  // Nothing is measured for a sign that is not on screen.
  expect(report.hidden).toBeNull();
  expect(report.unknown).toBeNull();
});
