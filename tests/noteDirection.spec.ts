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
