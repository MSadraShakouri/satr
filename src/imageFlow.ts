import { createImageSelectionEditor, type SelectionEditor } from './imageSelectionEditor';
import { createImageReview, type ImageReview } from './imageReview';
import type { ImageGeometry } from './imageGeometry';
import './imageFlow.css';

export interface ImageFlowOptions {
  image:Blob;
  /** A chosen filename, or empty for clipboard and camera. */
  name:string;
  onInsert(blob:Blob,name:string):Promise<void>;
  onClose():void;
  signal?:AbortSignal;
}
export interface ImageFlow {element:HTMLElement;back():void;dispose():void}

/** File, clipboard, and camera all enter the same editor and review. The
 * source remains in memory only. Storage is the caller's responsibility. */
export async function createImageFlow(options:ImageFlowOptions):Promise<ImageFlow> {
  if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(!options.image.size||!options.image.type.startsWith('image/'))throw new Error('Choose an image');
  const url=URL.createObjectURL(options.image),image=new Image();image.src=url;
  try{await image.decode();}catch{URL.revokeObjectURL(url);throw new Error('Could not open this image');}
  if(options.signal?.aborted){URL.revokeObjectURL(url);throw new DOMException('Cancelled','AbortError');}
  if(!image.naturalWidth||!image.naturalHeight){URL.revokeObjectURL(url);throw new Error('This image has no pixels');}
  const container=document.createElement('div');container.className='image-flow';container.dataset.ignoreSwipe='';
  let editor:SelectionEditor|null=null,review:ImageReview|null=null,disposed=false,busy=false;
  const dispose=():void=>{if(disposed)return;disposed=true;review?.dispose();editor?.dispose();URL.revokeObjectURL(url);image.src='';container.remove();};
  const close=():void=>{if(disposed)return;dispose();options.onClose();};
  const back=():void=>{if(busy)return;if(review){review.dispose();review=null;if(editor)editor.element.hidden=false;}else close();};
  const showReview=(geometry:ImageGeometry):void=>{
    if(disposed||!editor)return;editor.element.hidden=true;
    review=createImageReview({source:image,width:image.naturalWidth,height:image.naturalHeight,sourceType:options.image.type,sourceSize:options.image.size,geometry,onBack:back,
      async onInsert(blob){busy=true;try{await options.onInsert(blob,options.name);close();}finally{busy=false;}}});
    container.append(review.element);
  };
  editor=createImageSelectionEditor({source:image,width:image.naturalWidth,height:image.naturalHeight,onCancel:close,onPreview:showReview});
  container.append(editor.element);return {element:container,back,dispose};
}
