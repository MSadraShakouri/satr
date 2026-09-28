// Right sidebar: outline and search in one view, laid out like the left
// sidebar (src/leftSidebar.ts) so both drawers read as one design:
// - Header: "Outline" (this note) or "Search" (all notes) in the drawer-title
//   style, the note's or space's name under it.
// - A pill search field and, under it, a two-option pill (This note /
//   All notes), switched by tapping; no swipe, which would fight the
//   drawer's own gesture.
// - This note: an empty field shows the outline (the heading you're reading
//   highlighted, tap to go there). Typing keeps the headings that match or
//   whose section has matches, with each match listed under its heading.
// - All notes: results grouped by note, each note's matches under its
//   headings the same way.
// - Every match shows its line number and up to seven lines of context.
// - The file tree's rows and spacing (16px, 8px 8px 8px 24px, guides,
//   collapsible branches) and the same floating button at the bottom
//   (collapse / expand all).
// Queries are regular expressions, ignoring case (src/searchRegex.ts).
import { headingsOfText, type Heading } from './outline';
import { isInvalidSearch, searchRegExp } from './searchRegex';
import { stem } from './vault';

export interface SidebarDeps {
  headings(): Heading[];
  /** Fractional source line at the top of the note area. */
  currentLine(): number;
  onHeading(line: number): void;
  /** All notes to search (the space); the open one with its live text. */
  notes(): Promise<{ path: string; text: string }[]>;
  currentPath(): string;
  currentText(): string;
  /** Name of the space (or "All files"), for the header. */
  scopeName(): string;
  onResult(path: string, from: number, to: number): void;
}
export type SearchScope = 'note' | 'all';

const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  chevron: icon('<path d="m6 9 6 6 6-6"/>'),
  collapseAll: icon('<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>'),
  expandAll: icon('<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>'),
};
const SCOPE_KEY = 'satr:search-scope';
const MAX_PER_NOTE = 100;
const MAX_TOTAL = 1000;

interface Hit { from: number; to: number }

