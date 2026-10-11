import { expect, test, type Page } from '@playwright/test';

// The picker's gestures are tested through the REAL touch pipeline, so this
// suite runs with a touch screen — the device it targets has one.
test.use({ hasTouch: true });

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
/** The settle: the track adopted where the scroll rested and re-centred. */
const settled = (page: Page) => expect.poll(() => page.locator('.timestamp-picker-viewport').evaluate(
  (el) => Math.abs(el.scrollLeft - 2 * el.clientWidth),
), { timeout: 5000 }).toBeLessThanOrEqual(2);
/** A finger drag: touch down, relative deltas (each lands wherever the track
 *  really is now, compensations included), finger up. `toPages` is the target
 *  in page widths. */
const drag = async (page: Page, toPages: number): Promise<void> => {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.timestamp-picker-viewport')!
      .dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
  });
  await viewport(page).evaluate(async (el, to) => {
    const width = el.clientWidth;
    const total = width * to - el.scrollLeft;
    el.style.scrollSnapType = 'none'; // a real finger bypasses snap while dragging
    for (let step = 1; step <= 12; step += 1) {
      el.scrollLeft += total / 12;
      el.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }
  }, toPages);
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.timestamp-picker-viewport')!;
    el.style.scrollSnapType = '';
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
  });
};
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
  await picker.locator('[data-stamp-hour]').fill('09');
  await picker.locator('[data-stamp-minute]').fill('30');
  await picker.locator('[data-stamp-second]').fill('00');
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
  // The seconds ride in the open now: 1700000000 ends :20, the slot shows it.
  await expect(picker.locator('[data-stamp-second]')).toHaveValue('20');
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
  await picker.locator('[data-stamp-today]').click();
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
  await expect(picker.locator('.timestamp-picker-month')).not.toHaveText(home!); // the title turns mid-glide
  await settled(page); // the grid turns at rest
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
  await settled(page);
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

test('a slot is red only when provably impossible, and holds the advance', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const insert = picker.locator('[data-stamp-insert]');
  const hour = picker.locator('[data-stamp-hour]');
  const minute = picker.locator('[data-stamp-minute]');
  await hour.click();
  await hour.pressSequentially('2');
  await expect(hour).not.toHaveClass(/is-invalid/); // 2 may yet be 20\u201323: waiting is not wrong
  await expect(insert).toBeEnabled();
  await hour.pressSequentially('5'); // 25: proved impossible
  await expect(hour).toHaveClass(/is-invalid/);
  await expect(insert).toBeDisabled();
  await expect(minute).not.toBeFocused(); // the advance holds until it is fixed
  await hour.press('Backspace'); // back to 2, waiting again
  await expect(hour).not.toHaveClass(/is-invalid/);
  await expect(insert).toBeEnabled();
  await hour.pressSequentially('1'); // the register shifts: 21, legal \u2014 the chain moves
  await expect(minute).toBeFocused();
  await minute.pressSequentially('7'); // shown 07: a real minute, never red
  await expect(minute).not.toHaveClass(/is-invalid/);
  await minute.press('Backspace');
  await minute.pressSequentially('70'); // 70, complete and impossible: red
  await expect(minute).toHaveClass(/is-invalid/);
  await minute.press('Backspace');
  await minute.pressSequentially('30'); // 30: legal, on to the seconds
  await expect(picker.locator('[data-stamp-second]')).toBeFocused();
  await expect(insert).toBeEnabled();
  // What lands is exactly the padded time shown: 21:30.
  await picker.locator('.timestamp-picker-format[data-stamp-format="T"]').click();
  await picker.locator('[data-stamp-insert]').click();
  const at = new Date(Number(/<t:(\d{1,15}):T>/.exec(await noteText(page))![1]) * 1000);
  expect(at.getHours()).toBe(21);
  expect(at.getMinutes()).toBe(30);
});

test('the chips and the Insert code follow the typing live', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  await picker.locator('.timestamp-picker-format[data-stamp-format="T"]').click();
  const hour = picker.locator('[data-stamp-hour]');
  await hour.click();
  await hour.pressSequentially('09'); // shown padded as it lands
  await expect(hour).toHaveValue('09');
  await picker.locator('[data-stamp-minute]').pressSequentially('05'); // on to the seconds
  await picker.locator('[data-stamp-second]').pressSequentially('00'); // done
  const sample = picker.locator('.timestamp-picker-format[data-stamp-format="T"] .timestamp-picker-format-sample');
  await expect(sample).toHaveText(/9:05:00/);
  // The button says the exact code the moment carries now.
  await expect(picker.locator('[data-stamp-insert]')).toHaveText(/<t:\d{1,15}:T>/);
  const before = await picker.locator('[data-stamp-insert]').textContent();
  const minute = picker.locator('[data-stamp-minute]');
  await minute.click();
  await minute.pressSequentially('45');
  await expect(picker.locator('[data-stamp-insert]')).not.toHaveText(before!);
  await expect(sample).toHaveText(/9:45:00/);
});

