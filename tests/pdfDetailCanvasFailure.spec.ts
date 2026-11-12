import {test,expect} from '@playwright/test';
import {tinyPdf} from './support/tinyPdf';
test('a tile can be sharpened after its replacement canvas fails',async({page})=>{
 await page.addInitScript((pdf)=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/handout.pdf':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/handout.pdf',pdf);localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/handout.pdf'}],active:0}));},tinyPdf(3));
 await page.goto('/');await expect(page.locator('.pdf-page')).toHaveCount(3,{timeout:20000});
 await expect(page.locator('.pdf-page').first().locator('canvas.pdf-raster:not(.pdf-detail)')).toHaveCount(1,{timeout:20000});
 const plus=page.locator('.pdf-toolbar-button[aria-label="Zoom in"]');
 await plus.evaluate((el:HTMLElement)=>el.click());
 await expect(page.locator('.pdf-page').first().locator('canvas.pdf-detail')).toHaveCount(1,{timeout:20000});
 await page.waitForTimeout(1200);
 await page.evaluate(()=>{
   (window as any).savedTile=document.querySelector('.pdf-page canvas.pdf-detail');
   const original=HTMLCanvasElement.prototype.getContext;
   (HTMLCanvasElement.prototype as any).getContext=function(type:string,...args:unknown[]){
    if(type==='2d'&&this.width>=200&&this.height>=200&&!(window as any).failedTileCanvas){(window as any).failedTileCanvas=true;return null;}
    return (original as any).call(this,type,...args);
   };
 });
 await plus.evaluate((el:HTMLElement)=>el.click());
 await expect.poll(()=>page.evaluate(()=>(window as any).failedTileCanvas),{timeout:10000}).toBe(true);
 expect(await page.evaluate(()=>(window as any).savedTile===document.querySelector('.pdf-page canvas.pdf-detail')), 'the failed replacement leaves the previous tile in place').toBe(true);
 await page.waitForTimeout(1000);
 const pane=page.locator('#preview-pane');await pane.hover();await page.mouse.wheel(0,1);await page.mouse.wheel(0,-1);
 await expect.poll(()=>page.evaluate(()=>{ const current=document.querySelector('.pdf-page canvas.pdf-detail'); return current !== null && (window as any).savedTile !== current; }),{timeout:5000,message:'a later plan must replace the stale tile'}).toBe(true);
});

test('an unavailable replacement tile does not spin while idle and can recover',async({page})=>{
 await page.addInitScript((pdf)=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/handout.pdf':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/handout.pdf',pdf);localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/handout.pdf'}],active:0}));},tinyPdf(3));
 await page.goto('/');await expect(page.locator('.pdf-page')).toHaveCount(3,{timeout:20000});
 await expect(page.locator('.pdf-page').first().locator('canvas.pdf-raster:not(.pdf-detail)')).toHaveCount(1,{timeout:20000});
 const plus=page.locator('.pdf-toolbar-button[aria-label="Zoom in"]');
 await plus.evaluate((el:HTMLElement)=>el.click());
 await expect(page.locator('.pdf-page').first().locator('canvas.pdf-detail')).toHaveCount(1,{timeout:20000});await page.waitForTimeout(1200);
 await page.evaluate(()=>{
  (window as any).savedTile=document.querySelector('.pdf-page canvas.pdf-detail');
  (window as any).failTile=true;(window as any).failures=0;
  const original=HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).getContext=function(type:string,...args:unknown[]){
   if(type==='2d'&&this.width>=200&&this.height>=200&&(window as any).failTile){(window as any).failures++;return null;}
   return (original as any).call(this,type,...args);
  };
 });
 await plus.evaluate((el:HTMLElement)=>el.click());
 await expect.poll(()=>page.evaluate(()=>(window as any).failures),{timeout:10000}).toBeGreaterThan(0);
 await page.waitForTimeout(1500);const failures=await page.evaluate(()=>(window as any).failures);await page.waitForTimeout(1000);
 expect(await page.evaluate(()=>(window as any).failures),'a broken context does not spin without another plan').toBe(failures);
 await page.evaluate(()=>{(window as any).failTile=false;});
 const pane=page.locator('#preview-pane');await pane.hover();await page.mouse.wheel(0,1);await page.mouse.wheel(0,-1);
 await expect.poll(()=>page.evaluate(()=>{const current=document.querySelector('.pdf-page canvas.pdf-detail');return current!==null&&(window as any).savedTile!==current;}),{timeout:5000,message:'a later plan replaces the tile after recovery'}).toBe(true);
});
