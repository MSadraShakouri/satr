import {expect,test} from '@playwright/test';
import sharp from 'sharp';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/A.md':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/A.md','# A\n');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/A.md'}],active:0}));});await page.goto('/');await page.waitForSelector('#boot-snapshot',{state:'detached'});await page.locator('.cm-content').click();});

async function addMenu(page:any){await page.locator('#edit-toolbar [data-command=image]').evaluate((el:HTMLElement)=>el.click());await expect(page.locator('.menu:not(.is-closing)')).toBeVisible();}

test('chosen image enters the editor, saves beside the note and inserts its Markdown link',async({page})=>{
 const bytes=await sharp({create:{width:600,height:400,channels:4,background:'#a75411'}}).png().toBuffer();await addMenu(page);
 const chooser=page.waitForEvent('filechooser');await page.locator('.menu:not(.is-closing) .menu-item',{hasText:'Choose image'}).click();await (await chooser).setFiles({name:'my image.png',mimeType:'image/png',buffer:bytes});
 await expect(page.locator('.image-select')).toBeVisible();await page.locator('.image-select [data-flow=crop]').click();await page.locator('.image-select [data-act=next]').click();await expect(page.locator('.image-review')).toBeVisible();await page.locator('.image-review select').selectOption('image/png');await page.locator('.image-review [data-act=insert]').click();await expect(page.locator('.image-flow')).toHaveCount(0);
 const got=await page.evaluate(async()=>{const {backend}=(window as any).__satr.load('/src/vault.ts');const c=(document.querySelector('.cm-content') as HTMLElement).innerText;const bytes=await backend.readBytes('Notes/res/my image.png');const im=await createImageBitmap(new Blob([bytes],{type:'image/png'}));return {text:c,width:im.width,height:im.height,bytes:bytes.length}});
 expect(got.text).toContain('![](res/my%20image.png)');expect(got.width).toBe(456);expect(got.height).toBe(304);expect(got.bytes).toBeGreaterThan(0);
});

test('image paste opens the same editor and cancellation leaves the note and storage unchanged',async({page})=>{
 const before=await page.locator('.cm-content').innerText();const accepted=await page.evaluate(()=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array([137,80,78,71])],'paste.png',{type:'image/png'}));const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});return document.querySelector('.cm-content')!.dispatchEvent(event);});
 // Invalid bytes are refused rather than being inserted as text or saved.
 expect(accepted).toBe(false);await expect(page.locator('.notice')).toContainText('Could not open this image');expect(await page.locator('.cm-content').innerText()).toBe(before);
 const result=await page.evaluate(async()=>{const {backend}=(window as any).__satr.load('/src/vault.ts');return backend.stat('Notes/res/paste.png')});expect(result).toBeNull();
});

test('a pasted image uses the same crop and preview flow without changing the clipboard source',async({page})=>{
 const input=await sharp({create:{width:300,height:200,channels:4,background:'#ee3377'}}).png().toBuffer();
 const prevented=await page.evaluate((bytes:number[])=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(bytes)],'clipboard.png',{type:'image/png'}));return !document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));},[...input]);expect(prevented).toBe(true);
 await expect(page.locator('.image-select')).toBeVisible();await page.locator('.image-select [data-flow=crop]').click();await page.locator('.image-select [data-act=next]').click();await page.locator('.image-review select').selectOption('image/png');await page.locator('.image-review [data-act=insert]').click();await expect(page.locator('.image-flow')).toHaveCount(0);
 const got=await page.evaluate(async()=>{const {backend}=(window as any).__satr.load('/src/vault.ts'),b=await backend.readBytes('Notes/res/clipboard.png'),im=await createImageBitmap(new Blob([b],{type:'image/png'}));return {text:(document.querySelector('.cm-content') as HTMLElement).innerText,w:im.width,h:im.height}});expect(got.text).toContain('![](res/clipboard.png)');expect([got.w,got.h]).toEqual([228,152]);
});

