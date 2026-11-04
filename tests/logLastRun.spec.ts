import { expect, test, type Page } from '@playwright/test';

// How the previous run ended, said at launch. The only evidence an ordinary
// Android gives that the app was killed rather than closed is its own
// heartbeat running on past the last goodbye -- no API, no permission, and
// the same answer on every version the app supports.

declare global {
  interface Window {
    __satr: { load(path: string): {
      lines(): { area: string; kind: string; text: string; facts?: Record<string, unknown> }[];
    } };
  }
}

async function boot(page: Page, marks: { awayAt?: number; seenAt?: number }): Promise<void> {
  await page.addInitScript((seed: { awayAt?: number; seenAt?: number }) => {
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n\nwords\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    if (seed.awayAt !== undefined) localStorage.setItem('satr:awayAt', String(seed.awayAt));
    if (seed.seenAt !== undefined) localStorage.setItem('satr:seenAt', String(seed.seenAt));
  }, marks);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.waitForSelector('#app .cm-file-name');
}

const launchLines = (page: Page) => page.evaluate(() =>
  window.__satr.load('/src/log.ts').lines().filter((line) => line.area === 'launch'));

test('a run that was killed while it was being read leaves the heartbeat ahead of the goodbye', async ({ page }) => {
  const now = Date.now();
  // Backgrounded ten minutes ago, then brought forward and read for five
  // more -- and then it stopped, saying nothing.
  await boot(page, { awayAt: now - 10 * 60_000, seenAt: now - 5 * 60_000 });
  const lines = await launchLines(page);
  const told = lines.find((line) => line.text.includes('without a goodbye'));
  expect(told, 'the launch says the last run did not end cleanly').toBeTruthy();
  expect(told!.kind, 'it is a warning, so it survives quiet').toBe('warning');
  expect(Number(told!.facts!.secondsAgo)).toBeGreaterThanOrEqual(295);
  expect(Number(told!.facts!.secondsAgo)).toBeLessThan(330);
  // Five minutes of running that nothing announced the end of.
  expect(Number(told!.facts!.unannouncedFor)).toBeGreaterThanOrEqual(295);
  expect(lines.some((line) => line.text.includes('ended cleanly'))).toBe(false);
});

test('a run with no goodbye on record at all is not reported as unannounced since 1970', async ({ page }) => {
  const now = Date.now();
  // The heartbeat is there, the goodbye mark is not -- which is the ordinary
  // state after openFirstNote clears it. Subtracting the missing mark read it
  // as zero and gave "unannouncedFor=1793778808", a number that said nothing
  // and appeared in his log at every launch.
  await boot(page, { seenAt: now - 4 * 60_000 });
  const lines = await launchLines(page);
  const told = lines.find((line) => line.text.includes('without a goodbye'));
  expect(told, 'it is still reported as an unclean end').toBeTruthy();
  expect(Number(told!.facts!.secondsAgo)).toBeGreaterThanOrEqual(235);
  expect(told!.facts!.everSaidGoodbye, 'and it says what it does not know').toBe(false);
  expect(told!.facts!.unannouncedFor, 'rather than inventing a duration').toBeUndefined();
  expect(JSON.stringify(told)).not.toContain('17937');
});

test('a run that was told it was going away ends cleanly', async ({ page }) => {
  const now = Date.now();
  // The two marks are written together on the way out, which is what a clean
  // exit looks like from the next launch.
  await boot(page, { awayAt: now - 3 * 60_000, seenAt: now - 3 * 60_000 });
  const lines = await launchLines(page);
  const told = lines.find((line) => line.text.includes('ended cleanly'));
  expect(told).toBeTruthy();
  expect(told!.kind).toBe('note');
  expect(Number(told!.facts!.secondsAgo)).toBeGreaterThanOrEqual(175);
  expect(lines.some((line) => line.text.includes('without a goodbye'))).toBe(false);
});

test('one missed beat is not a casualty', async ({ page }) => {
  const now = Date.now();
  // A single throttled timer can leave the heartbeat a beat past the
  // goodbye. Three beats of slack, so this is still a clean exit.
  await boot(page, { awayAt: now - 60_000 - 35_000, seenAt: now - 60_000 });
  const lines = await launchLines(page);
  expect(lines.some((line) => line.text.includes('without a goodbye'))).toBe(false);
  expect(lines.some((line) => line.text.includes('ended cleanly'))).toBe(true);
});

test('the first run ever says nothing about a run that never happened', async ({ page }) => {
  await boot(page, {});
  const lines = await launchLines(page);
  expect(lines.some((line) => line.text.includes('the last run'))).toBe(false);
  // And the launch itself is still logged, so the absence is of one line.
  expect(lines.some((line) => line.text.includes('cold start'))).toBe(true);
});

test('a clock that moved backwards is not reported as a run ending in the future', async ({ page }) => {
  await boot(page, { awayAt: Date.now() + 20 * 60_000, seenAt: Date.now() + 20 * 60_000 });
  const lines = await launchLines(page);
  expect(lines.some((line) => line.text.includes('the last run'))).toBe(false);
});

test('it is read before the heartbeat starts again, or every launch would look clean', async ({ page }) => {
  const now = Date.now();
  await boot(page, { awayAt: now - 30 * 60_000, seenAt: now - 20 * 60_000 });
  const lines = await launchLines(page);
  expect(lines.some((line) => line.text.includes('without a goodbye'))).toBe(true);
  // The heartbeat has since written its own mark, which is exactly why the
  // reading had to happen first.
  const seen = await page.evaluate(() => Number(localStorage.getItem('satr:seenAt')));
  expect(seen).toBeGreaterThan(now - 60_000);
});

test('asking Android why costs a browser nothing and never throws', async ({ page }) => {
  await boot(page, { awayAt: Date.now() - 600_000, seenAt: Date.now() - 300_000 });
  const lines = await page.evaluate(async () => {
    const diagnostics = window.__satr.load('/src/diagnostics.ts') as unknown as { tellWhyItDied(): Promise<void> };
    const log = window.__satr.load('/src/log.ts');
    await diagnostics.tellWhyItDied();
    return log.lines().filter((line) => line.area === 'native');
  });
  // Nothing to say off a phone, and in particular no failure: an answer that
  // only Android 11 can give must not read as a fault on anything else.
  expect(lines.filter((line) => line.kind === 'failure')).toHaveLength(0);
  expect(lines.some((line) => line.text.includes('the system says'))).toBe(false);
});
