/**
 * What a search bar shows about a query, in one place.
 *
 * There are two find bars -- the one a note is searched with and the one a
 * document is -- and they are the same bar to a reader: the same button in
 * the nav opens them, and they carry the same markup and class names. They
 * had drifted apart where it shows most, which is a Persian query: the
 * note's bar moved the count to the end of the text and counted in Persian
 * digits, and the document's left it in English on the other side, with
 * the room for it reserved on the wrong edge of the field.
 */

/** A query whose first strong letter is Persian or Arabic. */
const RTL_QUERY = /^[^A-Za-z\u00C0-\u024F\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]*[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

export const queryIsRtl = (query: string): boolean => RTL_QUERY.test(query);

/** Figures in the query's own digits: ۱۴۱ for a Persian search, 141 for a
 *  Latin one -- a reader looking for a Persian word is reading Persian. */
export const queryDigits = (value: number, rtl: boolean): string =>
  (rtl ? String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]) : String(value));

/**
 * Lay the bar out for the query in it: the count goes to the end of the
 * text, and the field keeps its room on that side. Called as the key is
 * pressed rather than when the search comes back, so the text never sits
 * short of the edge for a moment and then jumps over.
 */
export function markQuery(bar: HTMLElement, count: HTMLElement, query: string): boolean {
  const rtl = queryIsRtl(query);
  bar.classList.toggle('mod-rtl-query', rtl);
  count.dir = rtl ? 'rtl' : 'ltr';
  return rtl;
}

/** "۳ / ۱۴۱", or nothing at all where there is no query to count. */
export function countLabel(query: string, at: number, total: number): string {
  if (!query.trim()) return '';
  const rtl = queryIsRtl(query);
  return `${queryDigits(total ? at + 1 : 0, rtl)} / ${queryDigits(total, rtl)}`;
}
