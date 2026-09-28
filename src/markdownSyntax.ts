// Shared shielding for literal code and math. Closing fences may immediately
// follow their opening line (an empty block); unmatched fences extend to EOF.
export const MATH_OR_CODE = /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\2[`~]*[ \t]*(?=\n|$)|(?![\s\S]))|(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?[^`]\3(?!`)|(?<!\\)\$\$([\s\S]*?)\$\$|(?<![\\$])\$([^$\n]+?)\$/gm;
