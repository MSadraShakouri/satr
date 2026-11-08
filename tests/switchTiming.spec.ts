import { expect, test, type Page } from '@playwright/test';

// A tab switch says where its time went.
//
// The 12:47 device log had a note-to-note switch blocking for 830ms with
// only 337ms of it spoken for: the leaving of the old tab was not timed at
// all, and showFile was one opaque lump. An instrument comes before a fix,
// so the switch line now carries `left` and the note line carries the four
// stages inside showFile. This test holds the facts in place, because a
// measurement nobody checks goes stale the first time the code moves.

const NOTE = Array.from({ length: 30 }, (_, i) => `## Section ${i}\n\nSome prose about thing ${i}.\n`).join('\n');

async function boot(page: Page): Promise<void> {
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/a.md': 1, 'Notes/b.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/a.md', text as string);
    localStorage.setItem('satr:fs:file:Notes/b.md', `${text as string}\n\ntail\n`);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/a.md' }, { path: 'Notes/b.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:demoShown', '1');
  }, NOTE);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.waitForTimeout(400);
}

interface Line { area: string; text: string; facts?: Record<string, string | number | boolean>; ms?: number }

const logLines = (page: Page): Promise<Line[]> =>
  page.evaluate(async () => {
    const mod = await (window as unknown as { __satr: { load(m: string): Promise<{ lines(): Line[] }> } }).__satr.load('/src/log.ts');
    return JSON.parse(JSON.stringify(mod.lines())) as Line[];
  });

test('the switch line times the leaving, and the note line splits its stages', async ({ page }) => {
  await boot(page);
  // The phone's way in: the tab switcher, then the other tab's card.
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.locator('.mobile-tab-switcher')).toHaveCount(1);
  await page.locator('.mobile-tab-card, .mobile-tab-title').nth(1).click();
  await page.waitForTimeout(900);

  const lines = await logLines(page);
  const switched = lines.filter((l) => l.area === 'tabs' && l.text === 'switch').pop();
  expect(switched, 'the switch was logged').toBeTruthy();
  // The old line started its clock after the old tab had been put away, so
  // the save and the snapshot fell outside the number. They are inside it
  // now, and named.
  expect(Object.keys(switched!.facts ?? {}), 'what the switch line says').toContain('left');
  expect(typeof switched!.facts!.left).toBe('number');

  const shown = lines.filter((l) => l.area === 'file' && l.text === 'note on screen').pop();
  expect(shown, 'the note line is there').toBeTruthy();
  const facts = shown!.facts ?? {};
  for (const stage of ['text', 'chrome', 'place', 'preRestore', 'restore', 'rest']) {
    expect(Object.keys(facts), `the stage "${stage}" is named`).toContain(stage);
    expect(typeof facts[stage], `"${stage}" is a number of milliseconds`).toBe('number');
  }
  // These two are inside "place", not extra work to add to the switch.
  expect(Math.abs(Number(facts.place) - Number(facts.preRestore) - Number(facts.restore)),
    'the two nested synchronous parts account for place, within rounding').toBeLessThanOrEqual(2);
  // The stages are of the switch, not longer than it.
  const parts = ['text', 'chrome', 'place', 'rest'].reduce((sum, k) => sum + Number(facts[k]), 0);
  expect(parts, 'the stages add up to no more than the switch').toBeLessThanOrEqual(Number(switched!.ms ?? 0) + 50);
});
