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
/** The settle. The track is a fixed ladder and is never re-centred, so rest
 *  is not a particular place any more — it is: the scroll stands on a page,
 *  it has not moved since the last look, and the sheet has adopted that page
 *  (the current one is the one under the scroll). Resting ON a snap point is
 *  not enough on its own: a glide has not left its starting page in the
 *  first frames, and a test would read that as the settle it is waiting for. */
const settled = async (page: Page): Promise<void> => {
  let last = Number.NaN;
  await expect.poll(async () => {
    const now = await page.locator('.timestamp-picker-viewport').evaluate((el) => {
      const at = el.scrollLeft;
      const index = Math.round(at / el.clientWidth);
      return {
        at,
        onPage: Math.abs(at - index * el.clientWidth) <= 2,
        adopted: Number(el.querySelector<HTMLElement>('.timestamp-picker-page.is-current')?.dataset.stampPage) === index,
      };
    });
    const stable = now.at === last;
    last = now.at;
    return now.onPage && now.adopted && stable;
  }, { timeout: 5000, intervals: [60, 60, 100, 150, 250, 500] }).toBe(true);
};
/** Which page of the ladder the scroll stands on, and which one is current. */
const atPage = (page: Page) => page.locator('.timestamp-picker-viewport').evaluate(
  (el) => Math.round(el.scrollLeft / el.clientWidth),
);
const currentPage = (page: Page) => page.locator('.timestamp-picker-page.is-current').evaluate(
  (el) => Number((el as HTMLElement).dataset.stampPage),
);
/** A finger drag: touch down, relative deltas (each lands wherever the track
 *  really is now, compensations included), finger up. `toPages` is the target
 *  in page widths, counted FROM WHERE THE TRACK IS: the ladder is fixed and
 *  never re-centres, so there is no absolute page to aim at. */
const drag = async (page: Page, byPages: number): Promise<void> => {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.timestamp-picker-viewport')!
      .dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
  });
  await viewport(page).evaluate(async (el, by) => {
    const width = el.clientWidth;
    const total = width * by;
    el.style.scrollSnapType = 'none'; // a real finger bypasses snap while dragging
    for (let step = 1; step <= 12; step += 1) {
      el.scrollLeft += total / 12;
      el.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }
  }, byPages);
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

