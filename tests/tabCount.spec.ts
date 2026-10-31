import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

// The number of open tabs, drawn inside the square on the navbar pill.
// One figure had room to spare; two were wider than the square's inside and
// welded themselves to its frame; three spilled out past it altogether.

test.use({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 6 });

async function boot(page: Page, open: number): Promise<void> {
  await page.addInitScript((count) => {
    const files: Record<string, number> = {};
    const tabs: Array<{ path: string }> = [];
    for (let i = 1; i <= (count as number); i += 1) {
      files[`Notes/n${i}.md`] = 1;
      localStorage.setItem(`satr:fs:file:Notes/n${i}.md`, `# note ${i}\n\nbody\n`);
      tabs.push({ path: `Notes/n${i}.md` });
    }
    localStorage.setItem('satr:fs:index', JSON.stringify({ files, folders: ['Notes'] }));
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs, active: 0 }));
  }, open);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

const SHOT = 6; // pixels per CSS pixel in the shots below

/** Every dark shape in the shot, as boxes, biggest first. The square drawn
 *  around the count is one shape and each figure is another, so this
 *  separates the frame from what is inside it without assuming where
 *  either of them is. */
function shapes(ink: Uint8Array, w: number, h: number): Array<[number, number, number, number]> {
  const seen = new Uint8Array(w * h);
  const found: Array<[number, number, number, number]> = [];
  for (let at = 0; at < w * h; at += 1) {
    if (!ink[at] || seen[at]) continue;
    let top = Math.floor(at / w); let bottom = top; let left = at % w; let right = left;
    const queue = [at];
    seen[at] = 1;
    while (queue.length) {
      const here = queue.pop()!;
      const y = Math.floor(here / w); const x = here % w;
      if (y < top) top = y; if (y > bottom) bottom = y;
      if (x < left) left = x; if (x > right) right = x;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const ny = y + dy; const nx = x + dx;
          const next = ny * w + nx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w && ink[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
        }
      }
    }
    found.push([top, bottom, left, right]);
  }
  return found.sort((a, b) => (b[1] - b[0]) * (b[3] - b[2]) - (a[1] - a[0]) * (a[3] - a[2]));
}

/** How far the figures sit from the middle of the square they are drawn in,
 *  in CSS pixels, read off the screen rather than off the font's metrics —
 *  which is the whole point: every box the layout engine offers is a box
 *  about the font, and none of them is centred on the figures. */
async function offCentre(page: Page): Promise<{ x: number; y: number }> {
  const shot = await page.locator('#nav-tabs').screenshot();
  const { data, info } = await sharp(shot).greyscale().raw().toBuffer({ resolveWithObject: true });
  const ink = new Uint8Array(info.width * info.height);
  for (let i = 0; i < ink.length; i += 1) ink[i] = data[i * info.channels] < 128 ? 1 : 0;
  const all = shapes(ink, info.width, info.height);
  const [frameTop, frameBottom, frameLeft, frameRight] = all[0];
  const figures = all.slice(1).filter(([t, b]) => b - t > 3); // not a stray pixel
  expect(figures.length, 'the figures were found inside the square').toBeGreaterThan(0);
  const top = Math.min(...figures.map((f) => f[0]));
  const bottom = Math.max(...figures.map((f) => f[1]));
  const left = Math.min(...figures.map((f) => f[2]));
  const right = Math.max(...figures.map((f) => f[3]));
  return {
    x: ((left + right) / 2 - (frameLeft + frameRight) / 2) / SHOT,
    y: ((top + bottom) / 2 - (frameTop + frameBottom) / 2) / SHOT,
  };
}

/** The figures, and how much clear room is left on each side of them
 *  inside the drawn square. */
const fit = (page: Page): Promise<{ said: string; air: number }> => page.evaluate(() => {
  const digit = document.querySelector('.mobile-navbar-tabs-digit') as HTMLElement;
  const square = document.querySelector('#nav-tabs svg rect') as SVGRectElement;
  const text = digit.getBoundingClientRect();
  const box = square.getBoundingClientRect();
  return { said: digit.textContent ?? '', air: Math.round(((box.width - text.width) / 2) * 10) / 10 };
});

for (const [open, said] of [[1, '1'], [9, '9'], [12, '12'], [99, '99'], [128, '128'], [1200, '999+']] as Array<[number, string]>) {
  test(`${open} tabs is drawn as ${said}, inside the square`, async ({ page }) => {
    await boot(page, open);
    const seen = await fit(page);
    expect(seen.said).toBe(said);
    // Clear of the frame on both sides. The square's stroke is 2px wide and
    // sits on its edge, so a figure needs more than a pixel of air not to
    // touch it — which is what two figures used to have none of.
    expect(seen.air).toBeGreaterThan(1.5);
  });
}

for (const [open, said] of [[1, '1'], [4, '4'], [12, '12'], [99, '99'], [128, '128'], [1200, '999+']] as Array<[number, string]>) {
  test(`${said} is in the middle of the square, both ways`, async ({ page }) => {
    await boot(page, open);
    const off = await offCentre(page);
    // A quarter of a pixel. The figures used to sit a pixel low — the box
    // the browser centres is the font's, and this font draws its figures
    // taller than its caps and not symmetric about anything on offer.
    expect(Math.abs(off.y), `${off.y.toFixed(2)}px above/below the middle`).toBeLessThan(0.25);
    expect(Math.abs(off.x), `${off.x.toFixed(2)}px left/right of the middle`).toBeLessThan(0.25);
  });
}

test('the count is said out loud as well as drawn', async ({ page }) => {
  await boot(page, 12);
  await expect(page.locator('#nav-tabs')).toHaveAttribute('aria-label', 'Tabs: 12 open (hold for the menu)');
});
