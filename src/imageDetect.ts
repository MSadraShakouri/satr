import type { ImageQuad } from './imageGeometry';

/** Conservative bright-page heuristic, not a general document scanner. Null
 * means no confident quadrilateral, and the caller keeps manual handles. */
export function detectBrightPage(source: CanvasImageSource, width: number, height: number): ImageQuad | null {
  const scale=Math.min(1,420/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale)),n=w*h;
  if(w<20||h<20)return null;
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Image detection unavailable');
  ctx.drawImage(source,0,0,w,h);const rgba=ctx.getImageData(0,0,w,h).data,gray=new Uint8Array(n),hist=new Uint32Array(256);
  for(let i=0;i<n;i++){const j=i*4,v=Math.round(.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2]);gray[i]=v;hist[v]++;}
  let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
  let leftCount=0,leftSum=0,otsu=128,bestVariance=0;
  for(let t=0;t<255;t++){
    leftCount+=hist[t];leftSum+=t*hist[t];const right=n-leftCount;if(!leftCount||!right)continue;
    const delta=leftSum/leftCount-(sum-leftSum)/right,variance=leftCount*right*delta*delta;
    if(variance>bestVariance){bestVariance=variance;otsu=t;}
  }
  if(bestVariance===0)return null;
  const thresholds=[otsu+8,otsu+18,otsu+28,otsu+38,otsu+48,200,210].map(t=>Math.max(25,Math.min(240,t)));
  let winner:ImageQuad|null=null,bestScore=0;
  for(const threshold of new Set(thresholds)){
    const seen=new Uint8Array(n),queue=new Int32Array(n);
    for(let start=0;start<n;start++){
      if(seen[start]||gray[start]<threshold)continue;
      let head=0,tail=0;queue[tail++]=start;seen[start]=1;
      let count=0,edge=0,low=Infinity,high=-Infinity,diffLow=Infinity,diffHigh=-Infinity;
      let tl:[number,number]|null=null,tr:[number,number]|null=null,br:[number,number]|null=null,bl:[number,number]|null=null;
      while(head<tail){
        const k=queue[head++],x=k%w,y=Math.floor(k/w);count++;
        if(x<2||y<2||x>=w-2||y>=h-2)edge++;
        const sumxy=x+y,diff=x-y;
        if(sumxy<low){low=sumxy;tl=[x,y];}if(sumxy>high){high=sumxy;br=[x,y];}
        if(diff>diffHigh){diffHigh=diff;tr=[x,y];}if(diff<diffLow){diffLow=diff;bl=[x,y];}
        for(const next of [x>0?k-1:-1,x<w-1?k+1:-1,y>0?k-w:-1,y<h-1?k+w:-1])if(next>=0&&!seen[next]&&gray[next]>=threshold){seen[next]=1;queue[tail++]=next;}
      }
      if(count<n*.15||count>n*.9||edge>count*.002||!tl||!tr||!br||!bl)continue;
      const p=[tl,tr,br,bl];let area=0,convex=true;
      for(let i=0;i<4;i++){
        const a=p[i],b=p[(i+1)%4],d=p[(i+2)%4];area+=a[0]*b[1]-b[0]*a[1];
        if((b[0]-a[0])*(d[1]-b[1])-(b[1]-a[1])*(d[0]-b[0])<=2)convex=false;
      }
      area=Math.abs(area)/2;const fill=count/Math.max(1,area);
      if(!convex||fill<.72||fill>1.08)continue;
      let plausible=true;
      for(let i=0;i<4;i++){
        const v=[p[(i+3)%4][0]-p[i][0],p[(i+3)%4][1]-p[i][1]],u=[p[(i+1)%4][0]-p[i][0],p[(i+1)%4][1]-p[i][1]];
        if(Math.abs((v[0]*u[0]+v[1]*u[1])/(Math.hypot(...v)*Math.hypot(...u)))>.8)plausible=false;
      }
      if(!plausible)continue;
      const score=count/n*Math.min(fill,1);
      if(score>bestScore){bestScore=score;winner=p.map(([x,y])=>[x/(w-1),y/(h-1)] as const) as unknown as ImageQuad;}
    }
  }
  return winner;
}
