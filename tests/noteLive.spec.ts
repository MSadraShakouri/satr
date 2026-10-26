import { test, expect, type Page } from '@playwright/test';

/** A live block: code a note brought, running in a frame that can draw and
 *  cannot reach anything. The two halves are tested apart — that it really
 *  runs, and that it really cannot touch the app or the notes. */

declare global {
  interface Window {
    __printedHtml?: string;
  }
}

const DRAWS = '```live\n'
  + '<div id="box" style="height:0">drawn</div>\n'
  + '<script>document.getElementById("box").style.height = "137px";</script>\n'
  + '```\n';

// Every way out, counted: 1 for storage, 2 for the app's document, 4 for the
// top window. The frame says what it found by making itself that many pixels
// tall, since the height is the one thing it is allowed to say.
const BREAKS_OUT = '```live\n'
  + '<script>\n'
  + 'var blocked = 0;\n'
  + 'try { localStorage.setItem("satr:fs:file:Notes/live.md", "wiped"); } catch (e) { blocked += 1; }\n'
  + 'try { parent.document.body.setAttribute("data-taken", "yes"); } catch (e) { blocked += 2; }\n'
  + 'try { top.location.href = "about:blank"; } catch (e) { blocked += 4; }\n'
  + 'document.body.style.height = (100 + blocked) + "px";\n'
  + '</script>\n'
  + '```\n';

async function boot(page: Page, note: string): Promise<void> {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/live.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/live.md', text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/live.md' }], active: 0 }));
  }, note);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('live');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
}

test('a live block runs its code, and asks for the height it needs', async ({ page }) => {
  await boot(page, DRAWS);
  const frame = page.locator('#preview-pane iframe.md-live');
  await expect(frame).toHaveCount(1);
  // Sealed: scripts and nothing else. Same origin is what is missing, and
  // what being sealed means.
  expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
  // It started at the fence's height and ended at its content's, which it
  // could only reach by running.
  await expect.poll(async () => frame.evaluate((el) => Math.round(el.getBoundingClientRect().height)), { timeout: 4000 }).toBe(137);
});

test('a live block cannot reach the notes, the app, or the window', async ({ page }) => {
  await boot(page, BREAKS_OUT);
  const frame = page.locator('#preview-pane iframe.md-live');
  await expect.poll(async () => frame.evaluate((el) => Math.round(el.getBoundingClientRect().height)), { timeout: 4000 }).toBe(107);
  // And the app is where it was: the note unharmed, the page untouched, the
  // editor still open on it.
  expect(await page.evaluate(() => localStorage.getItem('satr:fs:file:Notes/live.md'))).toContain('```live');
  expect(await page.evaluate(() => document.body.getAttribute('data-taken'))).toBeNull();
  await expect(page.locator('#app .cm-file-name')).toHaveText('live');
});

test('a live block is carried into the export at the height it asked for', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => { window.parent.__printedHtml = document.documentElement.outerHTML; };
  });
  await page.goto('/');
  const printed = await page.evaluate(async (markdown) => {
    const { exportPdf } = await window.__satr.load('/src/exportPdf.ts');
    await exportPdf('Live', markdown);
    return window.__printedHtml;
  }, '```live height=320\n<p>printed</p>\n```\n');
  expect(printed, 'export must reach the print dialog').toBeTruthy();
  await page.setContent(printed!);
  const frame = page.locator('iframe.md-live');
  await expect(frame).toHaveCount(1);
  expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(await frame.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(320);
});