// ---- Gestures: the calendar is a native snap scroller ----

const viewport = (page: Page) => page.locator('.timestamp-picker-viewport');

test('the calendar is a native snap scroller, current month centred', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  await expect(viewport(page)).toHaveCSS('scroll-snap-type', /x mandatory/);
  expect(await viewport(page).evaluate((el) => el.querySelectorAll('.timestamp-picker-page').length)).toBe(5);
  // The centre page sits two pages in: two of runway on either side.
  const [left, width] = await viewport(page).evaluate((el) => [el.scrollLeft, el.clientWidth]);
  expect(Math.abs(left - 2 * width)).toBeLessThanOrEqual(2);
});

test('a fling that settles on a neighbour page turns the month', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const home = await picker.locator('.timestamp-picker-month').textContent();
  // The gesture itself is the browser's; the sheet only hears the settle.
  // A fling to the previous page, then the quiet that settles it:
  await viewport(page).evaluate((el) => {
    el.scrollLeft = el.clientWidth;
    el.dispatchEvent(new Event('scroll'));
  });
  await settled(page);
  expect(await picker.locator('.timestamp-picker-month').textContent()).not.toBe(home);
  // The visible grid IS the month before: its first day, inserted, is the 1st.
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').first().click();
  await picker.locator('[data-stamp-insert]').click();
  const previous = new Date(Number(/<t:(\d{1,15})>/.exec(await noteText(page))![1]) * 1000);
  const now = new Date();
  expect(previous.getDate()).toBe(1);
  expect(previous.getMonth()).toBe((now.getMonth() + 11) % 12);
});

test('the title follows the finger: the month names itself mid-drag', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const home = await picker.locator('.timestamp-picker-month').textContent();
  // A quarter of the way toward the previous page: the title already wears
  // that month — it does not wait for the track to stop.
  await viewport(page).evaluate((el) => {
    el.scrollLeft = Math.round(el.clientWidth * 1.25); // three-quarters toward the previous page
    el.dispatchEvent(new Event('scroll'));
  });
  await expect(picker.locator('.timestamp-picker-month')).not.toHaveText(home!);
  // And when the track settles there, it stays that month, re-centred.
  await page.waitForTimeout(220); // past the settle debounce
  await expect(picker.locator('.timestamp-picker-month')).not.toHaveText(home!);
  const [left, width] = await viewport(page).evaluate((el) => [el.scrollLeft, el.clientWidth]);
  expect(Math.abs(left - 2 * width)).toBeLessThanOrEqual(2);
});

