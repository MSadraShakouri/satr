import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('satr:test:seeded', '1');
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: {'Notes/A.md':1}, folders:['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs:[{ path:'Notes/A.md' }], active:0 }));
  });
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state:'detached' });
}

test('records the largest frame-opportunity gap for a moving multi-touch gesture once at the last lift', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const log = (window as any).__satr.load('/src/log.ts');
    log.forget();
    const fire = (type: string, count: number) => {
      const touches = Array.from({ length: count }, (_, i) => new Touch({ identifier: i, target: document.body, clientX: 30, clientY: 50 }));
      document.body.dispatchEvent(new TouchEvent(type, { bubbles: true, touches, changedTouches: touches }));
    };
    const waitFrames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    fire('touchstart', 1); fire('touchmove', 1); await waitFrames();
    fire('touchstart', 2); fire('touchend', 1);
    const afterFirstLift = log.lines().filter((l: any) => l.text === 'frames under a finger').length;
    const until = performance.now() + 180; while (performance.now() < until) { /* simulate a held main thread */ }
    await waitFrames(); fire('touchend', 0);
    return { afterFirstLift, lines: log.lines().filter((l: any) => l.text === 'frames under a finger') };
  });
  expect(out.afterFirstLift).toBe(0);
  expect(out.lines).toHaveLength(1);
  expect(out.lines[0].facts.longestMs).toBeGreaterThanOrEqual(150);
  expect(out.lines[0].facts.intervals).toBeGreaterThanOrEqual(2);
  expect(out.lines[0].facts.gestureMs).toBeGreaterThanOrEqual(180);
});

test('taps, cancelled gestures and hidden pages do not report a scroll gap', async ({ page }) => {
  await boot(page);
  const count = await page.evaluate(async () => {
    const log = (window as any).__satr.load('/src/log.ts'); log.forget();
    const fire = (type:string, n:number) => {
      const touches = Array.from({length:n}, (_, i) => new Touch({identifier:i,target:document.body,clientX:20,clientY:50}));
      document.body.dispatchEvent(new TouchEvent(type, {bubbles:true,touches,changedTouches:touches}));
    };
    const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    fire('touchstart',1); await frames(); fire('touchend',0);
    fire('touchstart',1); fire('touchmove',1); await frames(); fire('touchcancel',0);
    fire('touchstart',1); fire('touchmove',1); await frames();
    Object.defineProperty(document, 'visibilityState', {configurable:true, get:()=> 'hidden'});
    document.dispatchEvent(new Event('visibilitychange')); fire('touchend',0);
    return log.lines().filter((l:any) => l.text === 'frames under a finger').length;
  });
  expect(count).toBe(0);
});

test('a browser-driven touch scroll is sampled even if the browser cancels its pointer', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const scroller = document.createElement('div');
    scroller.id = 'frame-test-scroller';
    scroller.style.cssText = 'position:fixed;z-index:99999;top:40px;left:20px;width:320px;height:600px;overflow:auto;touch-action:pan-y';
    scroller.innerHTML = '<div style="height:5000px"></div>';
    document.body.append(scroller);
    (window as any).__satr.load('/src/log.ts').forget();
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:180,y:500}] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:180,y:500-i*25}] });
    await page.waitForTimeout(25);
  }
  await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  const read = () => page.evaluate(() => (window as any).__satr.load('/src/log.ts').lines().filter((l:any) => l.text === 'frames under a finger'));
  await expect.poll(async () => (await read()).length).toBe(1);
  expect(await page.locator('#frame-test-scroller').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect((await read())[0].facts.intervals).toBeGreaterThan(1);
});
