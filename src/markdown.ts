import { scanMath, type MathSpan } from './mathScan';
import { applyReadingDirections } from './direction';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { renderMath } from './math';
import { TIMESTAMP_START, timestampTag, type TimestampFormat } from './timestamps';
import type { Token, TokensList } from 'marked';
import hljs from 'highlight.js/lib/common';

marked.setOptions({ gfm: true, breaks: false });
// Obsidian mobile shows a copy button on every code block (top end corner).
const COPY_BUTTON = '<button class="copy-code-button" type="button" aria-label="Copy code"></button>';
marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      if (lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(text, { language: lang }).value;
        return `<pre><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code>${COPY_BUTTON}</pre>`;
      }
      return `<pre><code>${escapeHtml(text)}</code>${COPY_BUTTON}</pre>`;
    },
  },
});

// Footnotes, rendered like Obsidian's reading view: references become
// <sup class="footnote-ref"><a class="footnote-link">[1]</a></sup>, numbered
// in order of first reference; definitions are collected into a
// <section class="footnotes"> (rule + ordered list) at the end, each with a
// ↩︎ back-link per reference. Inline footnotes ^[like this] are supported;
// references without a definition stay as plain text.
interface FootnoteState {
  defs: Map<string, string>;
  order: string[];
  uses: Map<string, number>;
  inline: number;
}
let footnotes: FootnoteState = { defs: new Map(), order: [], uses: new Map(), inline: 0 };
const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]?([^\n]*)((?:\n(?:[ ]{2,}|\t)[^\n]*)*)/;

function collectFootnotes(text: string): Map<string, string> {
  const defs = new Map<string, string>();
  let fence: string | null = null;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(lines[index]);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    if (!lines[index].startsWith('[^')) continue;
    const match = FOOTNOTE_DEF.exec(lines.slice(index, index + 64).join('\n'));
    if (!match) continue;
    const id = match[1].toLowerCase();
    const more = match[3] ? match[3].split('\n').slice(1).map((line) => line.trim()) : [];
    if (!defs.has(id)) defs.set(id, [match[2], ...more].join('\n'));
    index += more.length;
  }
  return defs;
}

function footnoteRefHtml(id: string): string {
  let index = footnotes.order.indexOf(id);
  if (index < 0) index = footnotes.order.push(id) - 1;
  const uses = footnotes.uses.get(id) ?? 0;
  footnotes.uses.set(id, uses + 1);
  const number = String(index + 1);
  const refId = uses > 0 ? `${number}-${uses}` : number;
  return `<sup class="footnote-ref" data-footnote-id="fnref-${refId}"><a class="footnote-link" href="#fn-${number}">[${number}]</a></sup>`;
}

function footnotesSectionHtml(): string {
  if (!footnotes.order.length) return '';
  const items = footnotes.order.map((id, index) => {
    const number = String(index + 1);
    const uses = footnotes.uses.get(id) ?? 1;
    const backrefs = Array.from({ length: uses }, (_, use) =>
      `<a class="footnote-backref footnote-link" href="#fnref-${use > 0 ? `${number}-${use}` : number}">↩︎</a>`).join('');
    const body = marked.parseInline(footnotes.defs.get(id) ?? '', { async: false }) as string;
    return `<li data-footnote-id="fn-${number}"><p>${body.replace(/\n/g, '<br>')}${backrefs}</p></li>`;
  }).join('');
  return `<section class="footnotes"><hr><ol>${items}</ol></section>`;
}

