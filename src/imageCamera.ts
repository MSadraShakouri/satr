import './imageCamera.css';

interface StillCapture { takePhoto():Promise<Blob> }
type StillCaptureConstructor = new (track:MediaStreamTrack)=>StillCapture;
export interface ImageCameraOptions {onPhoto(photo:Blob):void;onCancel():void}
export interface ImageCamera {element:HTMLElement;dispose():void}

/** In-app live viewfinder. A still is taken via ImageCapture.takePhoto(); a
 * video frame is never substituted and nothing is written to the gallery. */
export function createImageCamera({onPhoto,onCancel}:ImageCameraOptions):ImageCamera {
  const root=document.createElement('section');root.className='image-camera';root.setAttribute('aria-label','Camera');
  root.innerHTML='<header><button type="button" data-act="cancel">Cancel</button><strong>Camera</strong><span></span></header><div class="image-camera-stage"><video autoplay playsinline muted></video><p role="status">Opening camera…</p></div><div class="image-camera-footer"><button type="button" data-act="capture" aria-label="Take photo" disabled><span></span></button></div>';
  const video=root.querySelector('video')!,status=root.querySelector<HTMLParagraphElement>('[role=status]')!,button=root.querySelector<HTMLButtonElement>('[data-act=capture]')!;
  let stream:MediaStream|null=null,disposed=false,busy=false,request=0,closed=false;
  function stop():void{request++;if(stream){for(const track of stream.getTracks())track.stop();stream=null;}video.srcObject=null;button.disabled=true;}
  function dispose():void{if(disposed)return;disposed=true;stop();document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('pagehide',onPageHide);root.remove();}
  function cancel():void{if(closed)return;closed=true;dispose();onCancel();}
  function onVisibility():void{if(document.visibilityState==='hidden'&&!disposed){stop();status.textContent='Camera closed while Satr was in the background.';status.hidden=false;}}
  function onPageHide():void{stop();}
  document.addEventListener('visibilitychange',onVisibility);window.addEventListener('pagehide',onPageHide);
  root.querySelector<HTMLButtonElement>('[data-act=cancel]')!.addEventListener('click',cancel);
  button.addEventListener('click',()=>{void(async()=>{
    if(!stream||busy||disposed)return;
    const track=stream.getVideoTracks()[0],Ctor=(window as unknown as {ImageCapture?:StillCaptureConstructor}).ImageCapture;
    if(!track||!Ctor){status.textContent='Still-photo capture is not available on this device.';status.hidden=false;return;}
    busy=true;button.disabled=true;status.hidden=true;const current=request;
    try{
      const photo=await new Ctor(track).takePhoto();
      if(disposed||current!==request)return;
      if(!photo.size||!photo.type.startsWith('image/'))throw new Error('The camera did not return a photo');
      closed=true;dispose();onPhoto(photo);
    }catch(e){if(!disposed&&current===request){status.textContent=e instanceof Error?e.message:'Could not take the photo';status.hidden=false;button.disabled=false;}}
    finally{busy=false;}
  })();});
  void(async()=>{
    const current=++request;
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera is not available');
      const next=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
      if(disposed||current!==request){for(const track of next.getTracks())track.stop();return;}
      const Ctor=(window as unknown as {ImageCapture?:StillCaptureConstructor}).ImageCapture;
      if(!Ctor||!next.getVideoTracks().length){for(const track of next.getTracks())track.stop();throw new Error('Still-photo capture is not available on this device.');}
      stream=next;video.srcObject=next;await video.play();if(disposed||current!==request)return;status.hidden=true;button.disabled=false;
    }catch(e){if(!disposed&&current===request){stop();status.textContent=e instanceof Error?e.message:'Could not open camera';status.hidden=false;}}
  })();
  return {element:root,dispose};
}
