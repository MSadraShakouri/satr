// ==Highlight== in the editor, as Obsidian: a Lezer inline extension built
// like @lezer/markdown's own Strikethrough (same flanking rules, "==" for
// "~~"). The whole span, marks included, gets the highlight colour; live
// preview hides the marks when the caret is elsewhere (src/livePreview.ts).
import type { MarkdownConfig } from '@lezer/markdown';
import { Tag, tags } from '@lezer/highlight';

export const highlightTag = Tag.define();

const PUNCTUATION = /[!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\xA1\u2010-\u2027]/;
const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' };

export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': highlightTag } },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseInline: [{
    name: 'Highlight',
    parse(cx, next, pos) {
      if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
      const before = cx.slice(pos - 1, pos);
      const after = cx.slice(pos + 2, pos + 3);
      const sBefore = /\s|^$/.test(before), sAfter = /\s|^$/.test(after);
      const pBefore = PUNCTUATION.test(before), pAfter = PUNCTUATION.test(after);
      return cx.addDelimiter(HighlightDelim, pos, pos + 2,
        !sAfter && (!pAfter || sBefore || pBefore),
        !sBefore && (!pBefore || sAfter || pAfter));
    },
    after: 'Emphasis',
  }],
};
