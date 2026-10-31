// The bars moving out of the way while the reader scrolls, and the beat
// between the two moves.
//
// Reported on the phone: "scrolling up the status bar flashes". A bar's own
// hide/show animation runs for about a fifth of a second, and a second request
// inside that time restarts it mid-flight — the bar slides in, is told to go
// away again, slides in again: a flash. Two things asked for that second move
// without anyone meaning to: a finger's wobble across the 3px threshold, and
// the bounce that comes straight back to the top of a note (the top restores
// the bars, unconditionally, in the old code).
//
// What is pinned here is the page's half of the rule: after the bars move,
// nothing moves them again until they have stopped moving — the bars say so
// themselves now, with transitionend, rather than the app holding a copy of
// the stylesheet's duration (src/main.ts) — and a move held back that way is
// not lost, it is made as soon as the slide is over if the note is still
// where it asked for it (a flick that stops, a bounce to the top). The Android half is in SystemBarsPlugin.java: never ask
// a bar that is already showing to show, because the asking is what restarts
// the animation.
//
// A finger sends a stream of scroll events, not one, and the app ignores the
// scrolls it makes itself (syncingScroll, src/main.ts) — so a single event can
// be swallowed. Every gesture here is a short ramp of events, as a finger is.
//
// Reported again after that: on the way up they come back and then leave
// again, and nothing on screen moves when they do. That one is not a flash
// between two gestures — it is a scroll position that moved without a reader:
// the editor corrects a stretch of estimated line heights as the note flies
// past, and moves scrollTop precisely so that the text on screen stays put.
// The bars are told from the reader's hand now (a finger, a wheel, a
// scrolling key), and what the hand has not asked for cannot turn them
// around. The last two tests here are that rule.
import { expect, test, type Page } from '@playwright/test';

const NOTE = 'a line of prose to scroll through\n'.repeat(200);
// `transform 0.3s` on .topbar and .mobile-navbar (src/style.css). The app
// does not hold this number any more; it reads it off the elements. The
// tests still need to know how long to wait.
const SLIDE = 300;

declare global {
  interface Window {
    navMoves: { at: number; hidden: boolean }[];
    navHiddenNow: () => boolean;
  }
}

/** The app, with one long note open, and every move of the bars recorded. */
async function boot(page: Page) {
  await page.addInitScript((text) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/Long.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/Long.md', text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/Long.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, NOTE);
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/Long/);
  // The boot cover holds a clone of the app while it opens (src/snapshot.ts).
  await expect(page.locator('#boot-snapshot')).toHaveCount(0);
  await page.evaluate(() => {
    window.navMoves = [];
    window.navHiddenNow = () => document.body.classList.contains('is-hidden-nav');
    new MutationObserver(() => window.navMoves.push({ at: performance.now(), hidden: window.navHiddenNow() }))
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  });
  // Past the note's opening hold (1200ms, src/main.ts) and any restore.
  await page.waitForTimeout(1500);
}

const moves = (page: Page): Promise<{ at: number; hidden: boolean }[]> => page.evaluate(() => window.navMoves);
const hidden = (page: Page): Promise<boolean> => page.evaluate(() => window.navHiddenNow());
const clearMoves = (page: Page): Promise<void> => page.evaluate(() => { window.navMoves = []; });

/** No two moves closer together than one slide: that is the whole rule, and
 *  a pair inside one slide is what the reader sees as a flash. */
async function expectOneMovePerBeat(page: Page) {
  const all = await moves(page);
  for (let i = 1; i < all.length; i += 1) {
    expect(all[i].at - all[i - 1].at, `moves ${JSON.stringify(all)}`).toBeGreaterThanOrEqual(SLIDE - 40);
  }
}

/** Scroll the note by `by` px the way a finger does: a short ramp of scroll
 *  events (`ms` long), not one event that a sync could swallow. */
async function scrollBy(page: Page, by: number, ms = 50) {
  await page.evaluate(async ({ by, ms }) => {
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
    const start = scroller.scrollTop;
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        const done = performance.now() - t0;
        scroller.scrollTop = start + by * Math.min(1, done / ms);
        scroller.dispatchEvent(new Event('scroll'));
        if (done < ms) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
  }, { by, ms });
}

