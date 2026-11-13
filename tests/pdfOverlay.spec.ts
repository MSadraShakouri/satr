import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
async function boot(page: Page): Promise<void> {
  await page.addInitScript((pdf) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/B.md': 1, 'Notes/book.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# First\n\nFirst note\n');
    localStorage.setItem('satr:fs:file:Notes/B.md', '# Second\n\nSecond note\n');
    localStorage.setItem('satr:fs:file:Notes/book.pdf', pdf);
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }, { path: 'Notes/book.pdf' }], active: 2 }));
  }, tinyPdf(4, [], ['One', 'Two', 'Three', 'Four']));
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
}
async function pin(page: Page): Promise<void> {
  await page.locator('#file-actions').click();
  await page.getByRole('menuitem', { name: 'Keep PDF on screen' }).click();
  await expect(page.locator('.pinned-pdf .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.menu-backdrop')).toHaveCount(0);
}
async function switchTo(page: Page, name: string): Promise<void> {
  await page.locator('#nav-tabs').click();
  await page.locator('.mobile-tab-title').getByText(name, { exact: true }).click();
}

test('PDF stays above switching notes and resizing never moves their layout', async ({ page }) => {
  await boot(page); await pin(page);
  const overlay = page.locator('.pinned-pdf');
  await expect(page.locator('.cm-file-name')).toHaveText('A');
  const noteTop = await page.locator('#editor-pane').evaluate(e => e.getBoundingClientRect().top);
  await expect(page.locator('.menu-backdrop')).toHaveCount(0);
  const grip = page.locator('.pinned-grip'); const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, 0, { steps: 5 }); await page.mouse.up();
  expect(await overlay.evaluate(e => e.getBoundingClientRect().height)).toBe(120);
  expect(await page.locator('#editor-pane').evaluate(e => e.getBoundingClientRect().top)).toBe(noteTop);
  await expect(page.locator('.topbar-title')).toBeHidden();
  await switchTo(page, 'B');
  await expect(page.locator('.cm-file-name')).toHaveText('B');
  await expect(overlay.locator('.pdf-page canvas').first()).toBeVisible();
  await expect(page.locator('.pinned-pdf-bar')).toHaveCSS('height', '32px');
  await page.locator('.pinned-hide').click();
  await expect(overlay).toHaveCount(0);
  await page.locator('#nav-tabs').click();
  await expect(page.locator('.mobile-tab-title').getByText('book.pdf', { exact: true })).toBeVisible();
});

test('navigation works and opening normally keeps the PDF tab', async ({ page }) => {
  await boot(page); await pin(page);
  await page.locator('.pinned-page').click();
  await page.getByLabel('Page number').fill('3');
  await page.locator('.pinned-page-form button').click();
  await expect(page.locator('.pinned-page')).toHaveText('3 / 4', { timeout: 10000 });
  await page.locator('.pinned-browse').click();
  await expect(page.locator('.pinned-thumbnails button')).toHaveCount(4);
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await expect(page.locator('.pinned-contents')).toContainText('Two', { timeout: 15000 });
  await page.locator('.pinned-contents button').getByText('Two', { exact: true }).click();
  await expect(page.locator('.pinned-page')).toHaveText('2 / 4', { timeout: 10000 });
  await page.locator('.pinned-normal').click();
  await expect(page.locator('.pinned-pdf')).toHaveCount(0);
  await expect(page.locator('#preview-pane .pdf-page')).toHaveCount(4, { timeout: 15000 });
  await expect(page.locator('.pdf-page-input')).toHaveValue('2', { timeout: 15000 });
});

test('PDF scrolling is independent and a hidden PDF returns at its place', async ({ page }) => {
  await boot(page); await pin(page);
  const pdf = page.locator('.pinned-pdf-scroller');
  const note = page.locator('.cm-scroller');
  const before = await note.evaluate(e => e.scrollTop);
  const box = (await pdf.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => pdf.evaluate(e => e.scrollTop)).toBeGreaterThan(100);
  expect(await note.evaluate(e => e.scrollTop)).toBe(before);
  await page.locator('.pinned-page').click();
  await page.getByLabel('Page number').fill('3');
  await page.locator('.pinned-page-form button').click();
  await expect(page.locator('.pinned-page')).toHaveText('3 / 4');
  await page.locator('.pinned-hide').click();
  await switchTo(page, 'book.pdf');
  await expect(page.locator('.pdf-page-input')).toHaveValue('3', { timeout: 15000 });
});

