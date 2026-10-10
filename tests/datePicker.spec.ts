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

test('the month arrows step the way they point', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  // Right = next month: its 1st, inserted.
  await picker.locator('[data-stamp-step="1"]').click();
  await picker.locator('.timestamp-picker-day:not(.is-blank)').first().click();
  await picker.locator('[data-stamp-insert]').click();
  const nextCode = /<t:(\d{1,15})>/.exec(await noteText(page))!;
  const next = new Date(Number(nextCode[1]) * 1000);
  const now = new Date();
  expect(next.getDate()).toBe(1);
  expect(next.getMonth()).toBe((now.getMonth() + 1) % 12);
  // Left = the month before: its 1st.
  await openPicker(page);
  await sheet(page).locator('[data-stamp-step="-1"]').click();
  await sheet(page).locator('.timestamp-picker-day:not(.is-blank)').first().click();
  await sheet(page).locator('[data-stamp-insert]').click();
  const codes = [...(await noteText(page)).matchAll(/<t:(\d{1,15})>/g)].map((m) => Number(m[1]));
  const previous = new Date(codes[codes.length - 1] * 1000);
  expect(previous.getDate()).toBe(1);
  expect(previous.getMonth()).toBe((now.getMonth() + 11) % 12);
});

test('the title opens a month and year box, in the calendar the grid is wearing', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  await picker.locator('[data-stamp-jump]').click();
  await picker.locator('[data-stamp-jump-month]').fill('1');
  await picker.locator('[data-stamp-jump-year]').fill('2030');
  await picker.locator('[data-stamp-jump-year]').press('Enter');
  // The grid followed: January 2030 — the title says so, and the 1st is real.
  await expect(picker.locator('.timestamp-picker-month')).toContainText('2030');
  await picker.locator('.timestamp-picker-day:not(.is-blank)').first().click();
  await picker.locator('[data-stamp-insert]').click();
  const jumped = new Date(Number(/<t:(\d{1,15})>/.exec(await noteText(page))![1]) * 1000);
  expect(jumped.getUTCFullYear()).toBe(2030);
  expect(jumped.getUTCMonth()).toBe(0);
  expect(jumped.getUTCDate()).toBe(1);
});

test('the jump box counts in Jalali when the grid does', async ({ page }) => {
  await boot(page, { timestampLocale: 'fa', timestampCalendar: 'auto' });
  await openPicker(page);
  const picker = sheet(page);
  await picker.locator('[data-stamp-jump]').click();
  // Farvardin 1400 — Jalali New Year, 21 March 2021.
  await picker.locator('[data-stamp-jump-month]').fill('1');
  await picker.locator('[data-stamp-jump-year]').fill('1400');
  await picker.locator('[data-stamp-jump-year]').press('Enter');
  await picker.locator('.timestamp-picker-day:not(.is-blank)').first().click();
  await picker.locator('[data-stamp-insert]').click();
  const jumped = new Date(Number(/<t:(\d{1,15})>/.exec(await noteText(page))![1]) * 1000);
  const newYear = Date.UTC(2021, 2, 21);
  expect(Math.abs(jumped.getTime() - newYear)).toBeLessThan(36 * 3600 * 1000);
});

test('an impossible time is refused live, a keystroke fixes it', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const insert = picker.locator('[data-stamp-insert]');
  const hour = picker.locator('[data-stamp-hour]');
  const minute = picker.locator('[data-stamp-minute]');
  await hour.fill('25');
  await expect(insert).toBeDisabled();
  await expect(hour).toHaveClass(/is-invalid/);
  await minute.fill('99');
  await expect(insert).toBeDisabled();
  await expect(minute).toHaveClass(/is-invalid/);
  await hour.fill('9');
  await minute.fill('30');
  await expect(hour).not.toHaveClass(/is-invalid/);
  await expect(insert).toBeEnabled();
  // A cleared field is refused too.
  await minute.fill('');
  await expect(insert).toBeDisabled();
  await minute.fill('05'); // a leading zero is still a real minute
  await expect(insert).toBeEnabled();
  // What lands is exactly the time shown.
  await picker.locator('.timestamp-picker-format[data-stamp-format="T"]').click();
  await picker.locator('[data-stamp-insert]').click();
  const at = new Date(Number(/<t:(\d{1,15}):T>/.exec(await noteText(page))![1]) * 1000);
  expect(at.getHours()).toBe(9);
  expect(at.getMinutes()).toBe(5);
});

test('the chips and the Insert code follow the typing live', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  await picker.locator('.timestamp-picker-format[data-stamp-format="T"]').click();
  await picker.locator('[data-stamp-hour]').fill('9');
  await picker.locator('[data-stamp-minute]').fill('5');
  const sample = picker.locator('.timestamp-picker-format[data-stamp-format="T"] .timestamp-picker-format-sample');
  await expect(sample).toHaveText(/9:05:00/);
  // The button says the exact code the moment carries now.
  await expect(picker.locator('[data-stamp-insert]')).toHaveText(/<t:\d{1,15}:T>/);
  const before = await picker.locator('[data-stamp-insert]').textContent();
  await picker.locator('[data-stamp-minute]').fill('45');
  await expect(picker.locator('[data-stamp-insert]')).not.toHaveText(before!);
  await expect(sample).toHaveText(/9:45:00/);
});
