import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
  });
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
});

test('crop and rotated output use the original integer pixels', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const geom = (window as any).__satr.load('/src/imageGeometry.ts');
    const { renderImageSelection } = (window as any).__satr.load('/src/imageRender.ts');
    const c = document.createElement('canvas'); c.width = 40; c.height = 30;
    const ctx = c.getContext('2d')!;
    const pixels = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const n = (y * c.width + x) * 4; pixels.data[n] = x * 5; pixels.data[n + 1] = y * 7; pixels.data[n + 2] = 99; pixels.data[n + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const normal = geom.cropGeometry(40, 30, 0, [.25, .2, .75, .8]);
    const rotated = geom.cropGeometry(40, 30, 1, [0, 0, 1, 1]);
    const small = await renderImageSelection(c, normal);
    const turn = await renderImageSelection(c, rotated);
    const p = (canvas: HTMLCanvasElement, x: number, y: number) => Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data);
    return { normal, rotated, pixel: p(small, 0, 0), rotatedPixel: p(turn, 0, 0), expectedRotated: p(c, 0, 29) };
  });
  expect([result.normal.width, result.normal.height]).toEqual([20, 18]);
  expect(result.pixel).toEqual([50, 42, 99, 255]);
  expect([result.rotated.width, result.rotated.height]).toEqual([30, 40]);
  expect(result.rotatedPixel).toEqual(result.expectedRotated);
});

test('page then crop matches the same pixels in the full straightened page, including alpha', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const geom = (window as any).__satr.load('/src/imageGeometry.ts');
    const { renderImageSelection } = (window as any).__satr.load('/src/imageRender.ts');
    const source = document.createElement('canvas'); source.width = 1000; source.height = 800;
    const s = source.getContext('2d')!, im = s.createImageData(source.width, source.height);
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      const i = (y * source.width + x) * 4; im.data[i] = x % 256; im.data[i + 1] = y % 256; im.data[i + 2] = (x + y) % 256; im.data[i + 3] = (x * 3 + y * 2) % 256;
    }
    s.putImageData(im, 0, 0);
    const quad = [[.08,.09],[.94,.15],[.89,.94],[.13,.87]];
    const full = geom.pageGeometry(1000, 800, 0, quad), selected = geom.pageGeometry(1000, 800, 0, quad, [.1,.2,.9,.85]);
    const straight = await renderImageSelection(source, full), part = await renderImageSelection(source, selected);
    const a = straight.getContext('2d')!.getImageData(selected.offsetX, selected.offsetY, selected.width, selected.height).data;
    const b = part.getContext('2d')!.getImageData(0, 0, selected.width, selected.height).data;
    let max = 0, different = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); max = Math.max(max, d); if (d) different++; }
    return { width: selected.width, height: selected.height, max, different };
  });
  expect(result.width * result.height).toBeGreaterThan(200_000);
  expect(result.max).toBe(0);
  expect(result.different).toBe(0);
});

test('worker and yielding fallback return identical pixels and respect cancellation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const geom = (window as any).__satr.load('/src/imageGeometry.ts');
    const { renderImageSelection } = (window as any).__satr.load('/src/imageRender.ts');
    const source = document.createElement('canvas'); source.width = 900; source.height = 700;
    const ctx = source.getContext('2d')!; ctx.fillStyle = '#fee'; ctx.fillRect(0,0,900,700); ctx.fillStyle = 'rgba(0,80,255,.5)'; ctx.fillRect(200,100,400,350);
    const g = geom.pageGeometry(900,700,1,[[.1,.07],[.9,.1],[.87,.9],[.08,.86]]);
    const ActualWorker = window.Worker; let workerMessages = 0, workerErrors = 0;
    window.Worker = class extends ActualWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', () => workerMessages++);
        this.addEventListener('error', () => workerErrors++);
      }
    };
    const worker = await renderImageSelection(source,g), fallback = await renderImageSelection(source,g,{useWorker:false});
    window.Worker = ActualWorker;
    const a=worker.getContext('2d')!.getImageData(0,0,g.width,g.height).data, b=fallback.getContext('2d')!.getImageData(0,0,g.width,g.height).data;
    let different=0; for (let i=0;i<a.length;i++) if(a[i]!==b[i]) different++;
    const abort=new AbortController(); abort.abort(); let cancelled='';
    try { await renderImageSelection(source,g,{signal:abort.signal}); } catch (error) { cancelled=(error as Error).name; }
    return { different, cancelled, width:g.width, height:g.height, workerMessages, workerErrors };
  });
  expect(result.width * result.height).toBeGreaterThan(200_000);
  expect(result.different).toBe(0);
  expect(result.workerMessages).toBe(1);
  expect(result.workerErrors).toBe(0);
  expect(result.cancelled).toBe('AbortError');
});

