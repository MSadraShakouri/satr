import { expect, test } from '@playwright/test';

async function ready(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: '' }], active: 0 }));
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__satr));
}

test('an old JPEG in flight cannot overwrite a replacement card', async ({page}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const cards = window.__satr.load('/src/pdfCard.ts');
    const lifecycle = window.__satr.load('/src/pdfCardLifecycle.ts');
    const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 50;
    canvas.getContext('2d')!.fillRect(0, 0, 40, 50);
    const real = HTMLCanvasElement.prototype.toBlob;
    let release!: () => void; let ready!: () => void;
    const started = new Promise<void>(r => { ready = r; });
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      HTMLCanvasElement.prototype.toBlob = real;
      real.call(this, blob => { release = () => callback(blob); ready(); }, ...args);
    };
    try {
      const old = cards.keepCard('Notes/A/book.pdf', 2, 3, canvas);
      await started;
      const deletion = lifecycle.forgetPdfCardsWithin('Notes/A');
      const replacement = cards.keepCard('Notes/A/book.pdf', 1, 1, canvas);
      release();
      await Promise.all([old, deletion, replacement]);
      const card = await cards.recallCard('Notes/A/book.pdf');
      return card && {page: card.page, pages: card.pages};
    } finally { HTMLCanvasElement.prototype.toBlob = real; }
  });
  expect(result).toEqual({page: 1, pages: 1});
});

test('subtree invalidation leaves similarly named siblings and fresh writes alone', async ({page}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const cards = window.__satr.load('/src/pdfCard.ts');
    const lifecycle = window.__satr.load('/src/pdfCardLifecycle.ts');
    const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 50;
    canvas.getContext('2d')!.fillRect(0, 0, 40, 50);
    await Promise.all([
      cards.keepCard('Notes/A/book.pdf', 2, 3, canvas),
      cards.keepCard('Notes/AB/book.pdf', 4, 5, canvas),
      cards.keepCard('Notes/A/sub/book.pdf', 6, 7, canvas),
    ]);
    const oldEpoch = lifecycle.cardEpoch('Notes/A/late.pdf');
    const deletion = lifecycle.forgetPdfCardsWithin('Notes/A');
    const stale = cards.keepCard('Notes/A/late.pdf', 8, 9, canvas, {epoch: oldEpoch});
    const replacement = cards.keepCard('Notes/A/book.pdf', 1, 1, canvas);
    await Promise.all([deletion, stale, replacement]);
    return Promise.all(['Notes/A/book.pdf', 'Notes/AB/book.pdf', 'Notes/A/sub/book.pdf', 'Notes/A/late.pdf'].map(async path => {
      const card = await cards.recallCard(path); return card ? card.page : null;
    }));
  });
  expect(result).toEqual([1, 4, null, null]);
});

test('invalidation waits for an already-issued card write before a new occupant files', async ({page}) => {
 await ready(page);
 const result = page.evaluate(async () => {
  const cards=window.__satr.load('/src/pdfCard.ts');
  const lifecycle=window.__satr.load('/src/pdfCardLifecycle.ts');
  const canvas=document.createElement('canvas');canvas.width=40;canvas.height=50;canvas.getContext('2d')!.fillRect(0,0,40,50);
  const put=IDBObjectStore.prototype.put; let intercepted=false;
  IDBObjectStore.prototype.put=function(value,key) {
   const request=put.call(this,value,key);
   if(key==='\u0000aside/pdf-card/Notes/A/book.pdf' && !intercepted) {
    intercepted=true;
    const original=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess')!;
    let handler: ((event:Event)=>void)|null=null; let event:Event;
    Object.defineProperty(request,'onsuccess',{configurable:true,get:()=>null,set:fn=>{
     handler=fn;original.set!.call(request,(e:Event)=>{event=e;(window as any).cardPutReady=true;(window as any).releaseCardPut=()=>handler?.call(request,event);});
    }});
   }
   return request;
  };
  try {
   const old=cards.keepCard('Notes/A/book.pdf',2,3,canvas);
   await new Promise<void>(resolve=>{
    const check=()=>{if((window as any).cardPutReady) resolve();else requestAnimationFrame(check);};check();
   });
   const deletion=lifecycle.forgetPdfCardsWithin('Notes/A');
   const fresh=cards.keepCard('Notes/A/book.pdf',1,1,canvas);
   (window as any).releaseCardPut();
   await Promise.all([old,deletion,fresh]);
   const result=await cards.recallCard('Notes/A/book.pdf');return result && {page:result.page,pages:result.pages};
  } finally { IDBObjectStore.prototype.put=put; }
 });
 expect(await result).toEqual({page:1,pages:1});
});

test('a recalled old card is discarded if its folder changes while the read is in flight', async ({page}) => {
 await ready(page);
 const result=await page.evaluate(async()=>{
  const cards=window.__satr.load('/src/pdfCard.ts');const lifecycle=window.__satr.load('/src/pdfCardLifecycle.ts');
  const canvas=document.createElement('canvas');canvas.width=40;canvas.height=50;canvas.getContext('2d')!.fillRect(0,0,40,50);
  await cards.keepCard('Notes/A/book.pdf',2,3,canvas);
  const get=IDBObjectStore.prototype.get;let ready!:()=>void;let release!:()=>void;
  const started=new Promise<void>(r=>ready=r);
  IDBObjectStore.prototype.get=function(key) {
   const request=get.call(this,key);
   if(key==='\u0000aside/pdf-card/Notes/A/book.pdf') {
    const original=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess')!;
    let handler:((event:Event)=>void)|null=null;
    Object.defineProperty(request,'onsuccess',{configurable:true,get:()=>null,set:fn=>{handler=fn;original.set!.call(request,(e:Event)=>{release=()=>handler?.call(request,e);ready();});}});
   }
   return request;
  };
  try {
   const old=cards.recallCard('Notes/A/book.pdf');await started;
   const deletion=lifecycle.forgetPdfCardsWithin('Notes/A');release();
   const recalled=await old;await deletion;return recalled;
  } finally { IDBObjectStore.prototype.get=get; }
 });
 expect(result).toBeNull();
});
