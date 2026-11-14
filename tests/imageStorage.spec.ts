import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown', '1');
    if (!localStorage.getItem('satr:fs:index')) {
      localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
      localStorage.setItem('satr:fs:file:Notes/A.md', '# A\n');
      localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    }
  });
  await page.goto('/'); await page.waitForSelector('#boot-snapshot', { state: 'detached' });
}

test('an image is stored beside the note, linked portably and read back unchanged', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { saveImageResource } = (window as any).__satr.load('/src/imageStorage.ts');
    const { backend } = (window as any).__satr.load('/src/vault.ts');
    const { renderMarkdown } = (window as any).__satr.load('/src/markdown.ts');
    const { loadImages } = (window as any).__satr.load('/src/images.ts');
    const original = document.createElement('canvas'); original.width = 23; original.height = 17;
    const ctx = original.getContext('2d')!; ctx.fillStyle = '#f71377'; ctx.fillRect(0,0,23,17);
    const blob: Blob = await new Promise((resolve) => original.toBlob((b) => resolve(b!), 'image/png'));
    const first = await saveImageResource('Notes/A.md', 'شکل 1 #100%.png', blob);
    const second = await saveImageResource('Notes/A.md', 'شکل 1 #100%.png', blob);
    const root = await saveImageResource('root.md', '', blob);
    const saved = await backend.readBytes(first.path);
    const expected = new Uint8Array(await blob.arrayBuffer());
    const equal = saved.length === expected.length && saved.every((b:number,i:number) => b === expected[i]);
    const target = document.createElement('div'); target.innerHTML = renderMarkdown(first.markdown);
    await loadImages(target, 'Notes/A.md');
    const img = target.querySelector('img') as HTMLImageElement | null;
    const decoded = !!img && img.naturalWidth === 23 && img.naturalHeight === 17;
    return { first, second, root, equal, decoded, note: await backend.read('Notes/A.md') };
  });
  expect(result.first).toEqual({ path: 'Notes/res/شکل 1 #100%.png', markdown: '![](res/%D8%B4%DA%A9%D9%84%201%20%23100%25.png)' });
  expect(result.second.path).toBe('Notes/res/شکل 1 #100% 1.png');
  expect(result.root).toEqual({ path: 'res/Image.png', markdown: '![](res/Image.png)' });
  expect(result.equal).toBe(true); expect(result.decoded).toBe(true); expect(result.note).toBe('# A\n');
  await page.reload();
  const persisted = await page.evaluate(async () => {
    const { backend } = (window as any).__satr.load('/src/vault.ts');
    return { entry: await backend.stat('Notes/res/شکل 1 #100%.png'), bytes: (await backend.readBytes('Notes/res/شکل 1 #100%.png'))?.length };
  });
  expect(persisted.entry.kind).toBe('file'); expect(persisted.bytes).toBeGreaterThan(0);
});

test('unbalanced parentheses and unusual Unicode cannot corrupt the Markdown link or orphan an image', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const {saveImageResource}=(window as any).__satr.load('/src/imageStorage.ts');
    const {renderMarkdown}=(window as any).__satr.load('/src/markdown.ts');
    const {backend}=(window as any).__satr.load('/src/vault.ts');
    const blob=new Blob(['image'],{type:'image/png'});
    const one=await saveImageResource('Notes/A.md','bad)name!.png',blob);
    const two=await saveImageResource('Notes/A.md','bad\ud800name.png',blob);
    const container=document.createElement('div');container.innerHTML=renderMarkdown(one.markdown);
    return {one,two,src:container.querySelector('img')?.dataset.src,second:!!await backend.stat(two.path)};
  });
  expect(result.one.markdown).toBe('![](res/bad%29name%21.png)');
  expect(result.src).toBe('res/bad%29name%21.png');
  expect(result.two.path).toBe('Notes/res/bad�name.png');
  expect(result.second).toBe(true);
});

test('parallel attempts cannot overwrite one another or an existing legacy file', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { backend } = (window as any).__satr.load('/src/vault.ts');
    await backend.write('Notes/res/old.jpg', 'original legacy text');
    const blob = new Blob(['new image'], { type: 'image/jpeg' });
    let old = ''; try { await backend.createImageBytes('Notes/res/old.jpg', blob); } catch (e) { old = (e as Error).name; }
    const [a,b] = await Promise.allSettled([backend.createImageBytes('Notes/res/race.jpg', blob), backend.createImageBytes('Notes/res/race.jpg', blob)]);
    return { old, oldText: await backend.read('Notes/res/old.jpg'), attempts: [a.status,b.status].sort(), bytes: Array.from(await backend.readBytes('Notes/res/race.jpg')) };
  });
  expect(result.old).toBe('ImageNameTakenError'); expect(result.oldText).toBe('original legacy text');
  expect(result.attempts).toEqual(['fulfilled', 'rejected']); expect(result.bytes).toEqual([...Buffer.from('new image')]);
});

test('aborted database transactions and index failures do not publish an image', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { backend } = (window as any).__satr.load('/src/vault.ts');
    const { getStored } = (window as any).__satr.load('/src/webStore.ts');
    const blob = new Blob(['binary'], { type: 'image/png' });
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value: unknown, key?: IDBValidKey) {
      const request = add.call(this, value, key);
      if (key === 'Notes/res/abort.png') request.addEventListener('success', () => this.transaction.abort(), { once: true });
      return request;
    };
    let transactionError = false;
    try { await backend.createImageBytes('Notes/res/abort.png', blob); } catch { transactionError = true; }
    IDBObjectStore.prototype.add = add;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) {
      if (key === 'satr:fs:index') throw new Error('injected index failure');
      return set.call(this, key, value);
    };
    let indexError = false;
    try { await backend.createImageBytes('Notes/res/index.png', blob); } catch { indexError = true; }
    Storage.prototype.setItem = set;
    return { transactionError, indexError, abort: await backend.stat('Notes/res/abort.png'), failedIndex: await backend.stat('Notes/res/index.png'), storedAbort: (await getStored('Notes/res/abort.png')) ?? null, storedIndex: (await getStored('Notes/res/index.png')) ?? null };
  });
  expect(result).toEqual({ transactionError: true, indexError: true, abort: null, failedIndex: null, storedAbort: null, storedIndex: null });
});

