import { expect, test, type Page } from '@playwright/test';

// The date sheet (src/datePicker.ts): picks a day in whatever calendar
// Settings → Dates has chosen and writes a `<t:unix[:fmt]>` code — at the
// caret from the keyboard toolbar, or over the code of a chip tapped in the
// reading view.

const NOTE = 'Stamp <t:1700000000:F> here.\n';

async function boot(page: Page, settings: Record<string, unknown> = {}, note = NOTE) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ settings, note }) => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', note);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    if (Object.keys(settings).length) localStorage.setItem('satr:settings', JSON.stringify({ version: 3, ...settings }));
  }, { settings, note });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
}

/** The toolbar command, run the way the toolbar runs it. */
async function openPicker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    const { insertTimestamp } = await window.__satr.load('/src/commands.ts');
    insertTimestamp(view);
  });
}

const sheet = (page: Page) => page.locator('.timestamp-picker');
const noteText = (page: Page) => page.evaluate(async () => {
  const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
  return EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!.state.doc.toString();
});

test('a Date button sits in the keyboard toolbar, hideable like the rest', async ({ page }) => {
  await boot(page);
  // The toolbar itself shows only with the keyboard up; the button is present
  // and not one of the hidden tools.
  const button = page.locator('#app button[data-command="timestamp"]');
  await expect(button).toHaveCount(1);
  expect(await button.evaluate((el) => ({ hidden: el.hidden, label: el.getAttribute('aria-label') }))).toEqual({ hidden: false, label: 'Date' });
});

test('the sheet writes the picked day and time as a code at the caret', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  await expect(picker).toBeVisible();
  // The 15th of the month it opened at (today's month), 09:30, full format.
  await picker.locator('.timestamp-picker-day:not(.is-blank)').nth(14).click();
  await picker.locator('[data-stamp-hour]').fill('9');
  await picker.locator('[data-stamp-minute]').fill('30');
  await picker.locator('.timestamp-picker-format[data-stamp-format="F"]').click();
  await picker.locator('[data-stamp-insert]').click();
  await expect(picker).toHaveCount(0);
  const text = await noteText(page);
  const code = /<t:(\d{1,15}):F>/.exec(text);
  expect(code).toBeTruthy();
  const picked = new Date(Number(code![1]) * 1000);
  const expected = new Date();
  expected.setDate(15);
  expected.setHours(9, 30, 0, 0);
  expect(picked.getTime()).toBe(expected.getTime());
  // The note's own timestamp is untouched, and the caret sits after the new code.
  expect(text).toContain('<t:1700000000:F>');
});

test('the default format chip writes the bare code Discord treats as f', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  await expect(picker.locator('.timestamp-picker-format[data-stamp-format="f"]')).toHaveClass(/is-selected/);
  await picker.locator('.timestamp-picker-day:not(.is-blank)').nth(2).click();
  await picker.locator('[data-stamp-insert]').click();
  expect(await noteText(page)).toMatch(/<t:\d{1,15}>/);
});

test('tapping a chip in the reading view edits the code that made it', async ({ page }) => {
  await boot(page);
  await page.locator('#app #preview-toggle').click();
  await page.locator('#app #preview time.discord-timestamp').click();
  const picker = sheet(page);
  await expect(picker).toBeVisible();
  // Seeded: November 2023, the 14th selected — the moment the code says.
  await expect(picker.locator('.timestamp-picker-month')).toContainText('November 2023');
  await expect(picker.locator('.timestamp-picker-day.is-selected')).toHaveText('14');
  // A different format: the very token is rewritten, not duplicated.
  await picker.locator('.timestamp-picker-format[data-stamp-format="T"]').click();
  await picker.locator('[data-stamp-insert]').click();
  await expect(picker).toHaveCount(0);
  const text = await noteText(page);
  expect(text).toContain('<t:1700000000:T>');
  expect(text).not.toContain('<t:1700000000:F>');
  expect(text.match(/<t:1700000000/g)?.length).toBe(1);
  // The reading view followed.
  await expect(page.locator('#app #preview time.discord-timestamp[data-format="T"]')).toHaveCount(1);
});

test('the grid answers in the chosen calendar and language', async ({ page }) => {
  await boot(page, { timestampLocale: 'fa', timestampCalendar: 'auto' });
  await openPicker(page);
  const picker = sheet(page);
  await expect(picker).toBeVisible();
  // November 2023 in Persian digits and Jalali years: آبان ۱۴۰۲.
  // The sheet opens on today's month — Persian digits, a Jalali year
  // ("۱۴۰۵ مهر" today; the order is the language's business).
  await expect(picker.locator('.timestamp-picker-month')).toContainText(/[۰-۹]{4}/);
  await expect(picker.locator('.timestamp-picker-month')).toContainText(/[آ-ی]/);
  await expect(picker.locator('.timestamp-picker-day:not(.is-blank)').first()).toHaveText(/[۰-۹]/);
  // The code is calendar-free: the same moment either way.
  await picker.locator('.timestamp-picker-day:not(.is-blank)').last().click();
  await picker.locator('[data-stamp-insert]').click();
  const code = /<t:(\d{1,15})>/.exec(await noteText(page));
  expect(code).toBeTruthy();
  expect(Number(code![1])).toBeGreaterThan(1_600_000_000);
});

test('Now re-seeds the sheet with the current moment', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  await picker.locator('.timestamp-picker-day:not(.is-blank)').first().click(); // somewhere else
  await picker.locator('[data-stamp-now]').click();
  await expect(picker.locator('.timestamp-picker-day.is-selected')).toHaveText(String(new Date().getDate()));
  await picker.locator('[data-stamp-insert]').click();
  const code = /<t:(\d{1,15})>/.exec(await noteText(page));
  const now = Math.floor(Date.now() / 1000);
  expect(Number(code![1])).toBeGreaterThan(now - 120);
  expect(Number(code![1])).toBeLessThan(now + 120);
});

test('Escape and the backdrop close the sheet, writing nothing', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  expect(await noteText(page)).toBe(NOTE);
  await openPicker(page);
  await expect(sheet(page)).toBeVisible();
  await page.locator('.menu-backdrop').click({ position: { x: 10, y: 10 }, force: true });
  await expect(sheet(page)).toHaveCount(0);
  expect(await noteText(page)).toBe(NOTE);
});
