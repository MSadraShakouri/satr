// A .csv is a table, and that is how it is read.
//
// Markor's way (format/csv/CsvTextConverter.java, Apache-2.0): the file is
// turned into a Markdown table and handed to the renderer every note goes
// through. The table is then Satr's own — the same styling, the same sideways
// scroll on a phone, the same export to PDF — and `**bold**` written into a
// cell is still bold when the file is read, which is the reason Markor gives
// for going through Markdown rather than building a table itself.
//
// Four things are done differently here, each because Markor's answer loses
// something off the file:
//   * a `|` inside a cell is escaped, where Markor replaces it with `!`;
//   * a row with more fields than the header widens the table, where Markor
//     keeps the header's width and the last fields fall off the end;
//   * a row whose first cell starts with `#` is data — a tag, an id, a count
//     — where Markor reads it as a comment and drops the row;
//   * an empty cell is left empty, where Markor fills it with `&nbsp;` that
//     then travels into anything copied out of the table.
// And the delimiter of a .tsv, .tab or .psv comes from its extension: a comma
// inside a sentence in the first line should not make the file a CSV.

/** What separates the fields of this file, and what quotes one. */
export interface CsvShape {
  delimiter: string;
  quote: string;
}

/** Markor's candidates, in its order (CsvConfig.java). The first of them to
 *  appear in the line wins, whichever it is — not the most frequent, which
 *  would need the whole file before the first row could be drawn. */
const DELIMITERS = [',', ';', '\t', ':', '|'];
const QUOTES = ['"', "'"];
const BY_EXTENSION: Record<string, string> = { tsv: '\t', tab: '\t', psv: '|' };

export const isCsvFile = (name: string): boolean => /\.(?:csv|tsv|tab|psv)$/i.test(name);

const extensionOf = (name: string): string => (/\.([^.\\/]+)$/.exec(name)?.[1] ?? '').toLowerCase();

/** The first line with anything on it — what the shape is read from. */
function firstRow(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim()) return line;
  }
  return '';
}

/** How this file is punctuated: from the extension where the extension says,
 *  from the first line otherwise. The quote character is only believed where
 *  it opens a field, so an apostrophe inside a word ("it's", "O'Hara") does
 *  not turn the rest of the line into one long quoted string. */
export function csvShape(text: string, name = ''): CsvShape {
  const line = firstRow(text);
  const fixed = BY_EXTENSION[extensionOf(name)];
  let delimiter = fixed ?? ',';
  if (!fixed) {
    let earliest = Infinity;
    for (const candidate of DELIMITERS) {
      const at = line.indexOf(candidate);
      if (at >= 0 && at < earliest) { earliest = at; delimiter = candidate; }
    }
  }
  let quote = '"';
  for (const field of line.split(delimiter)) {
    const start = field.trimStart()[0];
    if (start && QUOTES.includes(start)) { quote = start; break; }
  }
  return { delimiter, quote };
}

/** The rows of the file. A quoted field may hold the delimiter, a line of its
 *  own, or the quote character doubled; everything outside quotes is taken as
 *  typed. A line with nothing on it is not a row. */
export function parseCsv(text: string, shape: CsvShape): string[][] {
  const { delimiter, quote } = shape;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let had = false; // this row has a field, even if that field is empty
  const endField = (): void => { row.push(field); field = ''; had = true; };
  const endRow = (): void => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    had = false;
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === quote) {
        if (text[i + 1] === quote) { field += quote; i += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === quote && field === '') { quoted = true; continue; }
    if (char === delimiter) { endField(); continue; }
    if (char === '\r') continue;
    if (char === '\n') { endRow(); continue; }
    field += char;
  }
  if (field !== '' || had || row.length) endRow();
  return rows;
}

/** A cell as Markdown: the pipe escaped so the character survives the table,
 *  a line break inside the cell kept as one, and nothing else touched — the
 *  point of going through Markdown is that a cell can hold it. */
const cell = (value: string): string => value
  .replace(/\|/g, '\\|')
  .split('\n')
  .map((part) => part.trim())
  .join('<br>');

/** The file as a Markdown table: the first row is the header, and the table
 *  is as wide as its widest row so that nothing falls off the end. */
export function csvToMarkdown(text: string, shape: CsvShape = csvShape(text)): string {
  const rows = parseCsv(text, shape);
  if (!rows.length) return '';
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const line = (row: string[]): string => {
    const cells = Array.from({ length: width }, (_, i) => cell(row[i] ?? ''));
    return `| ${cells.join(' | ')} |`;
  };
  return [
    line(rows[0]),
    `|${' --- |'.repeat(width)}`,
    ...rows.slice(1).map(line),
  ].join('\n');
}

/** What the reading view, the export and the PDF are given for this file:
 *  a CSV as its table, anything else as itself. */
export const asMarkdown = (path: string, text: string): string => (
  isCsvFile(path) ? csvToMarkdown(text, csvShape(text, path)) : text
);

/** Where each field of one line sits, and which column it belongs to — what
 *  the editor colours. Quotes are honoured within the line; a field carrying
 *  a line break of its own is left to the lines it is written across, which
 *  is how Markor's own highlighter reads a file too (CsvSyntaxHighlighter).
 *  Each field takes the delimiter in front of it, so the separators are part
 *  of the colour rather than a gap in it. */
export function csvFields(line: string, shape: CsvShape): { from: number; to: number; column: number }[] {
  const { delimiter, quote } = shape;
  const fields: { from: number; to: number; column: number }[] = [];
  let mark = 0; // where this field's colour starts: its own delimiter
  let start = 0; // where its text starts
  let quoted = false;
  let column = 0;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char !== quote) continue;
      if (line[i + 1] === quote) i += 1; // a doubled quote is one quote
      else quoted = false;
      continue;
    }
    if (char === quote && i === start) { quoted = true; continue; }
    if (char === delimiter) {
      fields.push({ from: mark, to: i, column });
      column += 1;
      mark = i;
      start = i + 1;
    }
  }
  fields.push({ from: mark, to: line.length, column });
  return fields.filter((field) => field.to > field.from);
}