marked.use({
  extensions: [
    {
      name: 'footnoteDef',
      level: 'block',
      start: (src: string) => src.match(/^\[\^[^\]\s]+\]:/m)?.index,
      tokenizer(src: string) {
        const match = FOOTNOTE_DEF.exec(src);
        if (!match) return undefined;
        const raw = match[0] + (src.charAt(match[0].length) === '\n' ? '\n' : '');
        return { type: 'footnoteDef', raw };
      },
      renderer: () => '',
    },
    {
      name: 'footnoteRef',
      level: 'inline',
      start: (src: string) => { const at = src.search(/\[\^|\^\[/); return at < 0 ? undefined : at; },
      tokenizer(src: string) {
        const ref = /^\[\^([^\]\s]+)\]/.exec(src);
        if (ref && footnotes.defs.has(ref[1].toLowerCase())) return { type: 'footnoteRef', raw: ref[0], id: ref[1].toLowerCase() };
        const inline = /^\^\[([^\]]+)\]/.exec(src);
        if (inline) {
          const id = `\u0000inline-${footnotes.inline += 1}`;
          footnotes.defs.set(id, inline[1]);
          return { type: 'footnoteRef', raw: inline[0], id };
        }
        return undefined;
      },
      renderer: (token) => footnoteRefHtml((token as unknown as { id: string }).id),
    },
  ],
});

