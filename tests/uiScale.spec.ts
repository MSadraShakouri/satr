// One scale for the whole sheet, and the math still right at every size.
//
// The phone's font size setting (Android's font scale) arrives as
// --system-font-scale (src/native.ts), and src/style.css derives the root font
// size from it: `font-size: calc(100% * var(--system-font-scale))`. 100% is the
// browser's own default size — the same 16px, and on the web the reader's own
// Chrome font-size setting — so the sheet is 16px there and 16px × the phone's
// scale in the app, and *everything* that is text is written in rem: the
// chrome, the note and the math alike.
//
// That is the point of the single scale. KaTeX lays every sign, accent offset
// and fraction shift out in em, so a phone that grew the letters without
// growing that em produced \vec{u} with its arrow touching the u; the em has
// to resolve to the size of the letter beside it, always. The last test holds
// the two together: the ratio of a drawn sign to its formula's text is the
// same at every system font size.
import { expect, test, type Page } from '@playwright/test';

const NOTE = [
  'A note with math, so the signs are drawn: $\\vec{u}$ and a display formula.',
  '',
  '$$',
  ' \\vec{u} = (a, b, c), \\quad |\\vec{u}| = \\sqrt{a^2 + b^2 + c^2}',
  '$$',
  '',
  'A list, and a task:',
  '',
  '- one',
  '- [ ] two',
].join('\n');

async function boot(page: Page, url = '/') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/Scale.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/Scale.md', text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/Scale.md' }], active: 0 }));
    // The reading view: the formulas are rendered there (the editor shows the
    // source, by design), and the drawers, menus and settings all draw their
    // own text on the same page.
    localStorage.setItem('satr:view:Notes/Scale.md', JSON.stringify({ mode: 'preview', line: 0 }));
  }, NOTE);
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
}

/** Every font size the sheet actually uses, keyed by a readable selector path:
 *  the chrome, the note and KaTeX's own internals, which are all em. */
async function fontSizes(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const out: Record<string, number> = {};
    // The sidebar button is excluded from the sweep by name (below): it is an
    // icon at a fixed 32px, and the test asserts it stays there.
    const named: [string, string][] = [
      ['root', 'html'],
      ['note', '.preview-pane article'],
      ['heading', '.preview-pane h1, .preview-pane h2'],
      ['preview code', '.preview-pane code'],
      ['katex', '.preview-pane .katex'],
      ['katex sign', '.preview-pane .katex svg'],
      ['sidebar icon', '.sidebar-button'], // excluded from the sweep by name
      ['navbar', '#navbar-wrap'],
      ['toolbar button', '.edit-toolbar button'],
    ];
    for (const [name, selector] of named) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) out[name] = Number.parseFloat(getComputedStyle(el).fontSize);
    }
    // Plus every element on the page carrying its own text, so nothing that is
    // text can be left behind at a fixed size: drawer rows, menu items,
    // settings, tabs, toasts.
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      if (el.closest('.sidebar-button')) return; // an icon, deliberately fixed
      if (![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) return;
      const size = Number.parseFloat(getComputedStyle(el).fontSize);
      // font-size: 0 is a marker that is drawn, not read (a checkbox, a hidden
      // bullet); KaTeX's own vlist-s is a 1px unit, not text. Neither is the
      // size of any letter on the page.
      if (!size || size < 2) return;
      out[`text: ${el.className || el.tagName}`] ??= size;
    });
    return out;
  });
}

test('the web is the same sheet it always was, and one scale moves all of it', async ({ page }) => {
  await boot(page);
  const at1 = await fontSizes(page);
  expect(at1.root).toBe(16);
  expect(at1.note).toBe(16);

  await page.evaluate(() => document.documentElement.style.setProperty('--system-font-scale', '1.3'));
  const at13 = await fontSizes(page);
  // Every piece of text on the page, KaTeX's internals and the note included,
  // is 1.3× what it was — nothing stays behind at its old size, which is what
  // "the phone's UI is a different size from the web's" was.
  const wrong: string[] = [];
  for (const [name, size] of Object.entries(at1)) {
    if (name === 'sidebar icon') continue; // the one fixed size, asserted below
    const scaled = at13[name];
    if (scaled === undefined) { wrong.push(`${name}: gone`); continue; }
    if (Math.abs(scaled - size * 1.3) > 0.02) wrong.push(`${name}: ${size} → ${scaled}, expected ${size * 1.3}`);
  }
  expect(wrong).toEqual([]);
  // The one deliberate exception: the sidebar button is an icon, not text.
  expect(at13['sidebar icon']).toBe(32);
});

test('a drawn sign keeps its size relative to the letters, at every scale', async ({ page }) => {
  await boot(page);
  const ratio = async (): Promise<number> => page.evaluate(() => {
    const katex = document.querySelector<HTMLElement>('.preview-pane .katex')!;
    const sign = katex.querySelector<SVGElement>('svg')!;
    // The sign's own em is what KaTeX wrote in the presentation attribute; the
    // painted width must follow the formula's text.
    return sign.getBoundingClientRect().width / Number.parseFloat(getComputedStyle(katex).fontSize);
  });
  const at1 = await ratio();
  await page.evaluate(() => document.documentElement.style.setProperty('--system-font-scale', '1.3'));
  await page.evaluate(() => document.fonts.ready);
  const at13 = await ratio();
  expect(at1).toBeGreaterThan(0);
  expect(Math.abs(at13 - at1)).toBeLessThan(0.01);
});

test('the site can be shown at the phone’s own scale, from the address', async ({ page }) => {
  // The APK applies the phone's font size; ?fontscale= applies the same number
  // on the web, so the two can be held side by side (src/native.ts).
  await boot(page, '/?fontscale=1.15');
  const sizes = await fontSizes(page);
  expect(sizes.root).toBeCloseTo(18.4, 2);
  expect(sizes.note).toBeCloseTo(18.4, 2);
  await boot(page, '/?fontscale=2');
  expect((await fontSizes(page)).root).toBeCloseTo(32, 2);
});