test('camera capture flows directly to editing without saving an original',async({page})=>{
 await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=500;c.height=300;const ctx=c.getContext('2d')!;ctx.fillStyle='#abc';ctx.fillRect(0,0,c.width,c.height);const stream=c.captureStream();(window as any).cameraTrack=stream.getVideoTracks()[0];
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>stream});(window as any).ImageCapture=class{async takePhoto(){return await new Promise(resolve=>c.toBlob(resolve,'image/png'))}};
 });
 await addMenu(page);await page.locator('.menu:not(.is-closing) .menu-item',{hasText:'Camera'}).click();await expect(page.locator('.image-camera [data-act=capture]')).toBeEnabled();
 await page.locator('.image-camera [data-act=capture]').click();await expect(page.locator('.image-select')).toBeVisible();expect(await page.evaluate(()=>(window as any).cameraTrack.readyState)).toBe('ended');
 const before=await page.evaluate(async()=>{const {backend}=(window as any).__satr.load('/src/vault.ts');return backend.list('Notes/res')});expect(before).toEqual([]);
 await page.locator('.image-select [data-flow=crop]').click();await page.locator('.image-select [data-act=next]').click();await page.locator('.image-review select').selectOption('image/png');await page.locator('.image-review [data-act=insert]').click();await expect(page.locator('.image-flow')).toHaveCount(0);
 const after=await page.evaluate(async()=>{const {backend}=(window as any).__satr.load('/src/vault.ts');return (await backend.list('Notes/res')).map((x:any)=>x.name)});expect(after).toEqual(['Image.png']);
});

test('a note changed while the image is open is not overwritten or given an image',async({page})=>{
 const input=await sharp({create:{width:200,height:120,channels:4,background:'#ee3377'}}).png().toBuffer();const chooser=page.waitForEvent('filechooser');await addMenu(page);await page.locator('.menu:not(.is-closing) .menu-item',{hasText:'Choose image'}).click();await (await chooser).setFiles({name:'a.png',mimeType:'image/png',buffer:input});await expect(page.locator('.image-select')).toBeVisible();
 await page.evaluate(()=>{const cm=document.querySelector('.cm-content') as HTMLElement;cm.focus();document.execCommand('insertText',false,' changed');});
 await page.locator('.image-select [data-flow=crop]').click();await page.locator('.image-select [data-act=next]').click();await page.locator('.image-review select').selectOption('image/png');await page.locator('.image-review [data-act=insert]').click();await expect(page.locator('.image-review-error')).toContainText('The note changed');
 expect(await page.evaluate(async()=>{const {backend}=(window as any).__satr.load('/src/vault.ts');return backend.stat('Notes/res/a.png')})).toBeNull();
});

test('Back cancels a pending image decode without reopening the editor later',async({page})=>{
 const input=await sharp({create:{width:200,height:120,channels:4,background:'#ee3377'}}).png().toBuffer();
 await page.evaluate(()=>{const original=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){return new Promise<void>((resolve,reject)=>{(window as any).finishImageDecode=()=>original.call(this).then(resolve,reject);});};});
 const chooser=page.waitForEvent('filechooser');await addMenu(page);await page.locator('.menu:not(.is-closing) .menu-item',{hasText:'Choose image'}).click();await (await chooser).setFiles({name:'a.png',mimeType:'image/png',buffer:input});
 await page.waitForFunction(()=>(window as any).finishImageDecode);await page.evaluate(()=>document.dispatchEvent(new Event('satr:back')));await page.evaluate(()=>(window as any).finishImageDecode());await page.waitForTimeout(200);
 await expect(page.locator('.image-flow')).toHaveCount(0);expect(await page.evaluate(async()=>{const {backend}=(window as any).__satr.load('/src/vault.ts');return backend.stat('Notes/res/a.png')})).toBeNull();
});

test('Back cancels a delayed clipboard read without later opening the editor',async({page})=>{
 const input=await sharp({create:{width:200,height:120,channels:4,background:'#ee3377'}}).png().toBuffer();
 await page.evaluate((bytes:number[])=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:()=>new Promise(resolve=>{(window as any).finishClipboard=()=>resolve([{types:['image/png'],getType:async()=>new Blob([new Uint8Array(bytes)],{type:'image/png'})}]);})}});},[...input]);
 await addMenu(page);await page.locator('.menu:not(.is-closing) .menu-item',{hasText:'Paste image'}).click();await page.waitForFunction(()=>(window as any).finishClipboard);await page.evaluate(()=>document.dispatchEvent(new Event('satr:back')));await page.evaluate(()=>(window as any).finishClipboard());await page.waitForTimeout(200);
 await expect(page.locator('.image-flow')).toHaveCount(0);expect(await page.evaluate(async()=>{const {backend}=(window as any).__satr.load('/src/vault.ts');return backend.list('Notes/res')})).toEqual([]);
});