test('a code inside a code span or a fence shifts nothing: the tapped chip edits its own code', async ({ page }) => {
  // Neither renders as a chip, so neither may be counted when the chip is
  // matched back to the note — the old count ran over the raw text and handed
  // the rewrite to the first code it found, inside the backticks.
  const codeSpan = `<t:1700000000:R>`;
  const note = `The pattern \`${codeSpan}\` is code.\n\n\`\`\`\n${codeSpan}\n\`\`\`\n\nDue <t:1700000000:R> tomorrow.\n`;
  await boot(page, {}, note);
  await page.locator('#app #preview-toggle').click();
  await expect(page.locator('#app #preview time.discord-timestamp')).toHaveCount(1);
  await page.locator('#app #preview time.discord-timestamp').click();
  const picker = sheet(page);
  await expect(picker).toBeVisible();
  await picker.locator('.timestamp-picker-format[data-stamp-format="T"]').click();
  await picker.locator('[data-stamp-insert]').click();
  await expect(picker).toHaveCount(0);
  expect(await noteText(page)).toBe(`The pattern \`${codeSpan}\` is code.\n\n\`\`\`\n${codeSpan}\n\`\`\`\n\nDue <t:1700000000:T> tomorrow.\n`);
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

test('the calendar is a fixed ladder of pages on a native snap scroller', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  await expect(viewport(page)).toHaveCSS('scroll-snap-type', /x mandatory/);
  const shape = await viewport(page).evaluate((el) => ({
    frames: el.querySelectorAll('.timestamp-picker-page').length,
    grids: el.querySelectorAll('.timestamp-picker-grid').length,
    current: Number(el.querySelector<HTMLElement>('.timestamp-picker-page.is-current')!.dataset.stampPage),
    at: Math.round(el.scrollLeft / el.clientWidth),
    off: Math.abs(el.scrollLeft - Math.round(el.scrollLeft / el.clientWidth) * el.clientWidth),
  }));
  // A century of months, laid once: the page index IS the month, so nothing
  // is ever inserted, removed or re-centred under a gesture.
  expect(shape.frames).toBeGreaterThan(1000);
  // Only the months near the reader are drawn. The rest are empty frames,
  // which is what makes a ladder this long cost nothing.
  expect(shape.grids).toBeLessThanOrEqual(9);
  expect(shape.current).toBe(shape.at);
  expect(shape.off).toBeLessThanOrEqual(2);
});

test('a fling that settles on a neighbour page turns the month', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const home = await picker.locator('.timestamp-picker-month').textContent();
  // The gesture itself is the browser's; the sheet only hears the settle.
  // A fling to the previous page, then the quiet that settles it:
  await viewport(page).evaluate((el) => {
    el.scrollLeft -= el.clientWidth; // one page back from wherever it stands
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
  const from = await atPage(page);
  await viewport(page).evaluate((el) => {
    el.scrollLeft -= Math.round(el.clientWidth * 0.75); // three-quarters toward the previous page
    el.dispatchEvent(new Event('scroll'));
  });
  await expect(picker.locator('.timestamp-picker-month')).not.toHaveText(home!);
  // And when the track settles there, it stays that month — and stays where
  // it stopped. Nothing is re-centred any more: the page it rested on is
  // simply the month now, which is why a second swipe is never fought.
  await page.waitForTimeout(220); // past the settle debounce
  await expect(picker.locator('.timestamp-picker-month')).not.toHaveText(home!);
  await settled(page);
  expect(await atPage(page)).toBe(from - 1);
  expect(await currentPage(page)).toBe(from - 1);
});

test('two quick swipes one way turn two months, no resting between', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  // The first fling lands a page over; the second starts before anything
  // has rested (the runway is why the track carries five months).
  await viewport(page).evaluate((el) => {
    el.scrollLeft += el.clientWidth;
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(220); // settle: the page it stopped on is the month
  await viewport(page).evaluate((el) => {
    el.scrollLeft += el.clientWidth; // again, straight on from there
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
  const home_at = await atPage(page);
  await viewport(page).evaluate((el) => {
    el.scrollLeft += 40; // a nudge off the page it rests on
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(220); // past the settle debounce
  await viewport(page).evaluate((el, at) => {
    el.scrollLeft = at * el.clientWidth; // back home (the snap's own decision)
    el.dispatchEvent(new Event('scroll'));
  }, home_at);
  await page.waitForTimeout(220);
  expect(await picker.locator('.timestamp-picker-month').textContent()).toBe(home);
});

test('every month is a fixed six-week grid: the sheet never changes height', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  // Every month that is drawn is a six-week grid, whatever month it is.
  const cells = await viewport(page).evaluate((el) => [...el.querySelectorAll('.timestamp-picker-grid')].map((grid) => grid.querySelectorAll('.timestamp-picker-day').length));
  expect(cells.length).toBeGreaterThanOrEqual(5);
  expect([...new Set(cells)]).toEqual([42]);
  const height = await picker.evaluate((el) => el.getBoundingClientRect().height);
  // Turn two months: the grid is the same shape, the sheet the same height.
  await drag(page, -1);
  await settled(page);
  await page.waitForTimeout(250);
  // Sub-pixel: a layout pass may hand back 576.000061 for the same 576, so
  // the two heights are compared with a tolerance that a real row would blow
  // (a week of cells is ~40px).
  const turned = await picker.evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.abs(turned - height)).toBeLessThanOrEqual(0.5);
  await expect(picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)')).toHaveCount(31, { timeout: 5000 }).catch(() => {});
});

test('a six-page run finds real months all the way', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const now = new Date();
  const frames = await viewport(page).evaluate((el) => el.querySelectorAll('.timestamp-picker-page').length);
  // Six pages in one continuous scroll, no rest between: every frame the
  // scroll passes already exists, and the grids are drawn into them as the
  // reader comes near.
  await viewport(page).evaluate(async (el) => {
    const width = el.clientWidth;
    for (let step = 1; step <= 6; step += 1) {
      el.scrollLeft += width; // one page on from wherever the track is now
      el.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }
  });
  // Six pages of travel land six months on, with a real grid under them —
  // and the ladder is exactly as long as it was: pages are never added.
  await page.waitForTimeout(400); // past the settle debounce
  expect(await viewport(page).evaluate((el) => el.querySelectorAll('.timestamp-picker-page').length)).toBe(frames);
  const expected = new Date(now.getFullYear(), now.getMonth() + 6, 1);
  await settled(page);
  await picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day:not(.is-blank)').first().click();
  await picker.locator('[data-stamp-insert]').click();
  const reached = new Date(Number(/<t:(\d{1,15})>/.exec(await noteText(page))![1]) * 1000);
  expect(reached.getFullYear()).toBe(expected.getFullYear());
  expect(reached.getMonth()).toBe(expected.getMonth());
  expect(reached.getDate()).toBe(1);
  // And a step the other way, as a real drag.
  await openPicker(page);
  const before = await picker.locator('.timestamp-picker-month').textContent();
  const at = await atPage(page);
  await drag(page, -1.2); // one page back, with a little intent
  await settled(page);
  await expect(picker.locator('.timestamp-picker-month')).not.toHaveText(before!);
  expect(await atPage(page)).toBe(at - 1);
});

test('two quick left drags stay within two months - no anchor divergence', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const now = new Date();
  for (let round = 0; round < 2; round += 1) {
    await drag(page, -1.1); // one page back, fast, no rest between
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
  const shape = () => viewport(page).evaluate((el) => ({
    frames: el.querySelectorAll('.timestamp-picker-page').length,
    current: el.querySelector<HTMLElement>('.timestamp-picker-page.is-current')!.dataset.stampPage,
    at: Math.round(el.scrollLeft),
  }));
  // Finger down, then the drag carries the track most of a page along.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.timestamp-picker-viewport')!
      .dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
  });
  await viewport(page).evaluate((el) => {
    el.scrollLeft -= Math.round(el.clientWidth * 0.5);
    el.dispatchEvent(new Event('scroll'));
  });
  const held = await shape();
  // The title follows the page under the finger at once — that is what it is
  // for — but the track itself is untouched.
  await expect(picker.locator('.timestamp-picker-month')).not.toHaveText(before!);
  // Held past the settle window: the same ladder, the same page still
  // current, the same offset. Nothing is adopted and nothing moves while the
  // writer's hand is on the track.
  await page.waitForTimeout(300);
  expect(await shape()).toEqual(held);
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

// ---- The sheet's shape: the jump box's width, the switch's order, the keyboard ----

test('the month and year box is only as wide as its digits', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  await picker.locator('[data-stamp-jump]').click();
  await expect(picker.locator('[data-stamp-jump-month]')).toBeFocused();
  const box = await page.evaluate(() => {
    const box = (selector: string): DOMRect => document.querySelector(selector)!.getBoundingClientRect();
    const head = box('.timestamp-picker-head');
    const month = box('[data-stamp-jump-month]');
    const year = box('[data-stamp-jump-year]');
    return {
      headLeft: head.left, headRight: head.right,
      monthWidth: month.width, yearWidth: year.width,
      left: month.left, right: year.right,
    };
  });
  expect(box.monthWidth).toBeGreaterThan(20); // room for two digits
  expect(box.monthWidth).toBeLessThan(64);
  expect(box.yearWidth - box.monthWidth).toBeGreaterThan(8); // and the year is two digits wider
  expect(box.yearWidth).toBeLessThan(96);
  expect(box.left).toBeGreaterThanOrEqual(box.headLeft - 1); // the box holds the title's slot, it does not run over it
  expect(box.right).toBeLessThanOrEqual(box.headRight + 1);
});

test('switching calendars keeps both names put: only the highlight moves', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const button = picker.locator('[data-stamp-cal]');
  const read = () => page.evaluate(() => {
    const button = document.querySelector('[data-stamp-cal]') as HTMLElement;
    const options = [...button.querySelectorAll<HTMLElement>('[data-stamp-cal-option]')];
    return {
      order: options.map((option) => `${option.dataset.stampCalOption}${option.classList.contains('is-active') ? '*' : ''}`),
      names: options.map((option) => option.textContent),
      places: options.map((option) => Math.round(option.getBoundingClientRect().left)),
      row: [...document.querySelectorAll('.timestamp-picker-today, [data-stamp-cal], .timestamp-picker-now')].map((el) => Math.round(el.getBoundingClientRect().left)),
      title: document.querySelector('.timestamp-picker-month')!.textContent,
    };
  });
  const gregorian = await read();
  expect(gregorian.order).toEqual(['gregory*', 'persian']);
  await button.click();
  await page.waitForTimeout(150);
  const persian = await read();
  expect(persian.order).toEqual(['gregory', 'persian*']); // the highlight moved...
  expect(persian.names).toEqual(gregorian.names); // ...and nothing else did: same words,
  expect(persian.places).toEqual(gregorian.places); // same places, Today and Now where they were
  expect(persian.row).toEqual(gregorian.row);
  expect(persian.title).not.toBe(gregorian.title); // while the grid really did switch
});

test('the sheet stands two thirds of the screen tall', async ({ page }) => {
  await boot(page);
  // A tall screen: a fixed pixel cap would leave the sheet short of the
  // two thirds it is meant to stand, so the height must follow the screen.
  await page.setViewportSize({ width: 390, height: 1100 });
  await openPicker(page);
  await expect(sheet(page)).toHaveClass(/is-open/);
  await page.waitForTimeout(400); // the slide-in settles
  const ratio = await page.evaluate(() => {
    const rect = (document.querySelector('.timestamp-picker') as HTMLElement).getBoundingClientRect();
    return rect.height / window.innerHeight;
  });
  expect(ratio).toBeGreaterThan(0.6);
  expect(ratio).toBeLessThan(0.72);
});

test('a keyboard over the page: the sheet ends on its top edge, whole and reachable', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  await expect(picker).toHaveClass(/is-open/);
  await page.waitForTimeout(400); // the slide-in settles
  // The page itself never resizes for the keyboard (index.html's
  // interactive-widget=resizes-visual); the sheet ends on the keyboard's top
  // edge, so nothing of it hides behind the keys and no page shows between.
  const meta = await page.evaluate(() => document.querySelector('meta[name="viewport"]')!.getAttribute('content')!);
  expect(meta).toContain('interactive-widget=resizes-visual');
  const rest = await page.evaluate(() => {
    const rect = (document.querySelector('.timestamp-picker') as HTMLElement).getBoundingClientRect();
    return { width: rect.width, height: rect.height, top: rect.top };
  });
  await picker.locator('[data-stamp-hour]').click(); // a field focused: the on-screen keyboard is coming
  // Chrome's default: the keyboard covers the page and only the visual viewport
  // shrinks (a page zoom does the same thing to the same numbers).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await page.waitForTimeout(400);
  const raised = await page.evaluate(() => {
    const sheet = document.querySelector('.timestamp-picker') as HTMLElement;
    const hour = document.querySelector('[data-stamp-hour]') as HTMLElement;
    const vv = window.visualViewport!;
    const rect = sheet.getBoundingClientRect();
    const scroll = sheet.querySelector('.menu-scroll') as HTMLElement;
    return {
      visibleBottom: vv.offsetTop + vv.height,
      visibleHeight: vv.height,
      lift: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-lift')),
      width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom,
      scrollClient: scroll.clientHeight,
      hourBottom: hour.getBoundingClientRect().bottom,
    };
  });
  expect(raised.lift).toBeGreaterThan(120); // the keyboard is up, and the app knows it
  expect(Math.abs(raised.width - rest.width)).toBeLessThanOrEqual(1); // the box keeps its width...
  expect(Math.abs(raised.bottom - raised.visibleBottom)).toBeLessThanOrEqual(1); // ...and its bottom edge lands on the keyboard's top edge: nothing between them, nothing behind the keys
  expect(raised.height).toBeLessThanOrEqual(raised.visibleHeight + 1); // the whole box fits above the keys,
  expect(raised.top).toBeGreaterThanOrEqual(-1); // never climbing off the top of the screen,
  expect(raised.scrollClient).toBeLessThanOrEqual(raised.visibleHeight + 1); // and the scroll area answers the room, so the chips and the Insert row stay reachable
  expect(raised.hourBottom).toBeLessThanOrEqual(raised.visibleBottom + 1); // the field under the finger is scrolled clear of the keys
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); // the keyboard goes
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => {
    const rect = (document.querySelector('.timestamp-picker') as HTMLElement).getBoundingClientRect();
    return {
      bottom: rect.bottom, height: rect.height, inner: window.innerHeight,
      lift: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-lift')),
    };
  });
  expect(back.lift).toBe(0);
  expect(Math.abs(back.bottom - back.inner)).toBeLessThanOrEqual(1); // the sheet is back down,
  expect(Math.abs(back.height - rest.height)).toBeLessThanOrEqual(1); // and it was the same box all along
});

