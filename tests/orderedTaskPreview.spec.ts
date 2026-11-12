import {test, expect} from '@playwright/test';
for(const marker of ['۱','١'] as const) test(`ticking ${marker} numbered task in reading view changes source`,async({page})=>{
 await page.addInitScript((marker)=>{const p='Notes/tasks.md';localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{[p]:1},folders:['Notes']}));localStorage.setItem('satr:fs:file:'+p,`${marker}. [ ] first\n${marker==='۱'?'۲':'٢'}. [ ] second`);localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:p}],active:0}));},marker);
 await page.goto('/'); await page.waitForSelector('#boot-snapshot',{state:'detached'}); await page.locator('#preview-toggle').evaluate((b:HTMLButtonElement)=>b.click());
 const boxes=page.locator('#preview-pane input[type=checkbox]'); await expect(boxes).toHaveCount(2); await boxes.first().click();
 await page.locator('#preview-toggle').evaluate((b:HTMLButtonElement)=>b.click());
 await expect(page.locator('#app .cm-content')).toContainText('[x] first');
});
for (const [first, second] of [['a','b'],['الف','ب']] as const) test(`ticking lettered ${first} task changes the right source line`,async({page})=>{
 await page.addInitScript(({first,second})=>{const p='Notes/tasks.md';localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{[p]:1},folders:['Notes']}));localStorage.setItem('satr:fs:file:'+p,`${first}. [ ] first\n${second}. [ ] second`);localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:p}],active:0}));},{first,second});
 await page.goto('/'); await page.waitForSelector('#boot-snapshot',{state:'detached'}); await page.locator('#preview-toggle').evaluate((b:HTMLButtonElement)=>b.click());
 const boxes=page.locator('#preview-pane input[type=checkbox]'); await expect(boxes).toHaveCount(2); await boxes.nth(1).click();
 await page.locator('#preview-toggle').evaluate((b:HTMLButtonElement)=>b.click());
 await expect(page.locator('#app .cm-content')).toContainText('[x] second');
 await expect(page.locator('#app .cm-content')).toContainText('[ ] first');
});
test('a quoted Persian-numbered task can be ticked and unticked without changing its neighbour',async({page})=>{
 await page.addInitScript(()=>{const p='Notes/tasks.md';localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{[p]:1},folders:['Notes']}));localStorage.setItem('satr:fs:file:'+p,'> ۱. [ ] first\n> ۲. [x] second');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:p}],active:0}));});
 await page.goto('/'); await page.waitForSelector('#boot-snapshot',{state:'detached'}); await page.locator('#preview-toggle').evaluate((b:HTMLButtonElement)=>b.click());
 const boxes=page.locator('#preview-pane input[type=checkbox]'); await expect(boxes).toHaveCount(2); await boxes.first().click();
 await expect.poll(async()=>page.evaluate(async()=>{const {backend}=await window.__satr.load('/src/vault.ts');return await backend.read('Notes/tasks.md')})).toContain('۱. [x] first');
 await boxes.first().click();
 await page.locator('#preview-toggle').evaluate((b:HTMLButtonElement)=>b.click());
 await expect(page.locator('#app .cm-content')).toContainText('۱. [ ] first');
 await expect(page.locator('#app .cm-content')).toContainText('۲. [x] second');
});
