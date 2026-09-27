import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
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

export function renderMarkdown(source: string): string {
  const withoutFrontMatter = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const math: string[] = [];
  const orderedStyles: Array<'persian' | 'latin'> = [];
  let previousWasOrdered = false;
  withoutFrontMatter.split(/\r?\n/).forEach((line) => {
    const marker = /^\s*([0-9۰-۹٠-٩]+)[.)]\s+/.exec(line);
    if (marker && !previousWasOrdered) orderedStyles.push(/[۰-۹٠-٩]/.test(marker[1]) ? 'persian' : 'latin');
    previousWasOrdered = Boolean(marker);
  });
  const normalizedLists = withoutFrontMatter.replace(/^(\s*)([۰-۹٠-٩]+)([.)])\s+/gm, (_full, indent: string, number: string, punctuation: string) => `${indent}1${punctuation} `);
  const normalizedTables = ensureTableSeparators(normalizedLists);
  const tableAlignments = extractTableAlignments(normalizedTables);
  const withMathPlaceholders = normalizedTables.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (_full, display: string | undefined, inline: string | undefined) => {
    const value = (display ?? inline ?? '').replace(/(?<!\\) /g, '\\ ');
    const id = math.push(katex.renderToString(value, { displayMode: Boolean(display), throwOnError: false })) - 1;
    return display ? `<div data-satr-math="${id}"></div>` : `<span data-satr-math="${id}"></span>`;
  });
  const html = marked.parse(withMathPlaceholders) as string;
  let safe = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true }, ADD_ATTR: ['data-satr-math'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'svg', 'math'],
    FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload'],
  });
  math.forEach((rendered, index) => {
    safe = safe.replace(new RegExp(`<span data-satr-math="${index}"></span>`, 'g'), rendered)
      .replace(new RegExp(`<div data-satr-math="${index}"></div>`, 'g'), rendered);
  });
  const document = new DOMParser().parseFromString(safe, 'text/html');
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

function ensureTableSeparators(source: string): string {
  const lines = source.split(/\r?\n/);
  const output: string[] = [];
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
        output.push(current);
        continue;
      }
      inTableBody = false;
    }
    const currentIsSeparator = isSeparatorRow(current);
    if (currentIsSeparator && next?.includes('|') && nextCells >= 2) {
      if (index === 0 || !lines[index - 1].includes('|')) {
        output.push(`| ${Array.from({ length: currentCells }, () => ' ').join(' | ')} |`);
      }
      output.push(current);
      inTableBody = true;
      continue;
    }
    const looksLikeTable = current.includes('|') && next?.includes('|') && currentCells >= 2 && nextCells >= 2;
    if (looksLikeTable && !isSeparatorRow(next!)) {
      output.push(current);
      output.push(`| ${Array.from({ length: currentCells }, () => '---').join(' | ')} |`);
      inTableBody = true;
      continue;
    }
    output.push(current);
  }
  return output.join('\n');
}
