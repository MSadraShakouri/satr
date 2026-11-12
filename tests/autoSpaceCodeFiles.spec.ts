import {expect,test} from '@playwright/test';
for(const file of ['sample.js','sample.json','sample.py','sample.csv','sample.tsv','sample.tab','sample.psv']){
 test(`typing in ${file} leaves punctuation and data unchanged`,async({page})=>{
  await page.goto('/');
  await page.evaluate(async(file)=>{
   const {SatrEditor}=window.__satr.load('/src/editor.ts');const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;background:white;z-index:1000';document.body.append(host);
   const ed=new SatrEditor(host,()=>{}, {autoSpace:true});(window as any).__spaceCode=ed;
   await ed.setFileLanguage(file);ed.setValue('"hello,"');ed.setSelection(7);ed.focus();
  },file);
  await page.keyboard.type('world');
  expect(await page.evaluate(()=>(window as any).__spaceCode.getValue())).toBe('"hello,world"');
 });
}
test('auto-spacing resumes when the editor returns from code to a note',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{const {SatrEditor}=window.__satr.load('/src/editor.ts');const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:1000';document.body.append(host);const ed=new SatrEditor(host,()=>{}, {autoSpace:true});(window as any).__spaceCode=ed;await ed.setFileLanguage('sample.js');await ed.setFileLanguage('note.md');ed.setValue('hello,');ed.setSelection(6);ed.focus();});
 await page.keyboard.type('world');expect(await page.evaluate(()=>(window as any).__spaceCode.getValue())).toBe('hello, world');
});

test('a CSV cell edited through the app keeps the value that was typed',async({page})=>{
 await page.addInitScript(()=>{if(localStorage.getItem('seeded'))return;localStorage.setItem('seeded','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'data.csv':1},folders:[]}));localStorage.setItem('satr:fs:file:data.csv','"hello,"');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'data.csv'}],active:0}));localStorage.setItem('satr:demoShown','1');});
 await page.goto('/');await expect(page.locator('#app .cm-file-name')).toHaveText('data.csv');
 await page.evaluate(()=>{const {EditorView}=window.__satr.load('/node_modules/@codemirror/view/');const view=EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;view.dispatch({selection:{anchor:7}});view.focus();});
 await page.keyboard.type('world');
 const text=await page.evaluate(()=>window.__satr.load('/node_modules/@codemirror/view/').EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!.state.doc.toString());
 expect(text).toBe('"hello,world"');
 await expect.poll(()=>page.evaluate(()=>window.__satr.load('/src/vault.ts').backend.read('data.csv'))).toBe('"hello,world"');
 await page.reload();await expect(page.locator('#app .cm-file-name')).toHaveText('data.csv');
 await expect.poll(()=>page.evaluate(()=>window.__satr.load('/node_modules/@codemirror/view/').EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!.state.doc.toString())).toBe('"hello,world"');
});

test('switching the setting off and on does not turn prose spacing back on in code',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{const {SatrEditor}=window.__satr.load('/src/editor.ts');const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:1000';document.body.append(host);const ed=new SatrEditor(host,()=>{}, {autoSpace:true});(window as any).__spaceCode=ed;await ed.setFileLanguage('sample.js');ed.setAutoSpace(false);ed.setAutoSpace(true);ed.setValue('"hello,"');ed.setSelection(7);ed.focus();});
 await page.keyboard.type('world');expect(await page.evaluate(()=>(window as any).__spaceCode.getValue())).toBe('"hello,world"');
});
