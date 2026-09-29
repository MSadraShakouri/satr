import { MATH_OR_CODE } from './markdownSyntax';

// One direction policy for source lines and rendered blocks. This sets the
// paragraph base direction, NEVER a bidi override: dates/digits remain in
// their natural order, and embedded math/code retain LTR isolation.
export type TextDirection = 'ltr' | 'rtl';
export interface DirectionUnit {
  own: TextDirection | null;
  heading?: number;
  excluded?: boolean; // math, code and metadata never vote
}

export function strongDirection(text: string): TextDirection | null {
  // Script=Arabic includes digits/punctuation; only LETTERS count as strong.
  const first = /[\u200e\u200f\u061c]|\p{L}/u.exec(text)?.[0];
  if (!first) return null;
  return /[\u200f\u061c\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u.test(first) ? 'rtl' : 'ltr';
}

/** The note's own majority: which script has more strong letters. Math, code
 * and URLs don't vote. The line-number gutter and the outline tree follow
 * this. */
export function majorityDirection(markdown: string): TextDirection {
  const masked = markdown.replace(MATH_OR_CODE, (match: string) => match.replace(/[^\n]/g, ' '));
  let rtl = 0, ltr = 0;
  for (const ch of masked) {
    if (!/\p{L}/u.test(ch)) continue;
    if (/[\u200f\u061c\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u.test(ch)) rtl += 1;
    else ltr += 1;
  }
  return rtl > ltr ? 'rtl' : 'ltr';
}

export function resolveDirections(units: readonly DirectionUnit[]): TextDirection[] {
  const result: TextDirection[] = [];
  const headings: { level: number; dir: TextDirection }[] = [];
  let start = 0;
  while (start < units.length) {
    const heading = units[start];
    if (heading.heading) {
      while (headings.length && headings[headings.length - 1].level >= heading.heading) headings.pop();
      let below: TextDirection | null = null;
      for (let i = start + 1; i < units.length && !units[i].heading; i++) {
        if (!units[i].excluded && units[i].own) { below = units[i].own; break; }
      }
      const dir = heading.own ?? headings.at(-1)?.dir ?? below ?? 'ltr';
      result[start++] = dir;
      headings.push({ level: heading.heading, dir });
    }
    let end = start;
    while (end < units.length && !units[end].heading) end++;
    const next: (TextDirection | null)[] = [];
    let below: TextDirection | null = null;
    for (let i = end - 1; i >= start; i--) {
      next[i - start] = below;
      if (!units[i].excluded && units[i].own) below = units[i].own;
    }
    let above: TextDirection | null = null;
    let votes = 0;
    for (let i = start; i < end; i++) {
      const unit = units[i];
      if (unit.excluded) { result[i] = 'ltr'; continue; }
      if (unit.own) {
        result[i] = above = unit.own;
        votes |= unit.own === 'rtl' ? 1 : 2;
      } else {
        // A unanimous section prefix has priority over the following block.
        // Otherwise agreeing neighbours win; mixed neighbours prefer above.
        result[i] = votes === 1 ? 'rtl' : votes === 2 ? 'ltr'
          : above ?? next[i - start] ?? headings.at(-1)?.dir ?? 'ltr';
      }
    }
    start = end;
  }
  return result;
}

const withoutSyntax = (line: string): string => line
  .replace(/!\[([^\]]*)\]\([^)]*\)|!\[\[[^\]]*\]\]/g, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
  .replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, '$2')
  .replace(/\[\^[^\]]+\]:?/g, '')
  .replace(/https?:\/\/\S+/g, '')
  .replace(/<[^>]*>/g, '')
  .replace(/^(?:\s*>\s*)*/, '')
  .replace(/^\s*(?:[-*+]|[0-9۰-۹٠-٩]+[.)])\s+(?:\[[ xX]\]\s*)?/, '')
  .replace(/^\s*[a-zA-Z][.)]\s*$/, '');

/** Full-document context, cached by the editor's StateField. No viewport
 * cutoff: scrolling 200 lines away must not change a number's direction. */