export function createRightSidebar(root: HTMLElement, deps: SidebarDeps) {
  root.innerHTML = `
    <div class="workspace-drawer-inner">
      <div class="workspace-drawer-header">
        <div class="workspace-drawer-header-left">
          <div class="workspace-drawer-vault-switcher"><span class="workspace-drawer-vault-name drawer-view-name"></span></div>
          <div class="workspace-drawer-header-info drawer-note-name" dir="auto"></div>
        </div>
      </div>
      <div class="search-input-container">${ICONS.search}<input type="search" class="vault-search" dir="auto" placeholder="Search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></div>
      <div class="segmented-control search-scope" role="radiogroup" aria-label="Search in">
        <div class="segmented-control-thumb"></div>
        <button type="button" class="segmented-control-option" data-scope="note" role="radio">This note</button>
        <button type="button" class="segmented-control-option" data-scope="all" role="radio">All notes</button>
      </div>
      <div class="search-summary"></div>
      <div class="nav-files-container search-results outline-tree" role="tree"></div>
      <div class="nav-buttons-container">
        <button type="button" class="clickable-icon nav-action-button" data-act="collapse" aria-label="Collapse all">${ICONS.collapseAll}</button>
      </div>
    </div>`;
  const input = root.querySelector<HTMLInputElement>('.vault-search')!;
  const summary = root.querySelector<HTMLElement>('.search-summary')!;
  const list = root.querySelector<HTMLElement>('.search-results')!;
  const viewName = root.querySelector<HTMLElement>('.drawer-view-name')!;
  const noteName = root.querySelector<HTMLElement>('.drawer-note-name')!;
  const segmented = root.querySelector<HTMLElement>('.search-scope')!;
  const collapseButton = root.querySelector<HTMLButtonElement>('[data-act="collapse"]')!;
  let scope: SearchScope = localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'note';
  const collapsed = new Set<string>(); // closed branches: "h:<line>" or "n:<path>"
  let headings: Heading[] = [];

  function renderChrome(): void {
    viewName.textContent = scope === 'note' ? 'Outline' : 'Search';
    noteName.textContent = scope === 'note' ? stem(deps.currentPath()) : deps.scopeName();
    segmented.dataset.value = scope;
    segmented.style.setProperty('--index', scope === 'all' ? '1' : '0');
    segmented.querySelectorAll<HTMLElement>('[data-scope]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scope === scope)));
    input.placeholder = scope === 'note' ? 'Search this note' : 'Search all notes';
    const any = [...list.querySelectorAll<HTMLElement>('.tree-item[data-key]')].some((el) => collapsed.has(el.dataset.key!));
    collapseButton.innerHTML = any ? ICONS.expandAll : ICONS.collapseAll;
    collapseButton.setAttribute('aria-label', any ? 'Expand all' : 'Collapse all');
    collapseButton.hidden = !list.querySelector('.tree-item-children, .search-result-file-matches');
  }

  function snippet(text: string, from: number, to: number): string {
    const lineStart = text.lastIndexOf('\n', from - 1) + 1;
    let lineEnd = text.indexOf('\n', to);
    if (lineEnd < 0) lineEnd = text.length;
    const start = Math.max(lineStart, from - 100);
    const end = Math.min(lineEnd, to + 200);
    const cutStart = start > lineStart ? text.indexOf(' ', start) + 1 || start : start;
    return `${cutStart > lineStart ? '…' : ''}${escapeHtml(text.slice(cutStart, from).trimStart())}`
      + `<span class="search-result-file-matched-text">${escapeHtml(text.slice(from, to))}</span>`
      + `${escapeHtml(text.slice(to, end))}${end < lineEnd ? '…' : ''}`;
  }
  function findHits(re: RegExp, text: string, limit: number): Hit[] {
    const hits: Hit[] = [];
    re.lastIndex = 0;
    for (let m = re.exec(text); m && hits.length < limit; m = re.exec(text)) {
      if (m[0].length === 0) { re.lastIndex += 1; continue; }
      hits.push({ from: m.index, to: m.index + m[0].length });
    }
    return hits;
  }
  // 1-based line of each hit, counted in one pass over the text.
  function lineNumbers(text: string, hits: Hit[]): number[] {
    const out: number[] = [];
    let line = 1;
    let pos = 0;
    for (const hit of hits) {
      for (let i = text.indexOf('\n', pos); i >= 0 && i < hit.from; i = text.indexOf('\n', i + 1)) { line += 1; pos = i + 1; }
      out.push(line);
    }
    return out;
  }
  const RTL_FIRST = /^[^A-Za-z\u00C0-\u024F\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]*[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  function hitRows(path: string, text: string, hits: Hit[]): string {
    if (!hits.length) return '';
    const lines = lineNumbers(text, hits);
    return `<div class="search-result-file-matches">${hits.map((h, i) => {
      const lineStart = text.lastIndexOf('\n', h.from - 1) + 1;
      const dir = RTL_FIRST.test(text.slice(lineStart, lineStart + 200)) ? 'rtl' : 'ltr';
      return `<div class="search-result-file-match" data-path="${escapeHtml(path)}" data-from="${h.from}" data-to="${h.to}" dir="${dir}">`
        + `<span class="search-result-line-number">${lines[i]}</span><span class="search-result-text">${snippet(text, h.from, h.to)}</span></div>`;
    }).join('')}</div>`;
  }

  // ---- A note's headings as a tree, each hit under its section ----
  // `prefix` keeps collapse keys apart between notes in the all-notes view.
  function headingTree(path: string, text: string, headings: Heading[], re: RegExp | null, hits: Hit[], prefix: string): string {
    // Each hit belongs to the section of the last heading before it.
    const own: Hit[][] = headings.map(() => []);
    const preface: Hit[] = [];
    let h = -1;
    for (const hit of hits) {
      while (h + 1 < headings.length && headings[h + 1].from <= hit.from) h += 1;
      (h < 0 ? preface : own[h]).push(hit);
    }
    // Keep matching headings, headings with matches, and their parents.
    const keep = headings.map((heading, i) => !re || own[i].length > 0 || (re.lastIndex = 0, re.test(heading.text)));
    if (re) {
      const stack: number[] = [];
      headings.forEach((heading, i) => {
        while (stack.length && headings[stack[stack.length - 1]].level >= heading.level) stack.pop();
        if (keep[i]) for (const a of stack) keep[a] = true;
        stack.push(i);
      });
    }
    let html = re ? hitRows(path, text, preface) : '';
    const open: number[] = [];
    headings.forEach((heading, i) => {
      if (!keep[i]) return;
      while (open.length && open[open.length - 1] >= heading.level) { html += '</div></div>'; open.pop(); }
      let hasChildren = own[i].length > 0;
      for (let j = i + 1; j < headings.length && headings[j].level > heading.level; j += 1) if (keep[j]) { hasChildren = true; break; }
      const key = `${prefix}h:${heading.line}`;
      let label = escapeHtml(heading.text);
      if (re) label = label.replace(new RegExp(re.source, 'gi'), (m) => (m ? `<span class="search-result-file-matched-text">${m}</span>` : m));
      html += `<div class="tree-item${collapsed.has(key) ? ' is-collapsed' : ''}" data-key="${escapeHtml(key)}">`
        + `<div class="tree-item-self is-clickable" data-path="${escapeHtml(path)}" data-line="${heading.line}" data-from="${heading.from}" dir="auto">`
        + (hasChildren ? `<span class="tree-item-icon collapse-icon" data-toggle="${escapeHtml(key)}">${ICONS.chevron}</span>` : '')
        + `<span class="tree-item-inner">${label}</span>`
        + (own[i].length ? `<span class="tree-item-flair">${own[i].length}</span>` : '')
        + `</div><div class="tree-item-children">${hitRows(path, text, own[i])}`;
      open.push(heading.level);
    });
    while (open.pop() !== undefined) html += '</div></div>';
    return html;
  }

  // ---- This note: the outline, filtered by the query ----
  function renderNote(re: RegExp | null): void {
    headings = deps.headings();
    const hits = re ? findHits(re, deps.currentText(), MAX_TOTAL) : [];
    let html = headingTree(deps.currentPath(), deps.currentText(), headings, re, hits, '');
    if (!html) html = `<div class="pane-empty">${re ? 'No results' : 'No headings in this note'}</div>`;
    list.innerHTML = html;
    summary.textContent = re ? (hits.length ? `${hits.length}${hits.length >= MAX_TOTAL ? '+' : ''} result${hits.length === 1 ? '' : 's'}` : '') : '';
    markCurrent();
  }

  // ---- All notes ----
  let run = 0;
  async function renderAll(re: RegExp | null): Promise<void> {
    const mine = ++run;
    if (!re) {
      summary.textContent = '';
      list.innerHTML = `<div class="pane-empty">Search every note in ${escapeHtml(deps.scopeName())}</div>`;
      return;
    }
    const current = deps.currentPath();
    const notes = await deps.notes();
    if (mine !== run) return; // a newer search started meanwhile
    notes.sort((a, b) => (a.path === current ? -1 : b.path === current ? 1 : stem(a.path).localeCompare(stem(b.path))));
    let total = 0;
    let files = 0;
    let capped = false;
    let html = '';
    for (const note of notes) {
      if (total >= MAX_TOTAL) break;
      const hits = findHits(re, note.text, Math.min(MAX_PER_NOTE, MAX_TOTAL - total));
      if (!hits.length) continue;
      if (hits.length >= MAX_PER_NOTE || total + hits.length >= MAX_TOTAL) capped = true;
      files += 1;
      total += hits.length;
      const key = `n:${note.path}`;
      html += `<div class="tree-item search-result${collapsed.has(key) ? ' is-collapsed' : ''}" data-key="${escapeHtml(key)}">`
        + `<div class="search-result-file-title tree-item-self is-clickable" data-note="${escapeHtml(note.path)}" data-toggle="${escapeHtml(key)}">`
        + `<span class="tree-item-icon collapse-icon">${ICONS.chevron}</span>`
        + `<span class="tree-item-inner" dir="auto">${escapeHtml(stem(note.path))}</span><span class="tree-item-flair">${hits.length}${hits.length >= MAX_PER_NOTE ? '+' : ''}</span></div>`
        + `<div class="tree-item-children">${headingTree(note.path, note.text, note.path === current ? deps.headings() : headingsOfText(note.text), re, hits, `${note.path}|`)}</div></div>`;
    }
    summary.textContent = total ? `${total}${capped ? '+' : ''} result${total === 1 ? '' : 's'} in ${files} note${files === 1 ? '' : 's'}` : '';
    list.innerHTML = html || '<div class="pane-empty">No results</div>';
    renderChrome();
  }

  function render(): void {
    const query = input.value;
    const re = searchRegExp(query);
    const invalid = isInvalidSearch(query);
    input.classList.toggle('mod-no-match', invalid);
    renderChrome();
    if (invalid) {
      run += 1;
      summary.textContent = 'Invalid regular expression';
      list.innerHTML = '';
    } else if (scope === 'note') { run += 1; renderNote(re); }
    else void renderAll(re);
    renderChrome();
  }
  function markCurrent(): void {
    if (scope !== 'note' || !headings.length) return;
    const line = deps.currentLine();
    let current = -1;
    for (const h of headings) { if (h.line <= line + 0.5) current = h.line; else break; }
    for (const el of list.querySelectorAll<HTMLElement>('.tree-item-self[data-line]')) {
      el.classList.toggle('is-active', Number(el.dataset.line) === current);
    }
  }
  function setScope(next: SearchScope): void {
    if (next === scope) return;
    scope = next;
    localStorage.setItem(SCOPE_KEY, scope);
    render();
  }

  let timer: number | undefined;
  input.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(render, scope === 'note' ? 60 : 180); });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); window.clearTimeout(timer); render(); input.blur(); } });
  segmented.addEventListener('click', (event) => {
    const option = (event.target as HTMLElement).closest<HTMLElement>('[data-scope]');
    if (option) setScope(option.dataset.scope as SearchScope);
  });
  list.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const match = target.closest<HTMLElement>('.search-result-file-match');
    if (match) { deps.onResult(match.dataset.path!, Number(match.dataset.from), Number(match.dataset.to)); return; }
    const toggle = target.closest<HTMLElement>('[data-toggle]');
    if (toggle) {
      const key = toggle.dataset.toggle!;
      if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
      toggle.closest('.tree-item')?.classList.toggle('is-collapsed', collapsed.has(key));
      renderChrome();
      return;
    }
    const item = target.closest<HTMLElement>('.tree-item-self[data-line]');
    if (!item) return;
    if (item.dataset.path === deps.currentPath()) deps.onHeading(Number(item.dataset.line));
    else deps.onResult(item.dataset.path!, Number(item.dataset.from), Number(item.dataset.from));
  });
  collapseButton.addEventListener('click', () => {
    const items = [...list.querySelectorAll<HTMLElement>('.tree-item[data-key]')]
      .filter((el) => el.querySelector(':scope > .tree-item-children > *, :scope > .search-result-file-matches'));
    const any = items.some((el) => collapsed.has(el.dataset.key!));
    for (const el of items) {
      if (any) collapsed.delete(el.dataset.key!); else collapsed.add(el.dataset.key!);
      el.classList.toggle('is-collapsed', !any);
    }
    renderChrome();
  });
  render();

  return {
    /** Refresh for the current note (on open, after edits). */
    refresh(): void { if (scope === 'note' || input.value) render(); else renderChrome(); },
    markCurrent,
    setScope,
    focusSearch(next: SearchScope = scope): void { setScope(next); input.focus(); input.select(); },
    get scope() { return scope; },
  };
}
