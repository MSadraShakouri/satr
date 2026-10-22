// What an ordered list's marker is made of: digits (three sets) or letters
// (the two Persian orders). A list carries ONE alphabet — the numbering pass
// in src/editor.ts keeps it that way — so everything here answers the same
// two questions: which number is this marker, and which alphabet is it in.

export type Digits = 'latin' | 'persian' | 'arabic';
export type Letters = 'abjad' | 'abpats';
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

/** One marker token, for the list regexes: a number, `الف`, or one letter. */
export const MARKER = `(?:[0-9۰-۹٠-٩]+|الف|[${ABJAD}${ABPATS}])`;

/** True for anything a marker may be written with. */
export const isMarkerToken = (token: string): boolean => parseMarker(token) !== null;

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
  return abpats >= 0 ? { number: abpats + 1, alphabet: 'abpats' } : null;
}

export function formatDigits(number: number, alphabet: Digits): string {
  return String(Math.max(0, Math.trunc(number))).split('').map((digit) => DIGITS[alphabet][Number(digit)]).join('');
}

/** The marker for a number in an alphabet. Past the last letter an order has,
 *  the list carries on in Persian numbers rather than starting over. */
export function formatMarker(number: number, alphabet: Alphabet): string {
  if (alphabet === 'abjad' || alphabet === 'abpats') {
    const sequence = alphabet === 'abjad' ? ABJAD : ABPATS;
    return number >= 1 && number <= sequence.length ? sequence[number - 1] : formatDigits(number, 'persian');
  }
  return formatDigits(number, alphabet);
}

/** Which of the two orders the letters typed in a run are in. A letter is
 *  evidence when it sits where that order would put it: a `پ` as the third
 *  item is ابپتث, a `ج` is ابجد. `ا` and `ب` sit first and second in both, so
 *  they prove nothing, and a run that has only them is ابجد. */
export function orderOf(letters: Array<{ index: number; token: string }>): Letters {
  let abjad = 0;
  let abpats = 0;
  for (const { index, token } of letters) {
    if (ABJAD[index] === token) abjad += 1;
    if (ABPATS[index] === token) abpats += 1;
  }
  return abpats > abjad ? 'abpats' : 'abjad';
}
