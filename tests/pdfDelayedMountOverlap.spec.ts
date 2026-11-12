import {test,expect} from '@playwright/test';
import {tinyPdf} from './support/tinyPdf';
test('an older PDF mount finishing late cannot remove the active viewer pan claim',async({page})=>{
 const first=tinyPdf(2),second=tinyPdf(3);
 await page.addInitScript(({first,second})=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/note.md':1,'Notes/a.pdf':1,'Notes/b.pdf':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/note.md','note');localStorage.setItem('satr:fs:file:Notes/a.pdf',first);localStorage.setItem('satr:fs:file:Notes/b.pdf',second);localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/note.md'},{path:'Notes/a.pdf'},{path:'Notes/b.pdf'}],active:0}));},{first,second});
 await page.goto('/');await expect(page.locator('#app .cm-file-name')).toHaveText('note');
 await page.evaluate(()=>{
  const get=IDBObjectStore.prototype.get;let held=false;
  IDBObjectStore.prototype.get=function(key:IDBValidKey|IDBKeyRange){const request=get.call(this,key);if(this.name==='files'&&String(key).startsWith('\u0000aside/pdf-sketches/')&&!held){held=true;const tx=this.transaction;const success=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess')!;const complete=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete')!;let sh:any,ch:any,se:Event,ce:Event;
   Object.defineProperty(request,'onsuccess',{configurable:true,get:()=>null,set:h=>{sh=h;success.set!.call(request,(e:Event)=>{se=e;});}});
   Object.defineProperty(tx,'oncomplete',{configurable:true,get:()=>null,set:h=>{ch=h;complete.set!.call(tx,(e:Event)=>{ce=e;});}});
   tx.addEventListener('complete',()=>{(window as any).heldRecall=true;(window as any).releaseRecall=()=>{sh?.call(request,se);ch?.call(tx,ce);};});}
   return request;};
  const timer=window.setTimeout.bind(window);let delayed=false;
  window.setTimeout=((fn:TimerHandler,ms?:number,...args:any[])=>{if(ms===160&&!delayed){delayed=true;return timer(fn,20000,...args);}return timer(fn,ms,...args);}) as typeof window.setTimeout;
 });
 await page.locator('#nav-tabs').first().evaluate((el:HTMLElement)=>el.click());await page.locator('.mobile-tab-title').getByText('a.pdf',{exact:true}).click();
 await page.waitForFunction(()=>(window as any).heldRecall,{timeout:20000});await expect(page.locator('.pdf-page')).toHaveCount(2,{timeout:10000});
 await page.locator('#nav-tabs').first().evaluate((el:HTMLElement)=>el.click());await page.locator('.mobile-tab-title').getByText('b.pdf',{exact:true}).click();
 await expect(page.locator('#topbar-title')).toHaveText('b.pdf');await expect(page.locator('.pdf-page')).toHaveCount(3,{timeout:20000});await expect(page.locator('.pdf-page canvas').first()).toBeVisible({timeout:20000});
 expect(await page.locator('#preview-pane').getAttribute('data-pan-x'),'the live PDF can claim horizontal pan').not.toBeNull();
 await page.evaluate(()=>(window as any).releaseRecall());await page.waitForTimeout(500);
 await expect(page.locator('#topbar-title')).toHaveText('b.pdf');
 expect(await page.locator('#preview-pane').getAttribute('data-pan-x'),'late cleanup leaves the live PDF pan claim intact').not.toBeNull();
 await page.locator('#nav-tabs').first().evaluate((el:HTMLElement)=>el.click());await page.locator('.mobile-tab-title').getByText('note',{exact:true}).click();
 await expect(page.locator('#app .cm-file-name')).toHaveText('note');
 expect(await page.locator('#preview-pane').getAttribute('data-pan-x'),'the last PDF gives the pan claim back').toBeNull();
});