test('closing the PDF tab disposes the overlay but leaves the note open', async ({ page }) => {
  await boot(page); await pin(page);
  await page.locator('#nav-tabs').click();
  const card = page.locator('.mobile-tab').filter({ has: page.locator('.mobile-tab-title').getByText('book.pdf', { exact: true }) });
  await card.getByRole('button', { name: 'Close tab' }).click();
  await expect(page.locator('.pinned-pdf')).toHaveCount(0);
  await expect(page.locator('.mobile-tab-title').getByText('book.pdf', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.cm-file-name')).toHaveText('A');
});

test('a drawer and the tab switcher are above the PDF', async ({ page }) => {
  await boot(page); await pin(page);
  await page.locator('#files').click();
  await expect(page.locator('body')).toHaveClass(/files-open/);
  await expect(page.locator('#file-panel')).toBeVisible();
  await page.locator('#backdrop').click({ position: { x: 380, y: 500 }, force: true });
  await expect(page.locator('body')).not.toHaveClass(/files-open/);
  await page.locator('#nav-tabs').click();
  await expect(page.locator('.mobile-tab-switcher')).toBeVisible();
  await expect(page.locator('.mobile-tab-title').getByText('B', { exact: true })).toBeVisible();
});

test('opening the overlay keeps the current PDF page and note edits survive tab switches', async ({ page }) => {
  await boot(page);
  const pageBox = page.locator('.pdf-page-input');
  await pageBox.fill('3'); await pageBox.press('Enter');
  await expect(pageBox).toHaveValue('3');
  await pin(page);
  await expect(page.locator('.pinned-page')).toHaveText('3 / 4', { timeout: 10000 });
  await page.locator('.cm-content').click();
  await page.keyboard.press('End'); await page.keyboard.type(' edited');
  await switchTo(page, 'B'); await switchTo(page, 'A');
  await expect(page.locator('.cm-content')).toContainText('edited');
  await expect(page.locator('.pinned-page')).toHaveText('3 / 4');
});

test('the keyboard class does not move or resize the PDF edge', async ({ page }) => {
  await boot(page); await pin(page);
  const edge = () => page.locator('.pinned-pdf-bar').evaluate(el => {
    const box = el.getBoundingClientRect(); return { top: box.top, bottom: box.bottom };
  });
  const before = await edge();
  await page.evaluate(() => document.body.classList.add('keyboard-open'));
  expect(await edge(), 'keyboard opening must not move the PDF edge').toEqual(before);
  await page.evaluate(() => document.body.classList.remove('keyboard-open'));
  expect(await edge(), 'keyboard closing must not move the PDF edge').toEqual(before);
});

test('the PDF edge can still be resized by hand while the keyboard is open', async ({ page }) => {
  await boot(page); await pin(page);
  await page.locator('.cm-content').focus();
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(page.locator('body')).toHaveClass(/keyboard-open/);
  const overlay = page.locator('.pinned-pdf');
  const before = await overlay.evaluate(el => el.getBoundingClientRect().height);
  const grip = (await page.locator('.pinned-grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 70, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('body')).toHaveClass(/keyboard-open/);
  expect(await overlay.evaluate(el => el.getBoundingClientRect().height), 'a deliberate drag still resizes the PDF').toBeGreaterThan(before + 40);
});

test('the existing card marks which PDF is on screen', async ({ page }) => {
  await boot(page); await pin(page);
  await page.locator('#nav-tabs').click();
  const card = page.locator('.mobile-tab').filter({ has: page.locator('.mobile-tab-title').getByText('book.pdf', { exact: true }) });
  await expect(card.locator('.mobile-tab-pinned')).toHaveText('On screen');
});

test('the PDF still accepts pinch zoom in its own scroller', async ({ page }) => {
  await boot(page); await pin(page);
  const pane = page.locator('.pinned-pdf-scroller');
  const first = page.locator('.pinned-pdf .pdf-page[data-page="1"]');
  const before = (await first.boundingBox())!.width;
  const fingers = async (kind: string, spread: number): Promise<void> => {
    await pane.evaluate((el, [type, apart]) => {
      const b = el.getBoundingClientRect();
      for (const [id, side] of [[1, -1], [2, 1]]) el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 + side * apart }));
    }, [kind, spread] as [string, number]);
  };
  await fingers('pointerdown', 40); await fingers('pointermove', 90); await fingers('pointerup', 90);
  await expect.poll(async () => (await first.boundingBox())!.width, { timeout: 4000 }).toBeGreaterThan(before * 1.5);
});

test('the files button remains usable when the note hides its navigation', async ({ page }) => {
  await boot(page); await pin(page);
  await page.evaluate(() => document.body.classList.add('is-hidden-nav'));
  await expect(page.locator('#files')).toBeVisible();
  await page.locator('#files').click();
  await expect(page.locator('body')).toHaveClass(/files-open/);
});

test('the note reading view keeps the same minimum top when the PDF is resized', async ({ page }) => {
  await boot(page); await pin(page);
  await page.locator('#preview-toggle').evaluate((e: HTMLButtonElement) => e.click());
  await expect(page.locator('#preview')).toContainText('First note');
  const top = await page.locator('#preview-pane').evaluate(e => e.getBoundingClientRect().top);
  const grip = (await page.locator('.pinned-grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, 0, { steps: 5 }); await page.mouse.up();
  expect(await page.locator('#preview-pane').evaluate(e => e.getBoundingClientRect().top)).toBe(top);
  const overlay = (await page.locator('.pinned-pdf').boundingBox())!;
  const title = (await page.locator('#preview .inline-title').boundingBox())!;
  expect(title.y).toBeGreaterThanOrEqual(overlay.y + overlay.height - 1);
});

test('a recently closed note is reopened under the PDF', async ({ page }) => {
  const pdf = tinyPdf(2);
  await page.addInitScript((data) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/closed.md': 1, 'Notes/book.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/closed.md', '# Reopened\n');
    localStorage.setItem('satr:fs:file:Notes/book.pdf', data);
    localStorage.setItem('satr:recent', JSON.stringify(['Notes/closed.md']));
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/book.pdf' }], active: 0 }));
  }, pdf);
  await page.goto('/'); await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await pin(page);
  await expect(page.locator('.cm-file-name')).toHaveText('closed');
});

test('a height-only viewport change never moves the PDF edge, even without editor focus', async ({ page }) => {
  await boot(page); await pin(page);
  const grip = (await page.locator('.pinned-grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, 500, { steps: 5 }); await page.mouse.up();
  const edge = () => page.locator('.pinned-pdf-bar').evaluate(el => {
    const box = el.getBoundingClientRect(); return { top: box.top, bottom: box.bottom };
  });
  const before = await edge();
  await page.setViewportSize({ width: 390, height: 450 });
  await page.waitForTimeout(200); // let the resize event and its layout settle
  await expect(page.locator('body')).not.toHaveClass(/keyboard-open/);
  expect(await edge(), 'a height-only viewport resize must not move the edge').toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  expect(await edge(), 'restoring the viewport must not move the edge').toEqual(before);
});

test('keyboard-like viewport resizing never moves the PDF edge', async ({ page }) => {
  await boot(page); await pin(page);
  const overlay = page.locator('.pinned-pdf');
  const grip = (await page.locator('.pinned-grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, 500, { steps: 5 }); await page.mouse.up();
  const edge = () => page.locator('.pinned-pdf-bar').evaluate(el => {
    const box = el.getBoundingClientRect(); return { top: box.top, bottom: box.bottom };
  });
  const before = await edge();
  expect(await overlay.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(400);
  await page.locator('.cm-content').focus();
  for (let i = 0; i < 2; i++) {
    await page.setViewportSize({ width: 390, height: 450 });
    await expect(page.locator('body')).toHaveClass(/keyboard-open/);
    await page.waitForTimeout(200); // native WebView resize can arrive after the keyboard signal
    expect(await edge(), 'the keyboard opening must not move the edge').toEqual(before);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('body')).not.toHaveClass(/keyboard-open/);
    expect(await edge(), 'the keyboard closing must not move the edge').toEqual(before);
  }
});

test('when no note is known, pinning says to open one rather than losing the PDF', async ({ page }) => {
  await page.addInitScript((data) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/book.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/book.pdf', data);
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/book.pdf' }], active: 0 }));
  }, tinyPdf(2));
  await page.goto('/'); await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 15000 });
  await page.locator('#file-actions').click(); await page.getByRole('menuitem', { name: 'Keep PDF on screen' }).click();
  await expect(page.getByText('Open a note in another tab first.')).toBeVisible();
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible();
  await expect(page.locator('.pinned-pdf')).toHaveCount(0);
});

test('closing other tabs also closes the pinned PDF', async ({ page }) => {
  await boot(page); await pin(page);
  await page.locator('#nav-tabs').click();
  await page.getByRole('button', { name: '3 tabs' }).click();
  await page.getByRole('menuitem', { name: 'Close other tabs' }).click();
  await expect(page.locator('.pinned-pdf')).toHaveCount(0);
  await expect(page.locator('.mobile-tab-title').getByText('book.pdf', { exact: true })).toHaveCount(0);
});

for (const kind of ['file', 'folder'] as const) {
  test(`deleting the pinned PDF's ${kind} closes it without recreating its card`, async ({ page }) => {
    await page.addInitScript((data) => {
      localStorage.setItem('satr:demoShown', '1');
      localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/Private/book.pdf': 1, 'Notes/note.md': 1 }, folders: ['Notes', 'Notes/Private'] }));
      localStorage.setItem('satr:fs:file:Notes/Private/book.pdf', data); localStorage.setItem('satr:fs:file:Notes/note.md', 'note');
      localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/Private/book.pdf' }, { path: 'Notes/note.md' }], active: 0 }));
      localStorage.setItem('satr:expanded:notes', JSON.stringify(['Notes', 'Notes/Private']));
      localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    }, tinyPdf(3));
    await page.goto('/'); await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 20000 }); await pin(page);
    await page.locator('#files').click();
    await page.locator(`#file-panel .tree-item-self[data-path="${kind === 'file' ? 'Notes/Private/book.pdf' : 'Notes/Private'}"]`).click({ button: 'right' });
    await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Delete' }).click();
    await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Delete' }).last().click();
    await expect(page.locator('.pinned-pdf')).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => window.__satr.load('/src/vault.ts').backend.stat('Notes/Private/book.pdf'))).toBeNull();
    await page.waitForTimeout(1000);
    expect(await page.evaluate(async () => window.__satr.load('/src/pdfCard.ts').recallCard('Notes/Private/book.pdf'))).toBeNull();
  });
}

