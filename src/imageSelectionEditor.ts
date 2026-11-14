import { detectBrightPage } from './imageDetect';
import { cropGeometry, pageGeometry, type ImageGeometry, type ImageQuad, type ImageRect, type ImageTurn } from './imageGeometry';
import { renderImageSelection } from './imageRender';
import { cropPoints, moveCrop, movePageCorner, rotateCrop, rotateQuad, selectionTarget, type SelectionTarget } from './imageSelection';
import './imageSelectionEditor.css';

type Flow = 'crop' | 'page' | 'combo';
export interface SelectionEditorOptions {
  source: CanvasImageSource;
  width: number;
  height: number;
  onCancel(): void;
  onPreview(geometry: ImageGeometry): void;
}
export interface SelectionEditor { element: HTMLElement; dispose(): void }

/** The interactive selection step. It never encodes or changes the source;
 * onPreview receives original-resolution geometry, including Page + Crop. */
export function createImageSelectionEditor(options: SelectionEditorOptions): SelectionEditor {
  const {source,width,height,onCancel,onPreview}=options;
  const root=document.createElement('section'); root.className='image-select';
  root.setAttribute('aria-label','Edit image');
  root.innerHTML=`<header class="image-select-header"><button type="button" data-act="back">Cancel</button><strong>Edit image</strong><span class="image-select-status" role="status"></span></header>
    <div class="image-select-modes"><div role="tablist" aria-label="Selection mode"><button type="button" data-flow="crop" role="tab">Crop</button><button type="button" data-flow="page" role="tab">Page</button><button type="button" data-flow="combo" role="tab">Page + Crop</button></div><button type="button" data-act="rotate" aria-label="Rotate clockwise">↻</button></div>
    <div class="image-select-step" hidden>Crop the straightened page</div>
    <div class="image-select-stage"><div class="image-select-box"><canvas></canvas><svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"><path class="image-select-shade"></path><polygon class="image-select-outline"></polygon></svg><div class="image-select-handles"></div></div><div class="image-select-loupe" hidden><canvas width="112" height="112"></canvas></div></div>
    <div class="image-select-foot"><button type="button" data-act="detect">Smart Detect</button></div><div class="image-select-bottom"><button type="button" data-act="next">Preview</button><p class="image-select-error" role="alert" hidden></p></div>`;
  const q=<T extends Element>(selector:string):T => root.querySelector(selector) as T;
  const stage=q<HTMLDivElement>('.image-select-stage'), box=q<HTMLDivElement>('.image-select-box');
  const canvas=q<HTMLCanvasElement>('.image-select-box canvas'), handles=q<HTMLDivElement>('.image-select-handles');
  const polygon=q<SVGPolygonElement>('.image-select-outline'), shade=q<SVGPathElement>('.image-select-shade');
  const loupe=q<HTMLDivElement>('.image-select-loupe'), loupeCanvas=q<HTMLCanvasElement>('.image-select-loupe canvas');
  const status=q<HTMLSpanElement>('.image-select-status'), error=q<HTMLParagraphElement>('.image-select-error');
  const next=q<HTMLButtonElement>('[data-act="next"]');
  let flow:Flow='page', step:1|2=1, turn:ImageTurn=0, disposed=false, generation=0;
  let rect:ImageRect=[.12,.12,.88,.88], page:ImageQuad=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]];
  let comboRect:ImageRect=[0,0,1,1], edited:HTMLCanvasElement|null=null, detected:ImageQuad|null=null;
  let detectionVersion=0;
  let drag:{ id:number; target:SelectionTarget; x:number; y:number; point:readonly [number,number]; along:number }|null=null;
  let observer:ResizeObserver|null=null;
  const mode=(): 'crop'|'page' => flow==='crop'||(flow==='combo'&&step===2) ? 'crop':'page';
  const currentRect=():ImageRect => flow==='combo'&&step===2?comboRect:rect;
  const points=():ImageQuad => mode()==='crop'?cropPoints(currentRect()):page;
  const orientedWidth=():number => turn%2?height:width;
  const orientedHeight=():number => turn%2?width:height;
  const geometry=():ImageGeometry => flow==='crop'?cropGeometry(width,height,turn,rect):pageGeometry(width,height,turn,page,flow==='combo'?comboRect:undefined);
  const fit=(w:number,h:number,max:number):[number,number] => {const ratio=Math.min(1,max/Math.max(w,h));return [Math.max(1,Math.round(w*ratio)),Math.max(1,Math.round(h*ratio))];};
  function setCanvas():void {
    if (flow==='combo'&&step===2&&edited) {canvas.width=edited.width;canvas.height=edited.height;canvas.getContext('2d')!.drawImage(edited,0,0);return;}
    const [w,h]=fit(orientedWidth(),orientedHeight(),1400);canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d')!;ctx.scale(w/orientedWidth(),h/orientedHeight());
    if(turn===1){ctx.translate(height,0);ctx.rotate(Math.PI/2);}
    if(turn===2){ctx.translate(width,height);ctx.rotate(Math.PI);}
    if(turn===3){ctx.translate(0,width);ctx.rotate(-Math.PI/2);}
    ctx.drawImage(source,0,0,width,height);
  }
  function layout():void {
    if(disposed)return;
    const s=stage.getBoundingClientRect(), ratio=canvas.width/canvas.height;
    const w=Math.max(1,Math.min(Math.max(1,s.width-48),Math.max(1,s.height-12)*ratio));
    box.style.width=`${w}px`;box.style.height=`${w/ratio}px`;
  }
  const corners:HTMLButtonElement[]=[],edges:HTMLButtonElement[]=[];
  for(let i=0;i<4;i++){
    const corner=document.createElement('button');corner.type='button';corner.className='image-select-corner';corner.setAttribute('aria-label',`Corner ${i+1}`);
    corner.addEventListener('keydown',e=>{const delta=keyDelta(e);if(!delta)return;e.preventDefault();const [x,y]=points()[i];move({kind:'corner',index:i},x+delta[0],y+delta[1]);});
    const edge=document.createElement('button');edge.type='button';edge.className=`image-select-edge${i%2?' vertical':''}`;edge.setAttribute('aria-label',`Edge ${i+1}`);
    edge.addEventListener('keydown',e=>{const delta=keyDelta(e);if(!delta)return;e.preventDefault();const [x,y]=points()[i];move({kind:'edge',index:i,along:.5},x+delta[0],y+delta[1]);});
    corners.push(corner);edges.push(edge);handles.append(corner,edge);
  }
  function draw():void {
    if(disposed)return;
    const p=points(), coords=p.map(([x,y])=>`${x*1000},${y*1000}`).join(' ');
    polygon.setAttribute('points',coords);
    shade.setAttribute('d',`M 0 0 H 1000 V 1000 H 0 Z M ${p.map(([x,y])=>`${x*1000} ${y*1000}`).join(' L ')} Z`);
    p.forEach(([x,y],i)=>{
      corners[i].style.left=`${x*100}%`;corners[i].style.top=`${y*100}%`;
      corners[i].classList.toggle('is-active',drag?.target.kind==='corner'&&drag.target.index===i);
      const n=p[(i+1)%4];edges[i].hidden=mode()!=='crop';edges[i].style.left=`${(x+n[0])*50}%`;edges[i].style.top=`${(y+n[1])*50}%`;
      edges[i].classList.toggle('is-active',drag?.target.kind==='edge'&&drag.target.index===i);
    });
  }
  function keyDelta(e:KeyboardEvent):[number,number]|null {return e.key==='ArrowLeft'?[-.01,0]:e.key==='ArrowRight'?[.01,0]:e.key==='ArrowUp'?[0,-.01]:e.key==='ArrowDown'?[0,.01]:null;}
  function move(target:SelectionTarget,x:number,y:number):void {
    if(mode()==='page'&&target.kind==='corner')page=movePageCorner(page,target.index,x,y);
    else if(mode()==='crop'){const changed=moveCrop(currentRect(),target,x,y);if(flow==='combo'&&step===2)comboRect=changed;else rect=changed;}
    draw();
  }
  function ui():void {
    const second=flow==='combo'&&step===2;
    root.querySelectorAll<HTMLButtonElement>('[data-flow]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.flow===flow)));
    q<HTMLElement>('.image-select-modes').hidden=second;q<HTMLElement>('.image-select-step').hidden=!second;
    q<HTMLElement>('.image-select-foot').hidden=second;
    q<HTMLButtonElement>('[data-act="back"]').textContent=second?'‹ Page':'Cancel';
    next.textContent=flow==='combo'&&!second?'Next: crop':'Preview';
    setCanvas();layout();draw();
  }
  function showLoupe(clientX:number,clientY:number):void {
    if(!drag)return;const b=box.getBoundingClientRect(),s=stage.getBoundingClientRect(),p=points();
    const a=p[drag.target.index],z=p[(drag.target.index+1)%4], t=drag.target.kind==='edge'?drag.along:0;
    const x=a[0]+(z[0]-a[0])*t,y=a[1]+(z[1]-a[1])*t;
    const ctx=loupeCanvas.getContext('2d')!,sw=canvas.width*112/(3*Math.max(1,b.width)),sh=canvas.height*112/(3*Math.max(1,b.height));
    ctx.fillStyle='#888';ctx.fillRect(0,0,112,112);ctx.drawImage(canvas,x*canvas.width-sw/2,y*canvas.height-sh/2,sw,sh,0,0,112,112);
    const px=clientX-s.left,py=clientY-s.top;let left=clamp(px-56,5,Math.max(5,s.width-117)),top=py-145;
    if(top<5){top=5;left=clamp(px+(px<=s.width/2?87:-87)-56,5,Math.max(5,s.width-117));}
    loupe.style.left=`${left}px`;loupe.style.top=`${top}px`;loupe.hidden=false;
  }
  stage.addEventListener('pointerdown',e=>{
    if(drag||next.disabled)return;detectionVersion++;e.preventDefault();const b=box.getBoundingClientRect(),target=selectionTarget(mode(),mode()==='crop'?currentRect():page,b,e.clientX,e.clientY);
    drag={id:e.pointerId,target,x:e.clientX,y:e.clientY,point:points()[target.index],along:target.kind==='edge'?target.along:0};stage.setPointerCapture(e.pointerId);draw();showLoupe(e.clientX,e.clientY);
  });
  stage.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;e.preventDefault();const b=box.getBoundingClientRect(),dx=(e.clientX-drag.x)/b.width,dy=(e.clientY-drag.y)/b.height;
    move(drag.target,drag.point[0]+dx,drag.point[1]+dy);
    if(drag.target.kind==='edge'){const p=points(),a=p[drag.target.index],z=p[(drag.target.index+1)%4],d=drag.target.index%2===0?dx/(z[0]-a[0]):dy/(z[1]-a[1]);drag.along=clamp01(drag.target.along+d);}
    showLoupe(e.clientX,e.clientY);
  });
  const end=(e:PointerEvent):void => {if(drag?.id===e.pointerId){drag=null;loupe.hidden=true;draw();}};
  stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',end);stage.addEventListener('lostpointercapture',end);
  root.querySelectorAll<HTMLButtonElement>('[data-flow]').forEach(button=>button.addEventListener('click',()=>{flow=button.dataset.flow as Flow;step=1;generation++;error.hidden=true;ui();}));
  q<HTMLButtonElement>('[data-act="rotate"]').addEventListener('click',()=>{detectionVersion++;turn=((turn+1)%4) as ImageTurn;page=rotateQuad(page);rect=rotateCrop(rect);if(detected)detected=rotateQuad(detected);status.textContent=detected?'Page found':'';ui();if(!detected)detect(false);});
  q<HTMLButtonElement>('[data-act="back"]').addEventListener('click',()=>{if(flow==='combo'&&step===2){step=1;ui();}else onCancel();});
  function detect(manual:boolean):void {
    const request=++detectionVersion;
    const apply=(found:ImageQuad|null):void=>{
      if(disposed||request!==detectionVersion)return;
      if(found){detected=found;page=found;if(manual){flow='page';step=1;}status.textContent='Page found';ui();}
      else status.textContent='No page found';
    };
    if(detected){apply(detected);return;}
    status.textContent='';
    window.setTimeout(()=>{if(disposed||request!==detectionVersion)return;try{apply(detectBrightPage(canvas,canvas.width,canvas.height));}catch{if(!disposed&&request===detectionVersion)status.textContent='Detection unavailable';}},30);
  }
  q<HTMLButtonElement>('[data-act="detect"]').addEventListener('click',()=>detect(true));
  next.addEventListener('click',()=>{void (async()=>{
    error.hidden=true;
    try {
      if(flow==='combo'&&step===1){
        // Freeze the page while its straightened editing preview is rendering.
        detectionVersion++;
        const request=++generation,g=pageGeometry(width,height,turn,page),[w,h]=fit(g.width,g.height,1400);
        next.disabled=true;const result=await renderImageSelection(source,g,{size:{width:w,height:h}});
        if(disposed||request!==generation)return;edited=result;step=2;ui();
      } else onPreview(geometry());
    } catch(e){error.textContent=e instanceof Error?e.message:'Could not prepare the image';error.hidden=false;}
    finally{next.disabled=false;}
  })();});
  if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(layout);observer.observe(stage);}
  ui();requestAnimationFrame(layout);detect(false);
  return {element:root,dispose(){disposed=true;generation++;detectionVersion++;observer?.disconnect();canvas.width=canvas.height=1;loupeCanvas.width=loupeCanvas.height=1;if(edited)edited.width=edited.height=1;root.remove();}};
}
function clamp01(value:number):number{return Math.max(0,Math.min(1,value));}
function clamp(value:number, min:number, max:number):number{return Math.max(min,Math.min(max,value));}
