import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
});

async function notice(page: Page, text = 'Loaded from file') {
  await page.evaluate(async (text) => {
    const { showNotice } = await window.__satr.load('/src/notice.ts');
    showNotice(text, 60000);
  }, text);
  await expect(page.locator('.notice')).toHaveText(text);
}

test('a notice on the note sits between the files button and the preview button', async ({ page }) => {
  await notice(page);
  const gap = await page.evaluate(() => {
    const files = document.querySelector('#files')!.getBoundingClientRect();
    const preview = document.querySelector('#preview-toggle')!.getBoundingClientRect();
    const banner = document.querySelector('.notice')!.getBoundingClientRect();
    return {
      left: banner.left - files.right,
      right: preview.left - banner.right,
      coversFiles: banner.left < files.right && banner.right > files.left,
      coversPreview: banner.left < preview.right && banner.right > preview.left,
    };
  });
  expect(gap.coversFiles, JSON.stringify(gap)).toBe(false);
  expect(gap.coversPreview, JSON.stringify(gap)).toBe(false);
  expect(gap.left, JSON.stringify(gap)).toBeGreaterThanOrEqual(4);
  expect(gap.right, JSON.stringify(gap)).toBeGreaterThanOrEqual(4);
});

test('a notice slides with the files drawer, like the header buttons', async ({ page }) => {
  await notice(page);
  const before = await page.evaluate(() => document.querySelector('.notice')!.getBoundingClientRect().left);
  await page.evaluate(() => document.body.classList.add('files-open'));
  await expect.poll(async () => page.evaluate(() => document.querySelector('#files')!.getBoundingClientRect().left)).toBeGreaterThan(40);
  const after = await page.evaluate(() => {
    const notice = document.querySelector('.notice')!.getBoundingClientRect().left;
    const files = document.querySelector('#files')!.getBoundingClientRect().left;
    return { notice, files };
  });
  expect(after.notice, JSON.stringify({ before, after })).toBeGreaterThan(before + 40);
  expect(Math.abs(after.notice - (after.files + 44 + 8)), JSON.stringify({ before, after })).toBeLessThan(20);
});

test('a notice on Settings is the full-width banner', async ({ page }) => {
  await page.evaluate(async () => {
    const { openSettings } = await window.__satr.load('/src/settings.ts');
    openSettings({ apply: () => {}, tools: () => [] });
  });
  await expect(page.locator('.settings-screen')).toBeVisible();
  await notice(page, 'Preparing the PDF…');
  const box = await page.evaluate(() => {
    const banner = document.querySelector('.notice')!.getBoundingClientRect();
    return { left: banner.left, right: window.innerWidth - banner.right, width: banner.width };
  });
  expect(box.left, JSON.stringify(box)).toBeLessThan(20);
  expect(box.right, JSON.stringify(box)).toBeLessThan(20);
});