test('renaming the pinned PDF folder follows its tab and files only under the new path', async ({ page }) => {
  await page.addInitScript((data) => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/Private/book.pdf': 1, 'Notes/note.md': 1 }, folders: ['Notes', 'Notes/Private'] }));
    localStorage.setItem('satr:fs:file:Notes/Private/book.pdf', data); localStorage.setItem('satr:fs:file:Notes/note.md', 'note');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/Private/book.pdf' }, { path: 'Notes/note.md' }], active: 0 }));
    localStorage.setItem('satr:expanded:notes', JSON.stringify(['Notes', 'Notes/Private']));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, tinyPdf(3));
  await page.goto('/'); await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 20000 }); await pin(page);
  await page.locator('#files').click();
  await page.locator('#file-panel .tree-item-self[data-path="Notes/Private"]').click({ button: 'right' });
  await page.locator('.menu.mod-bottom-sheet .menu-item', { hasText: 'Rename' }).click();
  const editable = page.locator('#file-panel .is-being-renamed [contenteditable]'); await editable.fill('Renamed'); await editable.press('Enter');
  await expect.poll(() => page.evaluate(async () => window.__satr.load('/src/vault.ts').backend.stat('Notes/Renamed/book.pdf'))).not.toBeNull();
  await expect(page.locator('.pinned-pdf')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#nav-tabs').evaluate((e: HTMLButtonElement) => e.click());
  await expect.poll(() => page.evaluate(async () => (await window.__satr.load('/src/pdfCard.ts').recallCard('Notes/Renamed/book.pdf'))?.pages ?? null), { timeout: 10000 }).toBe(3);
  expect(await page.evaluate(async () => window.__satr.load('/src/pdfCard.ts').recallCard('Notes/Private/book.pdf'))).toBeNull();
});

