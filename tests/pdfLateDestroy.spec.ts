import {test,expect} from '@playwright/test';
import {tinyPdf} from './support/tinyPdf';
const PDF = tinyPdf(3);

test('a late draw cannot start more PDF work or schedule idle saving after destruction',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:''}],active:0}));});
 await page.goto('/');await page.waitForFunction(()=>Boolean(window.__satr));
 const result=await page.evaluate(async(pdf)=>{
  const {showPdf}=window.__satr.load('/src/pdfView.ts'),engine=await window.__satr.load('/src/pdfiumEngine.ts').pdfium(),bytes=Uint8Array.from(atob(pdf.split(',')[1]),c=>c.charCodeAt(0));const scroller=document.createElement('div'),host=document.createElement('div');scroller.style.cssText='position:fixed;left:0;top:0;width:390px;height:500px;overflow:auto';scroller.append(host);document.body.append(scroller);let calls=0,afterDestroy=false,lateCalls=0,idleAfterDestroy=0,release:()=>void=()=>{};
  const render=()=>{calls++;if(afterDestroy)lateCalls++;return {abort:()=>{},toPromise:()=>calls===1?new Promise((_,reject)=>{release=()=>reject(new Error('late simulated draw'));}):Promise.reject(new Error('simulated draw'))};};
  engine.renderPageRaw=render;engine.renderPageRectRaw=render;
  const timer=window.setTimeout.bind(window);window.setTimeout=((fn:TimerHandler,ms?:number,...args:any[])=>{if(afterDestroy&&ms===500)idleAfterDestroy++;return timer(fn,ms,...args);}) as typeof window.setTimeout;
  const h=await showPdf(host,bytes.buffer,{scroller});const initial=calls;h.destroy();afterDestroy=true;release();await new Promise(resolve=>timer(resolve,900));scroller.remove();return {initial,lateCalls,idleAfterDestroy};
 },PDF);
 console.log('LATE_DRAW_AFTER_DESTROY',JSON.stringify(result));
 expect(result.initial,'a draw was held in flight').toBe(1);
 expect(result.lateCalls,'no additional worker draws start for a destroyed view').toBe(0);
 expect(result.idleAfterDestroy,'no idle save is scheduled after destruction').toBe(0);
});


test('a queued resize from a closed PDF cannot restore its old place over a newer PDF',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:''}],active:0}));});
 await page.goto('/');await page.waitForFunction(()=>Boolean(window.__satr));
 const result=await page.evaluate(async(pdf)=>{
  const {showPdf}=window.__satr.load('/src/pdfView.ts');const bytes=Uint8Array.from(atob(pdf.split(',')[1]),c=>c.charCodeAt(0));const scroller=document.createElement('div'),host=document.createElement('div');scroller.style.cssText='position:fixed;left:0;top:0;width:390px;height:500px;overflow:auto';scroller.append(host);document.body.append(scroller);
  const original=window.ResizeObserver;const callbacks:ResizeObserverCallback[]=[];window.ResizeObserver=class extends original {constructor(callback:ResizeObserverCallback){super(callback);callbacks.push(callback);}};
  const old=await showPdf(host,bytes.slice().buffer,{scroller,place:{page:2,into:0,zoom:1}});const newer=await showPdf(host,bytes.slice().buffer,{scroller});old.destroy();scroller.scrollTop=0;const before=scroller.scrollTop;callbacks[0]([] as any,{} as any);const after=scroller.scrollTop;const pages=host.querySelectorAll('.pdf-page').length;window.ResizeObserver=original;newer.destroy();scroller.remove();return {before,after,pages};
 },PDF);
 console.log('LATE_RESIZE_AFTER_DESTROY',JSON.stringify(result));
 expect(result.pages).toBe(3);expect(result.before).toBe(0);
 expect(result.after,'a closed reader cannot move the newer reader').toBe(0);
});

