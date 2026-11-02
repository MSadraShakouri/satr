import { expect, test } from '@playwright/test';

// The cover painted by index.html is a picture of the last screen: full
// screen, top of everything, and `pointer-events: none` so touches go
// through to the real app underneath. That last part is what makes it
// dangerous. If it is still there when the app is up, every button still
// works and nothing on the screen ever changes again -- and because it is
// kept in localStorage and painted before any of the app's code loads, it
// comes back after a force stop and after the cache is cleared.
//
// So these are not tests about a nicety of the opening animation. They are
// tests that the app cannot be left wearing it.

const INDEX = { files: { 'Notes/A.md': 1 }, folders: ['Notes'] };

/** A copy of a screen, in the shape index.html reads. */
const picture = (page: { viewportSize: () => { width: number; height: number } | null }) => {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  return JSON.stringify({
    v: 1,
    w: size.width,
    h: size.height,
    root: '',
    style: '',
    body: '',
    html: '<div id="stale-copy">a picture of the last screen</div>',
    css: '',
    scroll: [],
  });
};

async function seed(page: import('@playwright/test').Page, extra?: () => void): Promise<void> {
  const snapshot = picture(page);
  await page.addInitScript(
    ([snap, body]: [string, string]) => {
      if (localStorage.getItem('satr:test:seeded')) return;
      localStorage.setItem('satr:test:seeded', '1');
      localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
      localStorage.setItem('satr:fs:file:Notes/A.md', 'hello');
      localStorage.setItem('satr:tabs', JSON.stringify([{ path: 'Notes/A.md' }]));
      localStorage.setItem('satr:snapshot', snap);
      if (body) new Function(body)();
    },
    [snapshot, extra ? `(${extra.toString()})()` : ''] as [string, string],
  );
}

test('the cover comes off even when the frames it waits for never arrive', async ({ page }) => {
  // The real failure, reproduced at its root. On the device this call is
  // made while the system splash is still over the view, and a view that is
  // not being painted does not run frame callbacks. The app was asking for
  // the cover to be lifted on one, having already told index.html's
  // watchdog to stand down -- so the picture stayed, for good.
  await seed(page, () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
  });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A', { timeout: 15000 });
  await expect(page.locator('#boot-snapshot')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('#boot-snapshot-css')).toHaveCount(0);
});

test('a touch takes the cover off, whatever else is going on', async ({ page }) => {
  // The reader's own escape hatch, and it needs no diagnosis from them: if
  // the screen is not responding to what they do, touching it uncovers the
  // app. Uncovering a half-painted app is a bad second; a picture that
  // never goes is the end of the app.
  await seed(page, () => {
    window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
    // and the app never finishes starting either
    localStorage.setItem('satr:boot:wedge', '1');
  });
  await page.addInitScript(() => {
    if (localStorage.getItem('satr:boot:wedge')) {
      Object.defineProperty(window, '__satrBooted', { value: false, writable: false });
    }
  });
  await page.goto('/');
  await expect(page.locator('#boot-snapshot')).toHaveCount(1);
  await page.mouse.click(5, 5);
  await expect(page.locator('#boot-snapshot')).toHaveCount(0, { timeout: 5000 });
});

test('a document is never kept as a picture', async ({ page }) => {
  // A page is a canvas, and a canvas copies as an empty box, so the picture
  // would be a blank page frame. It is also the most expensive screen in
  // the app to copy, saved at the moment the app leaves the foreground --
  // which is the moment the system is short of memory and choosing what to
  // kill. Three documents open is where this started.
  await seed(page);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A', { timeout: 15000 });
  await page.evaluate(() => {
    const app = document.querySelector('#app');
    const doc = document.createElement('div');
    doc.className = 'pdf-doc';
    app?.appendChild(doc);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(await page.evaluate(() => localStorage.getItem('satr:snapshot'))).toBeNull();
});

test('a reset clears the picture too, so the next start cannot wear it', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A', { timeout: 15000 });
  await page.evaluate(async () => {
    const module = await window.__satr.load('/src/safeStart.ts');
    module.clearSession();
  });
  expect(await page.evaluate(() => localStorage.getItem('satr:snapshot'))).toBeNull();
  // and the vault is untouched by it
  expect(await page.evaluate(() => localStorage.getItem('satr:fs:index'))).toContain('Notes/A.md');
});

test.use({ viewport: { width: 390, height: 700 } });

test('the picture is only ever a picture: it never swallows a touch', async ({ page }) => {
  await seed(page, () => {
    window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
  });
  await page.goto('/');
  const through = await page.evaluate(() => {
    const cover = document.getElementById('boot-snapshot');
    if (!cover) return 'no cover';
    const style = getComputedStyle(cover);
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return `${style.pointerEvents}|${cover.contains(hit) ? 'swallowed' : 'through'}`;
  });
  expect(through).toBe('none|through');
});
