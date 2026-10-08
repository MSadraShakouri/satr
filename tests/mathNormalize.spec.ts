import { expect, test, type Page } from '@playwright/test';
import type { SatrEditor } from '../src/editor';

declare global { interface Window { testEditor: SatrEditor } }

// A note pasted from Pandoc, or from anything that writes LaTeX, carries its
// formulas as `\(…\)` and `\[…\]`. Satr speaks dollars, so the Normalize math
// command rewrites the first pair into the second (src/mathNormalize.ts). The
// scanner stays dollars-only — nothing here renders as math until the rewrite,
// which is why the reading view and the PDF need no new case at all.
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
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, { text, pos });
}

const value = (page: Page): Promise<string> => page.evaluate(() => window.testEditor.getValue());
const normalize = (page: Page): Promise<boolean> => page.evaluate(() => window.testEditor.run('normalizeMath'));
const marks = (page: Page): Promise<{ math: string[]; delims: string[] }> => page.evaluate(() => {
  const dom = window.testEditor.view.dom;
  return {
    math: [...dom.querySelectorAll('.cm-math')].map((el) => el.textContent ?? ''),
    delims: [...dom.querySelectorAll('.cm-math-delim')].map((el) => el.textContent ?? ''),
  };
});
const notices = (page: Page): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll('.notice')].map((el) => el.textContent ?? ''));

test('an unpaired delimiter stays the escape it was', async ({ page }) => {
  await draft(page, 'a \\(x and a \\[ too|');
  await normalize(page);
  expect(await value(page)).toBe('a \\(x and a \\[ too');

  await draft(page, 'closed \\) on its own is not a pair|');
  await normalize(page);
  expect(await value(page)).toBe('closed \\) on its own is not a pair');
});

test('code is never math, in a span or in a fence', async ({ page }) => {
  await draft(page, 'a `\\(x\\)` here\n\n```\n\\[y\\]\n```|');
  await normalize(page);
  expect(await value(page)).toBe('a `\\(x\\)` here\n\n```\n\\[y\\]\n```');
});

test('\\(…\\) becomes $…$, and a second run finds nothing left', async ({ page }) => {
  await draft(page, 'a \\(x\\) and \\(y\\)|');
  await normalize(page);
  expect(await value(page)).toBe('a $x$ and $y$');
  expect(await marks(page)).toEqual({ math: ['x', 'y'], delims: ['$', '$', '$', '$'] });

  await normalize(page);
  expect(await value(page)).toBe('a $x$ and $y$');
});

test('dollars the note already had are left exactly as they were', async ({ page }) => {
  await draft(page, 'a $x$ beside \\(y\\)|');
  await normalize(page);
  expect(await value(page)).toBe('a $x$ beside $y$');

  // Content that already carries a dollar would nest one pair inside another.
  await draft(page, '\\(a$b\\)|');
  await normalize(page);
  expect(await value(page)).toBe('\\(a$b\\)');
});

test('\\[…\\] becomes a display block, even when it spans lines', async ({ page }) => {
  await draft(page, '\\[\nx = 1\n\\]|');
  await normalize(page);
  expect(await value(page)).toBe('$$\nx = 1\n$$');
  expect(await marks(page)).toEqual({ math: ['x = 1'], delims: ['$$', '$$'] });
});

test('a heading between \\[ and \\] breaks the pair, as it breaks $$', async ({ page }) => {
  await draft(page, '\\[\na\n# Heading\nb\n\\]|');
  await normalize(page);
  expect(await value(page)).toBe('\\[\na\n# Heading\nb\n\\]');

  await draft(page, 'two pairs: \\(a\\) and \\(b\\)|');
  await normalize(page);
  expect(await value(page)).toBe('two pairs: $a$ and $b$');
});

test('a selection is the scope; without one, the whole note', async ({ page }) => {
  await draft(page, '\\(a\\)\n\n\\(b\\)|');
  await page.evaluate(() => window.testEditor.setSelection(0, 5));
  await normalize(page);
  expect(await value(page)).toBe('$a$\n\n\\(b\\)');

  await draft(page, '\\(a\\)\n\n\\(b\\)|');
  await normalize(page);
  expect(await value(page)).toBe('$a$\n\n$b$');
});

