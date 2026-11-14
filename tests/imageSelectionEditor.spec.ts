import { expect, test } from '@playwright/test';
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.beforeEach(async ({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/A.md':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/A.md','# A');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/A.md'}],active:0}));});
  await page.goto('/');await page.waitForSelector('#boot-snapshot',{state:'detached'});
  await page.evaluate(()=>{
    const {createImageSelectionEditor}=(window as any).__satr.load('/src/imageSelectionEditor.ts');
    const source=document.createElement('canvas');source.width=1000;source.height=800;const ctx=source.getContext('2d')!;ctx.fillStyle='#553';ctx.fillRect(0,0,1000,800);ctx.fillStyle='#fff';ctx.fillRect(100,100,800,600);
    (window as any).imageResult=null;(window as any).imageCancelled=false;
    const editor=createImageSelectionEditor({source,width:1000,height:800,onCancel:()=>{(window as any).imageCancelled=true},onPreview:(g:any)=>{(window as any).imageResult=g}});
    document.body.append(editor.element);(window as any).testImageEditor=editor;
  });
});

test('the default Page screen has working handles and returns original-resolution geometry',async({page})=>{
  const root=page.locator('.image-select');
  await expect(root.locator('[data-flow=page]')).toHaveAttribute('aria-selected','true');
  const box=await root.locator('.image-select-box').boundingBox();expect(box).not.toBeNull();
  await page.mouse.move(box!.x+box!.width*.1,box!.y+box!.height*.1);await page.mouse.down();
  await page.mouse.move(box!.x+box!.width*.2,box!.y+box!.height*.2);await expect(root.locator('.image-select-loupe')).toBeVisible();await page.mouse.up();
  await expect(root.locator('.image-select-loupe')).toBeHidden();
  await root.locator('[data-act=next]').click();
  const g=await page.evaluate(()=>(window as any).imageResult);
  expect(g.kind).toBe('page');expect(g.sourceWidth).toBe(1000);expect(g.sourceHeight).toBe(800);
  expect(g.quad[0][0]).toBeCloseTo(.2,1);expect(g.quad[0][1]).toBeCloseTo(.2,1);
});

test('Page + Crop returns original-based page geometry, not preview-canvas dimensions',async({page})=>{
  const root=page.locator('.image-select');await expect(root.locator('.image-select-status')).toHaveText('Page found');await root.locator('[data-flow=combo]').click();
  await expect(root.locator('[data-act=next]')).toHaveText('Next: crop');await root.locator('[data-act=next]').click();
  await expect(root.locator('.image-select-step')).toBeVisible();await expect(root.locator('[data-act=next]')).toHaveText('Preview');
  await root.locator('[data-act=next]').click();const g=await page.evaluate(()=>(window as any).imageResult);
  expect(g.kind).toBe('page');expect(g.sourceWidth).toBe(1000);expect(g.sourceHeight).toBe(800);expect(g.width).toBe(800);expect(g.height).toBe(599);
  await root.locator('[data-act=back]').click();await expect(root.locator('[data-act=next]')).toHaveText('Next: crop');
  await root.locator('[data-act=back]').click();expect(await page.evaluate(()=>(window as any).imageCancelled)).toBe(true);
});

test('rotation changes output dimensions and keeps the selection attached to the image',async({page})=>{
  const root=page.locator('.image-select');await root.locator('[data-flow=crop]').click();await root.locator('[data-act=rotate]').click();await root.locator('[data-act=next]').click();
  const g=await page.evaluate(()=>(window as any).imageResult);expect(g.kind).toBe('crop');expect(g.turn).toBe(1);expect(g.sourceWidth).toBe(800);expect(g.sourceHeight).toBe(1000);expect(g.width).toBe(608);expect(g.height).toBe(760);
});

test('detection reports success only for a plausible page and falls back on a blank image',async({page})=>{
  const root=page.locator('.image-select');await expect(root.locator('.image-select-status')).toHaveText('Page found');
  const result=await page.evaluate(()=>{
    const {detectBrightPage}=(window as any).__satr.load('/src/imageDetect.ts');
    const blank=document.createElement('canvas');blank.width=400;blank.height=300;const ctx=blank.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,400,300);
    return detectBrightPage(blank,400,300);
  });
  expect(result).toBeNull();
  await root.locator('[data-flow=crop]').click();await root.locator('[data-act=detect]').click();
  await expect(root.locator('[data-flow=page]')).toHaveAttribute('aria-selected','true');
});

test('manual detection selects Page from Page + Crop and keeps found status after rotation',async({page})=>{
 const root=page.locator('.image-select');await expect(root.locator('.image-select-status')).toHaveText('Page found');
 await root.locator('[data-flow=combo]').click();await root.locator('[data-act=detect]').click();await expect(root.locator('[data-flow=page]')).toHaveAttribute('aria-selected','true');
 await root.locator('[data-act=rotate]').click();await expect(root.locator('.image-select-status')).toHaveText('Page found');
});
