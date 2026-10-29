// Ticking a task while the note is being read.
//
// Reported: "a thing for checklists where I can mark in preview mode too --
// check if it already exists and if it doesn't, add it". It did not: the
// parser hands the reading view a box with `disabled` on it, so a tap did
// nothing at all. The box is live there now and the tick is written into the
// line that made it -- the note is the only place a task's state lives.
import { expect, test, type Page } from '@playwright/test';

const NOTE = [
  '# Jobs',
  '',
  '- [ ] water the plants',
  '- [x] buy milk',
  '  - [ ] the blue one',
  '',
  '> - [ ] quoted task',
  '',
  '1. [ ] numbered task',
  '',
  '- a plain bullet',
].join('\n');

async function boot(page: Page, note: string = NOTE): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/jobs.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/jobs.md', text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/jobs.md' }], active: 0 }));
  }, note);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('jobs');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane .task-list-item, #preview-pane li:has(input[type="checkbox"])').first()).toBeVisible();
  await page.waitForTimeout(400);
}

test('a box ticked while reading is written into the note', async ({ page }) => {
  await boot(page);
  const boxes = page.locator('#preview-pane input[type="checkbox"]');
  await expect(boxes).toHaveCount(5);
  // the parser's box cannot be touched; the reading view's can
  expect(await boxes.first().isDisabled(), 'a box in the reading view is live').toBe(false);

  await boxes.nth(0).click();
  await page.waitForTimeout(300);
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#app .cm-content')).toBeVisible();
  let text = await page.evaluate(() => (document.querySelector('#app .cm-content') as HTMLElement).innerText);
  expect(text, 'the first task is done now').toContain('- [x] water the plants');
  expect(text, 'the one that was done is untouched').toContain('- [x] buy milk');

  // and back: unticking writes the empty box back
  await page.locator('#preview-toggle').click();
  await page.waitForTimeout(300);
  await page.locator('#preview-pane input[type="checkbox"]').nth(1).click();
  await page.waitForTimeout(300);
  await page.locator('#preview-toggle').click();
  text = await page.evaluate(() => (document.querySelector('#app .cm-content') as HTMLElement).innerText);
  expect(text, 'the finished one is open again').toContain('- [ ] buy milk');
});

test('the tick lands on the task that was tapped, wherever it sits', async ({ page }) => {
  await boot(page);
  const boxes = page.locator('#preview-pane input[type="checkbox"]');
  // a sub-task, a task inside a quote and a numbered task
  for (const index of [2, 3, 4]) {
    await boxes.nth(index).click();
    await page.waitForTimeout(250);
  }
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#app .cm-content')).toBeVisible();
  const text = await page.evaluate(() => (document.querySelector('#app .cm-content') as HTMLElement).innerText);
  expect(text).toContain('[x] the blue one');
  expect(text).toContain('[x] quoted task');
  expect(text).toContain('[x] numbered task');
  expect(text, 'nothing else was ticked').toContain('[ ] water the plants');
});

test('a tick does not move the note under the reader', async ({ page }) => {
  // A note long enough to read down into: the tick is tapped with the list
  // part-way up the pane, where losing the place would be felt.
  await boot(page, `${NOTE}\n\n${'A line of prose to read past.\n\n'.repeat(40)}`);
  const pane = page.locator('#preview-pane');
  await pane.evaluate((el) => { el.scrollTop = 120; });
  await page.waitForTimeout(200);
  const before = await pane.evaluate((el) => el.scrollTop);
  await page.locator('#preview-pane input[type="checkbox"]').nth(1).click();
  await page.waitForTimeout(500);
  const after = await pane.evaluate((el) => el.scrollTop);
  expect(Math.abs(after - before), `the reader stayed at ${before}, now ${after}`).toBeLessThanOrEqual(2);
  // the box the reader tapped shows the tick the note now holds
  expect(await page.locator('#preview-pane input[type="checkbox"]').nth(1).isChecked()).toBe(false);
});
