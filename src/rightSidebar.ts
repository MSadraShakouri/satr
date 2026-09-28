// Right sidebar, after Obsidian's right drawer — only two views here:
// - Outline: the note's headings as a tree (indentation guides, collapsible
//   branches), a filter field that keeps matching headings and their
//   parents, the heading you are reading highlighted; tap to go there.
// - Search: full-text search in this note or in all notes, results grouped
//   by note with the matched text highlighted in a line of context, like
//   Obsidian's search view; tap a result to open the note at that match.
//   Options: match case, regular expression.
import type { Heading } from './outline';

export interface SidebarDeps {
  headings(): Heading[];
  /** Fractional source line at the top of the note area. */
  currentLine(): number;
  onHeading(line: number): void;
  /** All notes to search; the open one with its live text. */
  notes(): { base: string; text: string }[];
  currentBase(): string;
  onResult(base: string, from: number, to: number): void;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  outline: icon('<path d="M21 6H8M21 12H11M21 18H11M3 6h1M6 12h1M6 18h1"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  chevron: icon('<path d="m6 9 6 6 6-6"/>'),
};
const MAX_PER_NOTE = 100;
const MAX_TOTAL = 1000;

export function createRightSidebar(root: HTMLElement, deps: SidebarDeps) {
  root.innerHTML = `
    <div class="workspace-drawer-tabs" role="tablist">
      <button type="button" class="workspace-drawer-tab is-active" data-tab="outline" role="tab" aria-label="Outline">${ICONS.outline}</button>
      <button type="button" class="workspace-drawer-tab" data-tab="search" role="tab" aria-label="Search">${ICONS.search}</button>
    </div>
    <section class="drawer-view is-active" data-view="outline">
      <div class="drawer-view-title">Outline</div>
      <div class="search-input-container">${ICONS.search}<input type="search" class="outline-filter" dir="auto" placeholder="Filter headings" autocomplete="off" spellcheck="false"></div>
      <div class="outline-tree"></div>
    </section>
    <section class="drawer-view" data-view="search">
      <div class="drawer-view-title">Search</div>
      <div class="search-input-container">${ICONS.search}<input type="search" class="vault-search" dir="auto" placeholder="Search" enterkeyhint="search" autocomplete="off" spellcheck="false"></div>
      <div class="search-options">
        <div class="search-scope" role="radiogroup" aria-label="Search in">
          <button type="button" class="search-chip" data-scope="note" role="radio" aria-checked="false">This note</button>
          <button type="button" class="search-chip" data-scope="all" role="radio" aria-checked="true">All notes</button>
        </div>
        <button type="button" class="search-chip search-toggle" data-opt="caseSensitive" aria-pressed="false" title="Match case">Aa</button>
        <button type="button" class="search-chip search-toggle" data-opt="regexp" aria-pressed="false" title="Regular expression">.*</button>
      </div>
      <div class="search-summary"></div>
      <div class="search-results"></div>
    </section>`;
  const outlineTree = root.querySelector<HTMLElement>('.outline-tree')!;
  const filter = root.querySelector<HTMLInputElement>('.outline-filter')!;
  const searchInput = root.querySelector<HTMLInputElement>('.vault-search')!;
  const summary = root.querySelector<HTMLElement>('.search-summary')!;
  const results = root.querySelector<HTMLElement>('.search-results')!;
  const options = { caseSensitive: false, regexp: false, scope: 'all' as 'all' | 'note' };
  let tab: 'outline' | 'search' = 'outline';
  const collapsed = new Set<number>(); // outline branches closed by the user (by line)
  const collapsedNotes = new Set<string>();

  // ---- Outline ----
  let headings: Heading[] = [];
  function renderOutline(): void {
    headings = deps.headings();
    const query = filter.value.trim().toLocaleLowerCase();
    // Keep matching headings plus their ancestors.
    const keep = new Array<boolean>(headings.length).fill(!query);
    if (query) {
      const stack: number[] = [];
      headings.forEach((h, i) => {
        while (stack.length && headings[stack[stack.length - 1]].level >= h.level) stack.pop();
        if (h.text.toLocaleLowerCase().includes(query)) { keep[i] = true; for (const a of stack) keep[a] = true; }
        stack.push(i);
      });
    }
    if (!headings.length) {
      outlineTree.innerHTML = '<div class="pane-empty">No headings in this note.</div>';
      return;
    }
    let html = '';
    const open: number[] = []; // levels of open .tree-item elements
    headings.forEach((h, i) => {
      if (!keep[i]) return;
      while (open.length && open[open.length - 1] >= h.level) { html += '</div></div>'; open.pop(); }
      const next = headings[i + 1];
      const hasChildren = next !== undefined && next.level > h.level;
      const isCollapsed = !query && collapsed.has(h.line);
      html += `<div class="tree-item${isCollapsed ? ' is-collapsed' : ''}" data-line="${h.line}">`
        + `<div class="tree-item-self is-clickable" data-line="${h.line}" dir="auto">`
        + (hasChildren ? `<span class="tree-item-icon collapse-icon" data-toggle="${h.line}">${ICONS.chevron}</span>` : '')
        + `<span class="tree-item-inner">${escapeHtml(h.text)}</span></div><div class="tree-item-children">`;
      open.push(h.level);
    });
    while (open.pop() !== undefined) html += '</div></div>';
    outlineTree.innerHTML = html || '<div class="pane-empty">No matching headings.</div>';
    markCurrent();
  }
  function markCurrent(): void {
    if (tab !== 'outline' || !headings.length) return;
    const line = deps.currentLine();
    let current = -1;
    for (const h of headings) { if (h.line <= line + 0.5) current = h.line; else break; }
    for (const el of outlineTree.querySelectorAll<HTMLElement>('.tree-item-self')) {
      el.classList.toggle('is-active', Number(el.dataset.line) === current);
    }
  }
  filter.addEventListener('input', renderOutline);
  outlineTree.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const toggle = target.closest<HTMLElement>('[data-toggle]');
    if (toggle) {
      const line = Number(toggle.dataset.toggle);
      if (collapsed.has(line)) collapsed.delete(line); else collapsed.add(line);
      toggle.closest('.tree-item')?.classList.toggle('is-collapsed', collapsed.has(line));
      return;
    }
    const item = target.closest<HTMLElement>('.tree-item-self');
    if (item) deps.onHeading(Number(item.dataset.line));
  });

  // ---- Search ----
  let searchTimer: number | undefined;
  function buildRegExp(): RegExp | null {
    const text = searchInput.value;
    if (!text) return null;
    try {
      return new RegExp(options.regexp ? text : escapeRegExp(text), options.caseSensitive ? 'gu' : 'giu');
    } catch {
      return null;
    }
  }
  function snippet(text: string, from: number, to: number): string {
    const lineStart = text.lastIndexOf('\n', from - 1) + 1;
    let lineEnd = text.indexOf('\n', to);
    if (lineEnd < 0) lineEnd = text.length;
    const start = Math.max(lineStart, from - 40);
    const end = Math.min(lineEnd, to + 80);
    const cutStart = start > lineStart ? text.indexOf(' ', start) + 1 || start : start;
    return `${cutStart > lineStart ? '…' : ''}${escapeHtml(text.slice(cutStart, from).trimStart())}`
      + `<span class="search-result-file-matched-text">${escapeHtml(text.slice(from, to))}</span>`
      + `${escapeHtml(text.slice(to, end))}${end < lineEnd ? '…' : ''}`;
  }
  function runSearch(): void {
    window.clearTimeout(searchTimer);
    const re = buildRegExp();
    searchInput.classList.toggle('mod-no-match', Boolean(searchInput.value) && !re);
    if (!re) { summary.textContent = ''; results.innerHTML = ''; return; }
    const current = deps.currentBase();
    const notes = deps.notes().filter((n) => options.scope === 'all' || n.base === current);
    // The open note first, then by name.
    notes.sort((a, b) => (a.base === current ? -1 : b.base === current ? 1 : a.base.localeCompare(b.base)));
    let total = 0;
    let files = 0;
    let capped = false;
    let html = '';
    for (const note of notes) {
      if (total >= MAX_TOTAL) break;
      const matches: string[] = [];
      re.lastIndex = 0;
      for (let m = re.exec(note.text); m; m = re.exec(note.text)) {
        if (m[0].length === 0) { re.lastIndex += 1; continue; }
        matches.push(`<div class="search-result-file-match" data-base="${escapeHtml(note.base)}" data-from="${m.index}" data-to="${m.index + m[0].length}" dir="auto">${snippet(note.text, m.index, m.index + m[0].length)}</div>`);
        if (matches.length >= MAX_PER_NOTE || total + matches.length >= MAX_TOTAL) break;
      }
      if (!matches.length) continue;
      if (matches.length >= MAX_PER_NOTE || total + matches.length >= MAX_TOTAL) capped = true;
      files += 1;
      total += matches.length;
      const isCollapsed = collapsedNotes.has(note.base);
      html += `<div class="search-result${isCollapsed ? ' is-collapsed' : ''}">`
        + `<div class="search-result-file-title tree-item-self is-clickable" data-note="${escapeHtml(note.base)}">`
        + `<span class="tree-item-icon collapse-icon">${ICONS.chevron}</span>`
        + `<span class="tree-item-inner">${escapeHtml(note.base)}</span><span class="tree-item-flair">${matches.length}${matches.length >= MAX_PER_NOTE ? '+' : ''}</span></div>`
        + `<div class="search-result-file-matches">${matches.join('')}</div></div>`;
    }
    summary.textContent = total ? `${total}${capped ? '+' : ''} result${total === 1 ? '' : 's'}${options.scope === 'all' ? ` in ${files} note${files === 1 ? '' : 's'}` : ''}` : 'No results';
    results.innerHTML = html;
  }
  const searchSoon = (): void => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(runSearch, 180); };
  searchInput.addEventListener('input', searchSoon);
  searchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); runSearch(); searchInput.blur(); } });
  root.querySelector('.search-options')!.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.scope) {
      options.scope = button.dataset.scope as 'all' | 'note';
      root.querySelectorAll<HTMLElement>('[data-scope]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scope === options.scope)));
    } else if (button.dataset.opt) {
      const key = button.dataset.opt as 'caseSensitive' | 'regexp';
      options[key] = !options[key];
      button.setAttribute('aria-pressed', String(options[key]));
    }
    runSearch();
  });
  results.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const title = target.closest<HTMLElement>('.search-result-file-title');
    if (title) {
      const base = title.dataset.note!;
      if (collapsedNotes.has(base)) collapsedNotes.delete(base); else collapsedNotes.add(base);
      title.parentElement!.classList.toggle('is-collapsed', collapsedNotes.has(base));
      return;
    }
    const match = target.closest<HTMLElement>('.search-result-file-match');
    if (match) deps.onResult(match.dataset.base!, Number(match.dataset.from), Number(match.dataset.to));
  });

  // ---- Tabs ----
  function setTab(next: 'outline' | 'search'): void {
    tab = next;
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === next));
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((v) => v.classList.toggle('is-active', v.dataset.view === next));
    if (next === 'outline') renderOutline(); else if (searchInput.value) runSearch();
  }
  root.querySelector('.workspace-drawer-tabs')!.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
    if (button) setTab(button.dataset.tab as 'outline' | 'search');
  });

  return {
    /** Refresh for the current note (on open). */
    refresh(): void { if (tab === 'outline') renderOutline(); else if (searchInput.value) runSearch(); },
    markCurrent,
    setTab,
    focusSearch(): void { setTab('search'); searchInput.focus(); searchInput.select(); },
    get tab() { return tab; },
  };
}