test('cleanup does not delete a newer writer’s replacement', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const {createOwnedStored, removeOwnedStored, putStored, getStored} = (window as any).__satr.load('/src/webStore.ts');
    const path='Notes/res/race.png';
    const created=await createOwnedStored(path,{blob:new Blob(['ours']),mime:'image/png'},'old-owner');
    await putStored(path,{blob:new Blob(['other']),mime:'image/png'});
    const cleaned=await removeOwnedStored(path,'old-owner'), saved=await getStored(path);
    return {created,cleaned,text:await saved.blob.text()};
  });
  expect(result).toEqual({created:'created',cleaned:true,text:'other'});
});

test('invalid paths, failed parents and unsupported formats are refused', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { saveImageResource } = (window as any).__satr.load('/src/imageStorage.ts');
    const { backend } = (window as any).__satr.load('/src/vault.ts');
    const blob=new Blob(['image'],{type:'image/png'}), names:string[]=[];
    for(const fn of [() => saveImageResource('../x.md','x.png',blob), () => backend.createImageBytes('Notes/../../res/x.png',blob), () => saveImageResource('Notes/A.md','x.gif',new Blob(['x'],{type:'image/gif'})), () => backend.createImageBytes('Notes/res/empty.png',new Blob([],{type:'image/png'}))]){
      try { await fn(); } catch(e) { names.push((e as Error).message); }
    }
    await backend.write('Blocked/res','not a folder');
    try { await saveImageResource('Blocked/A.md','x.png',blob); } catch(e) { names.push((e as Error).message); }
    return names;
  });
  expect(result).toEqual(['Invalid note path','Invalid image path','Unsupported or empty image','Image has no bytes','Image folder is a file']);
});

test('native bridge writes bounded chunks and aborts incomplete or cancelled transfers', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const {writeNativeImage, IMAGE_WRITE_CHUNK}=(window as any).__satr.load('/src/imageNativeWrite.ts');
    const input=Uint8Array.from({length:IMAGE_WRITE_CHUNK*2+123},(_,i)=>(i*31)%256), blob=new Blob([input],{type:'image/png'});
    const chunks:number[]=[]; let decoded:number[]=[]; let finished=0,aborted=0;
    const bridge={begin:async()=>({token:'t'}),append:async({data}:{data:string})=>{const raw=atob(data);chunks.push(raw.length);for(let i=0;i<raw.length;i++)decoded.push(raw.charCodeAt(i));},finish:async()=>{finished++},abort:async()=>{aborted++}};
    await writeNativeImage('Notes/res/a.png',blob,undefined,bridge);
    const same=decoded.length===input.length&&decoded.every((v,i)=>v===input[i]);
    const controller=new AbortController();let count=0;
    const cancelling={...bridge,append:async()=>{count++;controller.abort()}};let name='';
    try { await writeNativeImage('Notes/res/b.png',blob,controller.signal,cancelling); } catch(e){name=(e as Error).name}
    const failed={...bridge,append:async()=>{throw new Error('injected bridge failure')}};let failure='';
    try { await writeNativeImage('Notes/res/c.png',blob,undefined,failed); } catch(e){failure=(e as Error).message}
    return {chunks,same,finished,aborted,count,name,failure};
  });
  expect(result.chunks).toEqual([192*1024,192*1024,123]); expect(result.same).toBe(true);
  expect(result.finished).toBe(1); expect(result.aborted).toBe(2); expect(result.count).toBe(1);
  expect(result.name).toBe('AbortError'); expect(result.failure).toBe('injected bridge failure');
});

test('another open tab saving a note does not discard a newly created image from the index', async ({ page, context }) => {
  await boot(page);
  const other = await context.newPage(); await boot(other);
  await page.evaluate(async () => {
    const {backend} = (window as any).__satr.load('/src/vault.ts');
    await backend.createImageBytes('Notes/res/new.png', new Blob(['image'], {type:'image/png'}));
  });
  await other.evaluate(async () => {
    const {backend} = (window as any).__satr.load('/src/vault.ts');
    await backend.write('Notes/B.md', '# B');
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const {backend} = (window as any).__satr.load('/src/vault.ts');
    return { image: !!await backend.stat('Notes/res/new.png'), note: await backend.read('Notes/B.md') };
  });
  expect(result).toEqual({image: true, note: '# B'});
});

test('note recovery backups are create-only and cannot overwrite an existing file', async ({page})=>{
 await boot(page);
 const got=await page.evaluate(async()=>{
  const {backend}=(window as any).__satr.load('/src/vault.ts');const path='Notes/Satr recovery 00000000-0000-4000-8000-000000000001.md';
  await backend.createNoteBackup(path,'original note');let collision='',bad='';try{await backend.createNoteBackup(path,'newer')}catch(e){collision=(e as Error).name}try{await backend.createNoteBackup('Notes/A.md','bad')}catch(e){bad=(e as Error).message}
  return {collision,bad,text:await backend.read(path)};
 });expect(got).toEqual({collision:'ImageNameTakenError',bad:'Invalid recovery path',text:'original note'});
});
