import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n');
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
  });
  await page.goto('/'); await page.waitForSelector('#boot-snapshot', { state: 'detached' });
});

test('moving a note adjusts local image URLs without changing code, other links or shared files', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { rewriteMovedImageLinks } = (window as any).__satr.load('/src/imageMoveLinks.ts');
    const seen: string[] = [];
    const exists = async (path:string) => { seen.push(path); return ['Notes/Source/res/شکل (1).png','Notes/shared/a.png'].includes(path); };
    const input = [
      '![Diagram](res/%D8%B4%DA%A9%D9%84%20%281%29.png "caption")',
      '![other](../shared/a.png?size=2#part)',
      '[a link](res/%D8%B4%DA%A9%D9%84%20%281%29.png)',
      '`![](res/%D8%B4%DA%A9%D9%84%20%281%29.png)`',
      '```\n![](res/%D8%B4%DA%A9%D9%84%20%281%29.png)\n```',
      '![remote](https://example.com/a.png)',
      '![root](/Notes/res/a.png)',
      '![missing](res/missing.png)',
    ].join('\n\n');
    const output = await rewriteMovedImageLinks(input, 'Notes/Source/A.md', 'Notes/Destination/Deep/A.md', exists);
    return {input,output,seen};
  });
  expect(result.output).toContain('![Diagram](../../Source/res/%D8%B4%DA%A9%D9%84%20%281%29.png \"caption\")'.replaceAll('\\\"','\"'));
  expect(result.output).toContain('![other](../../shared/a.png?size=2#part)');
  expect(result.output).toContain('[a link](res/%D8%B4%DA%A9%D9%84%20%281%29.png)');
  expect(result.output).toContain('`![](res/%D8%B4%DA%A9%D9%84%20%281%29.png)`');
  expect(result.output).toContain('```\n![](res/%D8%B4%DA%A9%D9%84%20%281%29.png)\n```');
  expect(result.output).toContain('![remote](https://example.com/a.png)');
  expect(result.output).toContain('![root](/Notes/res/a.png)');
  expect(result.output).toContain('![missing](res/missing.png)');
  expect(result.seen).toContain('Notes/shared/a.png');
});

test('inserted image links survive moves deeper, upward, to the root, and back', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { rewriteMovedImageLinks } = (window as any).__satr.load('/src/imageMoveLinks.ts');
    const exists = async (p:string) => p === 'Notes/res/شکل (1).png';
    const start = '![تصویر](res/%D8%B4%DA%A9%D9%84%20%281%29.png)';
    const deep = await rewriteMovedImageLinks(start,'Notes/A.md','Notes/Deep/More/A.md',exists);
    const root = await rewriteMovedImageLinks(deep,'Notes/Deep/More/A.md','A.md',exists);
    const back = await rewriteMovedImageLinks(root,'A.md','Notes/A.md',exists);
    const same = await rewriteMovedImageLinks(start,'Notes/A.md','Notes/B.md',exists);
    return {start,deep,root,back,same};
  });
  expect(result.deep).toBe('![تصویر](../../res/%D8%B4%DA%A9%D9%84%20%281%29.png)');
  expect(result.root).toBe('![تصویر](Notes/res/%D8%B4%DA%A9%D9%84%20%281%29.png)');
  expect(result.back).toBe(result.start);
  expect(result.same).toBe(result.start);
});

test('moving a note keeps its image in place and restores the original note if rewriting fails', async ({page})=>{
 const got=await page.evaluate(async()=>{
  const {moveMarkdownWithImages}=(window as any).__satr.load('/src/imageMoveLinks.ts');
  async function scenario(fail:boolean){
   const files=new Map([['Notes/A.md','note ![](res/a.png)'],['Notes/res/a.png','image bytes']]);let writeCount=0;
   const store={read:async(p:string)=>files.get(p)??null,stat:async(p:string)=>files.has(p)?{path:p,name:p.split('/').pop(),kind:'file',mtime:1}:null,
    rename:async(a:string,b:string)=>{if(files.has(b))throw Error('exists');if(!files.has(a))throw Error('missing');files.set(b,files.get(a)!);files.delete(a)},
    write:async(p:string,t:string)=>{writeCount++;if(fail&&writeCount===1){files.set(p,'partial');throw Error('disk full')}files.set(p,t)},createNoteBackup:async(p:string,t:string)=>{if(files.has(p))throw Error('exists');files.set(p,t)},remove:async(p:string)=>{files.delete(p)}};
   let message='';try{await moveMarkdownWithImages(store,'Notes/A.md','Notes/New/A.md')}catch(e){message=(e as Error).message}
   return {message,old:files.get('Notes/A.md')??null,next:files.get('Notes/New/A.md')??null,image:files.get('Notes/res/a.png'),recovery:[...files].filter(([p])=>p.includes('Satr recovery')).map(([,v])=>v)};
  }
  return {success:await scenario(false),failure:await scenario(true)};
 });
 expect(got.success).toEqual({message:'',old:null,next:'note ![](../res/a.png)',image:'image bytes',recovery:[]});
 expect(got.failure.message).toContain('The original note was restored.');expect(got.failure.message).toContain('disk full');expect(got.failure.old).toBe('note ![](res/a.png)');expect(got.failure.next).toBeNull();expect(got.failure.image).toBe('image bytes');expect(got.failure.recovery).toEqual(['partial']);
});

test('a concurrent note change detected before the rewrite is never replaced by stale text',async({page})=>{
 const got=await page.evaluate(async()=>{
  const {moveMarkdownWithImages}=(window as any).__satr.load('/src/imageMoveLinks.ts');const files=new Map([['Notes/A.md','old ![](res/a.png)'],['Notes/res/a.png','img']]);let changed=false,writes=0;
  const store={read:async(p:string)=>files.get(p)??null,stat:async(p:string)=>files.has(p)?{kind:'file'}:null,write:async(p:string,t:string)=>{writes++;files.set(p,t)},createNoteBackup:async(p:string,t:string)=>{if(files.has(p))throw Error('exists');files.set(p,t)},remove:async(p:string)=>{files.delete(p)},rename:async(a:string,b:string)=>{files.set(b,files.get(a)!);files.delete(a);if(!changed&&b==='Notes/New/A.md'){files.set(b,'newer independent text');changed=true}}};
  let error='';try{await moveMarkdownWithImages(store,'Notes/A.md','Notes/New/A.md')}catch(e){error=(e as Error).message};return {error,writes,old:files.get('Notes/A.md'),next:files.get('Notes/New/A.md')??null};
 });expect(got.error).toContain('The moved note changed before its links were updated');expect(got.error).toContain('A recovery copy is at');expect(got.writes).toBe(0);expect(got.old).toBe('newer independent text');expect(got.next).toBeNull();
});

test('moving preserves escaped Markdown filenames and ignores schemes containing digits',async({page})=>{
 const got=await page.evaluate(async()=>{
  const {rewriteMovedImageLinks}=(window as any).__satr.load('/src/imageMoveLinks.ts');
  const text=String.raw`![escaped](res/photo\(1\).png) ![remote](s3://bucket/a.png)`;const seen:string[]=[];
  const output=await rewriteMovedImageLinks(text,'Notes/A.md','Notes/Deep/A.md',async(p:string)=>{seen.push(p);return p==='Notes/res/photo(1).png'||p==='Notes/s3:/bucket/a.png';});return {text,output,seen};
 });
 expect(got.output).toBe('![escaped](../res/photo%281%29.png) ![remote](s3://bucket/a.png)');expect(got.seen).toEqual(['Notes/res/photo(1).png']);
});
