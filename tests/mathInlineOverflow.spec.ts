import { expect, test, type Page } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true });

const FRACTION = String.raw`\frac{a_{1}x_{1}+a_{2}x_{2}+a_{3}x_{3}+a_{4}x_{4}+a_{5}x_{5}+a_{6}x_{6}+a_{7}x_{7}+a_{8}x_{8}+a_{9}x_{9}+a_{10}x_{10}+a_{11}x_{11}+a_{12}x_{12}+a_{13}x_{13}+a_{14}x_{14}+a_{15}x_{15}}{p}`;
const PERSIAN = String.raw`\text{عبارتی نسبتاً طولانی از نوشته های فارسی که از خط بیرون می رود و می تواند طولانی باشد}`;
const TALL = String.raw`\displaystyle \frac{\sum_{i=0}^{n} a_{1}x_{1}+a_{2}x_{2}+a_{3}x_{3}+a_{4}x_{4}+a_{5}x_{5}+a_{6}x_{6}+a_{7}x_{7}+a_{8}x_{8}+a_{9}x_{9}+a_{10}x_{10}}{\sum_{i=0}^{n}b_i^2}`;

// Exercise the real renderer and layout inside the real reading-pane styles.
// Disable section containment in one variant: older engines don't support it.
async function show(page: Page, source: string, noContain = true) {
  await page.goto('/');
  await page.evaluate(async ({ source, noContain }) => {
    const { renderMarkdownParts, sizeListMarkers } = await window.__satr.load('/src/markdown.ts');
    const { renderMath } = await window.__satr.load('/src/math.ts');
    const { clearMathLayout, layoutMath } = await window.__satr.load('/src/mathLayout.ts');
    const pane = document.querySelector<HTMLElement>('#preview-pane')!;
    const root = document.querySelector<HTMLElement>('#preview')!;
    pane.style.cssText = 'display:block;position:fixed;inset:0;width:100vw;height:100vh;z-index:1000;mask-image:none';
    if (noContain) { const style = document.createElement('style'); style.textContent = '#preview > .md-section{content-visibility:visible!important}'; document.head.append(style); }
    const data = renderMarkdownParts(source);
    root.innerHTML = data.html;
    for (const hole of root.querySelectorAll<HTMLElement>('[data-satr-math]')) {
      const formula = data.formulas[Number(hole.dataset.satrMath)];
      const template = document.createElement('template');
      template.innerHTML = renderMath(formula.tex, formula.display);
      hole.replaceWith(template.content);
    }
    sizeListMarkers(root);
    await document.fonts.ready;
    clearMathLayout();
    layoutMath(root);
  }, { source, noContain });
}