test('invalid crop, corner ordering and output region fail instead of changing the original', async ({ page }) => {
  const names = await page.evaluate(async () => {
    const geom=(window as any).__satr.load('/src/imageGeometry.ts'), {renderImageSelection}=(window as any).__satr.load('/src/imageRender.ts');
    const errors:string[]=[]; for (const fn of [() => geom.cropGeometry(10,10,0,[.8,0,.2,1]), () => geom.pageGeometry(10,10,0,[[0,0],[1,1],[1,0],[0,1]]), () => geom.cropGeometry(0,10,0,[0,0,1,1])]) {
      try { fn(); } catch (e) { errors.push((e as Error).message); }
    }
    try { await renderImageSelection(document.createElement('canvas'),geom.cropGeometry(10,10,0,[0,0,1,1]),{region:{x:9,y:0,width:2,height:1}}); } catch(e) { errors.push((e as Error).message); }
    return errors;
  });
  expect(names).toEqual(['Invalid crop', 'Invalid page corners', 'Invalid source image dimensions or rotation', 'Invalid image region']);
});

test('skewed page maps to independently solved original coordinates', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const geom = (window as any).__satr.load('/src/imageGeometry.ts'), { renderImageSelection } = (window as any).__satr.load('/src/imageRender.ts');
    const src = document.createElement('canvas'); src.width = 320; src.height = 240;
    const context = src.getContext('2d')!, pixels = context.createImageData(320, 240);
    for (let y=0;y<240;y++) for(let x=0;x<320;x++) { const i=(y*320+x)*4; pixels.data[i]=x%256; pixels.data[i+1]=y; pixels.data[i+2]=(x+y)%256; pixels.data[i+3]=255; }
    context.putImageData(pixels,0,0);
    const quad=[[.1,.08],[.91,.15],[.84,.92],[.06,.82]], g=geom.pageGeometry(320,240,0,quad,[.17,.13,.85,.9]);
    const actual=await renderImageSelection(src,g), actualPixels=actual.getContext('2d')!.getImageData(0,0,g.width,g.height).data;
    const dst=[[0,0],[g.pageWidth-1,0],[g.pageWidth-1,g.pageHeight-1],[0,g.pageHeight-1]];
    const matrix:number[][]=[];
    for(let i=0;i<4;i++){const [x,y]=dst[i],X=quad[i][0]*319,Y=quad[i][1]*239;matrix.push([x,y,1,0,0,0,-x*X,-y*X,X],[0,0,0,x,y,1,-x*Y,-y*Y,Y]);}
    // Independent eight-equation homography solution, not the renderer's formula.
    for(let col=0;col<8;col++){let pivot=col;for(let row=col+1;row<8;row++)if(Math.abs(matrix[row][col])>Math.abs(matrix[pivot][col]))pivot=row;[matrix[col],matrix[pivot]]=[matrix[pivot],matrix[col]];const n=matrix[col][col];for(let j=col;j<9;j++)matrix[col][j]/=n;for(let row=0;row<8;row++)if(row!==col){const k=matrix[row][col];for(let j=col;j<9;j++)matrix[row][j]-=k*matrix[col][j];}}
    const [a,b,c,d,e,f,gg,hh]=matrix.map(row=>row[8]); let max=0,count=0;
    for(let y=2;y<g.height-2;y+=11)for(let x=2;x<g.width-2;x+=11){const u=x+g.offsetX,v=y+g.offsetY,z=gg*u+hh*v+1,X=Math.max(0,Math.min(319,(a*u+b*v+c)/z)),Y=Math.max(0,Math.min(239,(d*u+e*v+f)/z));const x0=Math.floor(X),y0=Math.floor(Y),x1=Math.min(319,x0+1),y1=Math.min(239,y0+1),fx=X-x0,fy=Y-y0;for(let ch=0;ch<4;ch++){const at=(xx:number,yy:number)=>pixels.data[(yy*320+xx)*4+ch],expected=at(x0,y0)*(1-fx)*(1-fy)+at(x1,y0)*fx*(1-fy)+at(x0,y1)*(1-fx)*fy+at(x1,y1)*fx*fy;max=Math.max(max,Math.abs(expected-actualPixels[(y*g.width+x)*4+ch]));count++;}}
    return {max,count};
  });
  expect(result.count).toBeGreaterThan(500);
  expect(result.max).toBeLessThanOrEqual(.51);
});


test('the geometry is a snapshot and an in-flight perspective job can be cancelled', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const geom=(window as any).__satr.load('/src/imageGeometry.ts'), {renderImageSelection}=(window as any).__satr.load('/src/imageRender.ts');
    const quad=[[.1,.1],[.9,.12],[.88,.9],[.08,.85]], selection=geom.pageGeometry(1500,1200,0,quad);
    quad[0][0]=.4;
    const originalCorner=selection.quad[0][0];
    const c=document.createElement('canvas'); c.width=1500;c.height=1200;const controller=new AbortController();
    const ActualWorker=window.Worker; let started=false;
    window.Worker=class extends ActualWorker { constructor(url:string|URL,opts?:WorkerOptions){super(url,opts);started=true;setTimeout(()=>controller.abort(),0)} };
    let name='';try{await renderImageSelection(c,selection,{signal:controller.signal})}catch(e){name=(e as Error).name}finally{window.Worker=ActualWorker}
    return {originalCorner,started,name};
  });
  expect(result.originalCorner).toBe(.1);
  expect(result.started).toBe(true);
  expect(result.name).toBe('AbortError');
});
