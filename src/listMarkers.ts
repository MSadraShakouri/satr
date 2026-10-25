// What an ordered list's marker is made of: digits (three sets) or letters
// (the two Persian orders). A list carries ONE alphabet — the numbering pass
// in src/editor.ts keeps it that way — so everything here answers the same
// two questions: which number is this marker, and which alphabet is it in.

export type Digits = 'latin' | 'persian' | 'arabic';
export type Orders = 'abjad' | 'abpats';
export type Cases = 'lower' | 'upper';
export type Letters = Orders | Cases;
export type Alphabet = Digits | Letters;

const DIGITS: Record<Digits, string> = {
  latin: '0123456789',
  persian: '۰۱۲۳۴۵۶۷۸۹',
  arabic: '٠١٢٣٤٥٦٧٨٩',
};

/** ابجد هوز حطي كلمن سعفص قرشت ثخذ ضظغ — ابجد, the old Semitic order. */
export const ABJAD = 'ابجدهوزحطیکلمنسعفصقرشتثخذضظغ';
/** ا ب پ ت ث ج چ — the Persian alphabet, in its own order. */
export const ABPATS = 'ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی';
/** The English alphabet, as it is written in a list: `a. b. c.` */
export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** One marker token, for the list regexes: a number, `الف`, or one letter —
 *  Persian in either order, or English in either case. */
export const MARKER = `(?:[0-9۰-۹٠-٩]+|الف|[${ABJAD}${ABPATS}]|[${LOWER}${UPPER}])`;

/** True for anything a marker may be written with. */
export const isMarkerToken = (token: string): boolean => parseMarker(token) !== null;

/** A letter written as a marker at the head of a line: `a.`, `A)`, `الف.`,
 *  `ب)`. A letter is only a list marker where it reads as one — see
 *  lineIsLettered. */
/*  The quote marks count as indent: `> a.` and `> b.` are a list of their own,
 *  and neither is a sibling of an `a.` written outside the quote. */
export function letterItem(line: string): { indent: number; letter: string } | null {
  const match = new RegExp(`^([ \\t]*(?:>[ \\t]*)*)(الف|[${ABJAD}${ABPATS}]|[${LOWER}${UPPER}])[.)][ \\t]+`).exec(line);
  return match ? { indent: match[1].length, letter: match[2] } : null;
}

/** Where a letter stands in one of the Persian orders. `الف` is the first
 *  letter written as a word, and `ا` is that same first letter. */
const place = (letter: string, order: string): number => (letter === 'الف' ? 0 : order.indexOf(letter));

/** Two letters that follow one another in some alphabet: `a` then `b`, `الف`
 *  then `ب`. English letters must also be in the same case. */
export function nextLetter(one: string, other: string): boolean {
  const english = (letter: string): boolean => LOWER.includes(letter) || UPPER.includes(letter);
  if (english(one) || english(other)) {
    return english(one) && english(other)
      && Math.abs(one.charCodeAt(0) - other.charCodeAt(0)) === 1
      && (one === one.toLowerCase()) === (other === other.toLowerCase());
  }
  // Either Persian order will do: a run that reads as neighbours in ابجد or
  // in the alphabet's own order is a run either way.
  return [ABJAD, ABPATS].some((order) => {
    const here = place(one, order);
    const there = place(other, order);
    return here >= 0 && there >= 0 && Math.abs(here - there) === 1;
  });
}

/** Does this line's letter read as a list marker? `a.` and `b.` — or `الف.`
 *  and `ب.` — on neighbouring lines are a list, while `A. Smith` on its own,
 *  or `م. شاکوری`, or two lines opening `A.`, are sentences: the letter counts
 *  only when a line above or below carries the next or previous letter, at the
 *  same indent and in the same case. One rule for every script, so neither is
 *  held to a standard the other is not. Both the reading view (src/markdown.ts)
 *  and the editor's dimming (src/editor.ts) ask this one question, so a letter
 *  is drawn the same way in both. */
