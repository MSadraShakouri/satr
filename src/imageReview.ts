import type { ImageGeometry } from './imageGeometry';
import { renderImageSelection, type ImageRegion } from './imageRender';
import { encodeImage, createImageEstimateSampler, imageHasTransparency, makeImageOutput, type ImageEncoding, type ImageFormat, type JpegBackground } from './imageOutput';
import './imageReview.css';

export interface ImageReviewOptions {
  source:CanvasImageSource; width:number; height:number; sourceType:string; sourceSize:number; geometry:ImageGeometry;
  onBack():void; onInsert(blob:Blob):Promise<void>|void;
}
export interface ImageReview {element:HTMLElement;dispose():void}
type Point={x:number;y:number};
const clamp=(n:number,min:number,max:number):number=>Math.max(min,Math.min(max,n));
const pretty=(n:number):string=>n>=1048576?`${(n/1048576).toFixed(2)} MiB`:`${Math.max(1,Math.round(n/1024))} KiB`;

/** Original-based fit preview and final on-demand full-resolution encode. */
export function createImageReview(options:ImageReviewOptions):ImageReview {
  const {source,width,height,geometry:geo,onBack,onInsert}=options;
  const root=document.createElement('section');root.className='image-review';root.setAttribute('aria-label','Preview image');
  root.innerHTML=`<header class="image-review-header"><button type="button" data-act="back">‹ Edit</button><strong>Preview image</strong><span></span></header>
    <div class="image-review-stage"><canvas tabindex="0" aria-label="Image preview. Hold to compare the original."></canvas><span class="image-review-badge">Preparing preview…</span></div>
    <div class="image-review-options"><div class="image-review-format"><strong>Format</strong><select aria-label="Format"><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option><option value="image/png">PNG</option></select></div><div class="image-review-quality"><div>Quality <strong>85%</strong></div><div class="image-review-presets" aria-label="Image quality"></div></div><p class="image-review-size" role="status"></p><p class="image-review-error" role="alert" hidden></p></div>
    <div class="image-review-bottom"><button type="button" data-act="insert">Insert image</button></div>
    <div class="image-review-warning" hidden><div role="dialog" aria-modal="true" aria-label="Transparent image"><strong>JPEG cannot keep transparency</strong><p>Choose a background or keep transparency.</p><button type="button" data-choice="white">JPEG on white</button><button type="button" data-choice="black">JPEG on black</button><button type="button" data-choice="png">Use PNG</button><button type="button" data-choice="webp">Use WebP</button></div></div>`;
  const q=<T extends Element>(s:string):T=>root.querySelector(s) as T;
  const stage=q<HTMLDivElement>('.image-review-stage'),canvas=q<HTMLCanvasElement>('.image-review-stage canvas'),ctx=canvas.getContext('2d')!;
  const badge=q<HTMLSpanElement>('.image-review-badge'),format=q<HTMLSelectElement>('select'),qualityArea=q<HTMLDivElement>('.image-review-quality'),qualityLabel=q<HTMLElement>('.image-review-quality strong'),presets=q<HTMLDivElement>('.image-review-presets');
  const meta=q<HTMLParagraphElement>('.image-review-size'),error=q<HTMLParagraphElement>('.image-review-error'),warning=q<HTMLDivElement>('.image-review-warning'),insert=q<HTMLButtonElement>('[data-act="insert"]');
  let type:ImageFormat='image/jpeg', quality=85, background:JpegBackground|undefined,alpha:boolean|null=null, disposed=false, busy=false;
  let version=0, sampleVersion=0, previewAbort=new AbortController(), sampleAbort=new AbortController(), estimateAbort=new AbortController(), life=new AbortController();
  let originalPromise:Promise<HTMLCanvasElement>|null=null;
  let original:HTMLCanvasElement|null=null,preview:HTMLImageElement|null=null,sampleOriginal:HTMLCanvasElement|null=null,sample:HTMLImageElement|null=null,sampleRegion:ImageRegion|null=null;
  let estimateTimer=0,sampleTimer=0,holdTimer=0,animation=0,zoom=1,cx=geo.width/2,cy=geo.height/2,compare=false;
  const estimator=createImageEstimateSampler(source,geo,life.signal);
  let observer:ResizeObserver|null=null,lastTap:{x:number;y:number;time:number}|null=null;
  const pointers=new Map<number,Point>();
  let gesture:{kind:'pan';point:Point;cx:number;cy:number;scale:number}|{kind:'pinch';distance:number;zoom:number;anchorX:number;anchorY:number}|null=null;
  let press:{id:number;x:number;y:number;moved:boolean;held:boolean;quick:boolean;startZoom:number}|null=null;
  const encoding=():ImageEncoding=>({format:type,quality:quality/100,background});
  const size=()=>({w:stage.clientWidth,h:stage.clientHeight});
  const scale=()=>{const v=size();return Math.min(Math.max(1,v.w-24)/geo.width,Math.max(1,v.h-24)/geo.height)*zoom;};
  function clampView():void{const v=size(),s=scale(),halfW=v.w/(2*s),halfH=v.h/(2*s);cx=halfW>=geo.width/2?geo.width/2:clamp(cx,halfW,geo.width-halfW);cy=halfH>=geo.height/2?geo.height/2:clamp(cy,halfH,geo.height-halfH);}
  function draw():void {
    if(disposed)return;const {w,h}=size();if(!w||!h)return;const dpr=window.devicePixelRatio||1;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.max(1,Math.round(w*dpr));canvas.height=Math.max(1,Math.round(h*dpr));}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);clampView();const s=scale(),left=w/2-cx*s,top=h/2-cy*s;
    const image=compare?original:preview??original;if(image)ctx.drawImage(image,left,top,geo.width*s,geo.height*s);
    if(sampleRegion&&sample&&sampleOriginal){const part=compare?sampleOriginal:sample;ctx.drawImage(part,left+sampleRegion.x*s,top+sampleRegion.y*s,sampleRegion.width*s,sampleRegion.height*s);}
    badge.textContent=compare?'Original':preview?'Approximate preview':'Preparing preview…';
  }
  async function decoded(blob:Blob):Promise<HTMLImageElement>{const img=new Image(),url=URL.createObjectURL(blob);try{img.src=url;await img.decode();return img;}finally{URL.revokeObjectURL(url);}}
  async function fitPreview(v:number):Promise<void>{
    try{
      if(!original){
        if(!originalPromise){const {w,h}=size(),dpr=window.devicePixelRatio||1,factor=Math.min(.9,2048/Math.max(geo.width,geo.height),1.35*Math.min(Math.max(1,w-24)*dpr/geo.width,Math.max(1,h-24)*dpr/geo.height));
          originalPromise=renderImageSelection(source,geo,{size:{width:Math.max(1,Math.floor(geo.width*factor)),height:Math.max(1,Math.floor(geo.height*factor))},signal:life.signal});}
        const out=await originalPromise;if(disposed){out.width=out.height=1;return;}original=out;
      }
      if(v!==version||disposed)return;const blob=await encodeImage(original,encoding(),previewAbort.signal),img=await decoded(blob);
      if(v!==version||disposed)return;preview=img;draw();
    }catch(e){if(!disposed&&v===version&&!(e instanceof DOMException&&e.name==='AbortError')){badge.textContent='Preview unavailable';error.textContent=e instanceof Error?e.message:'Could not preview image';error.hidden=false;}}
  }
  function visibleRegion():ImageRegion{
    const {w,h}=size(),s=scale(),x=Math.max(0,Math.floor(cx-w/(2*s))),y=Math.max(0,Math.floor(cy-h/(2*s))),right=Math.min(geo.width,Math.ceil(cx+w/(2*s))),bottom=Math.min(geo.height,Math.ceil(cy+h/(2*s)));
    return {x,y,width:Math.max(1,right-x),height:Math.max(1,bottom-y)};
  }
  async function zoomSample(v:number,sv:number):Promise<void>{
    const region=visibleRegion();if(region.width>1400||region.height>1400||region.width*region.height>1300000||region.width*region.height>=geo.width*geo.height*.85)return;
    try{const c=await renderImageSelection(source,geo,{region,signal:sampleAbort.signal});if(v!==version||sv!==sampleVersion||disposed){c.width=c.height=1;return;}
      const img=await decoded(await encodeImage(c,encoding(),sampleAbort.signal));if(v!==version||sv!==sampleVersion||disposed){c.width=c.height=1;return;}
      if(sampleOriginal)sampleOriginal.width=sampleOriginal.height=1;sampleOriginal=c;sample=img;sampleRegion=region;draw();
    }catch{/* fit preview remains visible */}
  }
  function estimateText(low:number,high:number):string{
    const input=options.sourceSize;let delta='may be smaller or larger';if(input>0&&high<input)delta=`~${Math.round((1-high/input)*100)}–${Math.floor((1-low/input)*100)}% smaller`;else if(input>0&&low>input)delta=`~${Math.round((low/input-1)*100)}–${Math.round((high/input-1)*100)}% larger`;
    return `${input>0?`Original ${pretty(input)} → `:''}est. ${pretty(low)}–${pretty(high)} · ${delta}`;
  }
  function refresh():void{
    const v=++version;sampleVersion++;sampleAbort.abort();sampleAbort=new AbortController();previewAbort.abort();previewAbort=new AbortController();estimateAbort.abort();estimateAbort=new AbortController();
    window.clearTimeout(estimateTimer);window.clearTimeout(sampleTimer);sample=null;sampleRegion=null;if(sampleOriginal){sampleOriginal.width=sampleOriginal.height=1;sampleOriginal=null;}preview=null;compare=false;
    error.hidden=true;qualityArea.hidden=type==='image/png';qualityLabel.textContent=`${quality}%`;
    presets.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.classList.toggle('active',Number(b.dataset.quality)===quality));
    meta.textContent=`${options.sourceSize>0?`Original ${pretty(options.sourceSize)} · `:''}estimating output…`;draw();void fitPreview(v);
    estimateTimer=window.setTimeout(()=>{void estimator.estimate(encoding(),estimateAbort.signal).then(r=>{if(!disposed&&v===version)meta.textContent=estimateText(r.low,r.high);},()=>{if(!disposed&&v===version)meta.textContent='Size estimate unavailable';});},120);
  }
  function afterView():void{sampleVersion++;sampleAbort.abort();sampleAbort=new AbortController();sample=null;sampleRegion=null;compare=false;draw();window.clearTimeout(sampleTimer);const v=version,sv=sampleVersion;sampleTimer=window.setTimeout(()=>void zoomSample(v,sv),120);}
  function zoomAt(value:number,x:number,y:number):void{const v=size(),old=scale(),ax=cx+(x-v.w/2)/old,ay=cy+(y-v.h/2)/old;zoom=clamp(value,.25,16);const current=scale();cx=ax-(x-v.w/2)/current;cy=ay-(y-v.h/2)/current;afterView();}
  function animateZoom(value:number,x:number,y:number):void{
    cancelAnimationFrame(animation);const v=size(),start=zoom,startScale=scale(),ax=cx+(x-v.w/2)/startScale,ay=cy+(y-v.h/2)/startScale,begin=performance.now(),duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:300;
    function frame(now:number):void{const t=duration?Math.min(1,(now-begin)/duration):1,ease=glideEase(t);zoom=start*Math.pow(value/start,ease);const current=scale();cx=ax-(x-v.w/2)/current;cy=ay-(y-v.h/2)/current;draw();if(t<1)animation=requestAnimationFrame(frame);else afterView();}animation=requestAnimationFrame(frame);
  }
  function point(e:PointerEvent):Point{const r=stage.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
  function initGesture():void{
    const p=[...pointers.values()];if(p.length===1)gesture={kind:'pan',point:p[0],cx,cy,scale:scale()};else if(p.length>=2){const a=p[0],b=p[1],v=size(),s=scale(),x=(a.x+b.x)/2,y=(a.y+b.y)/2;gesture={kind:'pinch',distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom,anchorX:cx+(x-v.w/2)/s,anchorY:cy+(y-v.h/2)/s};}else gesture=null;
  }
  function clearHold():void{window.clearTimeout(holdTimer);if(compare){compare=false;draw();}}
  stage.addEventListener('pointerdown',e=>{
    e.preventDefault();cancelAnimationFrame(animation);const p=point(e);pointers.set(e.pointerId,p);stage.setPointerCapture(e.pointerId);
    if(pointers.size===1){const quick=!!lastTap&&e.timeStamp-lastTap.time<300&&Math.hypot(p.x-lastTap.x,p.y-lastTap.y)<64;press={id:e.pointerId,x:p.x,y:p.y,moved:false,held:false,quick,startZoom:zoom};if(quick)lastTap=null;holdTimer=window.setTimeout(()=>{if(pointers.size===1&&preview){compare=true;if(press)press.held=true;draw();}},400);}else{clearHold();if(press)press.moved=true;}
    initGesture();
  });
  stage.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;e.preventDefault();const p=point(e);pointers.set(e.pointerId,p);const list=[...pointers.values()];
    if(press?.quick&&e.pointerId===press.id){const dy=p.y-press.y;if(Math.abs(dy)<=8&&!press.moved)return;press.moved=true;clearHold();zoomAt(press.startZoom*Math.pow(1.005,dy),press.x,press.y);return;}
    if(gesture?.kind==='pan'&&list.length===1){if(Math.hypot(p.x-gesture.point.x,p.y-gesture.point.y)<8&&!press?.moved)return;if(press)press.moved=true;clearHold();cx=gesture.cx-(p.x-gesture.point.x)/gesture.scale;cy=gesture.cy-(p.y-gesture.point.y)/gesture.scale;afterView();}
    else if(gesture?.kind==='pinch'&&list.length>=2){if(press)press.moved=true;clearHold();const [a,b]=list,v=size(),x=(a.x+b.x)/2,y=(a.y+b.y)/2;zoom=clamp(gesture.zoom*Math.hypot(a.x-b.x,a.y-b.y)/gesture.distance,.25,16);const s=scale();cx=gesture.anchorX-(x-v.w/2)/s;cy=gesture.anchorY-(y-v.h/2)/s;afterView();}
  });
  function end(e:PointerEvent):void{
    if(!pointers.has(e.pointerId))return;const p=point(e),tap=e.type==='pointerup'&&press?.id===e.pointerId&&!press.moved&&!press.held&&pointers.size===1,quick=press?.quick;clearHold();pointers.delete(e.pointerId);
    if(tap&&quick){lastTap=null;animateZoom(zoom<1-.005?1:zoom<Math.sqrt(2)?2:1,p.x,p.y);}else if(tap)lastTap={...p,time:e.timeStamp};else lastTap=null;press=null;initGesture();
  }
  stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',end);stage.addEventListener('lostpointercapture',end);stage.addEventListener('contextmenu',e=>e.preventDefault());
  for(let value=0;value<=100;value+=5){const button=document.createElement('button');button.type='button';button.dataset.quality=String(value);button.textContent=`${value}%`;button.classList.toggle('active',value===quality);button.addEventListener('click',()=>{quality=value;refresh();});presets.append(button);}
  function transparencyWarning():void{warning.hidden=!(alpha===true&&type==='image/jpeg'&&!background);}
  format.addEventListener('change',()=>{type=format.value as ImageFormat;background=undefined;transparencyWarning();refresh();});
  warning.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach(button=>button.addEventListener('click',()=>{
    const choice=button.dataset.choice;if(choice==='white'||choice==='black'){type='image/jpeg';background=choice;}else {type=choice==='png'?'image/png':'image/webp';background=undefined;}format.value=type;warning.hidden=true;refresh();
  }));
  q<HTMLButtonElement>('[data-act="back"]').addEventListener('click',()=>{if(!busy)onBack();});
  insert.addEventListener('click',()=>{void(async()=>{
    if(busy)return;if(alpha===null&&type==='image/jpeg'){error.textContent='Checking transparency…';error.hidden=false;return;}
    transparencyWarning();if(!warning.hidden)return;busy=true;insert.disabled=true;insert.textContent='Preparing original…';error.hidden=true;
    try{const blob=await makeImageOutput(source,geo,encoding(),life.signal);if(!disposed)await onInsert(blob);}
    catch(e){if(!disposed&&!(e instanceof DOMException&&e.name==='AbortError')){error.textContent=e instanceof Error?e.message:'Could not insert image';error.hidden=false;}}
    finally{busy=false;insert.disabled=false;insert.textContent='Insert image';}
  })();});
  if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>{draw();});observer.observe(stage);}
  requestAnimationFrame(()=>{if(!disposed){const selected=presets.querySelector<HTMLButtonElement>('.active');if(selected)presets.scrollLeft=Math.max(0,selected.offsetLeft-presets.offsetLeft-presets.clientWidth/2+selected.clientWidth/2);refresh();}});
  if(options.sourceType==='image/jpeg')alpha=false;
  else void imageHasTransparency(source,width,height,life.signal).then(value=>{if(!disposed){alpha=value;transparencyWarning();}},()=>{if(!disposed){error.textContent='Could not check transparency';error.hidden=false;}});
  return {element:root,dispose(){disposed=true;life.abort();previewAbort.abort();sampleAbort.abort();estimateAbort.abort();estimator.dispose();window.clearTimeout(estimateTimer);window.clearTimeout(sampleTimer);window.clearTimeout(holdTimer);cancelAnimationFrame(animation);observer?.disconnect();if(original)original.width=original.height=1;if(sampleOriginal)sampleOriginal.width=sampleOriginal.height=1;canvas.width=canvas.height=1;root.remove();}};
}

/** The PDF reader's cubic-bezier(0.22, 1, 0.36, 1), including its x axis. */
function glideEase(part:number):number{let lo=0,hi=1,t=part;for(let i=0;i<20;i++){t=(lo+hi)/2;const q=1-t,x=3*q*q*t*.22+3*q*t*t*.36+t*t*t;if(x<part)lo=t;else hi=t;}const q=1-t;return 3*q*q*t+3*q*t*t+t*t*t;}
