import { expect, test, type Page } from '@playwright/test';

// Discord-style timestamps: <t:UNIX> / <t:UNIX:F> show the time they name, in
// the reading view and in the editor (where the code comes back while the
// cursor is on it). Formulas and code spans are never timestamps.

const NOTE = 'Due <t:1700000000:F> and the rest.\n\nAgo: <t:1700000000:R>\n\n`<t:1700000000:R>` stays code.\n';

async function boot(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((note) => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', note);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, NOTE);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
}

test('the formats: each one says what Discord says it does', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const { formatTimestamp } = await window.__satr.load('/src/timestamps.ts');
    const base = 1700000000;
    return {
      relativePast: formatTimestamp(base, 'R', (base + 3 * 3600) * 1000),
      relativeFuture: formatTimestamp(base + 2 * 86400, 'R', base * 1000),
      relativeSeconds: formatTimestamp(base + 30, 'R', base * 1000),
      short: formatTimestamp(base, 't', base * 1000),
      long: formatTimestamp(base, 'T', base * 1000),
      date: formatTimestamp(base, 'd', base * 1000),
      dateLong: formatTimestamp(base, 'D', base * 1000),
      full: formatTimestamp(base, 'f', base * 1000),
      fullWithDay: formatTimestamp(base, 'F', base * 1000),
    };
  });
  // The clock is fixed, so the relative ones are exact.
  expect(out.relativePast).toBe('3 hours ago');
  expect(out.relativeFuture).toBe('in 2 days');
  expect(out.relativeSeconds).toBe('in 30 seconds');
  // The absolute ones depend on the device's zone and language, so they are
  // checked against each other: longer formats carry more of the same date.
  expect(out.long.length).toBeGreaterThan(out.short.length);
  expect(out.dateLong.length).toBeGreaterThan(out.date.length);
  expect(out.full).toContain(out.dateLong.split(' ')[0]); // the day
  expect(out.fullWithDay.length).toBeGreaterThan(out.full.length);
});

test('the reading view shows the time for a timestamp, and leaves code alone', async ({ page }) => {
  await boot(page);
  const html = await page.evaluate(async (note) => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    return renderMarkdown(note);
  }, NOTE);
  expect(html).toContain('class="discord-timestamp"');
  expect(html.match(/class="discord-timestamp"/g)?.length).toBe(2); // the code span is not one
  expect(html).toContain('data-format="F"');
  expect(html).toMatch(/<code[^>]*>&lt;t:1700000000:R&gt;<\/code>/);
});

test('in the editor the time shows, and the code comes back when the cursor is on it', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#app .cm-lp-timestamp')).toHaveCount(2);
  const first = await page.locator('#app .cm-lp-timestamp').first().textContent();
  expect(first?.length ?? 0).toBeGreaterThan(5);
  // Put the cursor on the first timestamp: its source is shown, the widget goes.
  await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('#app .cm-editor') as HTMLElement)!;
    const at = view.state.doc.toString().indexOf('<t:');
    view.dispatch({ selection: { anchor: at + 3 } });
    view.focus();
  });
  await expect(page.locator('#app .cm-lp-timestamp')).toHaveCount(1);
  await expect(page.locator('#app .cm-content')).toContainText('<t:1700000000:F>');
});

test('a relative timestamp counts down while it is on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    const soon = Math.floor(Date.now() / 1000) + 45;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', `Soon: <t:${soon}:R>\n`);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  });
  await page.goto('/');
  const widget = page.locator('#app .cm-lp-timestamp');
  await expect(widget).toHaveText(/^in (4[0-5]) seconds$/);
  const first = await widget.textContent();
  // A tick later the number has moved on (it is not frozen at load time).
  await expect.poll(() => widget.textContent(), { timeout: 5000 }).not.toBe(first);
});

// ---- Settings → Dates: whose words, which calendar ----

test.describe('the date style', () => {
  // The browser says Chinese here: the timestamps must not listen to it.
  test.use({ locale: 'zh-CN' });

  test('by default the words follow the app language, never the device', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async () => {
      const { formatTimestamp } = await window.__satr.load('/src/timestamps.ts');
      return formatTimestamp(1700000000, 'd');
    });
    // English order (M/D/Y), not Chinese (Y/M/D).
    expect(out).toBe('11/14/2023');
  });

  test('a chosen language re-words them, calendar and digits with it', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async () => {
      const { formatTimestamp, setTimestampStyle } = await window.__satr.load('/src/timestamps.ts');
      setTimestampStyle('fa', 'auto');
      return {
        date: formatTimestamp(1700000000, 'd'),
        long: formatTimestamp(1700000000, 'D'),
        relative: formatTimestamp(1700000000 + 3600, 'R', 1700000000 * 1000),
      };
    });
    // Persian defaults to its own Jalali calendar: 14 November 2023 is Aban 1402.
    expect(out.date).toContain('۱۴۰۲');
    expect(out.long).toMatch(/[۰-۹]+.*۱۴۰۲|۱۴۰۲/);
    expect(out.relative).toMatch(/[آ-ی]/); // Persian words, not "in 1 hour"
  });

  test('the calendar can be pinned regardless of the language', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async () => {
      const { formatTimestamp, setTimestampStyle } = await window.__satr.load('/src/timestamps.ts');
      setTimestampStyle('en', 'persian');
      return formatTimestamp(1700000000, 'd');
    });
    expect(out).toContain('1402'); // the Jalali year, in Latin digits
    expect(out).not.toContain('2023');
  });

  test('Persian can be pinned to the Gregorian calendar', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async () => {
      const { formatTimestamp, setTimestampStyle } = await window.__satr.load('/src/timestamps.ts');
      setTimestampStyle('fa', 'gregory');
      return formatTimestamp(1700000000, 'F');
    });
    expect(out).toContain('۲۰۲۳');
    expect(out).not.toContain('۱۴۰۲');
  });
});

test('Settings → Dates: the rows save and the sample answers at once', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { openSettings } = await window.__satr.load('/src/settings.ts');
    openSettings({ apply: () => {}, tools: () => [] });
  });
  await expect(page.locator('.settings-screen')).toBeVisible();
  await expect(page.getByLabel('Language')).toHaveValue('auto');
  await expect(page.getByLabel('Calendar')).toHaveValue('auto');
  await page.getByLabel('Language').selectOption('fa');
  await page.getByLabel('Calendar').selectOption('gregory');
  // The sample re-words at once: Persian words and digits, Gregorian year.
  await expect(page.locator('[data-timestamp-sample]')).toHaveText(/[آ-ی]+ [۰-۹]+ [آ-ی]+ ۲۰۲[۰-۹]/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('satr:settings') ?? '{}') as Record<string, unknown>);
  expect(saved.timestampLocale).toBe('fa');
  expect(saved.timestampCalendar).toBe('gregory');
});

test('chips in the editor and the reading view wear the chosen style', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((note) => {
    if (localStorage.getItem('satr:fs:file:Notes/A.md')) return;
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', note);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:settings', JSON.stringify({ version: 3, timestampLocale: 'fa', timestampCalendar: 'persian' }));
  }, NOTE);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await expect(page.locator('#app .cm-lp-timestamp').first()).toContainText('۱۴۰۲');
  await page.locator('#app #preview-toggle').click();
  await expect(page.locator('#app #preview time.discord-timestamp').first()).toContainText('۱۴۰۲');
});
