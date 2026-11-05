import { test, expect, type Page } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

// Which way up a document is read.
//
// "Have a settings for pdf to auto rotate and stuff by user choice (override
// system rotation option too)." Two halves: the rule for when the setting
// applies, which is here, and the Android constant that carries out the
// override, which needs a phone (SystemBarsPlugin.setOrientation).
//
// The rule only has a say while a document is on screen -- a note being
// typed into does not rotate because the phone was put down sideways -- and
// that is what these tests hold.

test.use({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2 });

const PDF = tinyPdf(4);

async function boot(page: Page, rotation: string): Promise<void> {
  await page.addInitScript(([pdf, choice]) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/scan.pdf': 1, 'Notes/essay.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/scan.pdf', pdf as string);
    localStorage.setItem('satr:fs:file:Notes/essay.md', '# Essay\n\nA paragraph.\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/scan.pdf' }], active: 0 }));
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:settings', JSON.stringify({ documentRotation: choice }));
  }, [PDF, rotation] as [string, string]);
  await page.goto('/');
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(400);
}

const asked = (page: Page): Promise<string | undefined> => page.evaluate(() => document.body.dataset.rotation);

/** Open a file the way a reader does: the drawer, then the row. */
async function openFile(page: Page, path: string): Promise<void> {
  if (!(await page.locator('body').evaluate((body) => body.classList.contains('files-open')))) {
    await page.locator('#files').click();
    await expect(page.locator('body')).toHaveClass(/files-open/);
  }
  await page.locator(`#file-panel .tree-item-self[data-path="${path}"]`).click();
  await page.waitForTimeout(700);
}

test('the setting applies while a document is open, and not otherwise', async ({ page }) => {
  await boot(page, 'free');
  expect(await asked(page), 'the document may turn').toBe('free');

  // Open the note: the rule hands the phone back its say.
  await openFile(page, 'Notes/essay.md');
  await expect(page.locator('.cm-content')).toBeVisible();
  expect(await asked(page), 'a note follows the phone').toBe('system');

  await openFile(page, 'Notes/scan.pdf');
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible();
  expect(await asked(page), 'and back again on the way in').toBe('free');
});

test('"follow the phone" asks for nothing, on a document or a note', async ({ page }) => {
  await boot(page, 'system');
  expect(await asked(page)).toBe('system');
});

test('"stay sideways" is carried through to the document', async ({ page }) => {
  await boot(page, 'landscape');
  expect(await asked(page)).toBe('landscape');
});

test('the rule itself, read back from the module', async ({ page }) => {
  await boot(page, 'system');
  const seen = await page.evaluate(async () => {
    const mod = await (window as unknown as { __satr: { load(p: string): Promise<Record<string, unknown>> } }).__satr.load('/src/orientation.ts');
    const want = mod.wantedRotation as (s: string, open: boolean) => string;
    return {
      openFree: want('free', true),
      shutFree: want('free', false),
      openLandscape: want('landscape', true),
      shutLandscape: want('landscape', false),
      labels: (mod.ROTATIONS as [string, string][]).map(([value]) => value),
    };
  });
  expect(seen.openFree).toBe('free');
  expect(seen.shutFree, 'a note never overrides the phone').toBe('system');
  expect(seen.openLandscape).toBe('landscape');
  expect(seen.shutLandscape).toBe('system');
  expect(seen.labels, 'the four choices the dropdown offers').toEqual(['system', 'free', 'portrait', 'landscape']);
});
