import { expect, test } from '@playwright/test';

// The keyboard's cover of the layout viewport (src/keyboard.ts): the one
// number a bottom sheet's lift and the caret's bottom scroll margin are
// built from. In the app the WebView is resized for the keyboard, so the
// measured keyboard height is NOT a cover — counting it there lifted the
// date sheet a whole keyboard above the keys and collapsed the caret's
// visible band until writing scrolled to the top of the page. In a browser
// nothing resizes the layout viewport, so the measured height is a real
// cover and must be lifted/scrolled by. The module is pure, so it is
// tested on its own here; the surfaces are pinned in datePicker.spec.ts
// (a browser, where the lift must stay) and on the device (the app).
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a resized viewport has no keyboard cover, however tall the keyboard measures', async ({ page }) => {
  const cover = await page.evaluate(async () => {
    const m = await window.__satr.load('/src/keyboard.ts');
    return [m.keyboardCoverPx(true, 360), m.keyboardCoverPx(true, 0)];
  });
  expect(cover).toEqual([0, 0]);
});

test('an unresized viewport is covered by exactly the measured keyboard', async ({ page }) => {
  const cover = await page.evaluate(async () => {
    const m = await window.__satr.load('/src/keyboard.ts');
    return [m.keyboardCoverPx(false, 360), m.keyboardCoverPx(false, 0), m.keyboardCoverPx(false, -40)];
  });
  expect(cover).toEqual([360, 0, 0]);
});

test('the room above a lift is what the lift leaves, and never less than nothing', async ({ page }) => {
  const room = await page.evaluate(async () => {
    const m = await window.__satr.load('/src/keyboard.ts');
    return [m.sheetRoomPx(844, 360), m.sheetRoomPx(844, 0), m.sheetRoomPx(300, 360)];
  });
  expect(room).toEqual([484, 844, 0]);
});
