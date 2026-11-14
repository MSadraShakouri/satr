import {expect,test} from '@playwright/test';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('satr:demoShown','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/A.md':1},folders:['Notes']}));localStorage.setItem('satr:fs:file:Notes/A.md','# A');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/A.md'}],active:0}));});await page.goto('/');await page.waitForSelector('#boot-snapshot',{state:'detached'});});

test('in-app camera displays a live stream, requests a still photo, then stops tracks',async({page})=>{
 await page.evaluate(()=>{
  const {createImageCamera}=(window as any).__satr.load('/src/imageCamera.ts');const c=document.createElement('canvas');c.width=100;c.height=80;c.getContext('2d')!.fillRect(0,0,100,80);const stream=c.captureStream(4);(window as any).cameraStream=stream;(window as any).cameraConstraints=null;(window as any).photos=0;(window as any).cameraPhoto=null;
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async(constraints:unknown)=>{(window as any).cameraConstraints=constraints;return stream}});
  (window as any).ImageCapture=class{constructor(track:MediaStreamTrack){if(track!==stream.getVideoTracks()[0])throw Error('wrong track')}async takePhoto(){(window as any).photos++;return new Blob(['real still bytes'],{type:'image/jpeg'})}};
  const camera=createImageCamera({onPhoto:(blob:Blob)=>{(window as any).cameraPhoto=blob},onCancel(){}});document.body.append(camera.element);
 });
 const camera=page.locator('.image-camera');await expect(camera.locator('[data-act=capture]')).toBeEnabled();expect(await page.evaluate(()=>(document.querySelector('.image-camera video') as HTMLVideoElement).srcObject===(window as any).cameraStream)).toBe(true);
 await camera.locator('[data-act=capture]').click();await expect.poll(()=>page.evaluate(()=>(window as any).photos)).toBe(1);await expect(camera).toHaveCount(0);
 const got=await page.evaluate(async()=>({text:await (window as any).cameraPhoto.text(),type:(window as any).cameraPhoto.type,state:(window as any).cameraStream.getVideoTracks()[0].readyState,constraints:(window as any).cameraConstraints}));
 expect(got.text).toBe('real still bytes');expect(got.type).toBe('image/jpeg');expect(got.state).toBe('ended');expect(got.constraints).toEqual({audio:false,video:{facingMode:{ideal:'environment'}}});
});

test('cancelling during permission stops a later-arriving stream and returns no photo',async({page})=>{
 await page.evaluate(()=>{
  const {createImageCamera}=(window as any).__satr.load('/src/imageCamera.ts');const c=document.createElement('canvas');c.width=10;c.height=10;(window as any).cameraStream=c.captureStream();(window as any).cameraCancelled=0;(window as any).cameraPhoto=null;
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>new Promise(resolve=>{(window as any).permissionResolve=resolve})});(window as any).ImageCapture=class{};
  const camera=createImageCamera({onPhoto:(blob:Blob)=>{(window as any).cameraPhoto=blob},onCancel(){(window as any).cameraCancelled++}});document.body.append(camera.element);
 });
 await page.locator('.image-camera [data-act=cancel]').click();await page.evaluate(()=>(window as any).permissionResolve((window as any).cameraStream));
 await expect.poll(()=>page.evaluate(()=>(window as any).cameraStream.getVideoTracks()[0].readyState)).toBe('ended');expect(await page.evaluate(()=>(window as any).cameraCancelled)).toBe(1);expect(await page.evaluate(()=>(window as any).cameraPhoto)).toBeNull();
});

test('when still capture is unavailable the viewfinder refuses instead of taking a screenshot',async({page})=>{
 await page.evaluate(()=>{
  const {createImageCamera}=(window as any).__satr.load('/src/imageCamera.ts');const c=document.createElement('canvas');c.width=10;c.height=10;(window as any).cameraStream=c.captureStream();(window as any).cameraPhoto=null;
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>(window as any).cameraStream});(window as any).ImageCapture=undefined;
  const camera=createImageCamera({onPhoto:(blob:Blob)=>{(window as any).cameraPhoto=blob},onCancel(){}});document.body.append(camera.element);
 });
 await expect(page.locator('.image-camera [role=status]')).toHaveText('Still-photo capture is not available on this device.');await expect(page.locator('.image-camera [data-act=capture]')).toBeDisabled();expect(await page.evaluate(()=>(window as any).cameraStream.getVideoTracks()[0].readyState)).toBe('ended');expect(await page.evaluate(()=>(window as any).cameraPhoto)).toBeNull();
});