/** Down, then straight back up, with no trip out to the test runner in
 *  between: the whole point is what happens inside one slide. */
async function scrollDownThenUp(page: Page, down: number, up: number, ms = 30) {
  await page.evaluate(async ({ down, up, ms }) => {
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
    const ramp = (by: number): Promise<void> => new Promise<void>((resolve) => {
      const start = scroller.scrollTop;
      const t0 = performance.now();
      const tick = (): void => {
        const done = performance.now() - t0;
        scroller.scrollTop = start + by * Math.min(1, done / ms);
        scroller.dispatchEvent(new Event('scroll'));
        if (done < ms) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
    await ramp(down);
    await ramp(up);
  }, { down, up, ms });
}

test('scrolling down takes the bars away, and scrolling up brings them back', async ({ page }) => {
  await boot(page);
  await scrollBy(page, 200);
  await expect.poll(() => hidden(page)).toBe(true);
  await scrollBy(page, -200);
  await expect.poll(() => hidden(page)).toBe(false);
  expect((await moves(page)).map((m) => m.hidden)).toEqual([true, false]);
  await expectOneMovePerBeat(page);
});

test('a wobble inside the beat does not move the bars — that is the flash', async ({ page }) => {
  await boot(page);
  await scrollBy(page, 200);
  await expect.poll(() => hidden(page)).toBe(true);

  // A finger's wobble: 10px back up, then down again, inside the beat. (The
  // old code restored the bars on the way up and hid them again on the way
  // down — two animations inside one, which is the flash.)
  await clearMoves(page);
  await scrollBy(page, -10, 30);
  await scrollBy(page, 10, 30);
  expect(await moves(page)).toEqual([]); // nothing moved, so nothing flashed
  // And it stays that way: the wobble is not where the note ended up.
  await page.waitForTimeout(SLIDE + 150);
  expect(await hidden(page)).toBe(true);
  expect(await moves(page)).toEqual([]);
});

test('a wobble that lands AFTER the beat does not flash either', async ({ page }) => {
  await boot(page);
  // The beat used to be 200ms and the bars animate `transform` over 300ms
  // (src/style.css), so a reversal arriving in between found the beat over
  // and restarted the slide half way through — the flash, with no gesture
  // rule able to see it, because the question there is not which way the
  // reader went but whether the bar has finished moving. And the gate it
  // then had to clear was 12px, which a thumb resting on the glass wobbles
  // through. Both: the slide itself is the beat now, and taking the bars
  // away takes 32px.
  await scrollBy(page, 200);
  await expect.poll(() => hidden(page)).toBe(true);
  // Reading, not flicking: 40px up brings them back.
  await scrollBy(page, -40);
  await expect.poll(() => hidden(page)).toBe(false);
  // Past the old beat, still inside the transform — then a thumb's wobble,
  // bigger than the old 12px gate.
  await page.waitForTimeout(220);
  await clearMoves(page);
  await scrollBy(page, 14);
  await page.waitForTimeout(SLIDE + 200); // let anything held flush
  expect((await moves(page)).filter((move) => move.hidden)).toEqual([]);
  expect(await hidden(page)).toBe(false);
});

test('a flick up that stops inside the beat still brings the bars back', async ({ page }) => {
  await boot(page);
  await scrollBy(page, 200);
  await expect.poll(() => hidden(page)).toBe(true);

  // One flick up, and the finger stops: no further scroll event will come, so
  // the move the beat held back has to ask again by itself.
  await scrollBy(page, -60, 30);
  await expect.poll(() => hidden(page), { timeout: SLIDE + 600 }).toBe(false);
});

test('a bounce back to the top is one gesture, not two — and the bars come back', async ({ page }) => {
  await boot(page);
  await scrollBy(page, 40);
  await expect.poll(() => hidden(page)).toBe(true);

  // The note snaps back to the very top. The top always has the bars, but not
  // while the gesture that took them away is still running: at once, nothing.
  await clearMoves(page);
  await scrollBy(page, -40, 30);
  expect((await moves(page)).filter((m) => !m.hidden)).toEqual([]);
  // A beat later the bars are back on their own.
  await expect.poll(() => hidden(page), { timeout: SLIDE + 600 }).toBe(false);
});

test('a small nudge up is still a reader: 20px brings them back', async ({ page }) => {
  await boot(page);
  await scrollBy(page, 200);
  await expect.poll(() => hidden(page)).toBe(true);
  await page.waitForTimeout(SLIDE + 120); // nothing held back; this is a new gesture
  // One gate for both directions was 24px, and this nudge — a deliberate one,
  // the way a reader asks for the bars without losing their place — fell
  // under it. Taking them away is the expensive move and still takes 32;
  // bringing them back takes 16.
  await clearMoves(page);
  await scrollBy(page, -20);
  await expect.poll(() => hidden(page)).toBe(false);
});

test('the beat is the animation, not a number: a quicker slide frees them sooner', async ({ page }) => {
  await boot(page);
  // The app reads the duration off the bars themselves, so make them slide in
  // a fifth of the time: a move held back by the slide must then land a fifth
  // of the time later. Under the number this replaced it was 340ms whatever
  // the stylesheet said, and this gesture is the one that proves it — the
  // reversal arrives while the bars are still sliding away, so it IS held.
  await page.addStyleTag({ content: '.topbar, .mobile-navbar { transition-duration: 60ms !important; }' });
  await clearMoves(page);
  await scrollDownThenUp(page, 200, -60);
  await expect.poll(() => hidden(page), { timeout: 2000 }).toBe(false);
  const [away, back] = await moves(page);
  expect([away.hidden, back.hidden]).toEqual([true, false]);
  // 60ms of slide plus a frame or two. The old fixed beat could not be under
  // 340 by construction.
  expect(back.at - away.at, `moves ${JSON.stringify(await moves(page))}`).toBeLessThan(200);
});

test('a tap brings the bars back at once, beat or no beat', async ({ page }) => {
  await boot(page);
  await scrollBy(page, 200);
  await expect.poll(() => hidden(page)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await expect.poll(() => hidden(page)).toBe(false);
});

test('a note kept down does not flash: the bars move once per gesture', async ({ page }) => {
  await boot(page);
  await clearMoves(page);
  // Scroll down, wobble, keep down, wobble: the way a thumb actually moves.
  for (const by of [120, -6, 90, -4, 90, -5, 60]) await scrollBy(page, by, 30);
  await expect.poll(() => hidden(page)).toBe(true);
  await page.waitForTimeout(SLIDE + 150);
  expect((await moves(page)).map((m) => m.hidden)).toEqual([true]);
  await expectOneMovePerBeat(page);
});

// ---- A scroll position is not a gesture ----
test.describe('the hand behind the scroll', () => {
  test.use({ hasTouch: true });

  /** Scroll the note the way a finger does: the ramp of scroll events, with
   *  the finger that caused them on the glass. Going UP the note is the
   *  finger sliding DOWN it. */
  async function swipe(page: Page, by: number, ms = 50) {
    await page.evaluate(async ({ by, ms }) => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
      const start = scroller.scrollTop;
      const t0 = performance.now();
      let fingerY = 400;
      const touch = (type: string): void => {
        const point = new Touch({ identifier: 1, target: scroller, clientX: 195, clientY: fingerY });
        scroller.dispatchEvent(new TouchEvent(type, { touches: [point], bubbles: true }));
      };
      touch('touchstart');
      await new Promise<void>((resolve) => {
        const tick = (): void => {
          const done = performance.now() - t0;
          const to = start + by * Math.min(1, done / ms);
          fingerY -= (to - scroller.scrollTop) / 4; // the glass under the note
          scroller.scrollTop = to;
          touch('touchmove');
          scroller.dispatchEvent(new Event('scroll'));
          if (done < ms) requestAnimationFrame(tick);
          else { scroller.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true })); resolve(); }
        };
        tick();
      });
    }, { by, ms });
  }

  /** What the editor does when it finds a stretch above the viewport is
   *  taller than it had estimated: scrollTop moves, the text does not, and
   *  no finger is anywhere near the glass. */
  const correction = (page: Page, by: number) => page.evaluate((px) => {
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
    scroller.scrollTop += px;
    scroller.dispatchEvent(new Event('scroll'));
  }, by);

  test('a correction nobody made cannot take the bars away again', async ({ page }) => {
    await boot(page);
    await swipe(page, 400);
    await expect.poll(() => hidden(page)).toBe(true);
    await page.waitForTimeout(SLIDE + 60);
    await swipe(page, -400);
    await expect.poll(() => hidden(page)).toBe(false);
    clearMoves(page);
    // Ten times the threshold, and twice over, with the beat well past: the
    // old rule took the bars away on the first one.
    await page.waitForTimeout(SLIDE + 60);
    await correction(page, 130);
    await page.waitForTimeout(80);
    await correction(page, 130);
    await page.waitForTimeout(SLIDE + 120);
    expect(await hidden(page)).toBe(false);
    expect(await moves(page)).toEqual([]);
  });

  test('a thumb wobbling on a slow drag up cannot hand over a reversal', async ({ page }) => {
    await boot(page);
    await swipe(page, 400);
    await expect.poll(() => hidden(page)).toBe(true);
    await page.waitForTimeout(SLIDE + 60);
    // Slowly up, the way a thumb does it: a few pixels at a time, never
    // quite straight, with the editor correcting a height now and then.
    await page.evaluate(async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
      let fingerY = 300;
      const touch = (type: string): void => {
        const point = new Touch({ identifier: 1, target: scroller, clientX: 195, clientY: fingerY });
        scroller.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [point], bubbles: true }));
      };
      touch('touchstart');
      for (let i = 0; i < 40; i += 1) {
        const wobble = i % 7 === 6 ? -4 : 6; // the thumb's own jitter
        fingerY += wobble;
        scroller.scrollTop -= wobble;
        touch('touchmove');
        scroller.dispatchEvent(new Event('scroll'));
        if (i === 20) { // a height correction lands mid-drag
          scroller.scrollTop += 130;
          scroller.dispatchEvent(new Event('scroll'));
        }
        await sleep(20);
      }
      touch('touchend');
    });
    await page.waitForTimeout(SLIDE + 120);
    expect(await hidden(page)).toBe(false);
    // One move for the whole drag: they came back, and they stayed.
    expect((await moves(page)).map((m) => m.hidden)).toEqual([true, false]);
  });

  test('a real swipe down still takes them away at once', async ({ page }) => {
    await boot(page);
    await swipe(page, 400);
    await expect.poll(() => hidden(page)).toBe(true);
    await page.waitForTimeout(SLIDE + 60);
    await swipe(page, -400);
    await expect.poll(() => hidden(page)).toBe(false);
    await page.waitForTimeout(SLIDE + 60);
    await correction(page, 130); // ignored, as above
    await swipe(page, 400);
    await expect.poll(() => hidden(page)).toBe(true);
    await expectOneMovePerBeat(page);
  });
});