test('one undo puts the note back exactly as it was pasted', async ({ page }) => {
  await draft(page, 'a \\(x\\) and\n\n\\[\ny = 2\n\\]|');
  await normalize(page);
  expect(await value(page)).toBe('a $x$ and\n\n$$\ny = 2\n$$');

  await page.evaluate(() => window.testEditor.undo());
  expect(await value(page)).toBe('a \\(x\\) and\n\n\\[\ny = 2\n\\]');
});

test('the notice says how many, and says when there are none', async ({ page }) => {
  await draft(page, '\\(a\\) and \\(b\\)|');
  await normalize(page);
  expect(await notices(page)).toContain('Normalized 2 formulas.');

  await draft(page, 'nothing to do|');
  await normalize(page);
  expect(await notices(page)).toContain('No \\( \\) or \\[ \\] math in this note.');
});

// The normalizer lives in the ≡ sheet, not in the keyboard toolbar: it is one
// thing done to one note, not a formatting key. It is also dead when the note
// has nothing to convert, and a dead item in a menu is worse than no item.
async function boot(page: Page, text: string) {
  // No viewport override: at phone width the note's own keyboard hides the
  // floating navbar (style.css .keyboard-open .mobile-navbar), and the ≡ that
  // opens this sheet is on that navbar.
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/Math.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/Math.md', text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/Math.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, text);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/Math/);
  // The boot cover holds a clone of the app for its opening animation, so every
  // selector below would otherwise match twice (src/snapshot.ts).
  await expect(page.locator('#boot-snapshot')).toHaveCount(0);
}

const stored = (page: Page): Promise<string | null> => page.evaluate(() => localStorage.getItem('satr:fs:file:Notes/Math.md'));

test('the ≡ sheet normalizes the note it is opened on', async ({ page }) => {
  await boot(page, 'a \\(x\\) b');
  await page.locator('#navbar #nav-menu').first().click();
  await page.getByRole('menuitem', { name: 'Normalize math', exact: true }).click();
  await expect.poll(() => stored(page)).toBe('a $x$ b');
});

test('the item is dead on a note with nothing to convert', async ({ page }) => {
  await boot(page, 'nothing to convert here');
  await page.locator('#navbar #nav-menu').first().click();
  const item = page.getByRole('menuitem', { name: 'Normalize math', exact: true });
  await expect(item).toHaveClass(/is-disabled/);
  await expect(await stored(page)).toBe('nothing to convert here');
});

test('the keyboard toolbar is left as it was', async ({ page }) => {
  await boot(page, 'a \\(x\\) b');
  await expect(page.locator('#edit-toolbar-list button[data-command="normalizeMath"]')).toHaveCount(0);
  await expect(page.locator('#edit-toolbar-list button[data-command="math"]')).toHaveCount(1);
});


test('the gray grows from behind the pill: rounded top, tucked into its middle', async ({ page }) => {
  await boot(page, 'a \\(x\\) and \\(y\\)\n\n\\[z = 3\\]');
  const white = page.locator('#navbar .pill-white');
  const gray = page.locator('#navbar .pill-gray');
  const resting = await white.evaluate((el) => JSON.stringify(el.getBoundingClientRect()));
  await expect(gray).toBeVisible();
  await expect(gray).toContainText('3 LaTeX-style formulas — tap to convert');

  // The pill is exactly what it was: 52px, same place, still fully rounded.
  const grown = await white.evaluate((el) => JSON.stringify(el.getBoundingClientRect()));
  expect(grown).toBe(resting);
  const pill = JSON.parse(grown);
  expect(pill.height).toBe(52);
  const radius = await white.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(parseFloat(radius)).toBeGreaterThanOrEqual(26);

  // The gray: same width, bottom at the pill's middle, drawn behind it, and the
  // only rounded edge is its top.
  const shape = await gray.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      box: box.toJSON(),
      top: parseFloat(style.borderTopLeftRadius),
      bottom: parseFloat(style.borderBottomLeftRadius),
      z: Number(style.zIndex),
      whiteZ: Number(getComputedStyle(el.parentElement!.querySelector('.pill-white')!).zIndex),
    };
  });
  expect(Math.abs(shape.box.width - pill.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(shape.box.bottom - (pill.top + pill.height / 2))).toBeLessThanOrEqual(1);
  expect(shape.top).toBeGreaterThan(0);
  expect(shape.bottom).toBe(0);
  expect(shape.z).toBeLessThan(shape.whiteZ);
  // And it rises above the pill rather than stopping at it.
  expect(shape.box.top).toBeLessThan(pill.top);
});

