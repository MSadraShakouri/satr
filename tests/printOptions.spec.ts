import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, notePath?: string) {
  await page.evaluate(async (notePath) => {
    const path = '/src/settings.ts';
    const { openSettings } = await import(path);
    openSettings({ notePath, apply: () => {}, tools: () => [] });
  }, notePath);
  await expect(page.locator('.settings-screen')).toBeVisible();
}
async function close(page: Page) {
  await page.locator('.settings-back').click();
  await expect(page.locator('.settings-screen')).toHaveCount(0);
}

test('PDF controls sit with the other PDF settings and preserve per-file choices', async ({ page }) => {
  await page.goto('/');
  // Preferences saved by the old popup must remain available after the move.
  await page.evaluate(() => localStorage.setItem('satr:pdf:first.md', JSON.stringify({ columns: 2, direction: 'rtl', mathAlign: 'start' })));
  await open(page, 'first.md');
  const group = page.locator('.setting-group').filter({ has: page.getByLabel('Layout', { exact: true }) });
  await expect(group.getByRole('radiogroup', { name: 'Page numbers' })).toBeVisible();
  await expect(group.locator('[data-text="pdfCss"]')).toHaveCount(1);
  await expect(page.getByLabel('Layout', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Reading order')).toHaveValue('rtl');
  await expect(page.getByLabel('Display equations')).toHaveValue('start');
  await page.getByLabel('Layout', { exact: true }).selectOption('1');
  await page.getByLabel('Reading order').selectOption('ltr');
  await page.getByLabel('Display equations').selectOption('center');
  await close(page);
  await open(page, 'second.md');
  await expect(page.getByLabel('Layout', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Reading order')).toHaveValue('auto');
  await close(page);
  await open(page, 'first.md');
  await expect(page.getByLabel('Layout', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Reading order')).toHaveValue('ltr');
  await expect(page.getByLabel('Display equations')).toHaveValue('center');
  await expect(page.locator('dialog')).toHaveCount(0);
});

test('without an open file only file-specific PDF controls are disabled', async ({ page }) => {
  await page.goto('/');
  await open(page);
  for (const name of ['Layout', 'Reading order', 'Display equations']) await expect(page.getByLabel(name, { exact: true })).toBeDisabled();
  await expect(page.getByText('Open a file to change its PDF layout.', { exact: false })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'None', exact: true })).toBeEnabled();
  await expect(page.locator('[data-text="pdfCss"]')).toBeEditable();
});

for (const quickAction of ['', 'pdf']) {
  test(`export starts without a popup via ${quickAction ? 'quick action' : 'menu'}`, async ({ page }) => {
    await page.addInitScript((quickAction) => {
      window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; };
      if (window !== window.top) return;
      localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/Layout.md': 1 }, folders: ['Notes'] }));
      localStorage.setItem('satr:fs:file:Notes/Layout.md', '# Layout test\n\n$$x+y$$');
      localStorage.setItem('satr:current', 'Notes/Layout.md');
      localStorage.setItem('satr:settings', JSON.stringify({ version: 3, quickAction }));
      localStorage.setItem('satr:pdf:Notes/Layout.md', JSON.stringify({ columns: 2, direction: 'rtl', mathAlign: 'start' }));
    }, quickAction);
    await page.goto('/');
    await expect(page.locator('.cm-file-name')).toHaveText('Layout');
    await page.locator('#nav-menu').click();
    if (!quickAction) await page.getByRole('menuitem', { name: 'Export to PDF', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__printedHtml)), { timeout: 15_000 }).toBe(true);
    await expect(page.locator('dialog')).toHaveCount(0);
    const result = await page.evaluate(() => {
      const doc = new DOMParser().parseFromString(window.__printedHtml!, 'text/html');
      return {
        columns: Boolean(doc.querySelector('.satr-print-sheet')),
        direction: doc.querySelector('.satr-print-sheet')?.getAttribute('data-direction'),
        source: localStorage.getItem('satr:fs:file:Notes/Layout.md'),
      };
    });
    expect(result).toEqual({ columns: true, direction: 'rtl', source: '# Layout test\n\n$$x+y$$' });
  });
}

test('auto direction counts prose, ignoring math, code and an English title', async ({ page }) => {
  await page.goto('/');
  const directions = await page.evaluate(async () => {
    const optionsPath = '/src/printOptions.ts';
    const rendererPath = '/src/markdown.ts';
    const { printDirection } = await import(optionsPath);
    const { renderMarkdown } = await import(rendererPath);
    const body = document.createElement('div');
    body.innerHTML = renderMarkdown('# Homework\n\nاین یک متن فارسی برای آزمایش ترتیب ستون‌ها است.\n\n$$' + 'x+y+'.repeat(100) + 'z$$\n\n```\n' + 'English code '.repeat(100) + '\n```');
    const auto = printDirection(body, 'auto');
    const override = printDirection(body, 'ltr');
    body.innerHTML = renderMarkdown('An English note.\n\n$$\\text{متن فارسی}$$');
    const english = printDirection(body, 'auto');
    body.innerHTML = renderMarkdown('$$x+y$$');
    const mathOnly = printDirection(body, 'auto');
    return { auto, override, english, mathOnly };
  });
  expect(directions).toEqual({ auto: 'rtl', override: 'ltr', english: 'ltr', mathOnly: 'ltr' });
});

test('corrupt or obsolete per-file settings fall back safely', async ({ page }) => {
  await page.goto('/');
  const options = await page.evaluate(async () => {
    const path = '/src/printOptions.ts';
    const { loadPrintOptions } = await import(path);
    localStorage.setItem('satr:pdf:bad.md', '{broken');
    localStorage.setItem('satr:pdf:old.md', JSON.stringify({ columns: 4, direction: 'bad', mathAlign: 'bad' }));
    return [loadPrintOptions('bad.md'), loadPrintOptions('old.md')];
  });
  expect(options).toEqual(Array(2).fill({ columns: 1, direction: 'auto', mathAlign: 'center' }));
});
