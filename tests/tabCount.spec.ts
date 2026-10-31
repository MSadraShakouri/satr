import { test, expect, type Page } from '@playwright/test';

// The number of open tabs, drawn inside the square on the navbar pill.
// One figure had room to spare; two were wider than the square's inside and
// welded themselves to its frame; three spilled out past it altogether.

test.use({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2 });

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

test('the count is said out loud as well as drawn', async ({ page }) => {
  await boot(page, 12);
  await expect(page.locator('#nav-tabs')).toHaveAttribute('aria-label', 'Tabs: 12 open (hold for the menu)');
});
