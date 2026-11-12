import {expect,test} from '@playwright/test';
import {typesetPdf} from './support/tinyPdf';
test('a later search hit survives an opening-pane layout reset',async({page})=>{
 const pdf=typesetPdf([{chapter:'first'}, {chapter:'quenchfirst'}, {chapter:'quenchsecond'}]);
 await page.addInitScript(pdf=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:search-scope','all');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/a.pdf':1,'Notes/note.md':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/a.pdf',pdf);localStorage.setItem('satr:fs:file:Notes/note.md','note');localStorage.setItem('satr:spaces',JSON.stringify([{id:'notes',name:'Notes',path:'Notes'}]));localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/note.md'}],active:0}));},pdf);
 await page.goto('/');await page.keyboard.press('Control+Shift+f');const panel=page.locator('#right-panel');await panel.locator('[data-scope="all"]').click();await panel.locator('.vault-search').fill('quench');const hits=panel.locator('.search-result-file-match[data-path="Notes/a.pdf"]');await expect(hits).toHaveCount(2,{timeout:20000});
 await page.evaluate(async()=>{const {pdfium}=window.__satr.load('/src/pdfiumEngine.ts');const engine=await pdfium();const original=engine.openDocumentBuffer.bind(engine);engine.openDocumentBuffer=(...args:any[])=>{const task=original(...args);return {toPromise:async()=>{const result=await task.toPromise();await new Promise<void>(resolve=>{(window as any).releasePdfBytes=resolve;});return result;}};};});
 await hits.first().click();await page.waitForFunction(()=>Boolean((window as any).releasePdfBytes));await page.keyboard.press('Control+Shift+f');await expect(panel).toBeVisible();await panel.locator('[data-scope="all"]').click();await panel.locator('.vault-search').fill('quench');await expect(hits).toHaveCount(2,{timeout:20000});await hits.last().click();
 await page.evaluate(()=>(window as any).releasePdfBytes());
 await expect(page.locator('.pdf-counter')).toHaveText('3 / 3',{timeout:20000});
 // An opening pane can lose its scroll when laid out again, with no hand on it.
 await page.evaluate(()=>{document.querySelector('#preview')!.parentElement!.scrollTop=0;});
 await expect(page.locator('.pdf-counter')).toHaveText('3 / 3',{timeout:5000});
 // The held place must not fight an actual reader taking over.
 await page.locator('#preview-pane').dispatchEvent('pointerdown',{pointerType:'touch',pointerId:7});
 await page.evaluate(()=>{document.querySelector('#preview')!.parentElement!.scrollTop=0;});
 await expect(page.locator('.pdf-counter')).toHaveText('1 / 3',{timeout:5000});
});
