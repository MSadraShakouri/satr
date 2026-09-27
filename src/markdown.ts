import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { renderMath } from './math';
import type { Token, TokensList } from 'marked';
import hljs from 'highlight.js/lib/common';

marked.setOptions({ gfm: true, breaks: false });
marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      if (lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(text, { language: lang }).value;
        return `<pre><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre>`;
      }
      return `<pre><code>${escapeHtml(text)}</code></pre>`;
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
  const html = sections.map((section, index) => `<div class="md-section" data-sec="${index}">${section.html}</div>`).join('');

  let safe = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true }, ADD_ATTR: ['data-satr-math', 'data-sec'],
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
