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
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').nth(14).click();
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
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').nth(2).click();
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
  await expect(picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day.is-selected')).toHaveText('14');
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
  await expect(picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').first()).toHaveText(/[۰-۹]/);
  // The code is calendar-free: the same moment either way.
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').last().click();
  await picker.locator('[data-stamp-insert]').click();
  const code = /<t:(\d{1,15})>/.exec(await noteText(page));
  expect(code).toBeTruthy();
  expect(Number(code![1])).toBeGreaterThan(1_600_000_000);
});

test('Now re-seeds the sheet with the current moment', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').first().click(); // somewhere else
  await picker.locator('[data-stamp-now]').click();
  await expect(picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day.is-selected')).toHaveText(String(new Date().getDate()));
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
  // Right = next month: its 1st, inserted. The glide is native; the settle
  // re-renders, so wait for the title to move before touching the grid.
  const home = await picker.locator('.timestamp-picker-month').textContent();
  await picker.locator('[data-stamp-step="1"]').click();
  await expect(picker.locator('.timestamp-picker-month')).not.toHaveText(home!);
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').first().click();
  await picker.locator('[data-stamp-insert]').click();
  const nextCode = /<t:(\d{1,15})>/.exec(await noteText(page))!;
  const next = new Date(Number(nextCode[1]) * 1000);
  const now = new Date();
  expect(next.getDate()).toBe(1);
  expect(next.getMonth()).toBe((now.getMonth() + 1) % 12);
  // Left = the month before: its 1st.
  await openPicker(page);
  const away = await sheet(page).locator('.timestamp-picker-month').textContent();
  await sheet(page).locator('[data-stamp-step="-1"]').click();
  await expect(sheet(page).locator('.timestamp-picker-month')).not.toHaveText(away!);
  await sheet(page).locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').first().click();
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
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').first().click();
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
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').first().click();
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

// ---- Gestures: the calendar is a native snap scroller ----

const viewport = (page: Page) => page.locator('.timestamp-picker-viewport');

test('the calendar is a native snap scroller, current month centred', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  await expect(viewport(page)).toHaveCSS('scroll-snap-type', /x mandatory/);
  expect(await viewport(page).evaluate((el) => el.querySelectorAll('.timestamp-picker-page').length)).toBe(3);
  // The centre page sits exactly one page in.
  const [left, width] = await viewport(page).evaluate((el) => [el.scrollLeft, el.clientWidth]);
  expect(Math.abs(left - width)).toBeLessThanOrEqual(2);
});

test('a fling that settles on a neighbour page turns the month', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const home = await picker.locator('.timestamp-picker-month').textContent();
  // The gesture itself is the browser's; the sheet only hears the settle.
  // A fling to the previous page: scrollLeft 0, then the snap-change fires.
  await viewport(page).evaluate((el) => {
    el.scrollLeft = 0;
    el.dispatchEvent(new Event('scrollsnapchange'));
  });
  expect(await picker.locator('.timestamp-picker-month').textContent()).not.toBe(home);
  // Re-centred at once: the swap was invisible.
  const [left, width] = await viewport(page).evaluate((el) => [el.scrollLeft, el.clientWidth]);
  expect(Math.abs(left - width)).toBeLessThanOrEqual(2);
  // The visible grid IS the month before: its first day, inserted, is the 1st.
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').first().click();
  await picker.locator('[data-stamp-insert]').click();
  const previous = new Date(Number(/<t:(\d{1,15})>/.exec(await noteText(page))![1]) * 1000);
  const now = new Date();
  expect(previous.getDate()).toBe(1);
  expect(previous.getMonth()).toBe((now.getMonth() + 11) % 12);
});

