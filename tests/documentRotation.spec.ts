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

/**
 * A browser that answers the way Chrome on Android does: a lock outside
 * fullscreen is refused, a lock inside it is granted. Every ask is written
 * down so the test can see what was asked for, and in which order.
 */
async function fakeScreen(page: Page, { lockWorksOutsideFullscreen = false } = {}): Promise<void> {
  await page.addInitScript((outside) => {
    const asks: string[] = [];
    (window as unknown as { __asks: string[] }).__asks = asks;
    let full = false;
    Object.defineProperty(document, 'fullscreenElement', { get: () => (full ? document.documentElement : null), configurable: true });
    // document.documentElement does not exist yet this early; the prototype does.
    Element.prototype.requestFullscreen = async function (): Promise<void> { asks.push('fullscreen'); full = true; };
    document.exitFullscreen = async (): Promise<void> => { asks.push('exit fullscreen'); full = false; };
    const orientation = screen.orientation as unknown as { lock(o: string): Promise<void>; unlock(): void };
    orientation.lock = async (o: string): Promise<void> => {
      asks.push(`lock ${o}`);
      if (!full && !outside) throw new DOMException('not fullscreen', 'NotSupportedError');
    };
    orientation.unlock = (): void => { asks.push('unlock'); };
  }, lockWorksOutsideFullscreen);
}

const asks = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __asks: string[] }).__asks);

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


// ---- The same setting, in a browser ----
//
// "The free doesn't work in web, neither does sideways work when my phone
// is vertical." A page may only lock its orientation while it is fullscreen
// or installed, so the ask was being refused and swallowed. Now the refusal
// is answered: go fullscreen, ask again.

test('sideways is asked for, and the next tap is what makes it stick', async ({ page }) => {
  await fakeScreen(page);
  await boot(page, 'landscape');
  await page.waitForTimeout(300);
  // Nothing can go fullscreen without a tap behind it, and a document
  // restored at launch has not been tapped.
  expect(await asks(page), 'asked once, and refused').toEqual(['lock landscape']);

  await page.mouse.click(195, 400);
  await page.waitForTimeout(400);
  expect(await asks(page), 'the tap pays for the fullscreen, and the ask is made again').toEqual([
    'lock landscape', 'fullscreen', 'lock landscape',
  ]);
});

test('a browser that allows the lock is not sent fullscreen', async ({ page }) => {
  await fakeScreen(page, { lockWorksOutsideFullscreen: true });
  await boot(page, 'portrait');
  await page.waitForTimeout(300);
  expect(await asks(page), 'an installed app locks where it stands').toEqual(['lock portrait']);
});

test('leaving the document gives the phone back its say, and its chrome', async ({ page }) => {
  await fakeScreen(page);
  await boot(page, 'landscape');
  await page.mouse.click(195, 400); // pays for the fullscreen
  await page.waitForTimeout(400);
  await openFile(page, 'Notes/essay.md');
  await expect(page.locator('.cm-content')).toBeVisible();
  const seen = await asks(page);
  expect(seen.slice(-2), 'unlocked, and the fullscreen we entered is left').toEqual(['unlock', 'exit fullscreen']);
  expect(await asked(page)).toBe('system');
});

test('turning freely is not pretended at in a browser', async ({ page }) => {
  await fakeScreen(page);
  await boot(page, 'free');
  await page.waitForTimeout(300);
  // No page can get past the phone's own rotation lock; `any` only lets a
  // page off a lock it set itself. So it unlocks and says nothing more --
  // it does not drag the reader into fullscreen for a promise it cannot
  // keep. The override is the installed app's, and it is tested there.
  expect(await asks(page)).toEqual(['unlock']);
  expect(await asked(page), 'the setting is still live; only the browser cannot serve it').toBe('free');
});
