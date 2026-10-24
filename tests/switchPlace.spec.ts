import { expect, test, type Page } from '@playwright/test';
import type { EditorView } from '@codemirror/view';

declare global { interface Window { appView: EditorView } }

// Switching to the reading view and back must come home to the line it left.
// A reading view can be far shorter than the source behind it — a table is
// many wrapped lines to write and one compact block to read — so several
// source lines share one place in the page, and asking the page where the
// reader was answers with the first of them. The source place is kept across
// the switch instead, and given up the moment the reader moves the page.

// Eighteen lines whose reading view is one screen tall while the source is
// three — the shape that cannot give a place back, because every line past
// the first screenful of source maps into a page that has already ended.
const note = ['# حسابداری', '', '۱۴۰۵/۰۸/۰۲', '', '## فصل چهارم: دفتر روزنامه', '', 'نگهداری تعدادی حساب T کار دشواری است', '',
  'دفتری است که حساب‌های روزانه را داخل آن می‌نویسیم', '', '| دفتر روزنامه عمومی | | | | | صفحه ... |', '| :---: | :---: | :--- | :---: | :---: | :---: |',
  '| تاریخ | شرح | عطف | بدهکار | بستانکار | |', ...Array.from({ length: 5 }, () => '| | | | | | |')].join('\n');

async function boot(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ text }) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', text);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:view:Notes/A.md', JSON.stringify({ mode: 'edit', line: 0 }));
  }, { text: note });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText(/.+/);
  await page.evaluate(async () => {
    const { EditorView } = await window.__satr.load('/node_modules/@codemirror/view/dist/index.js');
    window.appView = EditorView.findFromDOM(document.querySelector('#app .cm-editor'))!;
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  await page.waitForTimeout(1300); // the app holds the opening place for a moment
}

const toggle = async (page: Page) => {
  await page.locator('#preview-toggle').evaluate((el: HTMLButtonElement) => el.click());
  await page.waitForTimeout(800);
};

/** Scroll the source the way a reader does, and report the line they are on. */
async function readDown(page: Page, where: number) {
  return page.evaluate(async (where) => {
    const { typingTop, editorScroll } = await window.__satr.load('/src/scrollSync.ts');
    const view = window.appView;
    view.scrollDOM.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); // the reader's own intent
    view.scrollDOM.scrollTop = Math.round((view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight) * where);
    await new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), 350));
    return Math.round(editorScroll(view, typingTop(view)) * 100) / 100;
  }, where);
}

const sourceLine = (page: Page) => page.evaluate(async () => {
  const { typingTop, editorScroll } = await window.__satr.load('/src/scrollSync.ts');
  return Math.round(editorScroll(window.appView, typingTop(window.appView)) * 100) / 100;
});

test('the source comes back to the line it was left on', async ({ page }) => {
  await boot(page);
  const left = await readDown(page, 1); // reading the last rows of the table
  expect(left, 'the reader is well down the source').toBeGreaterThan(5);
  await toggle(page); // into the reading view
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');
  await toggle(page); // and home again
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'edit');
  expect(await sourceLine(page), 'the same line, not the top of the note').toBeCloseTo(left, 1);
});

test('scrolling the reading view hands the place over to it', async ({ page }) => {
  await boot(page);
  const left = await readDown(page, 1);
  await toggle(page);
  // The reader moves the page themselves: from here the page is where they are.
  await page.evaluate(async () => {
    const pane = document.querySelector<HTMLElement>('#preview-pane')!;
    pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    pane.scrollTop = 0;
    await new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), 300));
  });
  await toggle(page);
  const back = await sourceLine(page);
  expect(back, 'the top of the page is the top of the note').toBeLessThan(left);
});
