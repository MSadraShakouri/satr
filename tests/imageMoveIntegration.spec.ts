import {expect,test,type Page} from '@playwright/test';
import {vaultText} from './support/vaultText';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
async function boot(page:Page,active='Notes/Source/A.md'){
 await page.addInitScript((active)=>{
  localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/Source/A.md':1,'Notes/Other.md':1,'Notes/Source/res/pic.png':1},folders:['Notes','Notes/Source','Notes/Source/res','Notes/Destination']}));
  localStorage.setItem('satr:fs:file:Notes/Source/A.md','old ![](res/pic.png)\n');localStorage.setItem('satr:fs:file:Notes/Other.md','other\n');localStorage.setItem('satr:fs:file:Notes/Source/res/pic.png','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Y21sAAAAASUVORK5CYII=');
  localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:active}],active:0}));localStorage.setItem('satr:spaces',JSON.stringify([{id:'notes',name:'Notes',path:'Notes'}]));
 },active);await page.goto('/');await page.waitForSelector('#boot-snapshot',{state:'detached'});
}
async function move(page:Page){await page.locator('#files').click();const source=page.locator('#file-panel .tree-item-self[data-path="Notes/Source"]');await source.click();await page.locator('#file-panel .tree-item-self[data-path="Notes/Source/A.md"]').click({button:'right'});await page.locator('.menu:not(.is-closing) .menu-item',{hasText:'Move to…'}).click();await page.locator('.dir-walk-up').click();await page.locator('.dir-walk [data-into="Notes/Destination"]').click();await page.locator('.dir-walk-confirm').click();}

test('moving an open edited note updates its link and keeps the shared image in place',async({page})=>{
 await boot(page);await page.locator('.cm-content').click();await page.keyboard.press('End');await page.keyboard.type(' more');await move(page);
 await expect.poll(()=>vaultText(page,'Notes/Destination/A.md')).toContain('../Source/res/pic.png');expect(await vaultText(page,'Notes/Source/A.md')).toBeNull();expect(await vaultText(page,'Notes/Destination/A.md')).toContain(' more');expect(await vaultText(page,'Notes/Source/res/pic.png')).toContain('data:image/png');await expect(page.locator('.cm-content')).toContainText('../Source/res/pic.png');
 const recovery=await page.evaluate(async()=>{const {backend}=(window as any).__satr.load('/src/vault.ts');return (await backend.list('Notes/Source')).filter((x:any)=>x.name.startsWith('Satr recovery'))});expect(recovery).toEqual([]);
});

test('moving a closed note updates its link without changing the open note',async({page})=>{
 await boot(page,'Notes/Other.md');await move(page);await expect.poll(()=>vaultText(page,'Notes/Destination/A.md')).toContain('../Source/res/pic.png');expect(await vaultText(page,'Notes/Source/res/pic.png')).toContain('data:image/png');await expect(page.locator('.cm-content')).toContainText('other');
});

test('failed link rewrite restores the original note and preserves any partial destination',async({page})=>{
 await boot(page);await page.evaluate(()=>{const {backend}=(window as any).__satr.load('/src/vault.ts'),write=backend.write.bind(backend);let failed=false;backend.write=async(path:string,text:string)=>{if(path==='Notes/Destination/A.md'&&!failed){failed=true;await write(path,'partial');throw new Error('injected write failure');}return write(path,text)};});
 await move(page);await expect(page.locator('#file-panel .nav-hint')).toContainText('The original note was restored');expect(await vaultText(page,'Notes/Source/A.md')).toBe('old ![](res/pic.png)\n');expect(await vaultText(page,'Notes/Destination/A.md')).toBeNull();expect(await vaultText(page,'Notes/Source/res/pic.png')).toContain('data:image/png');
 const recovery=await page.evaluate(async()=>{const {backend}=(window as any).__satr.load('/src/vault.ts');const list=await backend.list('Notes/Destination');return Promise.all(list.filter((x:any)=>x.name.startsWith('Satr recovery')).map((x:any)=>backend.read(x.path)))});expect(recovery).toEqual(['partial']);
});