test('a browser bar is not a keyboard: nothing lifts, no sliver under the sheet', async ({ page }) => {
  await boot(page);
  await openPicker(page);
  await page.waitForTimeout(400); // the slide-in settles
  await expect(sheet(page)).toHaveClass(/is-open/);
  // A phone browser's URL bar showing: the visual viewport is short by ~56px
  // with no keyboard anywhere (a page zoom gives the same numbers).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 844 / 788 });
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => {
    const picker = document.querySelector('.timestamp-picker') as HTMLElement;
    const rect = picker.getBoundingClientRect();
    const under = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 6) as HTMLElement | null;
    return {
      overlap: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-lift')),
      lift: getComputedStyle(picker).getPropertyValue('--sheet-lift').trim(),
      bottom: rect.bottom,
      inner: window.innerHeight,
      under: under?.closest('.timestamp-picker') !== null,
    };
  });
  expect(state.overlap).toBeGreaterThan(30); // the browser's chrome is really showing...
  expect(state.lift).toBe('0px'); // ...and it is not a keyboard: nothing lifts,
  expect(Math.abs(state.bottom - state.inner)).toBeLessThanOrEqual(1); // the sheet keeps to the bottom edge,
  expect(state.under).toBe(true); // and the very bottom pixel is the sheet's own: no sliver under it
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
});