test('a zoomed PDF keeps its drawer closed after an older mount finishes',async({page})=>{
 const first=tinyPdf(2),second=tinyPdf(3);
 await page.addInitScript(({first,second})=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/note.md':1,'Notes/a.pdf':1,'Notes/b.pdf':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/note.md','note');localStorage.setItem('satr:fs:file:Notes/a.pdf',first);localStorage.setItem('satr:fs:file:Notes/b.pdf',second);localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/note.md'},{path:'Notes/a.pdf'},{path:'Notes/b.pdf'}],active:0}));},{first,second});
 await page.goto('/');await expect(page.locator('#app .cm-file-name')).toHaveText('note');
 await page.evaluate(()=>{
  const get=IDBObjectStore.prototype.get;let held=false;
  IDBObjectStore.prototype.get=function(key:IDBValidKey|IDBKeyRange){const request=get.call(this,key);if(this.name==='files'&&String(key).startsWith('\u0000aside/pdf-sketches/')&&!held){held=true;const tx=this.transaction;const success=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess')!;const complete=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete')!;let sh:any,ch:any,se:Event,ce:Event;
   Object.defineProperty(request,'onsuccess',{configurable:true,get:()=>null,set:h=>{sh=h;success.set!.call(request,(e:Event)=>{se=e;});}});
   Object.defineProperty(tx,'oncomplete',{configurable:true,get:()=>null,set:h=>{ch=h;complete.set!.call(tx,(e:Event)=>{ce=e;});}});
   tx.addEventListener('complete',()=>{(window as any).heldRecall=true;(window as any).releaseRecall=()=>{sh?.call(request,se);ch?.call(tx,ce);};});}
   return request;};
  const timer=window.setTimeout.bind(window);let delayed=false;
  window.setTimeout=((fn:TimerHandler,ms?:number,...args:any[])=>{if(ms===160&&!delayed){delayed=true;return timer(fn,20000,...args);}return timer(fn,ms,...args);}) as typeof window.setTimeout;
 });
 await page.locator('#nav-tabs').first().evaluate((el:HTMLElement)=>el.click());await page.locator('.mobile-tab-title').getByText('a.pdf',{exact:true}).click();
 await page.waitForFunction(()=>(window as any).heldRecall,{timeout:20000});await expect(page.locator('.pdf-page')).toHaveCount(2,{timeout:10000});
 await page.locator('#nav-tabs').first().evaluate((el:HTMLElement)=>el.click());await page.locator('.mobile-tab-title').getByText('b.pdf',{exact:true}).click();
 await expect(page.locator('#topbar-title')).toHaveText('b.pdf');await expect(page.locator('.pdf-page')).toHaveCount(3,{timeout:20000});await expect(page.locator('.pdf-page canvas').first()).toBeVisible({timeout:20000});
 expect(await page.locator('#preview-pane').getAttribute('data-pan-x'),'the live PDF can claim horizontal pan').not.toBeNull();
 await page.locator('.pdf-toolbar-button[aria-label="Zoom in"]').evaluate((el:HTMLElement)=>el.click());
 await expect.poll(()=>page.locator('#preview-pane').evaluate((p:HTMLElement)=>p.scrollWidth-p.clientWidth),{timeout:10000}).toBeGreaterThan(20);
 const pane=page.locator('#preview-pane');await pane.hover();await page.mouse.wheel(-3000,0);
 await expect.poll(()=>pane.evaluate((p:HTMLElement)=>p.scrollLeft),{timeout:3000}).toBe(0);
 await page.evaluate(()=>(window as any).releaseRecall());await page.waitForTimeout(500);
 await expect(page.locator('#topbar-title')).toHaveText('b.pdf');
 const box=(await pane.boundingBox())!;const x=box.x+70,y=box.y+box.height/2;const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let n=1;n<=8;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+n*22,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForTimeout(700);
 expect(await page.evaluate(()=>document.body.classList.contains('files-open')||document.body.classList.contains('outline-open')),'a pan at the page edge does not open a drawer').toBe(false);
});

test('a repeated old destruction cannot remove a newer pane pan claim',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:''}],active:0}));});await page.goto('/');await page.waitForFunction(()=>Boolean(window.__satr));
 const state=await page.evaluate(async(pdf)=>{
  const {showPdf}=window.__satr.load('/src/pdfView.ts');const bytes=Uint8Array.from(atob(pdf.split(',')[1]),c=>c.charCodeAt(0));const scroller=document.createElement('div');scroller.style.cssText='position:fixed;width:390px;height:700px;overflow:auto';const host=document.createElement('div');scroller.append(host);document.body.append(scroller);
  const first=await showPdf(host,bytes.slice().buffer,{scroller});first.destroy();
  const second=await showPdf(host,bytes.slice().buffer,{scroller});first.destroy();const whileNew=scroller.hasAttribute('data-pan-x');second.destroy();const after=scroller.hasAttribute('data-pan-x');scroller.remove();return {whileNew,after};
 },tinyPdf(3));
 expect(state.whileNew,'the new viewer keeps the pan claim after a repeated old cleanup').toBe(true);
 expect(state.after,'the final cleanup releases the claim').toBe(false);
});

