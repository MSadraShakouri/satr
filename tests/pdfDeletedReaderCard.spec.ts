import {test,expect} from '@playwright/test';
import {tinyPdf} from './support/tinyPdf';
for (const kind of ['file','folder'] as const) {
 test(`closing a deleted active PDF does not refile its ${kind} card`,async({page})=>{
  await page.addInitScript(pdf=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/Private/book.pdf':1,'Notes/note.md':1},folders:['Notes','Notes/Private']}));localStorage.setItem('satr:fs:file:Notes/Private/book.pdf',pdf);localStorage.setItem('satr:fs:file:Notes/note.md','note');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/Private/book.pdf'},{path:'Notes/note.md'}],active:0}));localStorage.setItem('satr:expanded:notes',JSON.stringify(['Notes','Notes/Private']));localStorage.setItem('satr:spaces',JSON.stringify([{id:'notes',name:'Notes',path:'Notes'}]));},tinyPdf(3));
  await page.goto('/');await expect(page.locator('.pdf-page canvas').first()).toBeVisible({timeout:20000});
  await page.locator('#files').click();
  await page.locator(`#file-panel .tree-item-self[data-path="${kind==='file'?'Notes/Private/book.pdf':'Notes/Private'}"]`).click({button:'right'});
  await page.locator('.menu.mod-bottom-sheet .menu-item',{hasText:'Delete'}).click();await page.locator('.menu.mod-bottom-sheet .menu-item',{hasText:'Delete'}).last().click();
  await expect.poll(()=>page.evaluate(async()=>window.__satr.load('/src/vault.ts').backend.stat('Notes/Private/book.pdf'))).toBeNull();
  await expect(page.locator('#app .cm-file-name')).toHaveText('note');
  await page.waitForTimeout(1500);
  const card=await page.evaluate(async()=>window.__satr.load('/src/pdfCard.ts').recallCard('Notes/Private/book.pdf'));
  expect(card,'a deleted document must not be saved again on reader destruction').toBeNull();
 });
}

test('renaming an open PDF folder refiles at the new path and forgets both old occupants', async ({page}) => {
 await page.addInitScript(pdf=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/Private/book.pdf':1,'Notes/note.md':1},folders:['Notes','Notes/Private']}));localStorage.setItem('satr:fs:file:Notes/Private/book.pdf',pdf);localStorage.setItem('satr:fs:file:Notes/note.md','note');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/Private/book.pdf'},{path:'Notes/note.md'}],active:0}));localStorage.setItem('satr:expanded:notes',JSON.stringify(['Notes','Notes/Private']));localStorage.setItem('satr:spaces',JSON.stringify([{id:'notes',name:'Notes',path:'Notes'}]));},tinyPdf(3));
 await page.goto('/');await expect(page.locator('.pdf-page canvas').first()).toBeVisible({timeout:20000});
 await page.evaluate(async()=>{
  const {keepCard}=window.__satr.load('/src/pdfCard.ts');
  const c=document.createElement('canvas');c.width=100;c.height=140;c.getContext('2d')!.fillRect(0,0,100,140);
  await keepCard('Notes/Renamed/book.pdf',8,9,c);
 });
 await page.locator('#files').click();
 await page.locator('#file-panel .tree-item-self[data-path="Notes/Private"]').click({button:'right'});
 await page.locator('.menu.mod-bottom-sheet .menu-item',{hasText:'Rename'}).click();
 const editable=page.locator('#file-panel .is-being-renamed [contenteditable]');
 await editable.fill('Renamed'); await editable.press('Enter');
 await expect.poll(()=>page.evaluate(async()=>window.__satr.load('/src/vault.ts').backend.stat('Notes/Renamed/book.pdf'))).not.toBeNull();
 // Leaving the still-open viewer files a fresh card under the new path.
 await page.keyboard.press('Escape');
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await page.locator('#app #nav-tabs').first().dispatchEvent('click');
 await expect.poll(()=>page.evaluate(async()=>{
  const c=await window.__satr.load('/src/pdfCard.ts').recallCard('Notes/Renamed/book.pdf');return c?.pages ?? null;
 }),{timeout:10000}).toBe(3);
 const old=await page.evaluate(async()=>window.__satr.load('/src/pdfCard.ts').recallCard('Notes/Private/book.pdf'));
 expect(old).toBeNull();
});