test('two quick swipes one way turn two months, no resting between', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  // The first fling lands a page over; the second starts before anything
  // has rested (the runway is why the track carries five months).
  await viewport(page).evaluate((el) => {
    el.scrollLeft = 3 * el.clientWidth;
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(220); // settle: adopt +1, re-centre
  await viewport(page).evaluate((el) => {
    el.scrollLeft = 3 * el.clientWidth; // again, from the fresh centre
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(220);
  // Two months on: the visible first, inserted, says so.
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').first().click();
  await picker.locator('[data-stamp-insert]').click();
  const reached = new Date(Number(/<t:(\d{1,15})>/.exec(await noteText(page))![1]) * 1000);
  const now = new Date();
  expect(reached.getDate()).toBe(1);
  const expected = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  expect(reached.getMonth()).toBe(expected.getMonth());
  expect(reached.getFullYear()).toBe(expected.getFullYear());
});

test('a scroll that settles where it started keeps the month', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const home = await picker.locator('.timestamp-picker-month').textContent();
  await viewport(page).evaluate((el) => {
    el.scrollLeft = 2 * el.clientWidth + 40; // a nudge off the centre page
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(220); // past the settle debounce
  await viewport(page).evaluate((el) => {
    el.scrollLeft = 2 * el.clientWidth; // back home (the snap's own decision)
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(220);
  expect(await picker.locator('.timestamp-picker-month').textContent()).toBe(home);
});

test('every month is a fixed six-week grid: the sheet never changes height', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const cells = await viewport(page).evaluate((el) => [...el.querySelectorAll('.timestamp-picker-page')].map((p) => p.querySelectorAll('.timestamp-picker-day').length));
  expect(cells).toEqual([42, 42, 42, 42, 42]);
  const height = await picker.evaluate((el) => el.getBoundingClientRect().height);
  // Turn two months: the grid is the same shape, the sheet the same height.
  await drag(page, 0);
  await settled(page);
  await page.waitForTimeout(250);
  expect(await picker.evaluate((el) => el.getBoundingClientRect().height)).toBe(height);
  await expect(picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)')).toHaveCount(31, { timeout: 5000 }).catch(() => {});
});

test('the runway grows mid-scroll: a six-page run finds real months all the way', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const now = new Date();
  // Six pages in one continuous scroll, no rest between: the track must grow
  // ahead of the finger and the title must follow it.
  await viewport(page).evaluate(async (el) => {
    const width = el.clientWidth;
    for (let step = 1; step <= 6; step += 1) {
      el.scrollLeft = width * (2 + step);
      el.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }
  });
  expect(await viewport(page).evaluate((el) => el.querySelectorAll('.timestamp-picker-page').length)).toBeGreaterThan(8);
  // Rest: the month six on is adopted, re-centred, and its 1st is real.
  await page.waitForTimeout(400); // past the settle debounce
  const expected = new Date(now.getFullYear(), now.getMonth() + 6, 1);
  const [left, width] = await viewport(page).evaluate((el) => [el.scrollLeft, el.clientWidth]);
  expect(Math.abs(left - 2 * width)).toBeLessThanOrEqual(2);
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').first().click();
  await picker.locator('[data-stamp-insert]').click();
  const reached = new Date(Number(/<t:(\d{1,15})>/.exec(await noteText(page))![1]) * 1000);
  expect(reached.getFullYear()).toBe(expected.getFullYear());
  expect(reached.getMonth()).toBe(expected.getMonth());
  expect(reached.getDate()).toBe(1);
  // A step the other way: a real drag prepends in the finger's window.
  await openPicker(page);
  const before = await picker.locator('.timestamp-picker-month').textContent();
  await drag(page, -1.2); // one page left, with a little intent
  await settled(page);
  await expect(picker.locator('.timestamp-picker-month')).not.toHaveText(before!);
  const after = await viewport(page).evaluate((el) => [el.scrollLeft, el.clientWidth]);
  expect(Math.abs(after[0] - 2 * after[1])).toBeLessThanOrEqual(2);
});

test('two quick left drags stay within two months - no anchor divergence', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const now = new Date();
  for (let round = 0; round < 2; round += 1) {
    await drag(page, 0.9); // one page left, fast, no rest between
    await settled(page);
  }
  // Whatever the snap did to the synthetic stream, the bookkeeping may not
  // diverge: the landing is within two months of the start - the device bug
  // was a TWELVE-month jump.
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').first().click();
  await picker.locator('[data-stamp-insert]').click();
  const reached = new Date(Number(/<t:(\d{1,15})>/.exec(await noteText(page))![1]) * 1000);
  const min = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const max = new Date(now.getFullYear(), now.getMonth(), 1);
  expect(reached.getTime()).toBeGreaterThanOrEqual(min.getTime());
  expect(reached.getTime()).toBeLessThanOrEqual(max.getTime() + 86_400_000);
  expect(reached.getDate()).toBe(1);
});

test('nothing adopts under the finger: the drag owns the track until it lifts', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const before = await picker.locator('.timestamp-picker-month').textContent();
  // Finger down, then the drag arrives below the prepend threshold.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.timestamp-picker-viewport')!
      .dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
  });
  await viewport(page).evaluate((el) => {
    el.scrollLeft = Math.round(el.clientWidth * 0.5);
    el.dispatchEvent(new Event('scroll'));
  });
  await expect(viewport(page).evaluate((el) => el.querySelectorAll('.timestamp-picker-page').length)).resolves.toBeGreaterThan(5);
  // Held past the settle window: still the finger's track, nothing rebuilt.
  await page.waitForTimeout(300);
  await expect(viewport(page).evaluate((el) => el.querySelectorAll('.timestamp-picker-page').length)).resolves.toBeGreaterThan(5);
  // The finger lifts: the quiet settle adopts the month before.
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.timestamp-picker-viewport')!;
    el.style.scrollSnapType = '';
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
  });
  await settled(page);
  await expect(picker.locator('.timestamp-picker-month')).not.toHaveText(before!);
});

