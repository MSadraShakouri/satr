import { expect, test } from '@playwright/test';
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('satr:demoShown','1');
    localStorage.setItem('satr:fs:index',JSON.stringify({files:{'Notes/A.md':1},folders:['Notes']}));
    localStorage.setItem('satr:fs:file:Notes/A.md','# A');
    localStorage.setItem('satr:tabs',JSON.stringify({tabs:[{path:'Notes/A.md'}],active:0}));
  });
  await page.goto('/'); await page.waitForSelector('#boot-snapshot',{state:'detached'});
});

test('crop targeting prioritizes left and right outside the box, but a close corner wins', async ({page}) => {
  const targets=await page.evaluate(() => {
    const {selectionTarget}=(window as any).__satr.load('/src/imageSelection.ts');
    const rect=[.2,.2,.8,.8], box={left:0,top:0,width:300,height:300};
    return [[20,20],[280,20],[59,59],[150,30],[150,150]].map(([x,y])=>selectionTarget('crop',rect,box,x,y));
  });
  expect(targets[0]).toMatchObject({kind:'edge',index:3});
  expect(targets[1]).toMatchObject({kind:'edge',index:1});
  expect(targets[2]).toEqual({kind:'corner',index:0});
  expect(targets[3]).toMatchObject({kind:'edge',index:0});
  expect(['edge','corner']).toContain(targets[4].kind);
});

test('rotation preserves crop, page and detected corner positions through four turns', async ({page}) => {
  const got=await page.evaluate(() => {
    const {rotateCrop,rotateQuad}=(window as any).__satr.load('/src/imageSelection.ts');
    let crop=[.1,.2,.7,.9], quad=[[.13,.11],[.88,.16],[.91,.86],[.08,.79]];
    const onceCrop=rotateCrop(crop),onceQuad=rotateQuad(quad);
    for(let i=0;i<4;i++){crop=rotateCrop(crop);quad=rotateQuad(quad);}
    return {onceCrop,onceQuad,crop,quad};
  });
  expect(got.onceCrop).toEqual([expect.closeTo(.1),.1,.8,.7]);
  expect(got.onceQuad).toEqual([[expect.closeTo(.21),.08],[expect.closeTo(.89),.13],[.84,.88],[expect.closeTo(.14),.91]]);
  for(let i=0;i<4;i++) expect(got.crop[i]).toBeCloseTo([.1,.2,.7,.9][i]);
  for(let i=0;i<4;i++) for(let j=0;j<2;j++) expect(got.quad[i][j]).toBeCloseTo([[.13,.11],[.88,.16],[.91,.86],[.08,.79]][i][j]);
});

test('dragging clamps crop and rejects crossing page corners', async ({page}) => {
  const got=await page.evaluate(() => {
    const {moveCrop,movePageCorner}=(window as any).__satr.load('/src/imageSelection.ts');
    const rect=[.2,.2,.8,.8],page=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]];
    return {edge:moveCrop(rect,{kind:'edge',index:3,along:.5},5,5),corner:moveCrop(rect,{kind:'corner',index:0},-1,-1),invalid:movePageCorner(page,0,.99,.99),valid:movePageCorner(page,0,.2,.2)};
  });
  expect(got.edge).toEqual([expect.closeTo(.75),.2,.8,.8]);
  expect(got.corner).toEqual([0,0,.8,.8]);
  expect(got.invalid).toEqual([[.1,.1],[.9,.1],[.9,.9],[.1,.9]]);
  expect(got.valid[0]).toEqual([.2,.2]);
});
