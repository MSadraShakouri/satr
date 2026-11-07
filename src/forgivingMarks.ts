// A marker pair that has a space as the last thing inside it, in the source
// view.
//
// Reported: "forgiving not only for highlight, and the reason I want it is
// because it flickers with spaces."
//
// The flicker is CommonMark being right. A closing delimiter may not be
// preceded by whitespace, so the instant a space is typed as the last
// character inside `==one two ==` the Highlight node is gone: the colour goes,
// and once the caret leaves the line the two `==` come back as text. The next
// letter brings both back. Every space typed inside a pair blinks it off and
// on — `**`, `*`, `_`, `~~` and `==` alike.
//
// So the source view draws such a pair anyway, as long as the pair without the
// run of spaces would parse. That is the whole rule, and it is deliberately
// one-sided: only a run of spaces *before the closer* is forgiven, because
// that is the one the writer types last. `* b *` — a multiplication sign —
// trims to `* b*`, which is still not emphasis, so it stays a multiplication
// sign.
//
// The check is not a second opinion about flanking rules: the line, with the
// run taken out, is handed to the same parser the editor is using, and the
// pair counts only if that parse really produces the node in that place. There
// is one definition of emphasis in the app and this does not add another.
//
// The reading view is untouched. It keeps Obsidian's published rule, and a
// space before the closing `==` there still means no `<mark>`: this is the
// editor forgiving text that is still being written, which is what Obsidian's
// editor does too.
import { language, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { inMath } from './mathSource';

export type ForgivingKind = 'strong' | 'emphasis' | 'strike' | 'highlight';

export type ForgivingMark = {
  kind: ForgivingKind;
  /** The whole inside of the pair, the run of spaces before the closer
   *  included: the look runs from one mark to the other, so a highlight has no
   *  untinted gap at its end and a strike has no break in it. */
  contentFrom: number;
  contentTo: number;
  /** The opening marker, as typed. */
  openFrom: number;
  openTo: number;
  /** The closing marker, as typed. */
  closeFrom: number;
  closeTo: number;
};

/** Each marker, the look it gives, and the node the parser would have made of
 *  it. Two characters before one, so `**` is never read as two `*`. */
const KINDS: ReadonlyArray<{ mark: string; kind: ForgivingKind; node: string }> = [
  { mark: '**', kind: 'strong', node: 'StrongEmphasis' },
  { mark: '__', kind: 'strong', node: 'StrongEmphasis' },
  { mark: '~~', kind: 'strike', node: 'Strikethrough' },
  { mark: '==', kind: 'highlight', node: 'Highlight' },
  { mark: '*', kind: 'emphasis', node: 'Emphasis' },
  { mark: '_', kind: 'emphasis', node: 'Emphasis' },
];

/** Where `mark` stands on its own in `text`: not escaped, and not part of a
 *  longer run of the same character (`***` is not a `**` and a `*`). */
function occurrences(text: string, mark: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(mark); at >= 0; at = text.indexOf(mark, at + 1)) {
    if (text[at - 1] === '\\') continue;
    const before = text[at - 1] ?? '';
    const after = text[at + mark.length] ?? '';
    if (before === mark[0] || after === mark[0]) continue;
    found.push(at);
  }
  return found;
}

/** Would `text[open … close]` be a `node` if the run of spaces before the
 *  closer were not there? Asked of the editor's own parser, on the line with
 *  exactly that run taken out — so `==one two ==` is asked about as
 *  `==one two==`, and `* b *` as `* b*`, which is still not emphasis. */
function parsesWithout(state: EditorState, text: string, open: number, close: number, mark: string, node: string): boolean {
  const parser = state.facet(language)?.parser;
  if (!parser) return false;
  const inner = text.slice(open + mark.length, close);
  const trimmed = inner.replace(/[ \t]+$/, '');
  if (trimmed === inner || !trimmed.trim()) return false; // no run, or nothing in it
  const from = open;
  const to = open + mark.length * 2 + trimmed.length;
  const probe = text.slice(0, open + mark.length + trimmed.length) + text.slice(close);
  let found = false;
  parser.parse(probe).iterate({
    from,
    to,
    enter: (one) => {
      if (one.name === node && one.from === from && one.to === to) found = true;
    },
  });
  return found;
}

/** Every pair on the lines between `from` and `to` that only a run of spaces
 *  before its closer keeps from looking like what it is. */
export function forgivingMarks(state: EditorState, from: number, to: number): ForgivingMark[] {
  if (!state.facet(language)?.parser) return [];
  const tree = syntaxTree(state);
  const out: ForgivingMark[] = [];
  for (let pos = from; pos <= to;) {
    const line = state.doc.lineAt(pos);
    pos = line.to + 1;
    if (!/[=*_~]/.test(line.text)) continue;
    // A fence is code, and so is an indented block: no markdown is parsed
    // there and nothing is drawn (the reading view agrees).
    if (/Code/.test(tree.resolveInner(line.from, 1).name)) continue;
    for (const { mark, kind, node } of KINDS) {
      const at = occurrences(line.text, mark);
      // Paired greedily left to right, as the parser pairs them, and a pair
      // that does not survive the check is skipped rather than stretched: a
      // line holding two independent pairs is not read as one long one.
      for (let i = 0; i + 1 < at.length;) {
        const open = line.from + at[i];
        const close = line.from + at[i + 1];
        if (inMath(state, open) || inMath(state, close) || !parsesWithout(state, line.text, at[i], at[i + 1], mark, node)) {
          i += 1;
          continue;
        }
        out.push({
          kind,
          // To the closer itself, not to the last letter: the spaces inside a
          // pair are the pair's, and the highlight covers what the pair holds.
          contentFrom: open + mark.length,
          contentTo: close,
          openFrom: open,
          openTo: open + mark.length,
          closeFrom: close,
          closeTo: close + mark.length,
        });
        i += 2;
      }
    }
  }
  return out;
}
