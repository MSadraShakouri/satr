import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page, seed = false) {
  await page.addInitScript((legacy) => {
    localStorage.setItem('satr:demoShown', '1');
    if (legacy) {
      localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/old.md': 1 }, folders: ['Notes'] }));
      localStorage.setItem('satr:fs:file:Notes/old.md', 'legacy text');
    }
  }, seed);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__satr));
  await expect(page.locator('.empty-state-title')).toHaveText('No file is open');
}

// Abort only a real IndexedDB transaction whose put request just succeeded.
// Success of the request is not success of the enclosing transaction.
async function abortPut(page: Page, key: string) {
  await page.evaluate((target) => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      const request = original.call(this, value, key);
      if (this.name === 'files' && key === target) {
        const tx = this.transaction;
        request.addEventListener('success', () => tx.abort(), { once: true });
      }
      return request;
    };
  }, key);
}

test('legacy migration retains its only copy when the transaction aborts after request success', async ({ page }) => {
  await boot(page, true);
  // Remove any earlier database value, leaving the legacy key as the only copy.
  await page.evaluate(async () => {
    const {dropStored} = await window.__satr.load('/src/webStore.ts');
    await dropStored('Notes/old.md');
    localStorage.setItem('satr:fs:file:Notes/old.md', 'legacy text');
  });
  await abortPut(page, 'Notes/old.md');
  const report = await page.evaluate(async () => {
    const {backend} = await window.__satr.load('/src/vault.ts');
    const first = await backend.read('Notes/old.md');
    const backup = localStorage.getItem('satr:fs:file:Notes/old.md');
    const second = await backend.read('Notes/old.md');
    return {first, backup, second};
  });
  console.log('legacy-abort', JSON.stringify(report));
  expect(report).toEqual({first: 'legacy text', backup: 'legacy text', second: 'legacy text'});
});

test('renaming a legacy file does not erase it when its migration cannot commit', async ({ page }) => {
  await boot(page, true);
  await page.evaluate(async () => {
    const {dropStored} = await window.__satr.load('/src/webStore.ts');
    await dropStored('Notes/old.md');
    localStorage.setItem('satr:fs:file:Notes/old.md', 'legacy text');
  });
  await abortPut(page, 'Notes/old.md');
  const report = await page.evaluate(async () => {
    const {backend} = await window.__satr.load('/src/vault.ts');
    let error = false;
    try { await backend.rename('Notes/old.md', 'Notes/moved.md'); } catch { error = true; }
    return {error, old: await backend.read('Notes/old.md'), moved: await backend.read('Notes/moved.md')};
  });
  // It may move directly from the legacy copy, or safely report failure.
  expect(report.error ? report.old : report.moved).toBe('legacy text');
});



test('a newer local copy survives completion of an older migration', async ({page}) => {
 await boot(page, true);
 await page.evaluate(async () => {
  const {dropStored}=window.__satr.load('/src/webStore.ts');await dropStored('Notes/old.md');
  localStorage.setItem('satr:fs:file:Notes/old.md','legacy text');
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){
   const request=put.call(this,value,key);
   if(key==='Notes/old.md') request.addEventListener('success',()=>localStorage.setItem('satr:fs:file:Notes/old.md','newer'),{once:true});
   return request;
  };
 });
 const result=await page.evaluate(async()=>{
  const {backend}=window.__satr.load('/src/vault.ts');
  const first=await backend.read('Notes/old.md');const backup=localStorage.getItem('satr:fs:file:Notes/old.md');
  return {first,backup};
 });
 expect(result).toEqual({first:'legacy text',backup:'newer'});
});

test('a folder move checks every legacy copy before moving any file', async ({page}) => {
 await boot(page);
 const result=await page.evaluate(async()=>{
  const {backend}=window.__satr.load('/src/vault.ts');
  backend.writeSync('Notes/Set/a.md','alpha');backend.writeSync('Notes/Set/b.md','bravo');
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){const request=put.call(this,value,key);if(key==='Notes/Set/b.md')request.addEventListener('success',()=>this.transaction.abort(),{once:true});return request;};
  let error=false;try{await backend.rename('Notes/Set','Notes/Moved');}catch{error=true;}
  IDBObjectStore.prototype.put=put;
  return {error,a:await backend.read('Notes/Set/a.md'),b:await backend.read('Notes/Set/b.md'),moved:await backend.stat('Notes/Moved/a.md')};
 });
 expect(result).toEqual({error:true,a:'alpha',b:'bravo',moved:null});
});

test('migration can retry after a transaction aborts', async ({page}) => {
 await boot(page,true);
 const result=await page.evaluate(async()=>{
  const {backend}=window.__satr.load('/src/vault.ts');const {dropStored}=window.__satr.load('/src/webStore.ts');
  await dropStored('Notes/old.md');localStorage.setItem('satr:fs:file:Notes/old.md','legacy text');
  const put=IDBObjectStore.prototype.put;let aborted=false;
  IDBObjectStore.prototype.put=function(value,key){const request=put.call(this,value,key);if(key==='Notes/old.md'&&!aborted){aborted=true;request.addEventListener('success',()=>this.transaction.abort(),{once:true});}return request;};
  const first=await backend.read('Notes/old.md');const backed=localStorage.getItem('satr:fs:file:Notes/old.md');
  const second=await backend.read('Notes/old.md');const remaining=localStorage.getItem('satr:fs:file:Notes/old.md');
  IDBObjectStore.prototype.put=put;return {first,backed,second,remaining};
 });
 expect(result).toEqual({first:'legacy text',backed:'legacy text',second:'legacy text',remaining:null});
});

test('a legacy file remains readable when opening IndexedDB fails', async ({page}) => {
 await page.addInitScript(()=>{
  localStorage.setItem('satr:demoShown','1');
  localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/old.md':1},folders:['Notes']}));
  localStorage.setItem('satr:fs:file:Notes/old.md','legacy text');
  const original=indexedDB.open.bind(indexedDB);
  indexedDB.open=function(name,version){if(name==='satr')throw new Error('injected unavailable database');return original(name,version);};
 });
 await page.goto('/');await page.waitForFunction(()=>Boolean(window.__satr));
 const result=await page.evaluate(async()=>{
  const {backend}=window.__satr.load('/src/vault.ts');
  const value=await backend.read('Notes/old.md');let error=false;
  try{await backend.rename('Notes/old.md','Notes/new.md');}catch{error=true;}
  return {value,error,backup:localStorage.getItem('satr:fs:file:Notes/old.md')};
 });
 expect(result).toEqual({value:'legacy text',error:true,backup:'legacy text'});
});

test('a migration whose put throws keeps its local copy', async ({page}) => {
 await boot(page,true);
 const result=await page.evaluate(async()=>{
  const {backend}=window.__satr.load('/src/vault.ts');const {dropStored}=window.__satr.load('/src/webStore.ts');
  await dropStored('Notes/old.md');localStorage.setItem('satr:fs:file:Notes/old.md','legacy text');
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){if(key==='Notes/old.md')throw new Error('injected put failure');return put.call(this,value,key);};
  try {const value=await backend.read('Notes/old.md');return {value,backup:localStorage.getItem('satr:fs:file:Notes/old.md')};}
  finally {IDBObjectStore.prototype.put=put;}
 });
 expect(result).toEqual({value:'legacy text',backup:'legacy text'});
});