test('a scroll that settles where it started keeps the month', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const home = await picker.locator('.timestamp-picker-month').textContent();
  await viewport(page).evaluate((el) => {
    el.scrollLeft = el.clientWidth + 40; // a nudge off the centre page
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(220); // past the settle debounce
  await viewport(page).evaluate((el) => {
    el.scrollLeft = el.clientWidth; // back home (the snap's own decision)
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(220);
  expect(await picker.locator('.timestamp-picker-month').textContent()).toBe(home);
});

// ---- A chip tapped in the editor edits its own code ----

test('tapping a chip in the editor opens the sheet and rewrites that very code', async ({ page }) => {
  const older = 1700000000;
  const note = `First <t:${older}> second <t:${older}> third.\n`;
  await boot(page, {}, note);
  // The second of two identical codes: the tap must hit it, not count them.
  const chips = page.locator('#app .cm-content .cm-lp-timestamp');
  await expect(chips).toHaveCount(2);
  await chips.nth(1).click();
  const picker = sheet(page);
  await expect(picker).toBeVisible();
  await expect(picker.locator('.timestamp-picker-month')).toContainText(/2023/); // seeded with the code's own moment
  await picker.locator('[data-stamp-jump]').click(); // jump somewhere unmistakable
  await picker.locator('[data-stamp-jump-month]').fill('3');
  await picker.locator('[data-stamp-jump-year]').fill('2031');
  await picker.locator('[data-stamp-jump-year]').press('Enter');
  await expect(picker.locator('.timestamp-picker-month')).toContainText('2031');
  // A day click sets the moment; the jump only turned the pages to it.
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').nth(14).click();
  await picker.locator('[data-stamp-insert]').click();
  const text = await noteText(page);
  expect(text).toContain(`First <t:${older}>`);
  expect(text).not.toContain(`second <t:${older}>`);
  // And it is 15 March 2031, not a neighbouring month (the jump goes the whole way).
  const rewritten = new Date(Number(/second <t:(\d{1,15})>/.exec(text)![1]) * 1000);
  expect(rewritten.getUTCFullYear()).toBe(2031);
  expect(rewritten.getUTCMonth()).toBe(2);
  expect(rewritten.getUTCDate()).toBe(15);
});

test('the tap leaves the caret alone: the codes stay chips, and undo takes the rewrite back', async ({ page }) => {
  const older = 1700000000;
  const note = `First <t:${older}> second <t:${older}>.\n`;
  await boot(page, {}, note);
  const chips = page.locator('#app .cm-content .cm-lp-timestamp');
  await expect(chips).toHaveCount(2);
  await chips.nth(1).click();
  const picker = sheet(page);
  await picker.locator('[data-stamp-jump]').click();
  await picker.locator('[data-stamp-jump-month]').fill('7');
  await picker.locator('[data-stamp-jump-year]').fill('2029');
  await picker.locator('[data-stamp-jump-year]').press('Enter');
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').nth(9).click();
  await picker.locator('[data-stamp-insert]').click();
  expect(await noteText(page)).not.toBe(note);
  // The mousedown never reached the editor: nothing revealed the raw code.
  await expect(chips).toHaveCount(2);
  await page.locator('#app .cm-content').press('Control+z');
  expect(await noteText(page)).toBe(note);
});

// ---- The chain: Enter decides, two digits advance by themselves ----

test('Enter walks month to year and applies; arrows stay the caret\u2019s', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  await picker.locator('[data-stamp-jump]').click();
  const month = picker.locator('[data-stamp-jump-month]');
  const year = picker.locator('[data-stamp-jump-year]');
  await expect(month).toBeFocused();
  await month.press('ArrowRight'); // the caret\u2019s, inside the field
  await expect(month).toBeFocused();
  await month.fill('1');
  await month.press('Enter'); // month\u2019s advance: to the year
  await expect(year).toBeFocused();
  await year.fill('2030');
  await year.press('Enter'); // year\u2019s advance: the jump applies, the keyboard lands on the title
  await expect(picker.locator('.timestamp-picker-month')).toContainText('2030');
  await expect(year).toHaveCount(0);
  const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.stampJump !== undefined);
  expect(focused).toBe(true);
});

test('two digits advance by themselves: month, hour, and done on the minute', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  // The jump box: 2 digits in the month hop to the year; 4 in the year stay.
  await picker.locator('[data-stamp-jump]').click();
  const month = picker.locator('[data-stamp-jump-month]');
  const year = picker.locator('[data-stamp-jump-year]');
  await expect(month).toBeFocused();
  await month.type('1');
  await expect(year).not.toBeFocused(); // "1" may still become "12"
  await month.type('2'); // "12": the month is full — the year is next
  await expect(year).toBeFocused();
  await year.type('203'); // four digits is a year, not a trigger: no advance
  await expect(year).toBeFocused();
  await year.type('0'); // 2030, still no advance: Enter applies
  await year.press('Enter');
  await expect(picker.locator('[data-stamp-jump-year]')).toHaveCount(0);
  // The post-apply guard shields the time row for a beat; let it rest.
  await page.waitForTimeout(350);
  // The time row: 2 digits in the hour hop to the minute, 2 in the minute close.
  const hour = picker.locator('[data-stamp-hour]');
  const minute = picker.locator('[data-stamp-minute]');
  await hour.click();
  await hour.type('9');
  await expect(minute).not.toBeFocused();
  await hour.type('5'); // 95 is impossible — but the field is full; the chain moves
  await expect(minute).toBeFocused();
  await minute.type('3');
  await expect(minute).toBeFocused();
  await minute.type('0'); // 30: done — the keyboard lands on the title
  const onTitle = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.stampJump !== undefined);
  expect(onTitle).toBe(true);
});

test('a keyboard that advances with no key event is met by the focus guard', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  // Some keyboards "Next" straight into the next input, silently. The year
  // is the dangerous hop: the next input is the hour row. The guard bounces
  // the focus to the title — and the jump still applies.
  await picker.locator('[data-stamp-jump]').click();
  await picker.locator('[data-stamp-jump-month]').fill('1');
  await picker.locator('[data-stamp-jump-year]').fill('2030');
  await page.evaluate(() => {
    const year = document.querySelector<HTMLElement>('[data-stamp-jump-year]')!;
    year.blur(); // the focusout applies the jump…
    const hour = document.querySelector<HTMLElement>('[data-stamp-hour]')!;
    hour.focus(); // …and the delinquent Next lands here
  });
  const onTitle = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.stampJump !== undefined);
  expect(onTitle).toBe(true);
  await expect(picker.locator('.timestamp-picker-month')).toContainText('2030');
  await expect(picker.locator('[data-stamp-jump-year]')).toHaveCount(0);
});

test('junk keys meet digits-only fields; typing replaces the pre-filled value', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const hour = picker.locator('[data-stamp-hour]');
  await hour.click(); // takes the field whole: the current time is selected
  await hour.pressSequentially('2a5'); // "a" meets the digits-only field and dies
  await expect(hour).toHaveValue('25');
  await expect(picker.locator('[data-stamp-minute]')).toBeFocused(); // full: the chain moves
});