test('with nothing to say, nothing of the pill is disturbed', async ({ page }) => {
  await boot(page, 'plain $x$ and plain prose');
  await expect(page.locator('#navbar .pill-gray')).toBeHidden();
  await expect(page.locator('#edit-toolbar [data-math-warning]')).toBeHidden();
  const box = await page.locator('#navbar .pill-white').evaluate((el) => el.getBoundingClientRect().toJSON());
  expect(box.height).toBe(52);
});

test('the gray is the button, and it is also the receipt', async ({ page }) => {
  await boot(page, 'a \\(x\\) and \\(y\\)');
  const gray = page.locator('#navbar .pill-gray');
  await gray.click();
  await expect.poll(() => stored(page)).toBe('a $x$ and $y$');
  await expect(gray).toContainText('2 formulas converted');
  // Long enough to read, and still there when a late fold would have taken it.
  await page.waitForTimeout(1200);
  await expect(gray).toBeVisible();
  await expect(gray).toContainText('2 formulas converted');
  await expect(gray).toBeHidden({ timeout: 6000 });
});

test('the keyboard bar carries the same gray, and its buttons stay on their line', async ({ page }) => {
  // A keyboard, the way the app measures one: the visible viewport stops being
  // the whole window (layoutToolbar, src/main.ts).
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(window.visualViewport!, 'height', {
      get() { calls += 1; return calls <= 1 ? window.innerHeight : window.innerHeight - 300; },
    });
  });
  await boot(page, 'a \\(x\\)');
  await page.locator('.cm-content').click();
  await expect(page.locator('body')).toHaveClass(/keyboard-open/);

  const gray = page.locator('#edit-toolbar [data-math-warning]');
  await expect(gray).toBeVisible();
  // Both bars carry it; only the one on screen is seen.
  await expect(page.locator('#navbar [data-math-warning]')).toContainText('1 LaTeX-style formula — tap to convert');

  // The gray unfolds above the strip, and the strip is pushed down by exactly
  // the gray — so the buttons end up on the line they had before any of this.
  const parts = await page.evaluate(() => {
    const strip = document.querySelector('#edit-toolbar')!.getBoundingClientRect();
    const grayBox = document.querySelector('#edit-toolbar [data-math-warning]')!.getBoundingClientRect();
    const row = document.querySelector('.edit-toolbar-row')!.getBoundingClientRect();
    const pill = document.querySelector('.edit-toolbar-list-container')!.getBoundingClientRect();
    // Where the buttons sit when nothing is wrong: the visible viewport less
    // the toolbar strip, plus the 44px row itself (layoutToolbar).
    const visible = window.visualViewport!.offsetTop + window.visualViewport!.height;
    return {
      gray: grayBox.height, rowBottom: row.bottom, stripBottom: strip.bottom, resting: visible - 52 + 44,
      grayWidth: grayBox.width, pillWidth: pill.width, grayRight: grayBox.right, pillRight: pill.right,
    };
  });
  expect(parts.gray).toBeGreaterThan(0);
  // The gray belongs to the pill, not to the whole strip: it stops where the
  // pill stops and never runs under the round button beside it.
  expect(Math.abs(parts.grayWidth - parts.pillWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(parts.grayRight - parts.pillRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(parts.stripBottom - parts.rowBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(parts.rowBottom - parts.resting)).toBeLessThanOrEqual(1);
});

test('a warning the reader cannot scroll past is a warning they read', async ({ page }) => {
  await boot(page, 'a \\(x\\)\n\n'.repeat(120));
  await page.locator('.cm-content').click();
  await page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller') as HTMLElement;
    scroller.scrollTop = 600;
    scroller.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('body')).toHaveClass(/is-hidden-nav/);
  await expect(page.locator('#navbar .pill-gray')).toBeVisible();
});
