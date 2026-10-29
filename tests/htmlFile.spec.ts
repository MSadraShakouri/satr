import { test, expect, type Page } from '@playwright/test';

// An .html file in the vault is a page, not a note. Satr opens it as text and
// shows it in the reading view as the page it is: the file's own styling, full
// bleed, with nothing of Satr's over the top — and a font and a size only
// where the file asked for none.

const STYLED = `<!doctype html>
<html><head><meta charset="utf-8"><title>Brochure</title>
<style>
  body { margin: 0; font-family: Georgia, serif; background: rgb(16, 32, 58); color: rgb(255, 216, 168); }
  h1 { font-size: 44px; margin: 0; }
</style></head>
<body><h1>A page of its own</h1>
<p id="counted">counting…</p>
<script>document.getElementById('counted').textContent = 'ran: ' + (6 * 7);</script>
</body></html>`;

const BARE = '<h1>بدون استایل</h1>\n<p>این صفحه هیچ قلمی نخواسته است.</p>\n';

async function open(page: Page, files: Record<string, string>, active = 0): Promise<void> {
  await page.addInitScript((seed: Record<string, string>) => {
    const paths = Object.keys(seed);
    localStorage.setItem('satr:fs:index', JSON.stringify({
      files: Object.fromEntries(paths.map((p) => [p, 1])),
      folders: ['Notes'],
    }));
    for (const p of paths) localStorage.setItem(`satr:fs:file:${p}`, seed[p]);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: paths.map((path) => ({ path })), active: 0 }));
  }, files);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  if (active) await page.locator('.tab-card').nth(active).click();
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
}

test('the reading view shows a page in a frame of its own, with scripts the only thing allowed', async ({ page }) => {
  await open(page, { 'Notes/brochure.html': STYLED });
  const frame = page.locator('iframe.html-file');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  // Nothing of Satr's note furniture: no title of ours, no sections.
  expect(await page.locator('#preview .inline-title').count()).toBe(0);
  expect(await page.locator('#preview .md-section').count()).toBe(0);
  // The frame fills the reading pane.
  const pane = (await page.locator('#preview-pane').boundingBox())!;
  const box = (await frame.boundingBox())!;
  expect(Math.round(box.width)).toBe(Math.round(pane.width));
  expect(Math.round(box.height)).toBe(Math.round(pane.height));
});

test("the file's own styling is what shows, and its script runs", async ({ page }) => {
  await open(page, { 'Notes/brochure.html': STYLED });
  const inside = page.frameLocator('iframe.html-file');
  await expect(inside.locator('h1')).toHaveText('A page of its own');
  const look = await inside.locator('body').evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    font: getComputedStyle(el).fontFamily,
    heading: getComputedStyle(el.querySelector('h1')!).fontSize,
  }));
  expect(look).toEqual({ background: 'rgb(16, 32, 58)', font: 'Georgia, serif', heading: '44px' });
  await expect(inside.locator('#counted')).toHaveText('ran: 42');
});

test('a page that asks for nothing gets Vazirmatn at the app size', async ({ page }) => {
  await open(page, { 'Notes/plain.html': BARE });
  const inside = page.frameLocator('iframe.html-file');
  const look = await inside.locator('body').evaluate((el) => ({
    font: getComputedStyle(el).fontFamily,
    size: getComputedStyle(document.documentElement).fontSize,
    // the face travels with the page: an opaque origin can fetch nothing
    faces: [...document.styleSheets].reduce((n, sheet) => {
      try { return n + [...sheet.cssRules].filter((r) => r instanceof CSSFontFaceRule).length; } catch { return n; }
    }, 0),
  }));
  expect(look.font).toBe('Vazirmatn, system-ui, sans-serif');
  expect(look.size).toBe('16px');
  expect(look.faces).toBeGreaterThan(0);
});

test('a page is editable text, and the reading view follows the edit', async ({ page }) => {
  await open(page, { 'Notes/plain.html': BARE });
  await expect(page.locator('iframe.html-file')).toBeVisible();
  await page.locator('#preview-toggle').click();
  const source = await page.locator('.cm-content').innerText();
  expect(source).toContain('<h1>بدون استایل</h1>');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('<p id="added">تازه</p>');
  await page.locator('#preview-toggle').click();
  await expect(page.frameLocator('iframe.html-file').locator('#added')).toHaveText('تازه');
});

test('a markdown note is untouched by any of it', async ({ page }) => {
  await open(page, { 'Notes/note.md': '# سلام\n\nمتن.\n' });
  await expect(page.locator('#preview .inline-title')).toBeVisible();
  expect(await page.locator('iframe.html-file').count()).toBe(0);
  expect(await page.locator('#preview.is-page').count()).toBe(0);
});

test('a page being read says its name in the header, since the page itself will not', async ({ page }) => {
  // The pane is handed to the page whole — its own stylesheet, no title of
  // ours inside it — so the only place left to say which file this is, is
  // the chrome. Obsidian's view header does exactly this for every view
  // that is not a markdown note.
  await open(page, { 'Notes/page.html': '<h1>a page</h1>' });
  await expect(page.locator('iframe.html-file')).toBeVisible();
  await expect(page.locator('#topbar-title')).toBeVisible();
  await expect(page.locator('#topbar-title')).toHaveText('page.html');
  // and back in the editor the file's own inline title says it instead
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#topbar-title')).toBeHidden();
  await expect(page.locator('.cm-file-title')).toContainText('page.html');
});