test('a sheet opened while the keyboard is already up rides it at once', async ({ page }) => {
  await boot(page);
  // The keyboard is up before the sheet exists.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 844 / 620 });
  await page.waitForTimeout(400);
  await openPicker(page);
  // The sheet waits for the keyboard to go before it shows itself, and this
  // keyboard never does: it opens on its own cap, then slides in.
  await expect(sheet(page)).toBeVisible({ timeout: 2000 });
  await page.waitForTimeout(450); // the sheet's slide-in
  const state = await page.evaluate(() => {
    const picker = document.querySelector('.timestamp-picker') as HTMLElement;
    const rect = picker.getBoundingClientRect();
    const viewport = window.visualViewport!;
    return {
      keyboard: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-lift')),
      lift: parseFloat(getComputedStyle(picker).getPropertyValue('--sheet-lift')),
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      visibleTop: viewport.offsetTop,
      visibleHeight: viewport.height,
      visibleBottom: viewport.offsetTop + viewport.height,
    };
  });
  expect(state.keyboard).toBeGreaterThan(200); // the keyboard is up
  expect(state.lift).toBe(state.keyboard); // the sheet rose the moment it was in the DOM, by the keyboard's own height,
  expect(Math.abs(state.bottom - state.visibleBottom)).toBeLessThanOrEqual(1); // and sits exactly on its top edge,
  expect(state.top).toBeGreaterThanOrEqual(state.visibleTop - 1); // whole, on screen
  expect(state.height).toBeLessThanOrEqual(state.visibleHeight + 1);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
});

test('the grid starts at 1 in whichever calendar the sheet wears', async ({ page }) => {
  // The Dates setting is Jalali (Persian); the sheet's own switch re-words the
  // same dates as Gregorian. Either way every page is a whole month of that
  // calendar: its cells are 1, 2, 3 … with nothing missing. (The helpers once
  // walked the setting's calendar while the labels counted the sheet's, so
  // whichever calendar you were not set to began at 9 or 10.)
  await boot(page, { timestampLocale: 'en', timestampCalendar: 'persian' });
  await openPicker(page);
  const picker = sheet(page);
  const pages = () => page.evaluate(() => {
    const latin = (value: string): string => value
      .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
      .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
    // Only the pages that are drawn: the ladder's far frames are empty.
    return [...document.querySelectorAll('.timestamp-picker-page')].filter((sheetPage) => sheetPage.querySelector('.timestamp-picker-grid')).map((sheetPage) => {
      const days = [...sheetPage.querySelectorAll('.timestamp-picker-day:not(.is-blank)')]
        .map((day) => Number(latin(day.textContent ?? '')));
      return {
        days,
        current: sheetPage.classList.contains('is-current'),
        first: days[0],
        last: days[days.length - 1],
        count: days.length,
      };
    });
  });
  const now = new Date();
  const currentDays = (sheetPages: Awaited<ReturnType<typeof pages>>): number[] =>
    sheetPages.find((sheetPage) => sheetPage.current)!.days;

  const jalali = await pages();
  const jalaliMonth = Number(new Intl.DateTimeFormat('en-u-ca-persian', { month: 'numeric' }).format(now));
  for (const sheetPage of jalali) {
    expect(sheetPage.first).toBe(1); // a Jalali month starts at 1...
    expect(sheetPage.days).toEqual(Array.from({ length: sheetPage.count }, (_, index) => index + 1)); // ...and counts on with no gaps
    expect(sheetPage.count).toBeGreaterThanOrEqual(29);
    expect(sheetPage.count).toBeLessThanOrEqual(31);
  }
  // The centred page is the current Jalali month: today is in it.
  expect(new Intl.DateTimeFormat('en-u-ca-persian', { month: 'numeric' }).format(now)).toBe(String(jalaliMonth));
  expect(currentDays(jalali)).toContain(Number(new Intl.DateTimeFormat('en-u-ca-persian', { day: 'numeric' }).format(now)));
  await expect(picker.locator('.timestamp-picker-month')).toHaveText(/14\d\d/); // the title counts the same calendar

  await picker.locator('[data-stamp-cal]').click(); // -> Gregorian
  await page.waitForTimeout(250);
  const gregorian = await pages();
  for (const sheetPage of gregorian) {
    expect(sheetPage.first).toBe(1); // a Gregorian month starts at 1,
    expect(sheetPage.days).toEqual(Array.from({ length: sheetPage.count }, (_, index) => index + 1)); // though this was 9 or 10 not long ago
    expect(sheetPage.count).toBeGreaterThanOrEqual(28);
    expect(sheetPage.count).toBeLessThanOrEqual(31);
  }
  expect(currentDays(gregorian)).toContain(now.getDate()); // today is in the month the sheet shows
  await expect(picker.locator('.timestamp-picker-month')).toContainText(String(now.getFullYear()));
});

