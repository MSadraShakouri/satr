import {test,expect} from '@playwright/test';

test('forgiving markers respect even and odd escape runs',async({page})=>{
  await page.goto('/');
  const info=await page.evaluate(async()=>{
    const {SatrEditor}=window.__satr.load('/src/editor.ts');
    const {forgivingMarks}=window.__satr.load('/src/forgivingMarks.ts');
    const host=document.createElement('div');document.body.append(host);const ed=new SatrEditor(host,()=>{});
    const results: {mark:string;n:number;count:number}[]=[];
    for(const mark of ['==','**','__','~~','*','_']) for(const n of [0,1,2,3,4]){
      const text='\\'.repeat(n)+mark+'word '+mark;ed.setValue(text);
      const marks=forgivingMarks(ed.view.state,0,text.length);
      results.push({mark,n,count:marks.length});
    }
    return results;
  });
  for(const item of info) expect(item.count,`${item.mark}, ${item.n} slashes`).toBe(item.n % 2 === 0 ? 1 : 0);
});

test('a highlight after a literal backslash retains its appearance in the editor', async ({page})=>{
  await page.goto('/');
  const look=await page.evaluate(async()=>{
    const {SatrEditor}=window.__satr.load('/src/editor.ts');
    const host=document.createElement('div');document.body.append(host);const ed=new SatrEditor(host,()=>{});
    ed.setValue('\\\\==word ==');ed.view.contentDOM.blur();
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const word=ed.view.contentDOM.querySelector('.cm-lp-forgiving-highlight');
    return {text:ed.view.contentDOM.textContent, highlighted:!!word && (word.textContent ?? '').includes('word')};
  });
  expect(look.highlighted).toBe(true);
  expect(look.text).toContain('word');
  expect(look.text).not.toContain('==');
});
