// Shared shielding for literal code and math. Closing fences may immediately
// follow their opening line (an empty block); unmatched fences extend to EOF.
export const MATH_OR_CODE = /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\2[`~]*[ \t]*(?=\n|$)|(?![\s\S]))|(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?[^`]\3(?!`)|(?<!\\)\$\$([\s\S]*?)\$\$|(?<![\\$])\$([^$\n]+?)\$/gm;

// A display formula is a paragraph of its own: a line that starts a heading,
// a list item, a quote, a fence or a rule means the writer has left the
// formula behind (block math never swallows a list or a heading). Such a
// `$$ … $$` pair stays plain text — in the editor's source styling and in the
// reading view alike. The line the opening `$$` sits on is part of the
// formula, so only the lines after it are inspected; blank lines (the empty
// writing line) are always fine.
const MATH_BLOCK_BREAK = /^[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|[-*+][ \t]|[0-9\u06f0-\u06f9\u0660-\u0669]+[.)][ \t]|>|`{3,}|~{3,})/;
// A rule (- - -, ***, ___) or a setext underline (===); a single "=" stays.
const MATH_BLOCK_RULE = /^[ \t]{0,3}(?:(?:([-*_])(?:[ \t]*\1){2,})|={2,})[ \t]*$/;

export function isDisplayMathContent(content: string): boolean {
  const lines = content.split('\n');
  for (let index = 1; index < lines.length; index += 1) {
    if (MATH_BLOCK_BREAK.test(lines[index]) || MATH_BLOCK_RULE.test(lines[index])) return false;
  }
  return true;
}
