import {expect,test} from '@playwright/test';
for(const [file,initial,typed,expected] of [
 ['sample.js','if (x ','==y','if (x ==y'],
 ['sample.py','if x ','==y','if x ==y'],
 ['sample.csv','',' $x',' $x'],
 ['sample.js','const x = ','$foo','const x = $foo'],
] as const){
 test(`${file}: typing ${typed} does not insert Markdown delimiters`,async({page})=>{
  await page.goto('/');await page.evaluate(async({file,initial})=>{const {SatrEditor}=window.__satr.load('/src/editor.ts');const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:1000';document.body.append(host);const ed=new SatrEditor(host,()=>{}, {autoSpace:false});(window as any).__ed=ed;await ed.setFileLanguage(file);ed.setValue(initial);ed.setSelection(initial.length);ed.focus();},{file,initial});
  await page.keyboard.type(typed);expect(await page.evaluate(()=>(window as any).__ed.getValue())).toBe(expected);
 });
}

test('an equality typed in a JavaScript file is saved without Markdown highlight closers',async({page})=>{
 await page.addInitScript(()=>{if(localStorage.getItem('seeded'))return;localStorage.setItem('seeded','1');localStorage.setItem('satr:fs:index',JSON.stringify({files:{'test.js':1},folders:[]}));localStorage.setItem('satr:fs:file:test.js','if (x ) {}');localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'test.js'}],active:0}));localStorage.setItem('satr:demoShown','1');});
 await page.goto('/');await expect(page.locator('#app .cm-file-name')).toHaveText('test.js');
 await expect(page.locator('#app .cm-content')).toHaveClass(/is-code-file/);
 await page.evaluate(()=>{const {EditorView}=window.__satr.load('/node_modules/@codemirror/view/');const view=EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;view.dispatch({selection:{anchor:6}});view.focus();});
 await page.keyboard.type('==y');
 const get=()=>page.evaluate(()=>window.__satr.load('/node_modules/@codemirror/view/').EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!.state.doc.toString());
 expect(await get()).toBe('if (x ==y) {}');
 await expect.poll(()=>page.evaluate(()=>window.__satr.load('/src/vault.ts').backend.read('test.js'))).toBe('if (x ==y) {}');
 await page.reload();await expect(page.locator('#app .cm-file-name')).toHaveText('test.js');await expect.poll(get).toBe('if (x ==y) {}');
});

test('ordinary bracket pairing remains available in code',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{const {SatrEditor}=window.__satr.load('/src/editor.ts');const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:1000';document.body.append(host);const ed=new SatrEditor(host,()=>{});(window as any).__ed=ed;await ed.setFileLanguage('test.js');ed.setValue('');ed.focus();});
 await page.keyboard.type('(');expect(await page.evaluate(()=>(window as any).__ed.getValue())).toBe('()');
});

test('Markdown dollar pairing returns when switching from code to a note',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{const {SatrEditor}=window.__satr.load('/src/editor.ts');const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:1000';document.body.append(host);const ed=new SatrEditor(host,()=>{});(window as any).__ed=ed;await ed.setFileLanguage('test.js');await ed.setFileLanguage('note.md');ed.setValue('');ed.focus();});
 await page.keyboard.type('$x');expect(await page.evaluate(()=>(window as any).__ed.getValue())).toBe('$x$');
});

test('Enter after two literal dollars in delimited data does not create a math block',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{const {SatrEditor}=window.__satr.load('/src/editor.ts');const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:1000';document.body.append(host);const ed=new SatrEditor(host,()=>{});(window as any).__ed=ed;await ed.setFileLanguage('test.csv');ed.setValue('$$');ed.setSelection(2);ed.focus();});
 await page.keyboard.press('Enter');expect(await page.evaluate(()=>(window as any).__ed.getValue())).toBe('$$\n');
});

test('restored editor sessions keep their own file-mode delimiter policy',async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{const {SatrEditor}=window.__satr.load('/src/editor.ts');const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:1000';document.body.append(host);const ed=new SatrEditor(host,()=>{});(window as any).__ed=ed;await ed.setFileLanguage('note.md');ed.setValue('');(window as any).__noteState=ed.view.state;await ed.setFileLanguage('test.js');ed.setValue('if x ');(window as any).__codeState=ed.view.state;ed.restoreSession((window as any).__noteState);await ed.setFileLanguage('note.md');ed.setSelection(0);ed.focus();});
 await page.keyboard.type('$x');expect(await page.evaluate(()=>(window as any).__ed.getValue())).toBe('$x$');
 await page.evaluate(async()=>{const ed=(window as any).__ed;ed.restoreSession((window as any).__codeState);await ed.setFileLanguage('test.js');ed.setSelection(5);ed.focus();});
 await page.keyboard.type('==y');expect(await page.evaluate(()=>(window as any).__ed.getValue())).toBe('if x ==y');
});
