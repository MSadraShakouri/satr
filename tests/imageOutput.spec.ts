import {expect,test} from '@playwright/test';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/A.md':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/A.md','# A');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/A.md'}],active:0}));});await page.goto('/');await page.waitForSelector('#boot-snapshot',{state:'detached'});});

test('transparent pixels are found even when only one natural-resolution pixel is transparent',async({page})=>{
 const got=await page.evaluate(async()=>{
  const {imageHasTransparency}=(window as any).__satr.load('/src/imageOutput.ts');const c=document.createElement('canvas');c.width=250;c.height=601;const ctx=c.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);const opaque=await imageHasTransparency(c,c.width,c.height);ctx.clearRect(249,600,1,1);const alpha=await imageHasTransparency(c,c.width,c.height);const control=new AbortController();control.abort();let cancelled='';try{await imageHasTransparency(c,c.width,c.height,control.signal)}catch(e){cancelled=(e as Error).name}return {opaque,alpha,cancelled};
 });expect(got).toEqual({opaque:false,alpha:true,cancelled:'AbortError'});
});

test('final PNG retains natural crop dimensions and alpha; JPEG mattes use the selected colour',async({page})=>{
 const got=await page.evaluate(async()=>{
  const {makeImageOutput}=(window as any).__satr.load('/src/imageOutput.ts'),{cropGeometry}=(window as any).__satr.load('/src/imageGeometry.ts');const source=document.createElement('canvas');source.width=120;source.height=80;const ctx=source.getContext('2d')!;ctx.fillStyle='red';ctx.fillRect(0,0,60,80);
  const geo=cropGeometry(120,80,0,[.25,.25,.75,.75]);const png=await makeImageOutput(source,geo,{format:'image/png',quality:.85});const white=await makeImageOutput(source,geo,{format:'image/jpeg',quality:1,background:'white'});const black=await makeImageOutput(source,geo,{format:'image/jpeg',quality:1,background:'black'});
  async function pixels(blob:Blob){const im=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const cctx=c.getContext('2d')!;cctx.drawImage(im,0,0);const data=Array.from(cctx.getImageData(c.width-3,3,1,1).data);im.close();return {w:c.width,h:c.height,data};}
  return {png:await pixels(png),white:await pixels(white),black:await pixels(black)};
 });
 expect(got.png).toEqual({w:60,h:40,data:[0,0,0,0]});expect(got.white.w).toBe(60);expect(got.white.h).toBe(40);expect(got.white.data[0]).toBeGreaterThan(245);expect(got.black.data[0]).toBeLessThan(10);
});

test('the estimate encodes nine small tiles, not the full output',async({page})=>{
 const got=await page.evaluate(async()=>{
  const {estimateImageOutput}=(window as any).__satr.load('/src/imageOutput.ts'),{cropGeometry}=(window as any).__satr.load('/src/imageGeometry.ts');const c=document.createElement('canvas');c.width=1200;c.height=900;const ctx=c.getContext('2d')!;ctx.fillStyle='#a1b';ctx.fillRect(0,0,1200,900);const dims:number[][]=[],native=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback:BlobCallback,type?:string,quality?:any){dims.push([this.width,this.height]);return native.call(this,callback,type,quality)};
  try{return {estimate:await estimateImageOutput(c,cropGeometry(1200,900,0,[0,0,1,1]),{format:'image/webp',quality:.85}),dims};}finally{HTMLCanvasElement.prototype.toBlob=native;}
 });expect(got.dims).toHaveLength(9);expect(got.dims.every(([w,h]:number[])=>w<=256&&h<=256)).toBe(true);expect(got.estimate.low).toBeGreaterThan(0);expect(got.estimate.high).toBeGreaterThan(got.estimate.low);
});

test('the estimator reuses transformed tiles across quality changes',async({page})=>{
 const got=await page.evaluate(async()=>{
  const {createImageEstimateSampler}=(window as any).__satr.load('/src/imageOutput.ts'),{cropGeometry}=(window as any).__satr.load('/src/imageGeometry.ts');const source=document.createElement('canvas');source.width=1200;source.height=900;source.getContext('2d')!.fillRect(0,0,1200,900);
  let sourceDraws=0;const native=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(...args:any[]){if(args[0]===source)sourceDraws++;return (native as any).apply(this,args);};
  const sampler=createImageEstimateSampler(source,cropGeometry(1200,900,0,[0,0,1,1]));try{await sampler.estimate({format:'image/webp',quality:.85});const first=sourceDraws;await sampler.estimate({format:'image/webp',quality:.6});return {first,second:sourceDraws};}finally{sampler.dispose();CanvasRenderingContext2D.prototype.drawImage=native;}
 });expect(got).toEqual({first:9,second:9});
});

test('full-resolution page output in bounded strips exactly matches a single render, including alpha',async({page})=>{
 const got=await page.evaluate(async()=>{
  const {makeImageOutput}=(window as any).__satr.load('/src/imageOutput.ts'),{pageGeometry}=(window as any).__satr.load('/src/imageGeometry.ts'),{renderImageSelection}=(window as any).__satr.load('/src/imageRender.ts');
  const source=document.createElement('canvas');source.width=1600;source.height=1300;const ctx=source.getContext('2d')!,im=ctx.createImageData(1600,1300);for(let i=0;i<im.data.length;i+=4){const p=i/4;im.data[i]=p%251;im.data[i+1]=Math.floor(p/1600)%251;im.data[i+2]=(p*7)%251;im.data[i+3]=(p*3)%256;}ctx.putImageData(im,0,0);
  const geo=pageGeometry(1600,1300,0,[[.08,.1],[.94,.13],[.9,.93],[.12,.85]],[.05,.07,.95,.92]);
  const native=CanvasRenderingContext2D.prototype.getImageData;let peak=0;CanvasRenderingContext2D.prototype.getImageData=function(...args:any[]){peak=Math.max(peak,this.canvas.width*this.canvas.height);return (native as any).apply(this,args)};
  try{
   const full=await renderImageSelection(source,geo),fullPeak=peak;const expected=native.call(full.getContext('2d')!,0,0,geo.width,geo.height).data;peak=0;
   const blob=await makeImageOutput(source,geo,{format:'image/png',quality:.85}),stripPeak=peak,bmp=await createImageBitmap(blob),c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;c.getContext('2d')!.drawImage(bmp,0,0);const result=native.call(c.getContext('2d')!,0,0,c.width,c.height).data;let max=0,changed=0;for(let i=0;i<expected.length;i++){let d=Math.abs(expected[i]-result[i]);if(d){changed++;max=Math.max(max,d)}}return {width:geo.width,height:geo.height,max,changed,fullPeak,stripPeak};
  }finally{CanvasRenderingContext2D.prototype.getImageData=native;}
 });expect(got.width*got.height).toBeGreaterThan(1000000);expect(got.max).toBe(0);expect(got.changed).toBe(0);expect(got.stripPeak).toBeLessThan(got.fullPeak);
});
