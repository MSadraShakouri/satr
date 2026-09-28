// Search queries are regular expressions, matched ignoring case (the find
// bar and the sidebar search). Written the JavaScript way, without slashes:
// `colou?r`, `\bword\b`, `^- \[ \]`. A pattern that doesn't compile (yet,
// e.g. while typing `(`) finds nothing and is reported as invalid.

/** The query as a RegExp (flags `gi` by default); null if empty or invalid. */
export function searchRegExp(query: string, flags = 'gi'): RegExp | null {
  if (!query) return null;
  try { return new RegExp(query, flags); } catch { return null; }
}
export const isInvalidSearch = (query: string): boolean => Boolean(query) && searchRegExp(query) === null;

/** The replacement for one match, with `$&`, `$1`… and `$<name>` expanded. */
export function expandReplacement(match: RegExpExecArray | null, replacement: string): string {
  if (!match) return replacement;
  return replacement.replace(/\$(\$|&|\d{1,2}|<([^>]*)>)/g, (all, token: string, name?: string) => {
    if (token === '$') return '$';
    if (token === '&') return match[0];
    if (name !== undefined) return match.groups?.[name] ?? '';
    const n = Number(token);
    return n > 0 && n < match.length ? match[n] ?? '' : all;
  });
}