export function sourceDirections(markdown: string): TextDirection[] {
  const source = markdown.replace(/\r\n?/g, '\n');
  const originalLines = source.split('\n');
  const ignored = new Set<number>();
  let cursor = 0, line = 0;
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  let masked = source.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/^ {0,3}\[(?!\^)[^\]]+\]:[^\n]*$/gm, blank);
  masked = masked.replace(MATH_OR_CODE, (match: string, _a, _b, _c, display: string | undefined, inline: string | undefined, offset: number) => {
    // "$$" with nothing between on one line and a lone unpaired "$$" are
    // text, not math; an empty $$ … $$ block is still a math block.
    if (display !== undefined && !display.trim() && !match.includes('\n')) return match;
    if (inline !== undefined && !inline.trim()) return match;
    line += source.slice(cursor, offset).split('\n').length - 1;
    const lines = match.split('\n').length - 1;
    for (let i = line; i <= line + lines; i++) ignored.add(i);
    line += lines; cursor = offset + match.length;
    return blank(match);
  });
  const lines = masked.split('\n');
  const units: DirectionUnit[] = lines.map((raw, index) => {
    const text = withoutSyntax(raw);
    const explicit = /<[a-z][^>]*\bdir\s*=\s*["'](rtl|ltr)["']/i.exec(raw)?.[1].toLowerCase() as TextDirection | undefined;
    const heading = /^\s{0,3}(#{1,6})(?:\s|$)/.exec(text)?.[1].length;
    const indentedCode = /^( {4}|\t)/.test(originalLines[index]) && (index === 0 || !originalLines[index - 1].trim() || /^( {4}|\t)/.test(originalLines[index - 1]));
    return { own: explicit ?? strongDirection(text), heading, excluded: (ignored.has(index) && !text.trim()) || indentedCode };
  });
  for (let i = 1; i < lines.length; i++) {
    if (!units[i].excluded && /^\s{0,3}(=+|-+)\s*$/.test(lines[i]) && lines[i - 1].trim() && !units[i - 1].excluded && !units[i - 1].heading) {
      units[i - 1].heading = lines[i].trim()[0] === '=' ? 1 : 2;
    }
  }
  return resolveDirections(units);
}

const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,dt,dd,summary,caption,.md-prose-fragment';
const EXCLUDED = '.math-display,.math-flow,.katex,pre,code,.footnote-ref,.footnote-backref,.copy-code-button';
function proseText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(EXCLUDED).forEach((node) => node.remove());
  return (clone.textContent ?? '').replace(/https?:\/\/\S+/g, '');
}

/** The same policy over semantic blocks, before HTML is shared by preview
 * and PDF. Explicit user dir attributes are honoured. Containers follow
 * their first directional child so list markers/quote borders match too. */
export function applyReadingDirections(root: HTMLElement): void {
  const nodes = [...root.querySelectorAll<HTMLElement>(`${BLOCKS},pre,.math-display`)];
  const leaves = nodes.filter((el) => !el.parentElement?.closest('pre,code,.math-display,.math-flow,.katex')
    && (!el.matches('li,blockquote') || !el.querySelector(BLOCKS)));
  const units: DirectionUnit[] = [];
  const starts: number[] = [];
  const ownDirections: (TextDirection | null)[] = [];
  leaves.forEach((el) => {
    const prose = proseText(el);
    const explicit = el.getAttribute('dir');
    const own = explicit === 'rtl' || explicit === 'ltr' ? explicit : strongDirection(prose);
    const excluded = el.matches('pre,.math-display') || (!prose.trim() && Boolean(el.querySelector('.math-flow,.katex,code')));
    starts.push(units.length);
    ownDirections.push(excluded ? 'ltr' : own);
    // Soft source newlines still vote individually, even though Markdown
    // displays them in one paragraph. Mixed prose must not become a false
    // unanimous prefix merely because the renderer joined its lines.
    prose.split('\n').forEach((line, index) => units.push({
      own: explicit === 'rtl' || explicit === 'ltr' ? explicit : strongDirection(line),
      heading: index === 0 && /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : undefined,
      excluded,
    }));
  });
  const directions = resolveDirections(units);
  leaves.forEach((el, index) => el.setAttribute('dir', ownDirections[index] ?? directions[starts[index]]));
  for (const el of [...root.querySelectorAll<HTMLElement>('li,blockquote,ul,ol,.md-section')].reverse()) {
    if (el.getAttribute('dir') === 'ltr' || el.getAttribute('dir') === 'rtl') continue;
    el.setAttribute('dir', el.querySelector('[dir]')?.getAttribute('dir') ?? strongDirection(proseText(el)) ?? 'ltr');
  }
  root.querySelectorAll<HTMLElement>('.math-display,.math-flow,.katex,pre,code').forEach((el) => el.setAttribute('dir', 'ltr'));
}