// The keyboard's half of the same subject. Reported: "when opening the
// keyboard, the nav bar scrolls up and the typing bar shows, it happens
// behind it and it goes under a second … once you notice it's infuriating".
// The navbar is gone from the frame the keyboard arrives in, rather than
// sliding out over one.
test('the navbar does not travel when the keyboard comes up', async ({ page }) => {
  // A keyboard, the way the app measures one (layoutToolbar, src/main.ts):
  // the visible viewport stops being the whole window.
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(window.visualViewport!, 'height', {
      get() { calls += 1; return calls <= 1 ? window.innerHeight : window.innerHeight - 300; },
    });
  });
  await boot(page);
  const seen = await page.evaluate(async () => {
    const bar = document.querySelector<HTMLElement>('.mobile-navbar')!;
    const frames: { opacity: string; transform: string }[] = [];
    const watch = (): void => {
      if (!document.body.classList.contains('keyboard-open')) return void requestAnimationFrame(watch);
      const style = getComputedStyle(bar);
      frames.push({ opacity: style.opacity, transform: style.transform });
      if (frames.length < 6) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    document.querySelector<HTMLElement>('.cm-content')!.focus();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return frames;
  });
  // Every frame the keyboard is up: nothing drawn, nothing moving.
  expect(seen.length).toBeGreaterThan(2);
  for (const frame of seen) {
    expect(frame.opacity, JSON.stringify(seen)).toBe('0');
    expect(frame.transform, JSON.stringify(seen)).toBe('none');
  }
});
