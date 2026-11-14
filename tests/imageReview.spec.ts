import {expect,test} from '@playwright/test';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/A.md':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/A.md','# A');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/A.md'}],active:0}));});await page.goto('/');await page.waitForSelector('#boot-snapshot',{state:'detached'});});
async function mount(page:any,transparent:boolean){await page.evaluate((transparent:boolean)=>{
 const {createImageReview}=(window as any).__satr.load('/src/imageReview.ts'),{cropGeometry}=(window as any).__satr.load('/src/imageGeometry.ts');const c=document.createElement('canvas');c.width=1200;c.height=800;const ctx=c.getContext('2d')!;ctx.fillStyle='#a43';ctx.fillRect(0,0,c.width,c.height);if(transparent)ctx.clearRect(1199,799,1,1);
 (window as any).encoded=[];const native=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback:BlobCallback,type?:string,quality?:any){(window as any).encoded.push({w:this.width,h:this.height,type,quality});return native.call(this,callback,type,quality)};
 (window as any).saved=null;const review=createImageReview({source:c,width:c.width,height:c.height,sourceType:transparent?'image/png':'image/jpeg',sourceSize:1000000,geometry:cropGeometry(1200,800,0,[.1,.1,.9,.9]),onBack(){},onInsert(blob:Blob){(window as any).saved=blob}});document.body.append(review.element);(window as any).review=review;
 },transparent);}

test('default 85 quality is visible, freely scrollable, and preview does not encode full output',async({page})=>{
 await mount(page,false);const root=page.locator('.image-review');await expect(root.locator('.image-review-badge')).toHaveText('Approximate preview');
 await expect(root.locator('.image-review-presets button')).toHaveCount(21);await expect(root.locator('[data-quality="85"]')).toHaveClass(/active/);
 const row=root.locator('.image-review-presets');const info=await row.evaluate(el=>({left:el.scrollLeft,snap:getComputedStyle(el).scrollSnapType}));expect(info.left).toBeGreaterThan(0);expect(info.snap).toBe('none');
 await page.waitForTimeout(1000);const dimensions=await page.evaluate(()=>(window as any).encoded);expect(dimensions.length).toBeGreaterThan(0);expect(dimensions.some((v:any)=>v.w===960&&v.h===640)).toBe(false);
 await root.locator('[data-act=insert]').click();await expect.poll(()=>page.evaluate(()=>(window as any).saved?.size??0)).toBeGreaterThan(0);
 const output=await page.evaluate(async()=>{const blob=(window as any).saved;const image=await createImageBitmap(blob);return {w:image.width,h:image.height,type:blob.type}});expect(output).toEqual({w:960,h:640,type:'image/jpeg'});
});

test('transparent JPEG offers the four choices, and PNG preserves alpha without a quality selector',async({page})=>{
 await mount(page,true);const root=page.locator('.image-review');const dialog=root.locator('[role=dialog]');await expect(dialog).toBeVisible();await expect(dialog.locator('button')).toHaveText(['JPEG on white','JPEG on black','Use PNG','Use WebP']);await dialog.locator('[data-choice=png]').click();
 await expect(root.locator('select')).toHaveValue('image/png');await expect(root.locator('.image-review-quality')).toBeHidden();await root.locator('select').selectOption('image/jpeg');await expect(dialog).toBeVisible();await dialog.locator('[data-choice=black]').click();await expect(dialog).toBeHidden();
 await root.locator('select').selectOption('image/png');await root.locator('[data-act=insert]').click();await expect.poll(()=>page.evaluate(()=>(window as any).saved?.size??0)).toBeGreaterThan(0);expect(await page.evaluate(()=>(window as any).saved.type)).toBe('image/png');
});

test('holding the preview compares the uncompressed image',async({page})=>{
 await mount(page,false);const root=page.locator('.image-review'),stage=root.locator('.image-review-stage');await expect(root.locator('.image-review-badge')).toHaveText('Approximate preview');const box=await stage.boundingBox();await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();await expect(root.locator('.image-review-badge')).toHaveText('Original');await page.mouse.up();await expect(root.locator('.image-review-badge')).toHaveText('Approximate preview');
});

test('double tap animates to zoom and a second tap-and-drag adjusts it with one finger',async({page})=>{
 await mount(page,false);const root=page.locator('.image-review'),stage=root.locator('.image-review-stage');await expect(root.locator('.image-review-badge')).toHaveText('Approximate preview');
 await page.evaluate(()=>{const native=CanvasRenderingContext2D.prototype.drawImage;(window as any).imageDrawWidths=[];CanvasRenderingContext2D.prototype.drawImage=function(...args:any[]){if(this.canvas.matches('.image-review-stage canvas')&&args.length===5)(window as any).imageDrawWidths.push(args[3]);return (native as any).apply(this,args);};});
 const box=await stage.boundingBox();const x=box!.x+box!.width/2,y=box!.y+box!.height/2;
 await page.mouse.click(x,y);await page.mouse.click(x,y);await page.waitForTimeout(420);const widths=await page.evaluate(()=>(window as any).imageDrawWidths);expect(widths.length).toBeGreaterThan(2);expect(widths.at(-1)).toBeGreaterThan((box!.width-24)*1.95);
 await page.evaluate(()=>(window as any).imageDrawWidths=[]);await page.mouse.click(x,y);await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+80,{steps:5});await page.mouse.up();await page.waitForTimeout(200);
 const quick=await page.evaluate(()=>(window as any).imageDrawWidths);expect(quick.length).toBeGreaterThan(1);expect(quick.at(-1)).toBeGreaterThan(quick[0]*1.1);
});