test("the keyboard's own rectangle places the sheet when the browser reports one", async ({ page }) => {
  // Chromium's VirtualKeyboard API: the OS's keyboard rectangle, in client
  // coordinates — the exact edge a sheet must sit on, whatever the visual
  // viewport says. On a real Chrome Android phone the two disagree by the
  // browser chrome's strip, and a sheet placed by the visual viewport floats
  // above the keys with the dimmed page showing underneath it.
  await page.addInitScript(() => {
    const listeners: Array<() => void> = [];
    const keyboard = {
      overlaysContent: false,
      boundingRect: { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0 },
      addEventListener: (type: string, listener: () => void): void => { if (type === 'geometrychange') listeners.push(listener); },
      raise(top: number, bottom: number): void {
        keyboard.boundingRect = { top, bottom, height: bottom - top, left: 0, right: 390, width: 390, x: 0, y: top };
        for (const listener of listeners) listener();
      },
    };
    Object.defineProperty(navigator, 'virtualKeyboard', { value: keyboard, configurable: true });
    (window as unknown as { __keyboard: typeof keyboard }).__keyboard = keyboard;
  });
  await boot(page);
  await openPicker(page);
  await expect(sheet(page)).toHaveClass(/is-open/);
  await page.waitForTimeout(400);
  const optedIn = await page.evaluate(() => (navigator as unknown as { virtualKeyboard: { overlaysContent: boolean } }).virtualKeyboard.overlaysContent);
  expect(optedIn).toBe(true); // the app takes the geometry and leaves the browser's own resizing alone
  const rest = await page.evaluate(() => {
    const picker = document.querySelector('.timestamp-picker') as HTMLElement;
    return { bottom: Math.round(picker.getBoundingClientRect().bottom), inner: window.innerHeight };
  });
  expect(Math.abs(rest.bottom - rest.inner)).toBeLessThanOrEqual(1); // down: on the screen's bottom edge
  // The keyboard comes up. Only its rectangle says so — the visual viewport is
  // untouched, exactly as a real browser reports it with overlaysContent.
  await page.evaluate(() => (window as unknown as { __keyboard: { raise(t: number, b: number): void } }).__keyboard.raise(620, 844));
  await page.waitForTimeout(300);
  const raised = await page.evaluate(() => {
    const picker = document.querySelector('.timestamp-picker') as HTMLElement;
    const scroll = picker.querySelector('.menu-scroll') as HTMLElement;
    const rect = picker.getBoundingClientRect();
    const viewport = window.visualViewport!;
    return {
      bottom: Math.round(rect.bottom), top: Math.round(rect.top), height: Math.round(rect.height),
      edge: 620, scrollMax: scroll.clientHeight,
      vvHeight: Math.round(viewport.height),
    };
  });
  expect(raised.vvHeight).toBe(844); // the viewport never moved: the rectangle is the only witness
  expect(Math.abs(raised.bottom - raised.edge)).toBeLessThanOrEqual(1); // the sheet ends exactly on the keyboard's top edge
  expect(raised.top).toBeGreaterThanOrEqual(-1); // whole, on the screen
  expect(raised.scrollMax).toBeLessThanOrEqual(raised.edge + 1); // and its scroll area answers the room above the keys
  // The keyboard leaves: the rectangle empties and the sheet comes back down.
  await page.evaluate(() => (window as unknown as { __keyboard: { raise(t: number, b: number): void } }).__keyboard.raise(0, 0));
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => {
    const picker = document.querySelector('.timestamp-picker') as HTMLElement;
    return { bottom: Math.round(picker.getBoundingClientRect().bottom), inner: window.innerHeight };
  });
  expect(Math.abs(back.bottom - back.inner)).toBeLessThanOrEqual(1);
});

test('?kbdebug=1 puts the numbers on the screen, the bar’s clearance included', async ({ page }) => {
  // A phone has no console: the readout is the bug report. It carries the
  // keyboard's own numbers and the bottom bar's clearance, which is
  // --safe-bottom alone (env() on the web, the plugin in the APK).
  await boot(page);
  await page.goto('/?kbdebug=1');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await expect(page.locator('#kb-debug')).toBeVisible();
  const text = (await page.locator('#kb-debug').textContent()) ?? '';
  expect(text).toContain('screen ');
  expect(text).toMatch(/kb \d+ hidden \d+/);
  expect(text).toMatch(/safe --safe-bottom \d+ env \d+ innerBottom \d+/);
  expect(text).toMatch(/navbar [\d.]+\.\.[\d.]+ \(gap \d+\)/);
});

test('the weekday row reads the way its own language does, and the grid lines up under it', async ({ page }) => {
  // The header row took its direction from its own text (dir="auto") while
  // the day grid took it from the app's direction: with a Persian Dates
  // language inside an English app the two ran opposite ways and every column
  // stood under the wrong name — Friday's cell under Saturday's label. One
  // direction, the language's, now settles both, so they cannot disagree.
  const columns = () => page.evaluate(() => {
    const current = document.querySelector<HTMLElement>('.timestamp-picker-page.is-current')!;
    const centre = (el: Element): number => {
      const box = el.getBoundingClientRect();
      return Math.round(box.left + box.width / 2);
    };
    const selected = current.querySelector<HTMLElement>('.timestamp-picker-day.is-selected');
    return {
      labels: [...current.querySelectorAll<HTMLElement>('.timestamp-picker-weekdays span')]
        .map((span) => ({ name: (span.textContent ?? '').trim(), x: centre(span) })),
      selected: selected ? centre(selected) : null,
    };
  });
  const under = (seen: Awaited<ReturnType<typeof columns>>, tag: string): number => {
    const name = new Intl.DateTimeFormat(tag, { weekday: 'short' }).format(new Date());
    return seen.labels.find((label) => label.name === name)!.x;
  };

  // Persian: the week opens with Saturday on the RIGHT and ends with Friday
  // on the left — the DOM order runs right to left, as the screen does.
  await boot(page, { timestampLocale: 'fa', timestampCalendar: 'persian', weekStart: 6 });
  await openPicker(page);
  const persian = await columns();
  expect(persian.labels.map((label) => label.name))
    .toEqual([...persian.labels].sort((a, b) => b.x - a.x).map((label) => label.name));
  expect(Math.abs(persian.selected! - under(persian, 'fa-u-ca-persian'))).toBeLessThanOrEqual(1);

  // English: the same week, read the other way — Saturday on the left.
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('satr:settings') ?? '{}');
    localStorage.setItem('satr:settings', JSON.stringify({ ...settings, timestampLocale: 'en', timestampCalendar: 'gregory' }));
  });
  await page.reload();
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await openPicker(page);
  const english = await columns();
  expect(english.labels.map((label) => label.name))
    .toEqual([...english.labels].sort((a, b) => a.x - b.x).map((label) => label.name));
  expect(Math.abs(english.selected! - under(english, 'en'))).toBeLessThanOrEqual(1);
});

