import { expect, test, type Page } from '@playwright/test';

// Three defaults and one shape, each of which is only correct if it holds for
// a reader who never opened Settings:
//
//   * line numbers are OFF on a fresh install, and a stored choice still wins
//     (src/settings.ts, DEFAULTS) — Obsidian's showLineNumber: false;
//   * the calendar's first column is a SETTING, Saturday by default, and never
//     the device's own locale (src/settings.ts + src/datePicker.ts);
//   * the selection is square, like Obsidian's, so a run of rows joins instead
//     of scalloping (src/style.css, .cm-satr-selection).

const NOTE = 'First line.\nSecond line.\n\nThird line.\n';

async function boot(page: Page, settings?: Record<string, unknown>): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  // Everything the page needs is passed as an ARGUMENT: an init script is
  // serialised and runs in the page, so it cannot see this file's constants.
  await page.addInitScript(({ stored, note }) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', note);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    if (stored) localStorage.setItem('satr:settings', JSON.stringify(stored));
  }, { stored: settings, note: NOTE });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
}

test('a fresh install has no line-number gutter', async ({ page }) => {
  await boot(page);
  await expect(page.locator('body')).toHaveClass(/no-line-numbers/);
  const gutter = page.locator('.cm-gutters');
  expect(await gutter.count()).toBe(0);
});

test('a reader who turned line numbers on keeps them', async ({ page }) => {
  await boot(page, { version: 5, lineNumbers: true });
  await expect(page.locator('body')).not.toHaveClass(/no-line-numbers/);
  await expect(page.locator('.cm-gutters')).toBeVisible();
});

test('the settings default is off, and a saved value is not rewritten', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { loadSettings, saveSettings } = await window.__satr.load('/src/settings.ts');
    const fresh = loadSettings().lineNumbers;
    const changed = loadSettings();
    changed.lineNumbers = true;
    saveSettings(changed);
    return { fresh, afterSave: loadSettings().lineNumbers };
  });
  expect(result.fresh).toBe(false);
  expect(result.afterSave).toBe(true);
});

test('the week starts on Saturday by default, and every day is choosable', async ({ page }) => {
  await boot(page);
  const rows = await page.evaluate(async () => {
    const { createTimestampPicker } = await window.__satr.load('/src/datePicker.ts');
    const { loadSettings, saveSettings } = await window.__satr.load('/src/settings.ts');
    const read = (): string[] => [...document.querySelectorAll(
      '.timestamp-picker-page.is-current .timestamp-picker-weekdays span')].map((span) => span.textContent ?? '');
    const out: Record<string, string[]> = {};
    // The default first (no stored value at all), then two deliberate choices.
    for (const [name, start] of [['default', null], ['monday', 1], ['sunday', 0]] as const) {
      if (start !== null) {
        const s = loadSettings();
        s.weekStart = start;
        saveSettings(s);
      }
      const picker = createTimestampPicker();
      picker.open({ onInsert() {} });
      await new Promise((resolve) => setTimeout(resolve, 50));
      out[name] = read();
      picker.close();
      await new Promise((resolve) => setTimeout(resolve, 260)); // the sheet leaves the DOM
    }
    return out;
  });
  expect(rows.default).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  expect(rows.monday).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  expect(rows.sunday).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
});

test('the week start ignores the device locale', async ({ page }) => {
  // A device whose own week begins on Monday (en-GB reports firstDay: 1).
  // The row must still begin on Saturday, because nothing reads weekInfo.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((note) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', note);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    Object.defineProperty(Intl.Locale.prototype, 'weekInfo', { get: () => ({ firstDay: 1 }) });
  }, NOTE);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  const first = await page.evaluate(async () => {
    const { createTimestampPicker } = await window.__satr.load('/src/datePicker.ts');
    const picker = createTimestampPicker();
    picker.open({ onInsert() {} });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const text = document.querySelector('.timestamp-picker-page.is-current .timestamp-picker-weekdays span')?.textContent;
    picker.close();
    return text;
  });
  expect(first).toBe('Sat');
});

test('the selection is square everywhere it is painted', async ({ page }) => {
  await boot(page);
  await page.locator('.cm-line').nth(2).click();
  await page.keyboard.press('Control+A');
  // The selection layer is a view plugin: it paints on the next update, not
  // inside the keypress, so wait for a rect rather than sampling at once.
  await expect(page.locator('.cm-satr-selection').first()).toBeVisible();
  const radii = await page.evaluate(() => {
    const marks = [...document.querySelectorAll('.cm-satr-selection')];
    return { count: marks.length, radii: [...new Set(marks.map((mark) => getComputedStyle(mark).borderRadius))] };
  });
  expect(radii.count).toBeGreaterThan(1);
  expect(radii.radii).toEqual(['0px']);
});
