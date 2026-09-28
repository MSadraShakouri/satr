import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { renderMath } from './math';
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
// Images aren't shown inline: ![alt](src) becomes a tappable link.
const WIKI = /^(!?)\[\[([^\[\]|#\n]*)(?:#([^\[\]|\n]*))?(?:\|([^\[\]\n]*))?\]\]/;
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
      if (embed && isImagePath(target)) {
        return `<a class="image-link" data-src="${escapeHtml(target)}"><span>${escapeHtml(alias || target.split('/').pop() || target)}</span></a>`;
      }
      const shown = alias || (heading ? (target ? `${target} › ${heading}` : heading) : target);
      return `<a class="internal-link${embed ? ' mod-embed' : ''}" data-href="${escapeHtml(target)}" data-heading="${escapeHtml(heading)}">${escapeHtml(shown)}</a>`;
    },
  }],
  renderer: {
    image({ href, text }: { href: string; text: string }): string {
      const name = text || decodeURIComponent(href.split(/[?#]/)[0].split('/').pop() || href);
      return `<a class="image-link" data-src="${escapeHtml(href)}"><span>${escapeHtml(name)}</span></a>`;
    },
  },
});

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));

const newlines = (text: string): number => text.split('\n').length - 1;

// The preview is rendered in sections, one per top-level markdown block, each
// tagged with the source lines it came from (data-line / data-lines) — the
// same model as Obsidian's reading view. Lists are tagged per item. Editor and
// preview scroll positions are exchanged as a fractional source line (see
// src/scrollSync.ts). Every transform before lexing keeps line numbers,
// except table-separator insertion, which reports where its lines came from.
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
  const normalizedLists = withoutFrontMatter.replace(/^(\s*)([۰-۹٠-٩]+)([.)])\s+/gm, (_full, indent: string, _number: string, punctuation: string) => `${indent}1${punctuation} `);
  const { text: normalizedTables, origin } = ensureTableSeparators(normalizedLists);
  const tableAlignments = extractTableAlignments(normalizedTables);
  const math: string[] = [];
  const withMathPlaceholders = normalizedTables.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (full: string, display: string | undefined, inline: string | undefined) => {
    const id = math.push(renderMath(display ?? inline ?? '', Boolean(display))) - 1;
    // Keep the newlines the formula spanned, so later lines keep their numbers.
    return display ? `<div data-satr-math="${id}"></div>${'\n'.repeat(newlines(full))}` : `<span data-satr-math="${id}"></span>`;
  });

  footnotes = { defs: collectFootnotes(withMathPlaceholders), order: [], uses: new Map(), inline: 0 };
  const tokens = marked.lexer(withMathPlaceholders);
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
  document.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th').forEach((element) => element.setAttribute('dir', 'auto'));
  // dir=auto ignores descendants that carry their own dir (the <p>s inside),
  // so a quote would always resolve to LTR; give it the direction of its
  // first strong character instead, which puts the rule on the right side.
  document.querySelectorAll('blockquote').forEach((quote) => {
    const strong = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]|[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.exec(quote.textContent ?? '');
    quote.setAttribute('dir', strong && /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(strong[0]) ? 'rtl' : 'ltr');
  });
  document.querySelectorAll('ol').forEach((list, index) => {
    if (orderedStyles[index] !== 'persian') return;
    list.classList.add('persian-ordered');
    list.querySelectorAll(':scope > li').forEach((item, itemIndex) => item.setAttribute('data-persian-number', toPersian(itemIndex + 1)));
  });
  document.querySelectorAll('table').forEach((table, tableIndex) => {
    const firstRow = table.querySelector<HTMLTableRowElement>('thead tr');
    if (firstRow && [...firstRow.cells].every((cell) => !cell.textContent?.trim())) firstRow.remove();
    const alignments = tableAlignments[tableIndex] ?? [];
    table.querySelectorAll('tr').forEach((row) => row.querySelectorAll('th,td').forEach((cell, cellIndex) => {
      if (alignments[cellIndex]) cell.setAttribute('data-table-align', alignments[cellIndex]);
    }));
  });
  return document.body.innerHTML;
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
