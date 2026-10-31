import { expect, test } from '@playwright/test';
import { asFileWroteIt, hasLamAlef, inReadingOrder, joinersIn, withJoiners, type GlyphBox } from '../src/pdfText';

// A Persian page laid out visually — Word, and most things that typeset
// Arabic script — writes the lam-alef pair in the order the two letters are
// *drawn*, so the text read back out of the file has them the wrong way
// round: the page says «انقلاب» and the file says «انقالب». Searching his
// 52-page handout for «انقلاب» found nothing; the file's own spelling found
// 141.

const ALEF = '\u0627';
const LAM = '\u0644';

/** Boxes down a right-to-left line: x falls as the reading goes on. */
const painted = (xs: number[], y = 100): GlyphBox[] => xs.map((x) => ({ origin: { x, y } }));

test('a query is also asked the way the file writes it', () => {
  expect(asFileWroteIt('انقلاب')).toBe('انقالب');
  expect(asFileWroteIt('اسلامی')).toBe('اسالمی');
  expect(asFileWroteIt('لازم')).toBe('الزم');
  // every one of them, not just the first: the file is consistent
  expect(asFileWroteIt('لالا')).toBe('الال');
  // the other alefs a lam can be tied to
  expect(asFileWroteIt('تلآلؤ')).toBe('تآللؤ');
  // and a word with none of them is asked once
  expect(asFileWroteIt('جلسه')).toBe('جلسه');
  expect(asFileWroteIt('the quick brown fox')).toBe('the quick brown fox');
  expect(hasLamAlef('انقلاب')).toBe(true);
  expect(hasLamAlef('جلسه')).toBe(false);
});

test('the boxes say which pair came back to front', () => {
  // «انقالب» as the file has it: ا ن ق ا ل ب, with the alef of the ligature
  // painted to the LEFT of its lam — x grows where the reading should fall.
  const file = `${ALEF}نق${ALEF}${LAM}ب`;
  const boxes = painted([200, 190, 180, 165, 170, 150]);
  expect(inReadingOrder(file, boxes)).toBe('انقلاب');
});

test('a real alef-lam is left exactly as it is', () => {
  // «بین‌الملل» has an alef then a lam in that order on the page: x falls
  // through the pair, so nothing is swapped.
  const text = `بین\u200c${ALEF}${LAM}ملل`;
  const boxes = painted([300, 290, 280, 275, 265, 255, 245, 235, 225]);
  expect(inReadingOrder(text, boxes)).toBe(text);
});

test('two lines are not one', () => {
  // The same pair, but the lam is on the line below: not a ligature.
  const text = `${ALEF}${LAM}`;
  const boxes: GlyphBox[] = [{ origin: { x: 100, y: 100 } }, { origin: { x: 160, y: 140 } }];
  expect(inReadingOrder(text, boxes)).toBe(text);
});

test('a missing box, a space, or an empty page changes nothing', () => {
  expect(inReadingOrder(`${ALEF}${LAM}`, [null, { origin: { x: 160, y: 100 } }])).toBe(`${ALEF}${LAM}`);
  expect(inReadingOrder(`${ALEF}${LAM}`, [{ origin: { x: 100, y: 100 }, isSpace: true }, { origin: { x: 160, y: 100 } }]))
    .toBe(`${ALEF}${LAM}`);
  expect(inReadingOrder('', [])).toBe('');
  expect(inReadingOrder('plain english', painted([10, 20, 30]))).toBe('plain english');
});

test('every ligature in a line is put back, not just the first', () => {
  // «انقلاب اسلامی», as the file writes it, with both pairs reversed.
  const file = `${ALEF}نق${ALEF}${LAM}ب ${ALEF}س${ALEF}${LAM}می`;
  const boxes = painted([300, 290, 280, 265, 270, 250, 240, 230, 220, 205, 210, 190, 180]);
  expect(inReadingOrder(file, boxes)).toBe('انقلاب اسلامی');
});

// ---- The joiners the geometry drops ----

test('a line gets back the joiners the page text has for it', () => {
  // the contents are read off the geometry, which has no ZWNJ at all
  const page = 'جلسه اول\r\nانقالب اسالمی و ریشه\u200cهای آن\r\nواژه\u200cشناسی\r\n';
  const joiners = joinersIn(page);
  expect(joiners).not.toBeNull();
  expect(withJoiners('انقلاب اسلامی و ریشههای آن', joiners)).toBe('انقلاب اسلامی و ریشه\u200cهای آن');
  expect(withJoiners('واژهشناسی', joiners)).toBe('واژه\u200cشناسی');
  // a line with nothing to put back comes through as it is
  expect(withJoiners('جلسه اول', joiners)).toBe('جلسه اول');
});

test('a page without joiners costs nothing, and an unknown line is left alone', () => {
  expect(joinersIn('نظریه اول: مکتب تضاد')).toBeNull();
  expect(withJoiners('هرچه', null)).toBe('هرچه');
  const joiners = joinersIn('یک\u200cدو سه');
  expect(withJoiners('چهار پنج', joiners)).toBe('چهار پنج'); // not on this page
});

test('a file that spells its ligatures the right way round is matched too', () => {
  // no reversal in this text layer: the line is found as it reads
  const joiners = joinersIn('کلاس\u200cهای لازم\r\n');
  expect(withJoiners('کلاسهای لازم', joiners)).toBe('کلاس\u200cهای لازم');
});

test('two joiners in one line both come back, in the right places', () => {
  const joiners = joinersIn('می\u200cتوان گفت نمونه\u200cهای تاریخی\r\n');
  expect(withJoiners('میتوان گفت نمونههای تاریخی', joiners)).toBe('می\u200cتوان گفت نمونه\u200cهای تاریخی');
});

test('a wrapped heading, which is on the page in pieces, still gets them', () => {
  // the contents join a heading that was printed over two lines, and turn
  // its brackets back the right way round -- so the line as a whole is on
  // no page, and each word has to be found on its own
  const joiners = joinersIn('نمونه\u200cهای تاریخی )انقلاب\u200cهای\r\nمارکسیستی(\r\n');
  expect(withJoiners('نمونههای تاریخی (انقلابهای مارکسیستی)', joiners))
    .toBe('نمونه\u200cهای تاریخی (انقلاب\u200cهای مارکسیستی)');
});
