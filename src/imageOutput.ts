import { renderImageSelection, type ImageRegion } from './imageRender';
import type { ImageGeometry } from './imageGeometry';

export type ImageFormat = 'image/jpeg' | 'image/png' | 'image/webp';
export type JpegBackground = 'white' | 'black';
export interface ImageEncoding { format: ImageFormat; quality: number; background?: JpegBackground }
function check(signal?:AbortSignal):void{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');}

/** Inspect alpha in strips. This checks the full source, not a reduced preview
 * that could miss a single transparent pixel; no output is encoded here. */
export async function imageHasTransparency(source:CanvasImageSource,width:number,height:number,signal?:AbortSignal):Promise<boolean>{
  check(signal);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('Invalid source image');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.min(256,height);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Could not inspect transparency');
  for(let y=0;y<height;y+=canvas.height){
    check(signal);const h=Math.min(canvas.height,height-y);ctx.clearRect(0,0,width,canvas.height);
    ctx.drawImage(source,0,y,width,h,0,0,width,h);
    const data=ctx.getImageData(0,0,width,h).data;
    for(let i=3;i<data.length;i+=4)if(data[i]!==255)return true;
    if(y+canvas.height<height)await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  check(signal);return false;
}

/** Encode only the canvas supplied. A preview supplies a small canvas; Insert
 * supplies original-resolution output. JPEG gets an explicit matte. */
export async function encodeImage(canvas:HTMLCanvasElement,encoding:ImageEncoding,signal?:AbortSignal):Promise<Blob>{
  check(signal);if(!Number.isFinite(encoding.quality)||encoding.quality<0||encoding.quality>1)throw new Error('Invalid image quality');
  let input=canvas;
  if(encoding.format==='image/jpeg'&&encoding.background){
    input=document.createElement('canvas');input.width=canvas.width;input.height=canvas.height;
    const ctx=input.getContext('2d');if(!ctx)throw new Error('Could not prepare JPEG');
    ctx.fillStyle=encoding.background;ctx.fillRect(0,0,input.width,input.height);ctx.drawImage(canvas,0,0);
  }
  const blob=await new Promise<Blob|null>(resolve=>input.toBlob(resolve,encoding.format,encoding.quality));
  check(signal);if(!blob||blob.type!==encoding.format)throw new Error('This image format is not supported');return blob;
}
export async function makeImageOutput(source:CanvasImageSource,geometry:ImageGeometry,encoding:ImageEncoding,signal?:AbortSignal):Promise<Blob>{
  let full:HTMLCanvasElement;
  if(geometry.kind==='crop')full=await renderImageSelection(source,geometry,{signal});
  else {
    // A full-page perspective render otherwise holds the complete source
    // canvas, its pixel buffer, the worker output and the final canvas at
    // once. Render strips at original resolution into the final canvas;
    // the strip boundaries use the same global page coordinates.
    check(signal);full=document.createElement('canvas');full.width=geometry.width;full.height=geometry.height;
    const ctx=full.getContext('2d');if(!ctx||full.width!==geometry.width||full.height!==geometry.height)throw new Error('Could not allocate image');
    try{
      const stripHeight=Math.max(1,Math.min(geometry.height,Math.floor(1_000_000/geometry.width)));
      for(let y=0;y<geometry.height;y+=stripHeight){
        check(signal);const h=Math.min(stripHeight,geometry.height-y);
        const strip=await renderImageSelection(source,geometry,{region:{x:0,y,width:geometry.width,height:h},signal});
        try{ctx.drawImage(strip,0,y);}finally{strip.width=strip.height=1;}
      }
    }catch(error){full.width=full.height=1;throw error;}
  }
  try{return await encodeImage(full,encoding,signal);}finally{full.width=full.height=1;}
}

/** Cached original-resolution tiles: changing format or quality reuses the
 * expensive perspective sampling instead of transforming it nine times again. */
export function createImageEstimateSampler(source:CanvasImageSource,geometry:ImageGeometry,life?:AbortSignal): {
  estimate(encoding:ImageEncoding,signal?:AbortSignal):Promise<{low:number;high:number}>; dispose():void;
} {
  const nx=Math.min(3,geometry.width),ny=Math.min(3,geometry.height);
  const tiles=new Map<number,Promise<{canvas:HTMLCanvasElement;pixels:number}>>();let disposed=false;
  function tile(xx:number,yy:number):Promise<{canvas:HTMLCanvasElement;pixels:number}> {
    const id=yy*nx+xx,existing=tiles.get(id);if(existing)return existing;
    const cellW=geometry.width/nx,cellH=geometry.height/ny,width=Math.max(1,Math.min(256,Math.floor(cellW))),height=Math.max(1,Math.min(256,Math.floor(cellH)));
    const x=Math.min(geometry.width-width,Math.max(0,Math.round((xx+.5)*cellW-width/2))),y=Math.min(geometry.height-height,Math.max(0,Math.round((yy+.5)*cellH-height/2)));
    const region:ImageRegion={x,y,width,height};
    const pending=renderImageSelection(source,geometry,{region,signal:life}).then(canvas=>{if(disposed){canvas.width=canvas.height=1;throw new DOMException('Cancelled','AbortError');}return {canvas,pixels:width*height};});
    tiles.set(id,pending);void pending.catch(()=>{if(tiles.get(id)===pending)tiles.delete(id);});return pending;
  }
  return {
    async estimate(encoding,signal){
      let bytes=0,pixels=0;
      for(let yy=0;yy<ny;yy++)for(let xx=0;xx<nx;xx++){
        check(life);check(signal);if(disposed)throw new DOMException('Cancelled','AbortError');
        const current=await tile(xx,yy);check(life);check(signal);
        const blob=await encodeImage(current.canvas,encoding,signal);
        const overhead=encoding.format==='image/jpeg'?500:encoding.format==='image/webp'?40:100;
        bytes+=Math.max(0,blob.size-overhead);pixels+=current.pixels;
      }
      const overhead=encoding.format==='image/jpeg'?500:encoding.format==='image/webp'?40:100;
      const estimate=Math.max(1,Math.round(bytes*(geometry.width*geometry.height/pixels)+overhead));
      return {low:Math.max(1,Math.round(estimate*.5)),high:Math.round(estimate*2)};
    },
    dispose(){disposed=true;for(const pending of tiles.values())void pending.then(({canvas})=>{canvas.width=canvas.height=1;},()=>{});tiles.clear();},
  };
}

/** A deliberately broad nine-tile estimate, never a full output encoding. */
export async function estimateImageOutput(source:CanvasImageSource,geometry:ImageGeometry,encoding:ImageEncoding,signal?:AbortSignal):Promise<{low:number;high:number}>{
  const sampler=createImageEstimateSampler(source,geometry,signal);
  try{return await sampler.estimate(encoding,signal);}finally{sampler.dispose();}
}
