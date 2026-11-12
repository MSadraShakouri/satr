import {test,expect} from '@playwright/test';
test('selecting through a line break never highlights unselected mixed-direction text',async({page})=>{
 await page.goto('/');
 const failures=await page.evaluate(async()=>{
  const {SatrEditor}=window.__satr.load('/src/editor.ts');const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;background:white;z-index:1000';document.body.append(host);const ed=new SatrEditor(host,()=>{});await document.fonts.ready;
  const bad:any[]=[];
  for(const line of ['abc אבג def','אבג abc דהו','abc אבג','אבג abc','abc אבג xyz דהו', 'אבג ABC דהו XYZ']) {
   ed.setValue(line+'\nnext');ed.focus();
   for(let start=1;start<line.length;start++){
    ed.setSelection(start,line.length+1);await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));
    const node=ed.view.contentDOM.querySelector('.cm-line')!.firstChild!;if(node.nodeType!==Node.TEXT_NODE)throw Error('expected plain text');
    const boxes=[...ed.view.dom.querySelectorAll('.cm-satr-selection')].map(e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom};});
    for(let i=0;i<line.length;i++) {if(line[i]===' ')continue;const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+1);const rect=r.getBoundingClientRect(),x=(rect.left+rect.right)/2,y=(rect.top+rect.bottom)/2;const painted=boxes.some(b=>x>b.l&&x<b.r&&y>b.t&&y<b.b);if(painted !== (i >= start))bad.push({line,start,i,char:line[i],painted,boxes,x,y});}
   }
  }
  return bad;
 });
 expect(failures).toEqual([]);
});
