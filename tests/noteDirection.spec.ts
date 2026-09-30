import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the note majority decides, math and code do not vote', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { majorityDirection } = await import('/src/direction.ts');
    return {
      persian: majorityDirection('این یک متن فارسی است\n\nو سطری دیگر'),
      english: majorityDirection('This note is English\n\nWith another line'),
      mixed: majorityDirection('This is a longer English paragraph\n\nو یک سطر'),
      math: majorityDirection('سلام\n\n$$x^2 + y^2 = z^2$$\n\nمتن بیشتر'),
      code: majorityDirection('متن\n\n```\nconst lots of latin code in here\n```\n\nکمی'),
    };
  });
  expect(out.persian).toBe('rtl');
  expect(out.english).toBe('ltr');
  expect(out.mixed).toBe('ltr');
  expect(out.math).toBe('rtl');
  expect(out.code).toBe('rtl');
});

test('the line-number gutter sits on the note majority side', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    const editor = new SatrEditor(host, () => {});
    await document.fonts.ready;
    const read = () => {
      const dom = host.querySelector<HTMLElement>('.cm-editor')!;
      const gutters = dom.querySelector<HTMLElement>('.cm-gutters')!;
      return {
        rtlClass: dom.classList.contains('cm-satr-gutter-rtl'),
        left: getComputedStyle(gutters).left,
        right: getComputedStyle(gutters).right,
      };
    };
    editor.setValue('این یک متن فارسی است');
    const persian = read();
    editor.setValue('This note is English');
    const english = read();
    return { persian, english };
  });
  // Persian note: the gutter flips to the right.
  expect(report.persian.rtlClass).toBe(true);
  expect(report.persian.right).toBe('0px');
  expect(report.persian.left).toBe('auto');
  // English note: back to the left.
  expect(report.english.rtlClass).toBe(false);
  expect(report.english.right).toBe('auto');
});

test('the outline tree flips with the note while rows keep their own direction', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { createRightSidebar } = await import('/src/rightSidebar.ts');
    const host = document.createElement('div');
    document.body.appendChild(host);
    let dir: 'ltr' | 'rtl' = 'rtl';
    const sidebar = createRightSidebar(host, {
      headings: () => [
        { level: 1, text: 'عنوان فارسی', line: 1, from: 0 },
        { level: 2, text: 'An English heading', line: 3, from: 20 },
      ],
      currentLine: () => 0,
      onHeading: () => {},
      notes: async () => [],
      currentPath: () => '/note.md',
      currentText: () => '# عنوان\n\n# An English heading',
      scopeName: () => 'notes',
      onResult: () => {},
      noteDir: () => dir,
    });
    const tree = host.querySelector<HTMLElement>('.outline-tree')!;
    const rtlTree = tree.dir;
    const rows = [...tree.querySelectorAll<HTMLElement>('.tree-item-self')].map((r) => r.dir);
    dir = 'ltr';
    sidebar.refresh();
    return { rtlTree, rows, ltrTree: tree.dir };
  });
  expect(out.rtlTree).toBe('rtl');
  expect(out.ltrTree).toBe('ltr');
  // Each heading row still runs in its own direction.
  expect(out.rows).toEqual(['auto', 'auto']);
});

// Items 5 and 6: the side must follow the note itself — on load and on every
// file switch, with no typing involved — and the file name goes with it. A
// phone's WebView can also restore the page without a transaction, so the
// side is re-checked when the page regains focus or visibility.
test('the file name follows the gutter side, without any typing', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    const editor = new SatrEditor(host, () => {});
    await document.fonts.ready;
    const read = () => {
      const dom = host.querySelector<HTMLElement>('.cm-editor')!;
      const name = host.querySelector<HTMLElement>('.cm-file-name');
      return { rtl: dom.classList.contains('cm-satr-gutter-rtl'), align: name ? getComputedStyle(name).textAlign : null };
    };
    editor.setValue('این یک متن فارسی است');
    const persian = read();
    // A file switch is setTitle + setValue, with no keystroke in between.
    editor.setTitle('English note');
    editor.setValue('This note is English');
    const english = read();
    editor.setTitle('یادداشت فارسی');
    editor.setValue('و یک سطر دیگر فارسی');
    const back = read();
    return { persian, english, back };
  });
  expect(report.persian).toEqual({ rtl: true, align: 'right' });
  expect(report.english).toEqual({ rtl: false, align: 'start' });
  expect(report.back).toEqual({ rtl: true, align: 'right' });
});

test('a gutter side lost while the page was away comes back on focus', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { SatrEditor } = await import('/src/editor.ts');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
    document.body.appendChild(host);
    const editor = new SatrEditor(host, () => {});
    await document.fonts.ready;
    editor.setValue('این یک متن فارسی است\n\nو سطر دوم');
    const dom = host.querySelector<HTMLElement>('.cm-editor')!;
    // The platform drops the class (page restored in the background).
    dom.classList.remove('cm-satr-gutter-rtl');
    const lost = dom.classList.contains('cm-satr-gutter-rtl');
    window.dispatchEvent(new Event('focus'));
    const afterFocus = dom.classList.contains('cm-satr-gutter-rtl');
    dom.classList.remove('cm-satr-gutter-rtl');
    document.dispatchEvent(new Event('visibilitychange'));
    const afterVisible = dom.classList.contains('cm-satr-gutter-rtl');
    editor.setValue('Now an English note');
    const english = dom.classList.contains('cm-satr-gutter-rtl');
    return { lost, afterFocus, afterVisible, english };
  });
  expect(report.lost).toBe(false);
  expect(report.afterFocus).toBe(true);
  expect(report.afterVisible).toBe(true);
  expect(report.english).toBe(false);
});
