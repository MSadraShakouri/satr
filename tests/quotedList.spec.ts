import { expect, test } from '@playwright/test';

// A numbered list inside a quote. Every marker is rewritten in Latin digits
// before the parser sees it — that is how `۱.` and `الف.` are numbered at all
// — and the rewrite only looked at the start of a line, where a quote has its
// `>`. So `> ۱. یک` was never rewritten and came out as a line of prose, while
// `> 1. one` was a list because the parser can read that one itself.

type Shape = { lists: number; marks: string[]; text: string; inQuote: boolean };

async function shapes(page: import('@playwright/test').Page, sources: string[]): Promise<Shape[]> {
  return page.evaluate(async (items) => {
    const { renderMarkdown } = await window.__satr.load('/src/markdown.ts');
    return items.map((source) => {
      const doc = new DOMParser().parseFromString(renderMarkdown(source), 'text/html');
      const lists = [...doc.querySelectorAll('ol')];
      const marks = lists.flatMap((list) => [...list.children]
        .filter((child) => child.tagName === 'LI')
        .map((item) => `${item.getAttribute('data-persian-number') ?? '·'}${item.getAttribute('data-persian-delimiter') ?? ''}`));
      return {
        lists: lists.length,
        marks,
        text: (doc.querySelector('blockquote') ?? doc.body).textContent!.replace(/\s+/g, ' ').trim(),
        inQuote: lists.every((list) => Boolean(list.closest('blockquote'))) && lists.length > 0,
      };
    });
  }, sources);
}

test('a quoted list is a list whatever its markers are written in', async ({ page }) => {
  await page.goto('/');
  const [persian, latin, arabic, abjad, nested, parens] = await shapes(page, [
    '> ۱. یک\n> ۲. دو\n> ۳. سه',
    '> 1. one\n> 2. two',
    '> ١. واحد\n> ٢. اثنان',
    '> الف. اول\n> ب. دوم',
    '> > ۱. یک\n> > ۲. دو',
    '> ۱) یک\n> ۲) دو',
  ]);
  expect(persian.lists, 'persian digits in a quote').toBe(1);
  expect(persian.inQuote).toBe(true);
  expect(persian.marks).toEqual(['۱.', '۲.', '۳.']);
  expect(persian.text, 'the quote marks are not part of the item').toBe('یک دو سه');
  expect(latin.lists, 'english digits still work').toBe(1);
  expect(latin.inQuote).toBe(true);
  expect(arabic.marks).toEqual(['١.', '٢.']);
  expect(abjad.marks, 'abjad letters in a quote').toEqual(['الف.', 'ب.']);
  expect(nested.lists, 'a quote inside a quote').toBe(1);
  expect(nested.marks).toEqual(['۱.', '۲.']);
  expect(parens.marks, 'the delimiter travels too').toEqual(['۱)', '۲)']);
});

test('a quoted letter reads as prose unless it reads as a list', async ({ page }) => {
  await page.goto('/');
  const [name, pair, apart] = await shapes(page, [
    '> A. Smith said it first',
    '> a. one\n> b. two',
    '> a. one\n\nmiddle\n\n> c. three',
  ]);
  expect(name.lists, 'a name in a quote is not a list').toBe(0);
  expect(name.text).toBe('A. Smith said it first');
  expect(pair.lists, 'two letters in a row are a list').toBe(1);
  expect(apart.lists, 'two letters that are not neighbours are not').toBe(0);
});

test('a quoted list and an unquoted one are not the same list', async ({ page }) => {
  await page.goto('/');
  const [mixed] = await shapes(page, ['۱. یک\n۲. دو\n\n> الف. اول\n> ب. دوم']);
  expect(mixed.lists).toBe(2);
  expect(mixed.marks).toEqual(['۱.', '۲.', 'الف.', 'ب.']);
});
