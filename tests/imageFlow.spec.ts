import {expect,test} from '@playwright/test';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/A.md':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/A.md','# A');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/A.md'}],active:0}));});await page.goto('/');await page.waitForSelector('#boot-snapshot',{state:'detached'});});

async function mount(page:any){await page.evaluate(async()=>{
 const {createImageFlow}=(window as any).__satr.load('/src/imageFlow.ts');const c=document.createElement('canvas');c.width=600;c.height=400;const ctx=c.getContext('2d')!;ctx.fillStyle='#444';ctx.fillRect(0,0,600,400);ctx.fillStyle='#eee';ctx.fillRect(60,60,480,280);const blob:Blob=await new Promise(resolve=>c.toBlob(b=>resolve(b!),'image/png'));(window as any).flowOutput=null;(window as any).flowClosed=0;(window as any).failSave=false;
 const flow=await createImageFlow({image:blob,name:'source.png',onClose:()=>{(window as any).flowClosed++},onInsert:async(output:Blob,name:string)=>{if((window as any).failSave)throw new Error('disk full');(window as any).flowOutput={output,name}}});document.body.append(flow.element);(window as any).imageFlow=flow;
});}

test('the shared flow proceeds from editing to preview and emits only the edited output',async({page})=>{
 await mount(page);await page.locator('.image-select [data-flow=crop]').click();await page.locator('.image-select [data-act=next]').click();await expect(page.locator('.image-review')).toBeVisible();await expect(page.locator('.image-review-warning')).toBeHidden();await page.locator('.image-review select').selectOption('image/png');await page.locator('.image-review [data-act=insert]').click();
 await expect.poll(()=>page.evaluate(()=>(window as any).flowClosed)).toBe(1);const got=await page.evaluate(async()=>{const result=(window as any).flowOutput,im=await createImageBitmap(result.output);return {name:result.name,type:result.output.type,width:im.width,height:im.height}});expect(got).toEqual({name:'source.png',type:'image/png',width:456,height:304});await expect(page.locator('.image-flow')).toHaveCount(0);
});

test('back preserves the selection; a storage failure leaves the preview open and cancel writes nothing',async({page})=>{
 await mount(page);await page.locator('.image-select [data-flow=crop]').click();await page.locator('.image-select [data-act=next]').click();await page.locator('.image-review [data-act=back]').click();await expect(page.locator('.image-select [data-flow=crop]')).toHaveAttribute('aria-selected','true');await page.locator('.image-select [data-act=next]').click();await page.evaluate(()=>(window as any).failSave=true);await page.locator('.image-review [data-act=insert]').click();await expect(page.locator('.image-review-error')).toHaveText('disk full');await expect(page.locator('.image-flow')).toBeVisible();await page.evaluate(()=>(window as any).imageFlow.back());await page.evaluate(()=>(window as any).imageFlow.back());expect(await page.evaluate(()=>(window as any).flowClosed)).toBe(1);expect(await page.evaluate(()=>(window as any).flowOutput)).toBeNull();
});