export function lineIsLettered(lineAt: (index: number) => string | undefined, index: number): boolean {
  const item = letterItem(lineAt(index) ?? '');
  if (!item) return false;
  return [index - 1, index + 1].some((neighbour) => {
    const other = letterItem(lineAt(neighbour) ?? '');
    return Boolean(other && other.indent === item.indent && nextLetter(item.letter, other.letter));
  });
}

/** The number a marker says, and the alphabet it is written in. `الف` is the
 *  first letter of either order; `ا` is the first letter too. */
export function parseMarker(token: string): { number: number; alphabet: Alphabet } | null {
  for (const alphabet of ['latin', 'persian', 'arabic'] as const) {
    const set = DIGITS[alphabet];
    if (token.length && [...token].every((digit) => set.includes(digit))) {
      const number = [...token].reduce((total, digit) => total * 10 + set.indexOf(digit), 0);
      return { number, alphabet };
    }
  }
  if (token === 'الف') return { number: 1, alphabet: 'abjad' };
  if (token.length !== 1) return null;
  const abjad = ABJAD.indexOf(token);
  if (abjad >= 0) return { number: abjad + 1, alphabet: 'abjad' };
  const abpats = ABPATS.indexOf(token);
  if (abpats >= 0) return { number: abpats + 1, alphabet: 'abpats' };
  const lower = LOWER.indexOf(token);
  if (lower >= 0) return { number: lower + 1, alphabet: 'lower' };
  const upper = UPPER.indexOf(token);
  return upper >= 0 ? { number: upper + 1, alphabet: 'upper' } : null;
}

export function formatDigits(number: number, alphabet: Digits): string {
  return String(Math.max(0, Math.trunc(number))).split('').map((digit) => DIGITS[alphabet][Number(digit)]).join('');
}

/** The marker for a number in an alphabet. Past the last letter an order has,
 *  the list carries on in numbers — Persian digits after a Persian order,
 *  English digits after the English alphabet — rather than starting over. */
export function formatMarker(number: number, alphabet: Alphabet): string {
  if (alphabet === 'abjad' || alphabet === 'abpats') {
    const sequence = alphabet === 'abjad' ? ABJAD : ABPATS;
    return number >= 1 && number <= sequence.length ? sequence[number - 1] : formatDigits(number, 'persian');
  }
  if (alphabet === 'lower' || alphabet === 'upper') {
    const sequence = alphabet === 'lower' ? LOWER : UPPER;
    return number >= 1 && number <= sequence.length ? sequence[number - 1] : formatDigits(number, 'latin');
  }
  return formatDigits(number, alphabet);
}

/** Which of the two orders the letters typed in a run are in. A letter is
 *  evidence when it sits where that order would put it: a `پ` as the third
 *  item is ابپتث, a `ج` is ابجد. `ا` and `ب` sit first and second in both, so
 *  they prove nothing, and a run that has only them is ابجد. */
export function orderOf(letters: Array<{ index: number; token: string }>): Orders {
  let abjad = 0;
  let abpats = 0;
  for (const { index, token } of letters) {
    if (ABJAD[index] === token) abjad += 1;
    if (ABPATS[index] === token) abpats += 1;
  }
  return abpats > abjad ? 'abpats' : 'abjad';
}

/** Do these markers read as the list they are in: a, b, c from the head? Only
 *  English letters ask — `A. Smith` at the head of a line is a name, and two
 *  such lines are two sentences, not a list to renumber. Persian orders and
 *  the three digit sets are never prose, and are always put right. */
export function sequential(tokens: readonly string[], alphabet: Alphabet): boolean {
  if (alphabet !== 'lower' && alphabet !== 'upper') return true;
  const parsed = tokens.map((token) => parseMarker(token));
  const start = parsed[0]?.number ?? 0;
  // A number in the run is on its way to being a letter there (`a.` then a
  // typed `2.` is the second item), so only the numbers have to line up.
  return parsed.every((one, index) => one !== null && one.number === start + index);
}
