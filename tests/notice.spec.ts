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

test('a notice on the note is a rectangle from the centre of each circle', async ({ page }) => {
  await notice(page);
  const gap = await page.evaluate(() => {
    const files = document.querySelector('#files')!.getBoundingClientRect();
    const preview = document.querySelector('#preview-toggle')!.getBoundingClientRect();
    const banner = document.querySelector('.notice')!.getBoundingClientRect();
    const style = getComputedStyle(document.querySelector('.notice')!);
    const atFiles = document.elementFromPoint(files.left + files.width / 2, files.top + files.height / 2);
    return {
      left: banner.left - (files.left + files.width / 2),
      right: (preview.left + preview.width / 2) - banner.right,
      height: banner.height,
      radius: style.borderRadius,
      align: style.textAlign,
      wrap: style.whiteSpace,
      hit: atFiles && (atFiles.id === 'files' || atFiles.closest('#files') !== null),
    };
  });
  expect(Math.abs(gap.left), JSON.stringify(gap)).toBeLessThan(3);
  expect(Math.abs(gap.right), JSON.stringify(gap)).toBeLessThan(3);
  expect(Math.abs(gap.height - 44), JSON.stringify(gap)).toBeLessThan(2);
  expect(gap.radius === '0px' || gap.radius === '0', JSON.stringify(gap)).toBe(true);
  expect(gap.align, JSON.stringify(gap)).toBe('center');
  expect(gap.wrap, JSON.stringify(gap)).toBe('nowrap');
  expect(gap.hit, JSON.stringify(gap)).toBe(true);
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
  expect(Math.abs(after.notice - (after.files + 22)), JSON.stringify({ before, after })).toBeLessThan(4);
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
