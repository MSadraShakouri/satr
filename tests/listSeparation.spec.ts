import { expect, test } from '@playwright/test';

// Two ordered lists that follow one another are two lists, not one. Every
// marker is rewritten in Latin digits before the parser sees it — that is how
// `۱.` and `الف.` and `a.` are numbered at all — so a Persian list written
// under an English one read to the parser as more of the same list: the
// markers came back right and the halves ran together, with no gap, one
// direction over both and one marker strip sized for the widest marker in
// either. The alphabet is known after parsing, so a list is cut wherever it
// changes, the way a list is already cut where `1.` turns into `1)`.

const CASES: Array<[string, string]> = [
  ['latin digits then persian digits', '1. one\n2. two\n۱. یک\n۲. دو'],
  ['persian digits then abjad letters', '۱. یک\n۲. دو\nالف. اول\nب. دوم'],
  ['english letters then latin digits', 'a. one\nb. two\n1. three\n2. four'],
  ['arabic digits then persian digits', '١. واحد\n٢. اثنان\n۱. یک\n۲. دو'],
  ['lower case then upper case', 'a. one\nb. two\nA. three\nB. four'],
  ['a dot then a parenthesis', '1. one\n2. two\n1) three\n2) four'],
  ['persian parenthesis then persian dot', '۱) یک\n۲) دو\n۱. سه\n۲. چهار'],
  ['three alphabets in a row', '1. one\nالف. اول\nب. دوم\n۱. یک'],
  ['a blank line between the two', '1. one\n2. two\n\n۱. یک\n۲. دو'],
  ['the second list keeps its own first number', '۱. یک\n۲. دو\n5. five\n6. six'],
  ['an item with no marker stays with the run above', '1. one\n   carries on\n۱. یک'],
  ['one alphabet is one list', '1. one\n2. two\n3. three'],
  ['prose between them', '1. one\n2. two\n\nmiddle\n\n۱. یک\n۲. دو'],
  ['a list of one item', '1. only'],
  ['a nested list in another alphabet', '1. one\n2. two\n   ۱. یک\n   ۲. دو\n3. three'],
];

/** Every ordered list in the note: its direction, where it counts from, and
 *  the marker drawn against each item (· for one the browser numbers). */
async function shapes(page: import('@playwright/test').Page, cases: Array<[string, string]>): Promise<string[]> {
  return page.evaluate(async (items) => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    return items.map((text) => {
      const doc = new DOMParser().parseFromString(renderMarkdown(text), 'text/html');
      return [...doc.querySelectorAll('ol')].map((list) => {
        const marks = [...list.children]
          .filter((child) => child.tagName === 'LI')
          .map((item) => `${item.getAttribute('data-persian-number') ?? '·'}${item.getAttribute('data-persian-delimiter') ?? ''}`);
        return `[${list.getAttribute('dir')} from ${list.getAttribute('start') ?? '1'}: ${marks.join(' ')}]`;
      }).join(' ');
    });
  }, cases.map(([, text]) => text));
}

const WANT = [
  'latin digits then persian digits: [ltr from 1: · ·] [rtl from 1: ۱. ۲.]',
  'persian digits then abjad letters: [rtl from 1: ۱. ۲.] [rtl from 1: الف. ب.]',
  'english letters then latin digits: [ltr from 1: a. b.] [ltr from 1: · ·]',
  'arabic digits then persian digits: [rtl from 1: ١. ٢.] [rtl from 1: ۱. ۲.]',
  'lower case then upper case: [ltr from 1: a. b.] [ltr from 1: A. B.]',
  'a dot then a parenthesis: [ltr from 1: · ·] [ltr from 1: · ·]',
  'persian parenthesis then persian dot: [rtl from 1: ۱) ۲)] [rtl from 1: ۱. ۲.]',
  'three alphabets in a row: [ltr from 1: ·] [rtl from 1: الف. ب.] [rtl from 1: ۱.]',
  'a blank line between the two: [ltr from 1: · ·] [rtl from 1: ۱. ۲.]',
  'the second list keeps its own first number: [rtl from 1: ۱. ۲.] [ltr from 5: · ·]',
  'an item with no marker stays with the run above: [ltr from 1: ·] [rtl from 1: ۱.]',
  'one alphabet is one list: [ltr from 1: · · ·]',
  'prose between them: [ltr from 1: · ·] [rtl from 1: ۱. ۲.]',
  'a list of one item: [ltr from 1: ·]',
  'a nested list in another alphabet: [ltr from 1: · · ·] [rtl from 1: ۱. ۲.]',
];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a list is cut where its alphabet changes, and nowhere else', async ({ page }) => {
  const got = await shapes(page, CASES);
  expect(got.map((shape, index) => `${CASES[index][0]}: ${shape}`)).toEqual(WANT);
});

test('each half keeps the spacing it was written with', async ({ page }) => {
  const loose = (text: string) => page.evaluate(async (source) => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const doc = new DOMParser().parseFromString(renderMarkdown(source), 'text/html');
    return [...doc.querySelectorAll('ol')].map((list) => list.querySelectorAll(':scope > li > p').length);
  }, text);
  // the blank line sat between the two lists, not inside either of them
  expect(await loose('1. one\n2. two\n\n۱. یک\n۲. دو')).toEqual([0, 0]);
  // written with a blank line between every item: both halves stay as written
  expect(await loose('1. one\n\n2. two\n\n۱. یک\n\n۲. دو')).toEqual([2, 2]);
});

test('the two lists are drawn with a gap between them', async ({ page }) => {
  const gap = await page.evaluate(async () => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    const pane = document.createElement('div');
    pane.className = 'preview-pane';
    pane.style.cssText = 'position:fixed;inset:0;background:white;z-index:99;overflow:auto';
    pane.innerHTML = renderMarkdown('1. one\n2. two\n۱. یک\n۲. دو');
    document.body.appendChild(pane);
    await document.fonts.ready;
    const [first, second] = [...pane.querySelectorAll('ol')];
    const between = second.getBoundingClientRect().top - first.getBoundingClientRect().bottom;
    const inside = first.children[1].getBoundingClientRect().top - first.children[0].getBoundingClientRect().bottom;
    pane.remove();
    return { between: Math.round(between), inside: Math.round(inside) };
  });
  // a real gap, and a wider one than the hair between two items of one list
  expect(gap.between).toBeGreaterThan(8);
  expect(gap.between).toBeGreaterThan(gap.inside + 4);
});
