import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
async function boot(page: Page) {
  await page.addInitScript(pdf => {
    if (sessionStorage.getItem('overlay-seeded'))
      return;
    sessionStorage.setItem('overlay-seeded', 'yes');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/B.md': 1, 'Notes/book.pdf': 1, 'Notes/other.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# First\n');
    localStorage.setItem('satr:fs:file:Notes/B.md', '# Second\n');
    localStorage.setItem('satr:fs:file:Notes/book.pdf', pdf);
    localStorage.setItem('satr:fs:file:Notes/other.pdf', pdf);
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }, { path: 'Notes/book.pdf' }, { path: 'Notes/other.pdf' }], active: 2 }));
  }, tinyPdf(4));
  await page.goto('/');
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
}
async function pin(page: Page) {
  await page.locator('#file-actions').click();
  await page.getByRole('menuitem', { name: 'Keep PDF on screen' }).click();
  await expect(page.locator('.mobile-tab-switcher')).toBeVisible();
  await expect(page.locator('.pinned-pdf .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
}
async function choose(page: Page, name: string) { await page.locator('.mobile-tab-title').getByText(name, { exact: true }).click(); }
test('pin opens existing tab grid with PDF above it, and normal note preview is accessible', async ({ page }) => {
  await boot(page);
  await pin(page);
  await expect(page.locator('.mobile-tab-pinned')).toHaveText('On screen');
  await expect.poll(() => page.locator('.mobile-tab-switcher-scroll').evaluate(e => parseFloat(getComputedStyle(e).marginTop))).toBeGreaterThanOrEqual(120);
  await choose(page, 'A');
  await expect(page.locator('.cm-file-name')).toHaveText('A');
  await expect(page.locator('#preview-toggle')).toBeVisible();
  await page.locator('#preview-toggle').click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'edit');
});
test('PDF card opens normally and returns pinned above the note', async ({ page }) => {
  await boot(page);
  await pin(page);
  await choose(page, 'A');
  await page.locator('#nav-tabs').click();
  await choose(page, 'book.pdf');
  await expect(page.locator('.pinned-pdf')).toBeHidden();
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await page.locator('#nav-tabs').click();
  await expect(page.locator('.pinned-pdf')).toBeVisible();
  await choose(page, 'B');
  await expect(page.locator('.cm-file-name')).toHaveText('B');
  await expect(page.locator('.pinned-pdf')).toBeVisible();
});
test('new empty tab does not unpin and PDF grip tap does not resize', async ({ page }) => {
  await boot(page);
  await pin(page);
  const before = await page.locator('.pinned-pdf').evaluate(e => e.getBoundingClientRect().height);
  await page.locator('.pinned-grip').click();
  expect(await page.locator('.pinned-pdf').evaluate(e => e.getBoundingClientRect().height)).toBe(before);
  await page.locator('.mobile-tab-switcher').getByRole('button', { name: 'New tab', exact: true }).click();
  await expect(page.locator('#empty-tab')).toBeVisible();
  await expect(page.locator('.pinned-pdf')).toBeVisible();
});
test('pin is restored after reload at default height and can be unpinned', async ({ page }) => {
  await boot(page);
  await pin(page);
  await choose(page, 'A');
  await expect(page.locator('.cm-file-name')).toHaveText('A');
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
  await expect(page.locator('.pinned-pdf .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  const grip = (await page.locator('.pinned-grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, 480, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.locator('.pinned-pdf').evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThan(400);
  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('.pinned-pdf .pdf-page canvas').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.pinned-pdf')).toBeVisible();
  expect(await page.locator('.pinned-pdf').evaluate(e => e.getBoundingClientRect().height)).toBeCloseTo(844 * .34, 0);
  await page.locator('.pinned-hide').click();
  await expect(page.locator('.pinned-pdf')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.pinned-pdf')).toHaveCount(0);
});
test('a different PDF keeps its ordinary controls and replaces the pin through its menu', async ({ page }) => {
  await boot(page);
  await pin(page);
  await choose(page, 'other.pdf');
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.pinned-pdf')).toBeVisible();
  await expect(page.locator('#file-actions')).toBeVisible();
  await page.locator('#file-actions').click();
  await page.getByRole('menuitem', { name: 'Keep PDF on screen' }).click();
  await expect(page.locator('.mobile-tab-switcher')).toBeVisible();
  await expect(page.locator('.mobile-tab').filter({ has: page.getByText('other.pdf', { exact: true }) }).locator('.mobile-tab-pinned')).toHaveText('On screen');
  await expect(page.locator('.mobile-tab').filter({ has: page.getByText('book.pdf', { exact: true }) }).locator('.mobile-tab-pinned')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('satr:pinned-pdf'))).toBe('Notes/other.pdf');
});
test('navigation in the overlay while the tab grid is open carries back to the full screen PDF', async ({ page }) => {
  await boot(page);
  await pin(page);
  await page.locator('.pinned-page').click();
  await page.getByLabel('Page number').fill('3');
  await page.locator('.pinned-page-form button').click();
  await expect(page.locator('.pinned-page')).toHaveText('3 / 4');
  await page.locator('.mobile-tab-switcher').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.pinned-pdf')).toBeHidden();
  await expect(page.locator('.pdf-page-input')).toHaveValue('3', { timeout: 15000 });
  await page.locator('#nav-tabs').click();
  await choose(page, 'A');
  await expect(page.locator('.pinned-page')).toHaveText('3 / 4', { timeout: 15000 });
});
test('grid keeps a fixed minimum starting edge when the PDF is dragged', async ({ page }) => {
  await boot(page);
  await pin(page);
  const grid = page.locator('.mobile-tab-switcher-scroll');
  const before = await grid.evaluate(e => getComputedStyle(e).marginTop);
  const grip = (await page.locator('.pinned-grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, 480, { steps: 5 });
  await page.mouse.up();
  expect(await grid.evaluate(e => getComputedStyle(e).marginTop)).toBe(before);
});
test('a PDF can be pinned when it is the only tab, without choosing a note', async ({ page }) => {
  await page.addInitScript(pdf => { localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/book.pdf': 1 }, folders: ['Notes'] })); localStorage.setItem('satr:fs:file:Notes/book.pdf', pdf); localStorage.setItem('satr:demoShown', '1'); localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/book.pdf' }], active: 0 })); }, tinyPdf(2));
  await page.goto('/');
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await pin(page);
  await page.locator('.mobile-tab-switcher').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible();
  await page.locator('#nav-tabs').click();
  await expect(page.locator('.pinned-pdf')).toBeVisible();
});
test('overlay navigation in the grid survives immediately choosing a note', async ({ page }) => {
  await boot(page);
  await pin(page);
  await page.locator('.pinned-page').click();
  await page.getByLabel('Page number').fill('3');
  await page.locator('.pinned-page-form button').click();
  await expect(page.locator('.pinned-page')).toHaveText('3 / 4');
  await choose(page, 'A');
  await expect(page.locator('.cm-file-name')).toHaveText('A');
  await expect(page.locator('.pinned-page')).toHaveText('3 / 4', { timeout: 15000 });
});
test('tab arrows open the pinned PDF normally and bring the overlay back', async ({ page }) => {
  await boot(page);
  await pin(page);
  await choose(page, 'B');
  await expect(page.locator('.cm-file-name')).toHaveText('B');
  await page.getByRole('button', { name: 'Next tab' }).click();
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.pinned-pdf')).toBeHidden();
  await page.getByRole('button', { name: 'Previous tab' }).click();
  await expect(page.locator('.cm-file-name')).toHaveText('B');
  await expect(page.locator('.pinned-pdf')).toBeVisible();
});
test('the file drawer opens the pinned PDF normally, without unpinning', async ({ page }) => {
  await boot(page);
  await pin(page);
  await choose(page, 'A');
  await expect(page.locator('.cm-file-name')).toHaveText('A');
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
  await page.locator('#files').click();
  await page.locator('#file-panel .tree-item-self[data-path="Notes/book.pdf"]').click();
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.pinned-pdf')).toBeHidden();
  await page.locator('#nav-tabs').click();
  await choose(page, 'B');
  await expect(page.locator('.cm-file-name')).toHaveText('B');
  await expect(page.locator('.pinned-pdf')).toBeVisible();
});
test('restoring a pin while its own PDF is full-screen keeps it available in the grid', async ({ page }) => {
  await boot(page);
  await pin(page);
  await page.locator('.mobile-tab-switcher').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await page.locator('#nav-tabs').click();
  await expect(page.locator('.pinned-pdf .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await choose(page, 'A');
  await expect(page.locator('.cm-file-name')).toHaveText('A');
  await expect(page.locator('.pinned-pdf')).toBeVisible();
});
test('a manually resized overlay keeps its height when visiting its full-screen tab', async ({ page }) => {
  await boot(page);
  await pin(page);
  await choose(page, 'A');
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
  await expect(page.locator('.pinned-pdf .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  const grip = (await page.locator('.pinned-grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, 420, { steps: 5 });
  await page.mouse.up();
  const height = await page.locator('.pinned-pdf').evaluate(e => e.getBoundingClientRect().height);
  expect(height).toBeGreaterThan(350);
  await page.locator('#nav-tabs').click();
  await choose(page, 'book.pdf');
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await page.locator('#nav-tabs').click();
  await expect(page.locator('.pinned-pdf')).toBeVisible();
  await choose(page, 'B');
  await expect(page.locator('.cm-file-name')).toHaveText('B');
  await expect.poll(() => page.locator('.pinned-pdf').evaluate(e => e.getBoundingClientRect().height)).toBe(height);
});
test('zoom survives opening the pinned PDF normally and returning to a note', async ({ page }) => {
  await boot(page); await pin(page); await choose(page, 'A');
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(0);
  const pane = page.locator('.pinned-pdf-scroller');
  const overlayPage = page.locator('.pinned-pdf .pdf-page[data-page="1"]');
  const original = (await overlayPage.boundingBox())!.width;
  const fingers = async (type: string, spread: number) => {
    await pane.evaluate((el, [kind, apart]) => {
      const b = el.getBoundingClientRect();
      for (const [id, side] of [[1, -1], [2, 1]]) el.dispatchEvent(new PointerEvent(kind, { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 + side * apart }));
    }, [type, spread] as [string, number]);
  };
  await fingers('pointerdown', 40); await fingers('pointermove', 90); await fingers('pointerup', 90);
  await expect.poll(async () => (await overlayPage.boundingBox())!.width).toBeGreaterThan(original * 1.5);
  await page.locator('.pinned-normal').click();
  const fullPage = page.locator('#preview-pane .pdf-page[data-page="1"]');
  await expect(fullPage).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => (await fullPage.boundingBox())!.width).toBeGreaterThan(original * 1.5);
  await page.locator('#nav-tabs').click(); await choose(page, 'B');
  await expect(page.locator('.cm-file-name')).toHaveText('B');
  await expect.poll(async () => (await overlayPage.boundingBox())?.width ?? 0, { timeout: 15000 }).toBeGreaterThan(original * 1.5);
});