test('switching the calendar lands on the month that holds the chosen day', async ({ page }) => {
  // A month's first day in one calendar sits mid-month in the other, so
  // carrying that Date across the switch opened the NEIGHBOURING month and
  // left the grid with no selected day at all: on 23 October the Jalali side
  // came up on Mehr — the month that holds 1 October — while today was
  // 1 Aban. The chosen day decides where the switch lands.
  await boot(page);
  await openPicker(page);
  const picker = sheet(page);
  const title = picker.locator('.timestamp-picker-month');
  const selected = picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day.is-selected');
  const now = new Date();
  const jalali = (options: Intl.DateTimeFormatOptions, at: Date = now): string =>
    new Intl.DateTimeFormat('en-u-ca-persian', options).format(at);

  await picker.locator('[data-stamp-cal]').click(); // -> Persian
  await expect(title).toHaveText(jalali({ year: 'numeric', month: 'long' }));
  await expect(selected).toHaveText(jalali({ day: 'numeric' }));
  await picker.locator('[data-stamp-cal]').click(); // -> Gregorian again
  await expect(title).toHaveText(new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long' }).format(now));
  await expect(selected).toHaveText(String(now.getDate()));

  // Paged away from the chosen day there is nothing to hold on to, so the
  // switch keeps the neighbourhood: the month holding the middle of the one
  // on screen, never a month the reader did not ask for.
  await picker.locator('[data-stamp-jump]').click(); // away to January 2030
  await picker.locator('[data-stamp-jump-month]').fill('1');
  await picker.locator('[data-stamp-jump-month]').press('Enter');
  await picker.locator('[data-stamp-jump-year]').fill('2030');
  await picker.locator('[data-stamp-jump-year]').press('Enter');
  await expect(title).toHaveText(new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long' }).format(new Date(2030, 0, 1)));
  await picker.locator('[data-stamp-cal]').click(); // -> Persian
  await expect(title).toHaveText(jalali({ year: 'numeric', month: 'long' }, new Date(2030, 0, 15)));
});

/** A REAL finger on the track: CDP touch points, so Chromium's own gesture,
 *  fling and snap run — the synthetic drag above writes scrollLeft from the
 *  main thread, which is exactly where the compositor behaves differently. */
async function fingerSwipe(page: Page, dx: number, pace: 'flick' | 'push' = 'flick'): Promise<void> {
  // The sheet slides in; a finger put down mid-animation lands on wherever
  // the track was a frame ago. Wait for the box to stop moving first.
  const where = async (): Promise<number> => Math.round((await page.locator('.timestamp-picker-viewport').boundingBox())!.y);
  for (let tries = 0; tries < 40; tries += 1) {
    const first = await where();
    await page.waitForTimeout(50);
    if (first === await where()) break;
  }
  const box = (await page.locator('.timestamp-picker-viewport').boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', at: number) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: at, y, radiusX: 12, radiusY: 12, force: 1 }],
  });
  // A flick and a push: the same distance thrown off in 60ms or walked over
  // 300ms, which is the difference between a fling the compositor carries
  // and a drag that ends where the finger left it.
  const moves = pace === 'flick' ? 4 : 12;
  const wait = pace === 'flick' ? 15 : 25;
  await send('touchStart', x);
  for (let step = 1; step <= moves; step += 1) {
    await page.waitForTimeout(wait);
    await send('touchMove', x + (dx * step) / moves);
  }
  await send('touchEnd', x + dx);
  await cdp.detach();
  await page.waitForTimeout(900); // the fling, the snap and the settle
}

const monthsOf = (locale: string) => Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2020, month, 1)));

test('a finger turns exactly one month, each way', async ({ page }) => {
  // The swipe that runs towards the START of the track is the one that went
  // wrong: first it turned two months at a time, because a page was being
  // inserted there mid-gesture and the compensating scroll write was refused;
  // then, when that was merely rolled back, it turned none at all, because the
  // mutation killed the fling it interrupted.
  await boot(page);
  await openPicker(page);
  await settled(page);
  const title = sheet(page).locator('.timestamp-picker-month');
  const months = monthsOf('en');
  const at = async (): Promise<number> => {
    const [name, year] = (await title.textContent())!.trim().split(' ');
    return Number(year) * 12 + months.indexOf(name);
  };
  for (const pace of ['flick', 'push'] as const) {
    const start = await at();
    for (let step = 1; step <= 2; step += 1) {
      await fingerSwipe(page, 240, pace); // towards the start of the track
      expect(await at()).toBe(start - step);
    }
    for (let step = 1; step <= 2; step += 1) {
      await fingerSwipe(page, -240, pace); // and away from it, one at a time
      expect(await at()).toBe(start - 2 + step);
    }
    expect(await at()).toBe(start);
  }
  await settled(page); // every turn leaves the track centred again
  // A 40px push is a page turn on this engine and no more than one: mandatory
  // snap with scroll-snap-stop:always commits to the NEXT page for any drag
  // that moves the track at all. What may never happen is a nudge landing two
  // months away, which is what the uncompensated prepend used to do.
  const nudged = await at();
  await fingerSwipe(page, -40, 'push');
  expect(Math.abs(await at() - nudged)).toBeLessThanOrEqual(1);
  const back = await at();
  await fingerSwipe(page, 40, 'push');
  expect(Math.abs(await at() - back)).toBeLessThanOrEqual(1);
});

