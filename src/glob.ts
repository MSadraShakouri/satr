// Search patterns for the find bar and the sidebar search: plain text,
// ignoring case, with glob wildcards and nothing else.
// - `*` any run of characters within a line
// - `?` any one character
// - `\*`, `\?`, `\\` the character itself
// Without wildcards it is a plain text search.

const escapeRegExp = (c: string): string => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** RegExp source for a glob pattern (no flags; never matches across lines). */
export function globSource(query: string): string {
  let out = '';
  for (let i = 0; i < query.length; i += 1) {
    const c = query[i];
    if (c === '\\' && i + 1 < query.length && '*?\\'.includes(query[i + 1])) {
      out += escapeRegExp(query[i + 1]);
      i += 1;
    } else if (c === '*') {
      while (query[i + 1] === '*') i += 1;
      // A trailing star runs to the end of the line; inside, as little as possible.
      out += i === query.length - 1 ? '[^\\n]*' : '[^\\n]*?';
    } else if (c === '?') {
      out += '[^\\n]';
    } else {
      out += escapeRegExp(c);
    }
  }
  return out;
}

/** A global, case-insensitive RegExp for the pattern, or null when empty. */
export function globRegExp(query: string): RegExp | null {
  if (!query) return null;
  return new RegExp(globSource(query), 'gi');
}

/** Whether `text` is, as a whole, a match of the pattern. */
export function globMatchesWhole(query: string, text: string): boolean {
  return Boolean(query) && new RegExp(`^(?:${globSource(query)})$`, 'i').test(text);
}
