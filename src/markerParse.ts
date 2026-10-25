// The markdown parser reads Persian and Arabic-Indic numbers.
//
// CommonMark counts an ordered list by ASCII digits only, so `۱. یک` reached
// the editor as a paragraph: no hanging indent, no marker strip, no list at
// all — while `1. one` was a list everywhere a list may sit, blockquotes
// included. The reading view has never had that split, because
// src/markdown.ts rewrites a marker to ASCII (its `grow`) before marked sees
// the line. This does the same for the editor's parser, and nothing else in
// the editor has to learn a second definition of a list: the syntax tree
// carries OrderedList / ListItem / ListMark for a Persian list exactly as it
// does for an English one, so the live preview, the fold, the gutter and the
// line classes all follow with no change of their own.
//
// The substitution is one character for one character — `۱` and `٠` are each
// a single code unit, as `1` and `0` are — so every position in the tree is a
// position in the real document, and every decoration drawn from it lands on
// the text the writer typed. The document itself is never touched: this is
// what the parser reads, not what the editor holds or saves.
//
// A digit is only ever syntax at the head of a list item, so folding it
// changes nothing else: `۱۳۹۹` in a sentence parses as the text it is, and a
// table cell gets no list out of it — the same as `1399`.
import { Language, LanguageSupport } from '@codemirror/language';
import { Parser, type Input, type PartialParse, type TreeFragment } from '@lezer/common';

/** Persian (U+06F0) and Arabic-Indic (U+0660) digits. */
const ANY_DIGIT = /[۰-۹٠-٩]/;
const EVERY_DIGIT = /[۰-۹٠-٩]/g;

function asciiDigits(text: string): string {
  if (!ANY_DIGIT.test(text)) return text;
  return text.replace(EVERY_DIGIT, (digit) => {
    const code = digit.charCodeAt(0);
    return String.fromCharCode(48 + (code >= 0x06f0 ? code - 0x06f0 : code - 0x0660));
  });
}

/** The document as the parser reads it: the same length, the same lines, the
 *  same offsets — only the digits are ASCII. */
function asciiInput(input: Input): Input {
  return {
    get length() { return input.length; },
    get lineChunks() { return input.lineChunks; },
    chunk: (from: number) => asciiDigits(input.chunk(from)),
    read: (from: number, to: number) => asciiDigits(input.read(from, to)),
  };
}

class MarkerParser extends Parser {
  constructor(private readonly inner: Parser) { super(); }

  createParse(input: Input, fragments: readonly TreeFragment[], ranges: readonly { from: number; to: number }[]): PartialParse {
    return this.inner.createParse(asciiInput(input), fragments, ranges);
  }
}

/** The same markdown support, with a parser that reads Persian and
 *  Arabic-Indic numbers as the numbers they are. */
export function readsEveryNumber(support: LanguageSupport): LanguageSupport {
  const base = support.language;
  const parser = new MarkerParser(base.parser);
  return new LanguageSupport(new Language(base.data, parser, [], base.name), support.support);
}
