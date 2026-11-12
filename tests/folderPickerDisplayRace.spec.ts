import { expect, test } from '@playwright/test';
test('the folder shown cannot be confirmed while navigation is still loading', async ({page}) => {
  await page.goto('/'); await expect(page.locator('#app')).toBeVisible();
  await page.evaluate(() => {
    const {backend}=window.__satr.load('/src/vault.ts');
    const {walkToFolder}=window.__satr.load('/src/dirPicker.ts');
    const state={waiting:false,release:()=>{},result:null as string|null};
    (window as any).__walkDisplay=state;
    backend.list=async (dir:string)=>{
      if(dir==='B'){state.waiting=true;await new Promise<void>(r=>{state.release=r;});return [];}
      return [{kind:'folder',name:'B',path:'B',mtime:1}];
    };
    void walkToFolder({start:'',ceiling:'',title:'Destination',confirm:'Choose',label:(d:string)=>d||'Root'}).then((v:string|null)=>{state.result=v;});
  });
  await expect(page.locator('.dir-walk-here')).toHaveText('Root');
  await page.locator('.dir-walk [data-into="B"]').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__walkDisplay.waiting)).toBe(true);
  await expect(page.locator('.dir-walk-here')).toHaveText('Root');
  await expect(page.locator('.dir-walk [data-confirm]')).toBeDisabled();
  await page.evaluate(()=>(window as any).__walkDisplay.release());
  await expect(page.locator('.dir-walk-here')).toHaveText('B');
  await expect(page.locator('.dir-walk [data-confirm]')).toBeEnabled();
  await page.locator('.dir-walk [data-confirm]').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__walkDisplay.result)).toBe('B');
});
