import { test, expect } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';
test('a page can become sharp after one transient canvas allocation failure', async ({ page }) => {
  await page.addInitScript((pdf) => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({files:{'Notes/handout.pdf':1}, folders:['Notes']}));
    localStorage.setItem('satr:fs:file:Notes/handout.pdf', pdf);
    localStorage.setItem('satr:tabs', JSON.stringify({tabs:[{path:'Notes/handout.pdf'}],active:0}));
    const original = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as any).getContext = function(type: string, ...args: unknown[]) {
      if (type === '2d' && this.width >= 300 && this.height >= 400 && !(window as any).failedLargeCanvas) {
        (window as any).failedLargeCanvas = {width:this.width,height:this.height};
        return null;
      }
      return (original as any).call(this,type,...args);
    };
  }, tinyPdf(3));
  await page.goto('/');
  await expect(page.locator('.pdf-page')).toHaveCount(3,{timeout:20000});
  await expect.poll(() => page.evaluate(()=>(window as any).failedLargeCanvas), {timeout:20000}).toBeTruthy();
  await expect(page.locator('.pdf-page').first().locator('canvas.pdf-rough')).toHaveCount(1,{timeout:20000});
  const pane=page.locator('#preview-pane');await pane.hover();await page.mouse.wheel(0, 100);await page.mouse.wheel(0,-100);
  await expect(page.locator('.pdf-page').first().locator('canvas.pdf-raster'),'a later plan can retry the failed page').toHaveCount(1,{timeout:5000});
});

test('a persistently unavailable canvas does not self-retry in a tight loop', async ({ page }) => {
  await page.addInitScript((pdf) => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({files:{'Notes/handout.pdf':1}, folders:['Notes']}));
    localStorage.setItem('satr:fs:file:Notes/handout.pdf', pdf);
    localStorage.setItem('satr:tabs', JSON.stringify({tabs:[{path:'Notes/handout.pdf'}],active:0}));
    const original = HTMLCanvasElement.prototype.getContext;
    (window as any).failCanvases = true;
    (window as any).failedCanvases = 0;
    (HTMLCanvasElement.prototype as any).getContext = function(type: string, ...args: unknown[]) {
      if (type === '2d' && this.width >= 300 && this.height >= 400 && (window as any).failCanvases) {
        (window as any).failedCanvases += 1;
        return null;
      }
      return (original as any).call(this,type,...args);
    };
  }, tinyPdf(3));
  await page.goto('/');
  await expect(page.locator('.pdf-page')).toHaveCount(3,{timeout:20000});
  await expect.poll(() => page.evaluate(()=>(window as any).failedCanvases), {timeout:20000}).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  const failures = await page.evaluate(()=>(window as any).failedCanvases);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(()=>(window as any).failedCanvases), 'a broken context does not spin without another plan').toBe(failures);
  await page.evaluate(() => { (window as any).failCanvases = false; });
  const pane=page.locator('#preview-pane');await pane.hover();await page.mouse.wheel(0, 100);await page.mouse.wheel(0,-100);
  await expect(page.locator('.pdf-page').first().locator('canvas.pdf-raster'),'a later plan recovers after the context becomes available').toHaveCount(1,{timeout:5000});
});