test('the months run the way the language reads', async ({ page }) => {
  // Persian reads right to left, so the month before is to the right: the
  // track is laid out latest-first and the step arrows swap ends with it.
  // The claim is made without any calendar arithmetic — the arrows give the
  // months in order, and the finger must walk the same ones, one a swipe,
  // in both directions. Forward here is the finger moving RIGHT, which is
  // the direction that runs towards the start of the track.
  await boot(page, { timestampLocale: 'fa', timestampCalendar: 'persian', weekStart: 6 });
  await openPicker(page);
  await settled(page);
  const picker = sheet(page);
  const title = picker.locator('.timestamp-picker-month');
  const here = (await title.textContent())!.trim();

  const ahead: string[] = [];
  for (let step = 0; step < 3; step += 1) {
    const before = (await title.textContent())!.trim();
    await picker.locator('[data-stamp-step="1"]').click();
    await expect(title).not.toHaveText(before);
    ahead.push((await title.textContent())!.trim());
  }
  for (let step = 0; step < 3; step += 1) await picker.locator('[data-stamp-step="-1"]').click();
  await expect(title).toHaveText(here);
  await settled(page);

  for (const pace of ['flick', 'push'] as const) {
    for (const month of ahead) {
      await fingerSwipe(page, 240, pace);
      await expect(title).toHaveText(month);
    }
    for (const month of [ahead[1], ahead[0], here]) {
      await fingerSwipe(page, -240, pace);
      await expect(title).toHaveText(month);
    }
  }

  // The arrows sit where that reading puts them: the month before is on the
  // right, and its chevron points that way too.
  const head = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('.timestamp-picker-head')!;
    const x = (selector: string) => row.querySelector<HTMLElement>(selector)!.getBoundingClientRect().x;
    const flip = getComputedStyle(row.querySelector('[data-stamp-step="-1"] svg')!).transform;
    return { dir: row.dir, previous: x('[data-stamp-step="-1"]'), next: x('[data-stamp-step="1"]'), flip };
  });
  expect(head.dir).toBe('rtl');
  expect(head.previous).toBeGreaterThan(head.next);
  expect(head.flip).toBe('matrix(-1, 0, 0, 1, 0, 0)');
});

test('the chosen day stays lit on whichever page holds it', async ({ page }) => {
  // The highlight was drawn only on the page at rest in the middle, so a
  // swipe into the chosen day's month showed a grid with nothing lit until
  // the track settled — and the month either side of it never showed it.
  await boot(page);
  await openPicker(page);
  await settled(page);
  const picker = sheet(page);
  const today = String(new Date().getDate());
  await expect(picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day.is-selected')).toHaveText(today);
  await picker.locator('[data-stamp-step="-1"]').click(); // to the month before
  await settled(page);
  // Today's month is now the page to the right, and it is still lit.
  const here = await currentPage(page);
  await expect(picker.locator(`[data-stamp-page="${here + 1}"] .timestamp-picker-day.is-selected`)).toHaveText(today);
  await expect(picker.locator(`[data-stamp-page="${here}"] .timestamp-picker-day.is-selected`)).toHaveCount(0);
});

test('a calendar switch mid-swipe re-words the month on screen', async ({ page }) => {
  // The switch read the month the track had last SETTLED on. Thrown before
  // the settle, it re-worded a month that was no longer on screen and the
  // grid came up one or two months away from where the finger had left it.
  await boot(page);
  await openPicker(page);
  await settled(page);
  const picker = sheet(page);
  const now = new Date();
  const away = new Date(now.getFullYear(), now.getMonth() + 2, 15); // far enough that no Jalali month holds both
  // Scroll two pages on and switch in the same breath: no settle can run in
  // between, so the sheet has only the scroll position to go by.
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.timestamp-picker-viewport')!;
    viewport.scrollLeft += 2 * viewport.clientWidth;
    document.querySelector<HTMLElement>('[data-stamp-cal]')!.click();
  });
  await expect(picker.locator('.timestamp-picker-month'))
    .toHaveText(new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'long' }).format(away));
});

test('a quick second press of an arrow is not swallowed', async ({ page }) => {
  // A smooth scroll has not moved a pixel in its first frames, so a press
  // landing there read the track as resting and asked for the SAME
  // destination again: three presses turned two months. Re-centring after a
  // turn is itself a scroll, and its scrollend did the same thing from the
  // inside — it started the next queued turn on top of the one already
  // gliding.
  await boot(page);
  await openPicker(page);
  await settled(page);
  const picker = sheet(page);
  const title = picker.locator('.timestamp-picker-month');
  const months = monthsOf('en');
  const at = async (): Promise<number> => {
    const [name, year] = (await title.textContent())!.trim().split(' ');
    return Number(year) * 12 + months.indexOf(name);
  };
  const start = await at();
  for (const [dir, want] of [[1, 3], [-1, 0]] as const) {
    for (let press = 0; press < 3; press += 1) await picker.locator(`[data-stamp-step="${dir}"]`).click();
    await expect.poll(at, { timeout: 5000 }).toBe(start + want);
    await settled(page);
  }
  // And nothing is still being played back. Presses used to be kept in a
  // backlog and spent one animation at a time, so the months went on
  // turning after the writer had stopped pressing; the press moves a
  // destination now, and a destination cannot run on.
  for (let press = 0; press < 5; press += 1) await picker.locator('[data-stamp-step="1"]').click();
  await expect.poll(at, { timeout: 5000 }).toBe(start + 5);
  await page.waitForTimeout(700);
  expect(await at()).toBe(start + 5);
});

