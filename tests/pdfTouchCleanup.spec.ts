import { test, expect } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

test('reopening PDFs does not accumulate touch listeners on the shared pane',async({page})=>{
 await page.addInitScript((pdf)=>{
  localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/book.pdf':1,'Notes/note.md':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/book.pdf',pdf);localStorage.setItem('satr:fs:file:Notes/note.md','note');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/note.md'},{path:'Notes/book.pdf'}],active:0}));
  const active=new Set<EventListenerOrEventListenerObject>();(window as any).paneTouchListeners=active;
  const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener=function(type:string,listener:any,options?:any){if((this as Element).id==='preview-pane'&&type==='touchmove'&&listener)active.add(listener);return add.call(this,type,listener,options);};
  EventTarget.prototype.removeEventListener=function(type:string,listener:any,options?:any){if((this as Element).id==='preview-pane'&&type==='touchmove'&&listener)active.delete(listener);return remove.call(this,type,listener,options);};
 },tinyPdf(3));
 await page.goto('/');await expect(page.locator('#app .cm-file-name')).toHaveText('note');
 const count=()=>page.evaluate(()=>(window as any).paneTouchListeners.size);
 const initial=await count();
 for(let n=0;n<3;n++){
  await page.locator('#nav-tabs').first().evaluate((el:HTMLElement)=>el.click());await page.locator('.mobile-tab-title').getByText('book.pdf',{exact:true}).click();await expect(page.locator('.pdf-page')).toHaveCount(3,{timeout:20000});
  await page.locator('#nav-tabs').first().evaluate((el:HTMLElement)=>el.click());await page.locator('.mobile-tab-title').getByText('note',{exact:true}).click();await expect(page.locator('#app .cm-file-name')).toHaveText('note');
  expect(await count(),`closed PDF ${n+1} releases its touch listener`).toBe(initial);
 }
});

