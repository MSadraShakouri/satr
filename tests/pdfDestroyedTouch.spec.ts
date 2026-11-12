import { test, expect } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';
test('closing a PDF during a held zoom releases the shared preview pane', async ({page}) => {
 await page.addInitScript((pdf)=>{
  localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/book.pdf':1,'Notes/note.md':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/book.pdf',pdf);localStorage.setItem('satr:fs:file:Notes/note.md','# a note');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/book.pdf'},{path:'Notes/note.md'}],active:0}));
 },tinyPdf(3));
 await page.goto('/');await expect(page.locator('.pdf-page')).toHaveCount(3,{timeout:20000});
 await page.locator('.pdf-page').first().evaluate((node)=>{
  const opts={bubbles:true,pointerType:'touch',pointerId:91,clientX:150,clientY:200};
  node.dispatchEvent(new PointerEvent('pointerdown',opts));node.dispatchEvent(new PointerEvent('pointerup',opts));
  node.dispatchEvent(new PointerEvent('pointerdown',opts));
 });
 expect(await page.locator('#preview-pane').evaluate((pane:HTMLElement)=>pane.style.touchAction),'the double tap is held before the switch').toBe('none');
 await page.locator('#nav-tabs').first().evaluate((el:HTMLElement)=>el.click());
 await page.locator('.mobile-tab-title').getByText('note',{exact:true}).click();
 await expect(page.locator('.pdf-page')).toHaveCount(0);
 await expect(page.locator('#app .cm-file-name')).toHaveText('note');
 const after=await page.locator('#preview-pane').evaluate((pane:HTMLElement)=>{
  const touch=new Touch({identifier:1,target:pane,clientX:150,clientY:200});
  const event=new TouchEvent('touchmove',{bubbles:true,cancelable:true,touches:[touch]});
  pane.dispatchEvent(event);
  return {cancelled:event.defaultPrevented,touchAction:pane.style.touchAction};
 });
 console.log('DESTROYED_PDF_TOUCH', JSON.stringify(after));
 expect(after.touchAction,'a destroyed PDF does not leave touch-action disabled').toBe('');
 expect(after.cancelled,'a destroyed PDF does not cancel the next view’s touch movement').toBe(false);
});

test('destroying an overlapping PDF does not release another viewer’s held gesture',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:''}],active:0}));});
 await page.goto('/');await page.waitForFunction(()=>Boolean(window.__satr));
 const setup=await page.evaluate(async(pdf)=>{
  const {showPdf}=window.__satr.load('/src/pdfView.ts');const bytes=Uint8Array.from(atob(pdf.split(',')[1]),c=>c.charCodeAt(0));
  const scroller=document.createElement('div');scroller.style.cssText='position:fixed;inset:10px;width:390px;height:700px;overflow:auto;z-index:9999';const host=document.createElement('div');scroller.append(host);document.body.append(scroller);
  const first=await showPdf(host,bytes.slice().buffer,{scroller});
  const tapAndHold=(node:Element,id:number)=>{const opts={bubbles:true,pointerType:'touch',pointerId:id,clientX:150,clientY:200};node.dispatchEvent(new PointerEvent('pointerdown',opts));node.dispatchEvent(new PointerEvent('pointerup',opts));node.dispatchEvent(new PointerEvent('pointerdown',opts));};
  tapAndHold(host.querySelector('.pdf-doc')!,91);const firstHeld=scroller.style.touchAction;
  const second=await showPdf(host,bytes.slice().buffer,{scroller});
  const docs=host.querySelectorAll('.pdf-doc');tapAndHold(docs[1],92);const secondHeld=scroller.style.touchAction;
  first.destroy();
  const afterFirst={touchAction:scroller.style.touchAction,claimed:scroller.hasAttribute('data-ignore-swipe'),pan:scroller.hasAttribute('data-pan-x')};
  const touch=new Touch({identifier:92,target:scroller,clientX:150,clientY:200});const event=new TouchEvent('touchmove',{bubbles:true,cancelable:true,touches:[touch]});scroller.dispatchEvent(event);
  const cancelled=event.defaultPrevented;second.destroy();const afterBoth={touchAction:scroller.style.touchAction,claimed:scroller.hasAttribute('data-ignore-swipe'),pan:scroller.hasAttribute('data-pan-x')};scroller.remove();return {firstHeld,secondHeld,afterFirst,cancelled,afterBoth};
 },tinyPdf(3));
 expect(setup.firstHeld,'first viewer has a held gesture').toBe('none');
 expect(setup.secondHeld,'second viewer has a held gesture').toBe('none');
 expect(setup.afterFirst.touchAction,'the live viewer keeps its gesture').toBe('none');
 expect(setup.afterFirst.claimed,'the live viewer keeps its drawer claim').toBe(true);
 expect(setup.afterFirst.pan,'the live viewer keeps its horizontal pan claim').toBe(true);
 expect(setup.cancelled,'the live viewer still prevents scrolling during its hold').toBe(true);
 expect(setup.afterBoth.touchAction,'the final viewer releases touch action').toBe('');
 expect(setup.afterBoth.claimed,'the final viewer releases the drawer claim').toBe(false);
 expect(setup.afterBoth.pan,'the final viewer releases horizontal pan').toBe(false);
});

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
  console.log('PANE_LISTENER_COUNT',n+1,await count()); expect(await count(),`closed PDF ${n+1} releases its touch listener`).toBe(initial);
 }
});

