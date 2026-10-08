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