test('Today moves the date and Now moves the time, each keeping the other', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const now = new Date();
  // A date elsewhere and a typed time.
  await drag(page, 1); // to the month before
  await settled(page);
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').nth(14).click();
  const hour = picker.locator('[data-stamp-hour]');
  await hour.click();
  await hour.pressSequentially('04');
  await picker.locator('[data-stamp-minute]').pressSequentially('30');
  await picker.locator('[data-stamp-second]').pressSequentially('00');
  await picker.locator('[data-stamp-today]').click(); // the date -> today, 04:30 kept
  await picker.locator('.timestamp-picker-format[data-stamp-format="t"]').click();
  await picker.locator('[data-stamp-insert]').click();
  let at = new Date(Number(/<t:(\d{1,15}):t>/.exec(await noteText(page))![1]) * 1000);
  expect(at.getDate()).toBe(now.getDate());
  expect(at.getMonth()).toBe(now.getMonth());
  expect(at.getHours()).toBe(4);
  expect(at.getMinutes()).toBe(30);
  // Now: the time follows the clock; the date stays today's.
  await openPicker(page);
  await picker.locator('[data-stamp-now]').click();
  await picker.locator('[data-stamp-insert]').click();
  const codes = [...(await noteText(page)).matchAll(/<t:(\d{1,15})>/g)].map((m) => Number(m[1]));
  at = new Date(codes[codes.length - 1] * 1000);
  expect(Math.abs(at.getTime() - Date.now())).toBeLessThan(120_000);
  expect(at.getDate()).toBe(now.getDate());
});

test('the sheet can switch the calendar it wears, in place', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const title = picker.locator('.timestamp-picker-month');
  const gregorian = await title.textContent();
  await picker.locator('[data-stamp-cal]').click(); // -> Persian
  await expect(title).not.toHaveText(gregorian!);
  // The same instant, re-worded: today inserted from the Jalali grid is the
  // same unix second the clock says.
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day.is-selected').click();
  await picker.locator('[data-stamp-insert]').click();
  const code = Number(/<t:(\d{1,15})>/.exec(await noteText(page))![1]);
  expect(Math.abs(code - Math.floor(Date.now() / 1000))).toBeLessThan(120);
});

test('the picker arrows step the values, not the sheet', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const hour = picker.locator('[data-stamp-hour]');
  await hour.click();
  const before = await hour.inputValue();
  await hour.press('ArrowUp'); // steps, wrapping at the ceiling
  await expect(hour).toHaveValue(String((Number(before) + 1) % 24).padStart(2, '0'));
  const scrolled = await page.evaluate(() => document.querySelector<HTMLElement>('.menu-scroll')!.scrollTop);
  await hour.press('ArrowUp'); // the step itself moves nothing but the value
  await expect(hour).toHaveValue(String((Number(before) + 2) % 24).padStart(2, '0'));
  expect(await page.evaluate(() => document.querySelector<HTMLElement>('.menu-scroll')!.scrollTop)).toBe(scrolled);
  const title = picker.locator('.timestamp-picker-month');
  const month = await title.textContent();
  await title.press('ArrowDown'); // down through the months
  await expect(title).not.toHaveText(month!);
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

test('two digits advance by themselves, and 95 holds the chain', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  // The jump box: a two-digit month hands over to the year; a year does not.
  await picker.locator('[data-stamp-jump]').click();
  const month = picker.locator('[data-stamp-jump-month]');
  const year = picker.locator('[data-stamp-jump-year]');
  await expect(month).toBeFocused();
  await month.fill('');
  await month.pressSequentially('1');
  await expect(year).not.toBeFocused(); // 1 may still become 12
  await month.pressSequentially('2'); // 12: the year is next
  await expect(year).toBeFocused();
  await year.pressSequentially('2030'); // four digits is a year, not a trigger
  await year.press('Enter'); // the jump applies; the keyboard lands on the title
  await expect(picker.locator('[data-stamp-jump-year]')).toHaveCount(0);
  await page.waitForTimeout(350); // the post-apply guard rests
  // The time row: 9 alone waits (shown 09, but it may become 95)...
  const hour = picker.locator('[data-stamp-hour]');
  const minute = picker.locator('[data-stamp-minute]');
  const second = picker.locator('[data-stamp-second]');
  await hour.click();
  await hour.pressSequentially('9');
  await expect(minute).not.toBeFocused();
  await hour.pressSequentially('5'); // 95: impossible - red, and nothing moves
  await expect(hour).toHaveClass(/is-invalid/);
  await expect(minute).not.toBeFocused();
  await hour.press('Backspace');
  await hour.pressSequentially('15'); // the register shifts 9+1 then 1+5: 15, on to the minute
  await expect(minute).toBeFocused();
  await minute.pressSequentially('30'); // on to the seconds
  await expect(second).toBeFocused();
  await second.pressSequentially('45'); // done - the keyboard closes, quietly
  await expect(second).not.toBeFocused();
  await expect(picker).toBeVisible();
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
  await hour.fill('');
  await hour.pressSequentially('2a1'); // "a" meets the digits-only field and dies
  await expect(hour).toHaveValue('21');
  await expect(picker.locator('[data-stamp-minute]')).toBeFocused(); // full: the chain moves
});