test('an older held viewer does not cancel touches after a newer hold ends',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:''}],active:0}));});
 await page.goto('/');await page.waitForFunction(()=>Boolean(window.__satr));
 const result=await page.evaluate(async(pdf)=>{
  const {showPdf}=window.__satr.load('/src/pdfView.ts');const bytes=Uint8Array.from(atob(pdf.split(',')[1]),c=>c.charCodeAt(0));
  const scroller=document.createElement('div');scroller.style.cssText='position:fixed;inset:10px;width:390px;height:700px;overflow:auto';const host=document.createElement('div');scroller.append(host);document.body.append(scroller);
  const first=await showPdf(host,bytes.slice().buffer,{scroller});
  const arm=(node:Element,id:number)=>{const o={bubbles:true,pointerType:'touch',pointerId:id,clientX:150,clientY:200};node.dispatchEvent(new PointerEvent('pointerdown',o));node.dispatchEvent(new PointerEvent('pointerup',o));node.dispatchEvent(new PointerEvent('pointerdown',o));};
  arm(host.querySelector('.pdf-doc')!,91);
  const second=await showPdf(host,bytes.slice().buffer,{scroller});const docs=host.querySelectorAll('.pdf-doc');arm(docs[1],92);
  docs[1].dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch',pointerId:92,clientX:150,clientY:200}));
  const touch=new Touch({identifier:4,target:scroller,clientX:150,clientY:200});const event=new TouchEvent('touchmove',{bubbles:true,cancelable:true,touches:[touch]});scroller.dispatchEvent(event);
  const answer={cancelled:event.defaultPrevented,action:scroller.style.touchAction};first.destroy();second.destroy();scroller.remove();return answer;
 },tinyPdf(3));
 expect(result.action,'the newest hold ended').toBe('');
 expect(result.cancelled,'a superseded hold does not cancel future touches').toBe(false);
});

test('a note can scroll by touch after a PDF is closed during a zoom hold',async({page})=>{
 await page.addInitScript((pdf)=>{
  localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/book.pdf':1,'Notes/note.md':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/book.pdf',pdf);localStorage.setItem('satr:fs:file:Notes/note.md',Array.from({length:150},(_,i)=>`Paragraph ${i} has enough words to be a note.\n`).join('\n'));localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/book.pdf'},{path:'Notes/note.md'}],active:0}));
 },tinyPdf(3));
 await page.goto('/');await expect(page.locator('.pdf-page')).toHaveCount(3,{timeout:20000});
 await page.locator('.pdf-page').first().evaluate((node)=>{const o={bubbles:true,pointerType:'touch',pointerId:91,clientX:150,clientY:200};node.dispatchEvent(new PointerEvent('pointerdown',o));node.dispatchEvent(new PointerEvent('pointerup',o));node.dispatchEvent(new PointerEvent('pointerdown',o));});
 expect(await page.locator('#preview-pane').evaluate((p:HTMLElement)=>p.style.touchAction),'the old hold was armed').toBe('none');
 await page.locator('#nav-tabs').first().evaluate((el:HTMLElement)=>el.click());await page.locator('.mobile-tab-title').getByText('note',{exact:true}).click();await expect(page.locator('#app .cm-file-name')).toHaveText('note');
 await page.locator('#preview-toggle').evaluate((el:HTMLElement)=>el.click());
 const pane=page.locator('#preview-pane');await expect.poll(()=>pane.evaluate((p:HTMLElement)=>p.scrollHeight-p.clientHeight),{timeout:10000}).toBeGreaterThan(1000);
 const box=(await pane.boundingBox())!;const x=box.x+box.width/2,y=box.y+box.height*0.7;const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let n=1;n<=8;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-n*30}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(()=>pane.evaluate((p:HTMLElement)=>p.scrollTop),{timeout:3000,message:'the new note scrolls after the old PDF is destroyed'}).toBeGreaterThan(80);
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

test('a superseded PDF hold cannot move the shared pane',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:''}],active:0}));});await page.goto('/');await page.waitForFunction(()=>Boolean(window.__satr));
 const state=await page.evaluate(async(pdf)=>{
  const {showPdf}=window.__satr.load('/src/pdfView.ts');const bytes=Uint8Array.from(atob(pdf.split(',')[1]),c=>c.charCodeAt(0));const scroller=document.createElement('div');scroller.style.cssText='position:fixed;inset:10px;width:390px;height:700px;overflow:auto';const host=document.createElement('div');scroller.append(host);document.body.append(scroller);
  const first=await showPdf(host,bytes.slice().buffer,{scroller});
  const arm=(node:Element,id:number)=>{const o={bubbles:true,pointerType:'touch',pointerId:id,clientX:150,clientY:200};node.dispatchEvent(new PointerEvent('pointerdown',o));node.dispatchEvent(new PointerEvent('pointerup',o));node.dispatchEvent(new PointerEvent('pointerdown',o));};
  arm(host.querySelector('.pdf-doc')!,91);const second=await showPdf(host,bytes.slice().buffer,{scroller});const docs=host.querySelectorAll('.pdf-doc');arm(docs[1],92);
  const before=first.zoomNow();docs[0].dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'touch',pointerId:91,clientX:150,clientY:330}));docs[0].dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch',pointerId:91,clientX:150,clientY:330}));
  const result={before,after:first.zoomNow(),action:scroller.style.touchAction};first.destroy();second.destroy();scroller.remove();return result;
 },tinyPdf(3));
 expect(state.action,'the newer hold remains claimed').toBe('none');
 expect(state.after,'the superseded viewer must not commit a zoom').toBe(state.before);
});
