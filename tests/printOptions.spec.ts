import { expect, test, type Page } from '@playwright/test';
import type { PrintOptions } from '../src/printOptions';

declare global { interface Window { chosenPrintOptions?: PrintOptions | null } }
async function open(page: Page, path: string) {
  await page.evaluate(async (path) => {
    window.chosenPrintOptions = undefined;
    const module = '/src/printOptions.ts';
    const { choosePrintOptions } = await import(module);
    void choosePrintOptions(path).then((options) => { window.chosenPrintOptions = options; });
  }, path);
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('PDF options are per file; cancel and Escape do not overwrite them', async ({ page }) => {
  await page.goto('/');
  await open(page, 'first.md');
  await page.getByLabel('Layout').selectOption('2');
  await page.getByLabel('Reading order').selectOption('rtl');
  await page.getByLabel('Display equations').selectOption('start');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.locator('dialog.pdf-options')).toHaveCount(0);
  expect(await page.evaluate(() => window.chosenPrintOptions)).toEqual({ columns: 2, direction: 'rtl', mathAlign: 'start' });
  await open(page, 'second.md');
  await expect(page.getByLabel('Layout')).toHaveValue('1');
  await expect(page.getByLabel('Reading order')).toHaveValue('auto');
  await expect(page.getByLabel('Display equations')).toHaveValue('center');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.pdf-options')).toHaveCount(0);
  expect(await page.evaluate(() => window.chosenPrintOptions)).toBeNull();
  await open(page, 'first.md');
  await expect(page.getByLabel('Layout')).toHaveValue('2');
  await page.getByLabel('Layout').selectOption('1');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('dialog.pdf-options')).toHaveCount(0);
  await open(page, 'first.md');
  await expect(page.getByLabel('Layout')).toHaveValue('2');
});

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