for (const noContain of [true, false]) for (const rtl of [false, true]) {
  test(`inline overflow stays scrollable inside the reading pane (${noContain ? 'without containment' : 'with containment'}, ${rtl ? 'RTL' : 'LTR'})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await show(page, rtl ? `قبل $${PERSIAN}$ بعد` : `Before $${FRACTION}$ after`, noContain);
    const metrics = await page.evaluate(() => {
      const pane = document.querySelector<HTMLElement>('#preview-pane')!;
      const base = document.querySelector<HTMLElement>('.base.is-inline-scroll');
      if (!base) return { pane: pane.scrollWidth - pane.clientWidth, range: 0, moved: 0, bothEdges: false };
      const range = base.scrollWidth - base.clientWidth;
      base.scrollLeft = 0;
      const first = base.scrollLeft;
      base.scrollLeft = range;
      return { pane: pane.scrollWidth - pane.clientWidth, range, moved: base.scrollLeft - first, bothEdges: Math.abs(base.scrollLeft - range) < 1 };
    });
    expect(metrics.pane).toBeLessThanOrEqual(1);
    expect(metrics.range).toBeGreaterThan(100);
    expect(metrics.moved).toBeGreaterThan(100);
    expect(metrics.bothEdges).toBe(true);
  });
}

test('a touch drag moves the formula, not the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await show(page, `Before $${FRACTION}$ after`);
  const base = page.locator('.base.is-inline-scroll');
  const rect = (await base.boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const x = rect.x + rect.width * 0.75, y = rect.y + rect.height / 2;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 140 * i / 12, y }] });
    await page.waitForTimeout(20);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  expect(await base.evaluate(el => el.scrollLeft)).toBeGreaterThan(30);
  expect(await page.locator('#preview-pane').evaluate(el => el.scrollLeft)).toBe(0);
});

test('KaTeX breaks still work, a tall fraction is padded, and resizing resets the box', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await show(page, `Before $${TALL}$ after`);
  let m = await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('.base.is-inline-scroll')!;
    const s = getComputedStyle(b);
    return { range: b.scrollWidth - b.clientWidth, height: b.clientHeight, padding: parseFloat(s.paddingTop), scrollHeight: b.scrollHeight };
  });
  expect(m.range).toBeGreaterThan(100);
  expect(m.height).toBeGreaterThan(40);
  expect(m.padding).toBeGreaterThan(3);
  expect(m.scrollHeight - m.height).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1100, height: 844 });
  await page.evaluate(async () => { const { clearMathLayout, layoutMath } = await window.__satr.load('/src/mathLayout.ts'); clearMathLayout(); layoutMath(document.querySelector<HTMLElement>('#preview')!); });
  expect(await page.locator('.base.is-inline-scroll').count()).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => { const { clearMathLayout, layoutMath } = await window.__satr.load('/src/mathLayout.ts'); clearMathLayout(); layoutMath(document.querySelector<HTMLElement>('#preview')!); });
  expect(await page.locator('.base.is-inline-scroll').count()).toBe(1);
  // Repeated layout must not accumulate padding or scroll boxes.
  await page.evaluate(async () => { const { clearMathLayout, layoutMath } = await window.__satr.load('/src/mathLayout.ts'); clearMathLayout(); layoutMath(document.querySelector<HTMLElement>('#preview')!); });
  const again = await page.evaluate(() => { const b = document.querySelector<HTMLElement>('.base.is-inline-scroll')!; return [b.clientHeight, b.scrollWidth - b.clientWidth]; });
  expect(again).toEqual([m.height, m.range]);
});

test('a continuation still wraps at its KaTeX breaks rather than boxing the whole unit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await show(page, String.raw`Before $x=\frac{abcdefghijklmnopqrstuvwxyabcdefghijklmnopqrstuvwxy}{p}=y$ after`);
  const r = await page.evaluate(() => {
    const unit = document.querySelector<HTMLElement>('.math-unit.is-overwide')!;
    const rects = [...unit.getClientRects()];
    const pane = document.querySelector<HTMLElement>('#preview-pane')!;
    return { rects: rects.length, box: !!unit.querySelector('.base.is-inline-scroll'), starts: unit.classList.contains('is-line-start'), pane: pane.scrollWidth - pane.clientWidth };
  });
  expect(r.rects).toBeGreaterThan(1);
  expect(r.box).toBe(true);
  expect(r.starts).toBe(true);
  expect(r.pane).toBeLessThanOrEqual(1);
});

test('nested reading contexts and display math keep their own overflow behavior', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await show(page, `# Heading $${FRACTION}$\n\n- item\n  - nested $${FRACTION}$\n\n| table |\n| --- |\n| $${FRACTION}$ |\n\n$$${FRACTION}$$`);
  const r = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('#preview-pane')!;
    const display = document.querySelector<HTMLElement>('.math-display')!;
    const table = document.querySelector<HTMLElement>('.table-wrapper')!;
    return { pane: pane.scrollWidth - pane.clientWidth, heading: !!document.querySelector('h1 .base.is-inline-scroll'), list: !!document.querySelector('li li .base.is-inline-scroll'), displayBox: !!display.querySelector('.is-inline-scroll'), displayRange: display.scrollWidth - display.clientWidth, tableRange: table.scrollWidth - table.clientWidth };
  });
  expect(r.pane).toBeLessThanOrEqual(1);
  expect(r.heading).toBe(true);
  expect(r.list).toBe(true);
  expect(r.displayBox).toBe(false);
  expect(r.displayRange).toBeGreaterThan(0);
  expect(r.tableRange).toBeGreaterThan(0);
});

test('print does not turn inline math into a clipped scroll box', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await show(page, `Before $${FRACTION}$ after`);
  expect(await page.locator('.base.is-inline-scroll').count()).toBe(1);
  await page.emulateMedia({ media: 'print' });
  const css = await page.locator('.base.is-inline-scroll').evaluate(el => { const s = getComputedStyle(el); return [s.maxWidth, s.overflowX, s.paddingTop]; });
  expect(css).toEqual(['none', 'visible', '0px']);
});
