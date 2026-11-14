import type { ImagePoint, ImageQuad, ImageRect } from './imageGeometry';

export type SelectionTarget = { kind: 'corner'; index: number } | { kind: 'edge'; index: number; along: number };
export interface ImageBox { left: number; top: number; width: number; height: number }
const clamp = (n: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, n));
export const cropPoints = ([l,t,r,b]: ImageRect): ImageQuad => [[l,t],[r,t],[r,b],[l,b]];

/** Hit testing in screen pixels, including the margin outside the image. The
 * crop's left/right sides take precedence outside even beyond the corners;
 * close to a corner the corner still wins. */
export function selectionTarget(mode: 'crop' | 'page', selection: ImageRect | ImageQuad, box: ImageBox, x: number, y: number): SelectionTarget {
  const points = (mode === 'crop' ? cropPoints(selection as ImageRect) : selection as ImageQuad)
    .map(([a,b]) => [box.left + a * box.width, box.top + b * box.height] as const);
  let nearest = 0, distance = Infinity;
  for (let i=0;i<4;i++) {
    const d = Math.hypot(x-points[i][0], y-points[i][1]);
    if (d < distance) { nearest = i; distance = d; }
  }
  if (mode === 'page' || distance <= 20) return {kind:'corner',index:nearest};
  const edge = (i:number, inset = 0): {target: SelectionTarget; distance: number} => {
    const a=points[i],b=points[(i+1)%4],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    const margin = Math.min(.25, inset / Math.max(length, 1));
    const along=clamp(((x-a[0])*dx+(y-a[1])*dy)/Math.max(1,dx*dx+dy*dy),margin,1-margin);
    return {target:{kind:'edge',index:i,along},distance:Math.hypot(x-a[0]-along*dx,y-a[1]-along*dy)};
  };
  if (x < points[0][0]) return edge(3).target;
  if (x > points[1][0]) return edge(1).target;
  if (y < points[0][1]) return edge(0).target;
  if (y > points[2][1]) return edge(2).target;
  let best: SelectionTarget = {kind:'corner',index:nearest}, score=distance;
  for (let i=0;i<4;i++) { const candidate=edge(i,12); if (candidate.distance-12 < score) {score=candidate.distance-12;best=candidate.target;} }
  return best;
}

/** Coordinates supplied here are the initial selected handle plus pointer
 * displacement, not the pointer itself: touching a margin never jumps. */
export function moveCrop(rect: ImageRect, target: SelectionTarget, x:number, y:number): ImageRect {
  let [l,t,r,b]=rect; x=clamp(x); y=clamp(y);
  if (target.kind === 'corner') {
    if (target.index===0 || target.index===3) l=Math.min(x,r-.05); else r=Math.max(x,l+.05);
    if (target.index===0 || target.index===1) t=Math.min(y,b-.05); else b=Math.max(y,t+.05);
  } else {
    if (target.index===0) t=Math.min(y,b-.05);
    if (target.index===1) r=Math.max(x,l+.05);
    if (target.index===2) b=Math.max(y,t+.05);
    if (target.index===3) l=Math.min(x,r-.05);
  }
  return [l,t,r,b];
}
export function movePageCorner(quad: ImageQuad, index: number, x: number, y: number): ImageQuad {
  const next=quad.map(([a,b]) => [a,b] as ImagePoint) as unknown as [ImagePoint,ImagePoint,ImagePoint,ImagePoint];
  if (!Number.isInteger(index) || index<0 || index>3) return quad;
  next[index]=[clamp(x),clamp(y)];
  for(let i=0;i<4;i++) {
    const a=next[i],b=next[(i+1)%4],c=next[(i+2)%4];
    if ((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]) <= .003) return quad;
  }
  return next;
}
export function rotateCrop([l,t,r,b]: ImageRect): ImageRect { return [1-b,l,1-t,r]; }
export function rotateQuad(quad: ImageQuad): ImageQuad {
  const turn = ([x,y]: ImagePoint): ImagePoint => [1-y,x];
  return [turn(quad[3]),turn(quad[0]),turn(quad[1]),turn(quad[2])];
}
