import { expect, test, type Page } from '@playwright/test';

// Closing a tab by swiping it: the card follows the finger, and the pull it
// takes is a quarter of the card's width — or a flick, which is the same
// gesture a phone user already makes without thinking about distance. What it
// must never be is a card's worth of travel through a gesture that has to be
// perfectly horizontal: the switcher scrolls, so a drag that is really a
// scroll has to be handed back to the scroller untouched, and one that merely
// starts a little crooked still belongs to the swipe.
const TABS = ['Notes/A.md', 'Notes/B.md', 'Notes/C.md'];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((tabs) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1, 'Notes/B.md': 1, 'Notes/C.md': 1 }, folders: ['Notes'] }));
    for (const [i, path] of tabs.entries()) localStorage.setItem(`satr:fs:file:${path}`, `Note ${String.fromCharCode(65 + i)}`);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: tabs.map((path) => ({ path })), active: 0 }));
  }, TABS);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await page.locator('#nav-tabs').evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.locator('.mobile-tab')).toHaveCount(3);
});

type Step = { action: 'down' | 'move' | 'up' | 'wait'; dx?: number; dy?: number; wait?: number };

/** One finger on a tab card: the steps of a single gesture, with the card's
 *  own width and each step's effect on the card reported back. */
async function swipe(page: Page, index: number, steps: Step[]) {
  return page.evaluate(async ({ index, steps }) => {
    const card = document.querySelectorAll<HTMLElement>('.mobile-tab')[index];
    if (!card) throw new Error(`no tab card at ${index}`);
    const box = card.getBoundingClientRect();
    const x0 = box.left + box.width / 2;
    const y0 = box.top + box.height / 2;
    const seen: { transform: string; prevented: boolean }[] = [];
    for (const step of steps) {
      if (step.wait) await new Promise((r) => window.setTimeout(r, step.wait));
      if (step.action === 'wait') continue;
      const x = x0 + (step.dx ?? 0);
      const y = y0 + (step.dy ?? 0);
      const touch = new Touch({ identifier: 1, target: card, clientX: x, clientY: y, pageX: x, pageY: y });
      const live = step.action !== 'up';
      const type = step.action === 'down' ? 'touchstart' : step.action === 'up' ? 'touchend' : 'touchmove';
      const event = new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: live ? [touch] : [], targetTouches: live ? [touch] : [], changedTouches: [touch],
      });
      card.dispatchEvent(event);
      seen.push({ transform: card.style.transform, prevented: event.defaultPrevented });
    }
    return { width: box.width, seen };
  }, { index, steps });
}

const lastOf = (seen: { transform: string }[]) => seen[seen.length - 1].transform;
const flewOff = /^translateX\(-?\d+px\)$/;

test('a pull past a quarter of the card closes the tab', async ({ page }) => {
  const { width } = await swipe(page, 1, [{ action: 'down' }, { action: 'up' }]);
  const pull = Math.round(width * 0.3); // past the quarter, but a slow pull: no flick to help it
  const result = await swipe(page, 1, [
    { action: 'down' },
    { action: 'move', dx: -pull },
    { action: 'wait', wait: 200 },
    { action: 'up' },
  ]);
  // The card followed the finger, and at the lift was sent the rest of the way.
  expect(result.seen[1].transform).toBe(`translateX(${-pull}px)`);
  expect(lastOf(result.seen)).toMatch(flewOff);
  await expect(page.locator('.mobile-tab')).toHaveCount(2);
});

test('a short pull springs back and closes nothing', async ({ page }) => {
  const { width } = await swipe(page, 1, [{ action: 'down' }, { action: 'up' }]);
  const short = Math.round(width * 0.15);
  const result = await swipe(page, 1, [
    { action: 'down' },
    { action: 'move', dx: -short },
    { action: 'wait', wait: 200 },
    { action: 'up' },
  ]);
  expect(result.seen[1].transform).toBe(`translateX(${-short}px)`);
  expect(lastOf(result.seen)).toBe(''); // back where it was, not off the screen
  await expect(page.locator('.mobile-tab')).toHaveCount(3);
});

test('a flick closes on a short pull', async ({ page }) => {
  // 40px is well under the quarter of the card a slow pull would need; the
  // speed of it is what carries the card the rest of the way.
  const result = await swipe(page, 1, [
    { action: 'down' },
    { action: 'move', dx: 40 },
    { action: 'up', wait: 16 },
  ]);
  expect(lastOf(result.seen)).toMatch(flewOff);
  await expect(page.locator('.mobile-tab')).toHaveCount(2);
});

test('a downward drag scrolls the switcher and closes nothing', async ({ page }) => {
  const result = await swipe(page, 1, [
    { action: 'down' },
    { action: 'move', dx: 6, dy: 30 },
    { action: 'move', dx: 8, dy: 90 },
    { action: 'up' },
  ]);
  // The card never moved, and nothing was claimed from the scroller.
  expect(result.seen.map((s) => s.transform).join('')).toBe('');
  expect(result.seen.some((s) => s.prevented)).toBe(false);
  await expect(page.locator('.mobile-tab')).toHaveCount(3);
});

test('a drag that starts a little crooked still closes: the first real movement decides', async ({ page }) => {
  const result = await swipe(page, 1, [
    { action: 'down' },
    { action: 'move', dx: 7, dy: 9 }, // neither way yet, and not yet 10px
    { action: 'move', dx: 90, dy: 12 },
    { action: 'wait', wait: 200 },
    { action: 'up' },
  ]);
  expect(result.seen[2].prevented).toBe(true); // the swipe claimed it
  expect(lastOf(result.seen)).toMatch(flewOff);
  await expect(page.locator('.mobile-tab')).toHaveCount(2);
});

// The card is a picture of the note, so it shows it at the note's own text
// size — not merely at whatever the app's chrome happens to use. A writer who
// sets 20px notes sees 20px notes in the switch, halved by the card.
test('the card shows the note at the note\u2019s own text size', async ({ page }) => {
  const sizes = await page.evaluate(async () => {
    const preview = document.querySelector<HTMLElement>('.mobile-tab-preview-page')!;
    const note = document.querySelector<HTMLElement>('#app .cm-content')!;
    document.documentElement.style.setProperty('--note-font-size', '1.25rem');
    await new Promise((r) => requestAnimationFrame(r));
    return { preview: getComputedStyle(preview).fontSize, note: getComputedStyle(note).fontSize };
  });
  expect(sizes.note).toBe('20px'); // 1.25rem, the writer's setting
  expect(sizes.preview).toBe(sizes.note);
});
