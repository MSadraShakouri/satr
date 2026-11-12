import { expect, test, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// What "first page on glass" is made of.
//
// The 12:47 device log has three opens: 226ms with no engine facts at all,
// 233ms with engineMs=56, and 334ms with engineMs=126. The first one is the
// interesting one -- nothing drew it, so it came back off the shelf already
// drawn, and the whole 226ms belonged to something nobody had named. The
// line now says where the picture came from and how long the drawing plan
// took to put one up, so the three readings can be told apart.

const PDF = tinyPdf(4);

interface Line { area: string; text: string; facts?: Record<string, string | number | boolean>; ms?: number }

async function boot(page: Page): Promise<void> {
  await page.addInitScript((pdf) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/handout.pdf': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/handout.pdf', pdf as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/handout.pdf' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
    localStorage.setItem('satr:demoShown', '1');
  }, PDF);
  await page.goto('/');
  await expect(page.locator('.pdf-page')).not.toHaveCount(0, { timeout: 20000 });
  await expect.poll(async () => page.locator('.pdf-page canvas').count(), { timeout: 20000 }).toBeGreaterThan(0);
}

const logLines = (page: Page): Promise<Line[]> => page.evaluate(async () => {
  const mod = await (window as unknown as { __satr: { load(m: string): Promise<{ lines(): Line[] }> } }).__satr.load('/src/log.ts');
  return JSON.parse(JSON.stringify(mod.lines())) as Line[];
});

test('the first page says who drew it and how long the plan took', async ({ page }) => {
  await boot(page);
  // The canvas can be on the glass a tick before the line that says so is
  // written, so this waits for the line rather than assuming the order.
  await expect.poll(async () => (await logLines(page)).some((l) => l.area === 'pdf' && l.text === 'first page on glass'),
    { timeout: 10000 }).toBe(true);
  const first = (await logLines(page)).find((l) => l.area === 'pdf' && l.text === 'first page on glass');
  expect(first, 'the open was logged').toBeTruthy();
  const facts = first!.facts ?? {};
  // Never again a line with no facts on it at all.
  expect(Object.keys(facts), 'where the picture came from').toContain('from');
  expect(['engine', 'unknown']).toContain(facts.from);
  expect(Object.keys(facts), 'how long the plan took to put one up').toContain('plan');
  expect(typeof facts.plan).toBe('number');
  expect(Number(facts.plan), 'the plan is part of the open, not longer than it').toBeLessThanOrEqual(Number(first!.ms ?? 0) + 50);
  // A document nobody has read before is drawn by the engine, and then the
  // engine's own share of the wait is on the line too.
  if (facts.from === 'engine') expect(Object.keys(facts)).toContain('engineMs');
});

test('the tracked picture records a frame opportunity without calling it a paint', async ({ page }) => {
  await boot(page);
  await expect.poll(async () => (await logLines(page)).some((l) => l.text === 'tracked picture frame opportunity'), { timeout: 10000 }).toBe(true);
  const lines = await logLines(page);
  const inserted = lines.find((l) => l.text === 'first page on glass')!;
  const frame = lines.find((l) => l.text === 'tracked picture frame opportunity')!;
  expect(['base', 'photo']).toContain(inserted.facts?.picture);
  expect(inserted.facts?.page).toBeGreaterThanOrEqual(1);
  expect(inserted.facts?.pixelCopyMs).toBeGreaterThanOrEqual(0);
  expect(frame.facts?.page).toBe(inserted.facts?.page);
  expect(frame.facts?.picture).toBe(inserted.facts?.picture);
  expect(frame.facts?.afterPlacementMs).toBeGreaterThanOrEqual(0);
  expect(frame.facts?.connected).toBe(true);
  expect(frame.facts?.visible).toBe(true);
});

test('the shelf wait distinguishes an empty shelf from recalled pages', async ({ page }) => {
  await boot(page);
  const firstWait = (await logLines(page)).find((l) => l.text === 'shelf waited for')!;
  expect(firstWait.facts?.status).toBe('ready');
  expect(firstWait.facts?.recalled).toBe(0);
  expect(firstWait.facts?.pictureBytes).toBe(0);
  expect(firstWait.facts?.ready).toBe(1);
  expect(firstWait.facts?.readyHits).toBe(0);
  await page.evaluate(async (pdf) => {
    const { pdfKey } = (window as any).__satr.load('/src/pdfView.ts');
    const { keepSketches } = (window as any).__satr.load('/src/pdfSketchCache.ts');
    const raw = Uint8Array.from(atob(pdf.split(',')[1]), (c) => c.charCodeAt(0));
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 141;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 100, 141);
    ctx.fillStyle = '#000'; ctx.fillRect(10, 10, 30, 30);
    await keepSketches(await pdfKey(raw), 4, 0, new Map([[0, canvas]]));
  }, PDF);
  await page.reload();
  await expect.poll(async () => (await logLines(page)).some((l) => l.text === 'shelf waited for'), { timeout: 10000 }).toBe(true);
  const hit = (await logLines(page)).find((l) => l.text === 'shelf waited for')!;
  expect(hit.facts?.status).toBe('ready');
  expect(hit.facts?.recalled).toBe(1);
  expect(hit.facts?.pictureBytes).toBe(100 * 141 * 4);
  expect(hit.facts?.ready).toBe(1);
  expect(hit.facts?.readyHits).toBe(1);
  expect(hit.facts?.timeouts).toBe(0);
  expect(hit.facts?.errors).toBe(0);
});
