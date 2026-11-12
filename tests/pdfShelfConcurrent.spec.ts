import {test, expect} from '@playwright/test';

// Encode two documents at once, then hold the first list read *after* it has
// committed. This opens the same window as a quick document switch, without
// depending on the browser scheduler to hit it by chance.
test('overlapping sketch saves do not prune one another', async ({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:''}],active:0}));});
 await page.goto('/');await page.waitForFunction(()=>Boolean(window.__satr));
 const pending=page.evaluate(async()=>{
  const {keepSketches,forgetSketches,recallSketches}=await window.__satr.load('/src/pdfSketchCache.ts');
  const {asideKeys}=await window.__satr.load('/src/webStore.ts');
  await forgetSketches();
  const get=IDBObjectStore.prototype.get;
  let held=false;
  IDBObjectStore.prototype.get=function(key: IDBValidKey | IDBKeyRange){
   const request=get.call(this,key);
   if(this.name==='files' && key==='\u0000aside/pdf-sketches-list' && !held){
    held=true;
    const tx=this.transaction;
    const success=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess')!;
    const complete=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete')!;
    let requestHandler: ((event: Event) => void) | null = null;
    let transactionHandler: ((event: Event) => void) | null = null;
    let requestEvent: Event;
    let completeEvent: Event;
    Object.defineProperty(request,'onsuccess',{configurable:true,get:()=>null,set:handler=>{
      requestHandler=handler;
      success.set!.call(request,(event:Event)=>{requestEvent=event;});
    }});
    Object.defineProperty(tx,'oncomplete',{configurable:true,get:()=>null,set:handler=>{
      transactionHandler=handler;
      complete.set!.call(tx,(event:Event)=>{completeEvent=event;});
    }});
    tx.addEventListener('complete',()=>{
      (window as any).auditShelfReady=true;
      (window as any).auditShelfRelease=()=>{requestHandler?.call(request,requestEvent);transactionHandler?.call(tx,completeEvent);};
    });
   }
   return request;
  };
  const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;
  canvas.getContext('2d')!.fillRect(0,0,100,100);
  const saves=Promise.all([
   keepSketches('alpha',1,0,new Map([[0,canvas]])),
   keepSketches('bravo',1,0,new Map([[0,canvas]])),
  ]);
  await saves;
  IDBObjectStore.prototype.get=get;
  const keys=(await asideKeys()).filter((key:string)=>key.startsWith('pdf-sketches/')).sort();
  return {keys,alpha:(await recallSketches('alpha',1)).length,bravo:(await recallSketches('bravo',1)).length};
 });
 await page.waitForFunction(()=>(window as any).auditShelfReady);
 await page.waitForTimeout(250); // let the other save run if it is not serialized
 await page.evaluate(()=>(window as any).auditShelfRelease());
 const result=await pending;
 expect(result.keys).toEqual(['pdf-sketches/alpha','pdf-sketches/bravo']);
 expect(result.alpha).toBe(1);
 expect(result.bravo).toBe(1);
});

for (const failure of ['no context', 'draw throws'] as const) {
 test(`a recalled picture releases its bitmap when ${failure}`, async ({page}) => {
  await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:''}],active:0}));});
  await page.goto('/'); await page.waitForFunction(()=>Boolean(window.__satr));
  const result = await page.evaluate(async (kind) => {
   const shelf=window.__satr.load('/src/pdfSketchCache.ts');await shelf.forgetSketches();
   const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;canvas.getContext('2d')!.fillRect(0,0,100,100);
   await shelf.keepSketches('bitmap-release',1,0,new Map([[0,canvas]]));
   const bitmap=window.createImageBitmap;const context=HTMLCanvasElement.prototype.getContext;let closed=0;
   window.createImageBitmap=async()=>({width:100,height:100,close:()=>{closed++;}} as ImageBitmap);
   (HTMLCanvasElement.prototype as any).getContext=function(){return kind==='no context'?null:{drawImage(){throw new Error('injected draw failure');}};};
   try {const pages=await shelf.recallSketches('bitmap-release',1);return {closed,pages:pages.length};}
   finally {window.createImageBitmap=bitmap;HTMLCanvasElement.prototype.getContext=context;}
  },failure);
  expect(result.pages).toBe(0);expect(result.closed,'the decoded bitmap is released').toBe(1);
 });
}