test('the pinned PDF card expands the overlay without changing the note, and the grip restores it', async ({ page }) => {
  await boot(page); await pin(page);
  const overlay = page.locator('.pinned-pdf');
  const original = await overlay.evaluate(e => e.getBoundingClientRect().height);
  await page.locator('#nav-tabs').click();
  await page.locator('.mobile-tab-title').getByText('book.pdf', { exact: true }).click();
  await expect(page.locator('.cm-file-name')).toHaveText('A');
  expect(await overlay.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThan(original);
  await page.locator('.pinned-grip').click();
  expect(await overlay.evaluate(e => e.getBoundingClientRect().height)).toBe(original);
});

test('PDF navigation remains inside the screen when the overlay is expanded', async ({ page }) => {
  await boot(page); await pin(page);
  await page.locator('.pinned-grip').click();
  await page.locator('.pinned-browse').click();
  const panel = (await page.locator('.pinned-pdf-popup').boundingBox())!;
  const shell = (await page.locator('.app-shell').boundingBox())!;
  expect(panel.y).toBeGreaterThanOrEqual(shell.y);
  expect(panel.y + panel.height).toBeLessThanOrEqual(shell.y + shell.height);
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await expect(page.locator('.pinned-contents')).toContainText('Two', { timeout: 15000 });
});

test('a late random-source failure retries the pinned PDF from complete bytes', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class WatchedWorker extends NativeWorker {
      postMessage(message: any, transfer?: any): void {
        if (message?.type === 'Start') (window as any).__overlayPdfWorker = this;
        if (transfer) super.postMessage(message, transfer); else super.postMessage(message);
      }
    }
    window.Worker = WatchedWorker as typeof Worker;
    localStorage.setItem('satr:demoShown', '1');
  });
  await page.goto('/'); await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.evaluate(async (url) => {
    const { backend } = window.__satr.load('/src/vault.ts');
    const raw = atob(url.split(',')[1]);
    const xref = /startxref\n(\d+)\n%%EOF/.exec(raw)![1];
    const original = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const blob = new Blob([original, '\n%', new Uint8Array(17 * 1024 * 1024).fill(120), `\nstartxref\n${xref}\n%%EOF\n`]);
    await backend.writeBytes('Notes/failure-retry.pdf', blob);
    await backend.write('Notes/overlay-note.md', '# Note\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/overlay-note.md' }, { path: 'Notes/failure-retry.pdf' }], active: 1 }));
  }, tinyPdf(3));
  await page.reload(); await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await expect(page.locator('#preview-pane .pdf-page canvas').first()).toBeVisible({ timeout: 30000 });
  await pin(page);
  await page.locator('.pinned-page').click(); await page.getByLabel('Page number').fill('2'); await page.locator('.pinned-page-form button').click();
  await expect(page.locator('.pinned-page')).toHaveText('2 / 3');
  await page.evaluate(() => {
    const worker = (window as any).__overlayPdfWorker;
    if (!worker) throw new Error('PDF worker was not captured');
    worker.dispatchEvent(new MessageEvent('message', { data: { type: 'satr-pdf-read-failed', documentId: 'satr-2' } }));
  });
  await expect.poll(() => page.evaluate(() => (window.__satr.load('/src/log.ts').lines() as any[]).filter((line) => line.text === 'document parsed').length), { timeout: 30000 }).toBe(3);
  await expect(page.locator('.pinned-pdf .pdf-page canvas').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.pinned-page')).toHaveText('2 / 3', { timeout: 15000 });
});

test('back closes PDF navigation without hiding the PDF', async ({ page }) => {
  await boot(page); await pin(page);
  await page.locator('.pinned-browse').click();
  await expect(page.locator('.pinned-pdf-popup')).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('satr:back')));
  await expect(page.locator('.pinned-pdf-popup')).toBeHidden();
  await expect(page.locator('.pinned-pdf')).toBeVisible();
});

test('a changed viewport width still keeps the PDF within the resized screen', async ({ page }) => {
  await boot(page); await pin(page);
  const overlay = page.locator('.pinned-pdf');
  const grip = (await page.locator('.pinned-grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, 500, { steps: 5 }); await page.mouse.up();
  const original = await overlay.evaluate(el => el.getBoundingClientRect().height);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => overlay.evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(220);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => overlay.evaluate(el => el.getBoundingClientRect().height)).toBe(original);
});