// Wiki links, as Obsidian's: [[Note]], [[Note|shown text]], [[Note#Heading]]
// and embeds ![[Note]] (shown as a link). Rendered as <a class="internal-link"
// data-href="Note" data-heading="Heading">; src/main.ts resolves them against
// the space's notes, dims the broken ones and opens the rest on tap.
// Images: ![alt](src) and ![[name.png]] become centred pictures, loaded by
// src/images.ts; "|300" or "|300x200" after the alt text or name sets the size.
const WIKI = /^(!?)\[\[([^\[\]|#\n]*)(?:#([^\[\]|\n]*))?(?:\|([^\[\]\n]*))?\]\]/;
// <img> for src/images.ts to fill in. "alt|300" / "alt|300x200" (or just
// "300") sets the width (and height), as in Obsidian.
function imageTag(src: string, label: string, wiki: boolean): string {
  const size = /^(?:(.*)\|)?\s*(\d+)(?:x(\d+))?\s*$/.exec(label);
  const alt = size ? (size[1] ?? '').trim() : label;
  const width = size ? ` width="${size[2]}"` : '';
  const height = size?.[3] ? ` height="${size[3]}"` : '';
  let name = src.split(/[?#]/)[0].split('/').pop() || src;
  try { name = decodeURIComponent(name); } catch { /* as written */ }
  return `<img class="md-image" data-src="${escapeHtml(src)}"${wiki ? ' data-wiki="1"' : ''} alt="${escapeHtml(alt || name)}"${width}${height}>`;
}
const isImagePath = (path: string): boolean => /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/i.test(path);
marked.use({
  extensions: [{
    name: 'wikiLink',
    level: 'inline',
    start: (src: string) => { const at = src.search(/!?\[\[/); return at < 0 ? undefined : at; },
    tokenizer(src: string) {
      const match = WIKI.exec(src);
      if (!match || !(match[2] || match[3])) return undefined;
      return { type: 'wikiLink', raw: match[0], embed: match[1] === '!', target: match[2].trim(), heading: (match[3] ?? '').trim(), alias: match[4]?.trim() ?? '' };
    },
    renderer(token) {
      const { embed, target, heading, alias } = token as unknown as { embed: boolean; target: string; heading: string; alias: string };
      if (embed && isImagePath(target)) return imageTag(target, alias, true);
      const shown = alias || (heading ? (target ? `${target} › ${heading}` : heading) : target);
      return `<a class="internal-link${embed ? ' mod-embed' : ''}" data-href="${escapeHtml(target)}" data-heading="${escapeHtml(heading)}">${escapeHtml(shown)}</a>`;
    },
  }],
  renderer: {
    image({ href, text }: { href: string; text: string }): string {
      return imageTag(href, text, false);
    },
  },
});

// ==Highlight==, as Obsidian: a <mark>. The text right inside the marks
// can't be a space, and "===" isn't one.
marked.use({
  extensions: [{
    name: 'highlight',
    level: 'inline',
    start: (src: string) => { const at = src.indexOf('=='); return at < 0 ? undefined : at; },
    tokenizer(src: string) {
      const match = /^==(?!=)(?=\S)([\s\S]*?\S)==(?!=)/.exec(src);
      if (!match) return undefined;
      return { type: 'highlight', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
    },
    renderer(token) {
      return `<mark>${this.parser.parseInline((token as unknown as { tokens: Token[] }).tokens)}</mark>`;
    },
  }],
});

// <t:UNIX> and <t:UNIX:F>: Discord-style timestamps (src/timestamps.ts). An
// extension, so a code span or a formula that holds one stays as written.
marked.use({
  extensions: [{
    name: 'discordTimestamp',
    level: 'inline',
    start: (src: string) => { const at = src.indexOf('<t:'); return at < 0 ? undefined : at; },
    tokenizer(src: string) {
      const match = TIMESTAMP_START.exec(src);
      if (!match) return undefined;
      return { type: 'discordTimestamp', raw: match[0], seconds: Number(match[1]), format: (match[2] ?? 'f') as TimestampFormat };
    },
    renderer(token) {
      const { seconds, format } = token as unknown as { seconds: number; format: TimestampFormat };
      return timestampTag(seconds, format);
    },
  }],
});

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));

const newlines = (text: string): number => text.split('\n').length - 1;

// Math, from the same spans the editor styles (src/mathScan.ts): each formula
// becomes a placeholder that marked() passes through untouched — its tex is
// never read as markdown — and the rendered KaTeX goes back in after the
// sanitizer, so nothing in a formula is bold, struck or linked. A display
// formula keeps the lines it spanned, so the source line of everything below
// it holds. Text math never turned out to be (a lone `$$`, a pair a heading
// broke) is left alone and reads as the ordinary markdown it is.
function splitMath(source: string, spans: readonly MathSpan[]): string {
  if (!spans.length) return source;
  let out = '';
  let cursor = 0;
  spans.forEach((span, id) => {
    out += source.slice(cursor, span.from);
    out += span.display
      // Keep the lines the formula spanned, so everything below it keeps its number.
      ? `<div data-satr-math="${id}"></div>${'\n'.repeat(newlines(source.slice(span.from, span.to)))}`
      : `<span data-satr-math="${id}"></span>`;
    cursor = span.to;
  });
  return out + source.slice(cursor);
}

// The preview is rendered in sections, one per top-level markdown block, each
// tagged with the source lines it came from (data-line / data-lines) — the
// same model as Obsidian's reading view. Lists are tagged per item. Editor and
// preview scroll positions are exchanged as a fractional source line (see
// src/scrollSync.ts). Every transform before lexing keeps line numbers,
// except table-separator insertion, which reports where its lines came from.
// A fenced code block (to its closing fence, or the end of the note), a
// code span (backtick runs of the same length, within one paragraph), or
// math: $$display$$ or $inline$.
export function renderMarkdown(source: string): string {
  const normalized = source.replace(/\r\n?/g, '\n');
  // Front matter becomes blank lines, so line numbers don't shift.
  const withoutFrontMatter = normalized.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, (block) => block.replace(/[^\n]/g, ''));
  const orderedStyles: Array<'persian' | 'latin'> = [];
  let previousWasOrdered = false;
  withoutFrontMatter.split('\n').forEach((line) => {
    const marker = /^\s*([0-9۰-۹٠-٩]+)[.)]\s+/.exec(line);
    if (marker && !previousWasOrdered) orderedStyles.push(/[۰-۹٠-٩]/.test(marker[1]) ? 'persian' : 'latin');
    previousWasOrdered = Boolean(marker);
  });
  // Math first: the placeholders hold no markdown, and the transforms below
  // (page breaks, list markers, table separators) only ever look at the
  // lines' text, so the reading view and the editor agree on every formula.
  const spans = scanMath(withoutFrontMatter);
  const math = spans.map((span) => renderMath(withoutFrontMatter.slice(span.from + span.delim, span.to - span.delim), span.display));
  const withMathPlaceholders = splitMath(withoutFrontMatter, spans);
  // A list marker the writer typed keeps its own number — `۲.` becomes `2.`
  // for the parser's sake (the digits are only transliterated), never `1.`:
  // a single `2.` is the writer's 2, in the preview and in the PDF alike.
  const normalizedLists = markPageBreaks(withMathPlaceholders).replace(/^(\s*)([۰-۹٠-٩]+)([.)])\s+/gm, (_full, indent: string, number: string, punctuation: string) => `${indent}${latinDigits(number)}${punctuation} `);
  const { text: normalizedTables, origin } = ensureTableSeparators(normalizedLists);
  const tableAlignments = extractTableAlignments(normalizedTables);

  footnotes = { defs: collectFootnotes(normalizedTables), order: [], uses: new Map(), inline: 0 };
  const tokens = marked.lexer(normalizedTables);
  const sections: Array<{ html: string; token: Token; start: number; end: number }> = [];
  let line = 0;
  for (const token of tokens) {
    const start = line;
    line += newlines(token.raw);
    if (token.type === 'space') continue;
    const single = Object.assign([token], { links: tokens.links }) as TokensList;
    sections.push({ html: marked.parser(single), token, start, end: line });
  }
  const sourceLine = (transformed: number): number => origin[Math.min(transformed, origin.length - 1)] ?? transformed;
  const html = sections.map((section, index) => `<div class="md-section" data-sec="${index}">${section.html}</div>`).join('')
    + footnotesSectionHtml();

  let safe = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true }, ADD_ATTR: ['data-satr-math', 'data-sec', 'data-href', 'data-heading', 'data-src'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'svg', 'math'],
    FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload'],
  });
  math.forEach((rendered, index) => {
    safe = safe.replace(new RegExp(`<span data-satr-math="${index}"></span>`, 'g'), rendered)
      .replace(new RegExp(`<div data-satr-math="${index}"></div>`, 'g'), rendered);
  });
  const document = new DOMParser().parseFromString(safe, 'text/html');
  document.querySelectorAll<HTMLElement>('.md-section[data-sec]').forEach((element) => {
    const section = sections[Number(element.dataset.sec)];
    element.removeAttribute('data-sec');
    if (!section) return;
    const tag = (target: HTMLElement, from: number, to: number): void => {
      target.dataset.line = String(sourceLine(from));
      target.dataset.lines = String(Math.max(1, sourceLine(to) - sourceLine(from)));
    };
    const list = section.token.type === 'list' ? element.querySelector(':scope > ul, :scope > ol') : null;
    const items = list ? [...list.children].filter((child) => child.tagName === 'LI') as HTMLElement[] : [];
    const rawItems = section.token.type === 'list' ? (section.token as Token & { items: Array<{ raw: string }> }).items : [];
    if (list && items.length === rawItems.length) {
      let itemLine = section.start;
      items.forEach((item, index) => {
        const next = itemLine + newlines(rawItems[index].raw);
        tag(item, itemLine, index === items.length - 1 ? section.end : next);
        itemLine = next;
      });
    } else {
      tag(element, section.start, section.end);
    }
  });
  document.querySelectorAll('ol').forEach((list, index) => {
    if (orderedStyles[index] !== 'persian') return;
    list.classList.add('persian-ordered');
    // The list's own start is the writer's first number, not always one.
    const start = Number(list.getAttribute('start') ?? '1') || 1;
    list.querySelectorAll(':scope > li').forEach((item, itemIndex) => item.setAttribute('data-persian-number', toPersian(start + itemIndex)));
  });
  document.querySelectorAll('table').forEach((table, tableIndex) => {
    const firstRow = table.querySelector<HTMLTableRowElement>('thead tr');
    if (firstRow && [...firstRow.cells].every((cell) => !cell.textContent?.trim())) firstRow.remove();
    const alignments = tableAlignments[tableIndex] ?? [];
    table.querySelectorAll('tr').forEach((row) => row.querySelectorAll('th,td').forEach((cell, cellIndex) => {
      if (alignments[cellIndex]) cell.setAttribute('data-table-align', alignments[cellIndex]);
    }));
  });
  // Marked can leave bare prose beside a display formula. Give these
  // fragments their own direction just like an ordinary paragraph.
  document.querySelectorAll('.md-section').forEach((section) => {
    for (const child of [...section.childNodes]) {
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue;
      const span = document.createElement('span');
      span.className = 'md-prose-fragment';
      child.replaceWith(span); span.append(child);
    }
  });
  applyReadingDirections(document.body);
  return document.body.innerHTML;
}

// Page breaks, for the PDF (hidden on screen). Any of these, on its own line
// outside code: \pagebreak, \newpage, \clearpage, <!-- pagebreak -->,
// <!-- newpage -->, or HTML whose style asks for one (page-break-before /
// -after: always, break-before / -after: page), e.g.
// <div style="page-break-before: always"></div>. Each becomes an empty
// <div class="page-break">; HTML with content keeps its content, the break
// going before or after it. One line in, one line out (line numbers hold).
const PAGE_BREAK_LINE = /^\s{0,3}(?:\\(?:pagebreak|newpage|clearpage)|<!--\s*(?:page-?break|new-?page)\s*-->)\s*$/i;
const PAGE_BREAK_STYLE = /(page-break-|break-)(before|after)\s*:\s*(always|page|left|right)/i;
const PAGE_BREAK_DIV = '<div class="page-break"></div>';
function markPageBreaks(source: string): string {
  let fence: string | null = null;
  return source.split('\n').map((line) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      return line;
    }
    if (fence) return line;
    if (PAGE_BREAK_LINE.test(line)) return PAGE_BREAK_DIV;
    const style = /^\s{0,3}<[a-z][^>]*\bstyle\s*=\s*["']([^"']*)["'][^>]*>/i.exec(line);
    const wants = style ? PAGE_BREAK_STYLE.exec(style[1]) : null;
    if (!wants) return line;
    // An empty element is just the break; one with content keeps it.
    if (/^\s*<([a-z0-9]+)[^>]*>\s*(<\/\1>)?\s*$/i.test(line)) return PAGE_BREAK_DIV;
    return wants[2].toLowerCase() === 'before' ? `${PAGE_BREAK_DIV}${line.trimStart()}` : `${line}${PAGE_BREAK_DIV}`;
  }).join('\n');
}

function latinDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const persian = '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit);
    return String(persian >= 0 ? persian : '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
  });
}

function toPersian(number: number): string {
  return String(number).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

function extractTableAlignments(source: string): Array<Array<'left' | 'center' | 'right'>> {
  return source.split(/\r?\n/).filter((line) => {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    return cells.length >= 2 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
  }).map((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => {
    const value = cell.trim();
    if (value.startsWith(':') && value.endsWith(':')) return 'center';
    if (value.endsWith(':')) return 'right';
    if (value.startsWith(':')) return 'left';
    return 'center';
  }));
}

function ensureTableSeparators(source: string): { text: string; origin: number[] } {
  const lines = source.split(/\r?\n/);
  const output: string[] = [];
  // origin[k]: source line of output line k (inserted lines borrow a neighbour's).
  const origin: number[] = [];
  const emit = (text: string, from: number): void => { output.push(text); origin.push(from); };
  let inTableBody = false;
  const isSeparatorRow = (line: string): boolean => {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    return cells.length >= 2 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
  };
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    const currentCells = current.split('|').filter((cell) => cell.trim()).length;
    const nextCells = next?.split('|').filter((cell) => cell.trim()).length ?? 0;
    if (inTableBody) {
      if (current.includes('|') && currentCells >= 2) {
        emit(current, index);
        continue;
      }
      inTableBody = false;
    }
    const currentIsSeparator = isSeparatorRow(current);
    if (currentIsSeparator && next?.includes('|') && nextCells >= 2) {
      if (index === 0 || !lines[index - 1].includes('|')) {
        emit(`| ${Array.from({ length: currentCells }, () => ' ').join(' | ')} |`, index);
      }
      emit(current, index);
      inTableBody = true;
      continue;
    }
    const looksLikeTable = current.includes('|') && next?.includes('|') && currentCells >= 2 && nextCells >= 2;
    if (looksLikeTable && !isSeparatorRow(next!)) {
      emit(current, index);
      emit(`| ${Array.from({ length: currentCells }, () => '---').join(' | ')} |`, index);
      inTableBody = true;
      continue;
    }
    emit(current, index);
  }
  return { text: output.join('\n'), origin };
}