test('the date sheet lets the keyboard go, and the code still lands at the caret', async ({ page }) => {
  // The sheet is a tall one and half of it was behind the phone's keyboard.
  // Letting the editable go puts the keyboard down — but the caret has to
  // survive that, or the code lands at the top of the note instead of where
  // the writer was.
  await boot(page);
  const caret = await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    const at = view.state.doc.toString().indexOf('here.') + 'here.'.length;
    view.focus();
    view.dispatch({ selection: { anchor: at } });
    return at;
  });
  const typing = () => page.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false);
  expect(await typing()).toBe(true);
  await openPicker(page);
  await expect(sheet(page)).toBeVisible();
  expect(await typing()).toBe(false); // on a phone, that is the keyboard going down
  await sheet(page).locator('[data-stamp-insert]').click();
  await expect(sheet(page)).toHaveCount(0);
  // The code landed where the caret was, and the writer has the note back
  // with the caret after it — typing carries on where it left off.
  const text = await noteText(page);
  const written = /^<t:\d{1,15}:?[a-zA-Z]?>/.exec(text.slice(caret));
  expect(written).toBeTruthy();
  expect(text).toBe(NOTE.slice(0, caret) + written![0] + NOTE.slice(caret));
  expect(await typing()).toBe(true);
  const head = await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    return EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!.state.selection.main.head;
  });
  expect(head).toBe(caret + written![0].length);
});

test('the arrow names its month before the track has moved', async ({ page }) => {
  // The title used to wait for the glide to carry it: a press was answered
  // about three-quarters of an animation later, which read as the press not
  // having registered. While the sheet is taking itself somewhere, the title
  // says where it is going — the same breath as the press.
  await boot(page);
  await openPicker(page);
  await settled(page);
  const picker = sheet(page);
  const title = picker.locator('.timestamp-picker-month');
  const home = (await title.textContent())!;
  const pressed = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.timestamp-picker-viewport')!;
    const heading = document.querySelector<HTMLElement>('.timestamp-picker-month')!;
    const was = heading.textContent;
    const at = scroller.scrollLeft;
    document.querySelector<HTMLElement>('[data-stamp-step="1"]')!.click();
    // Read back in the same task the press ran in: nothing has had a frame.
    return { turned: heading.textContent !== was, moved: Math.abs(scroller.scrollLeft - at) };
  });
  expect(pressed.turned).toBe(true);
  expect(pressed.moved).toBe(0);
  // And it is the month the glide actually lands on.
  await settled(page);
  const landed = (await title.textContent())!;
  expect(landed).not.toBe(home);
  await expect(picker.locator('.timestamp-picker-page.is-current .timestamp-picker-day.is-blank')).toHaveCount(42 - new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0).getDate());
});

test('the keyboard is down before the sheet comes up', async ({ page }) => {
  // A tall sheet opened into the short window a keyboard still holds lays
  // itself out against that window, and jumps when the keyboard leaves. The
  // sheet waits for it — and never waits longer than it has to.
  await boot(page);
  await page.evaluate(async () => {
    const picker = await window.__satr.load('/src/datePicker.ts') as unknown as { keyboardWatch: { height: () => number } };
    (window as unknown as { __kb: number }).__kb = 320;
    picker.keyboardWatch.height = () => (window as unknown as { __kb: number }).__kb;
  });
  await openPicker(page);
  await page.waitForTimeout(200);
  await expect(sheet(page)).toHaveCount(0); // the keyboard is still down there
  await page.evaluate(() => { (window as unknown as { __kb: number }).__kb = 0; });
  await expect(sheet(page)).toBeVisible();
  // A keyboard that never reports itself down may not swallow the tap.
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { __kb: number }).__kb = 320; });
  await openPicker(page);
  await expect(sheet(page)).toBeVisible({ timeout: 2000 });
});

test('arrows pressed faster than one animation turn one month each', async ({ page }) => {
  // The press that lands mid-glide used to count from the page the glide was
  // passing, not from where it was bound: two quick presses turned three
  // months. (Nothing caught it while the title waited for the settle, since
  // waiting for the title meant waiting for the animation too.)
  await boot(page, { timestampLocale: 'fa', timestampCalendar: 'persian', weekStart: 6 });
  await openPicker(page);
  await settled(page);
  const picker = sheet(page);
  const title = picker.locator('.timestamp-picker-month');
  const start = await currentPage(page);

  // Two presses in the same breath, before a single frame has been drawn.
  await page.evaluate(() => {
    const arrow = document.querySelector<HTMLElement>('[data-stamp-step="1"]')!;
    arrow.click();
    arrow.click();
  });
  const promised = (await title.textContent())!.trim(); // named before it arrives
  await settled(page);
  expect(Math.abs(await currentPage(page) - start)).toBe(2);
  await expect(title).toHaveText(promised); // and the glide landed where the title said

  // And a press that changes its mind while the glide is still running: the
  // month back from the one being glided to is the one you started on. The
  // press used to count from the page the glide was passing instead of from
  // where it was bound, and landed a month too far.
  const here = await currentPage(page);
  const name = (await title.textContent())!.trim();
  await picker.locator('[data-stamp-step="1"]').click();
  await page.waitForTimeout(60); // mid-glide
  await picker.locator('[data-stamp-step="-1"]').click();
  await expect(title).toHaveText(name); // straight back to where it began
  await settled(page);
  expect(await currentPage(page)).toBe(here);
  await expect(title).toHaveText(name);
});
