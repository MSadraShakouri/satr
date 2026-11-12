import { test, expect } from '@playwright/test';
import { tinyPdf } from './support/tinyPdf';

test('a deleted folder must not leave a child PDF card for a replacement file', async ({page})=>{
 await page.addInitScript(({pdf})=>{
  if(localStorage.getItem('audit:seeded')) return;
  localStorage.setItem('audit:seeded','1'); localStorage.setItem('satr:demoShown','1');
  localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/Private/book.pdf':1,'Notes/note.md':1},folders:['Notes','Notes/Private']}));
  localStorage.setItem('satr:fs:file:Notes/Private/book.pdf',pdf);
  localStorage.setItem('satr:fs:file:Notes/note.md','note');
  localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/note.md'}],active:0}));
  localStorage.setItem('satr:spaces',JSON.stringify([{id:'notes',name:'Notes',path:'Notes'}]));
 },{pdf:tinyPdf(1)});
 await page.goto('/');await expect(page.locator('#app .cm-content').first()).toContainText('note');
 await page.evaluate(async()=>{
  const {keepCard}=await window.__satr.load('/src/pdfCard.ts');
  const c=document.createElement('canvas');c.width=100;c.height=140;const ctx=c.getContext('2d')!;ctx.fillStyle='red';ctx.fillRect(0,0,100,140);
  await keepCard('Notes/Private/book.pdf',2,3,c);
 });
 await page.locator('#files').click();
 await page.locator('#file-panel .tree-item-self[data-path="Notes/Private"]').click({button:'right'});
 await page.locator('.menu.mod-bottom-sheet .menu-item', {hasText:'Delete'}).click();
 await page.locator('.menu.mod-bottom-sheet .menu-item', {hasText:'Delete'}).last().click();
 await expect.poll(async()=>page.evaluate(async()=> (await window.__satr.load('/src/vault.ts')).backend.stat('Notes/Private'))).toBeNull();
 await page.evaluate(async(pdf)=>{
  const {backend}=await window.__satr.load('/src/vault.ts');
  await backend.write('Notes/Private/book.pdf',pdf);
  localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/note.md'},{path:'Notes/Private/book.pdf'}],active:0}));
 }, tinyPdf(1));
 await page.reload();await expect(page.locator('#app .cm-content').first()).toContainText('note');
 await page.locator('#app #nav-tabs').first().dispatchEvent('click');
 await expect(page.locator('.mobile-tab-switcher')).toBeVisible();
 const card=page.locator('.mobile-tab-preview-page').filter({hasText:'book'});
 await expect(card).toHaveCount(1);
 await expect(card.locator('img.tab-card-page')).toHaveCount(0);
 await expect(card).not.toContainText('Page 2 of 3');
});
