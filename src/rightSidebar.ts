// Right sidebar: outline and search, laid out exactly like the left one
// (src/leftSidebar.ts) so both drawers read as one design:
// - Header: the view's name in the drawer-title style with a chevron (tap:
//   choose the view, like the space switcher), the note's name under it,
//   and a 44px icon on the side that jumps to the other view.
// - A pill search field, then the list with the file tree's spacing and
//   rows (16px, 8px 8px 8px 24px, indentation guides, collapsible branches).
// - The same floating row of buttons at the bottom (collapse / expand all).
// Outline: the note's headings; the filter keeps matches and their parents;
// the heading you are reading is highlighted; tap to go there.
// Search: the note or the whole space, plain text ignoring case with * and
// ? wildcards (src/glob.ts); results grouped by note with the match in a
// line of context; tap to open the note there.
import { globRegExp } from './glob';
import { openMenu } from './menu';
import type { Heading } from './outline';
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
  onResult(path: string, from: number, to: number): void;
}
type View = 'outline' | 'search';

const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  outline: icon('<path d="M21 6H8M21 12H11M21 18H11M3 6h1M6 12h1M6 18h1"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  chevron: icon('<path d="m6 9 6 6 6-6"/>'),
  collapseAll: icon('<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>'),
  expandAll: icon('<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>'),
};
const TITLES: Record<View, string> = { outline: 'Outline', search: 'Search' };
const MAX_PER_NOTE = 100;
const MAX_TOTAL = 1000;

export function createRightSidebar(root: HTMLElement, deps: SidebarDeps) {
  root.innerHTML = `
    <div class="workspace-drawer-inner">
      <div class="workspace-drawer-header">
        <div class="workspace-drawer-header-left">
          <button type="button" class="workspace-drawer-vault-switcher" aria-haspopup="menu">
            <span class="workspace-drawer-vault-name drawer-view-name"></span>
            <span class="workspace-drawer-vault-switcher-icon">${ICONS.chevron}</span>
          </button>
          <div class="workspace-drawer-header-info drawer-note-name" dir="auto"></div>
        </div>
        <div class="workspace-drawer-header-icons">
          <button type="button" class="clickable-icon workspace-drawer-header-icon drawer-other-view"></button>
        </div>
      </div>
      <section class="drawer-view is-active" data-view="outline">
        <div class="search-input-container">${ICONS.search}<input type="search" class="outline-filter" dir="auto" placeholder="Filter headings" autocomplete="off" autocorrect="off" spellcheck="false"></div>
        <div class="nav-files-container outline-tree" role="tree"></div>
      </section>
      <section class="drawer-view" data-view="search">
        <div class="search-input-container">${ICONS.search}<input type="search" class="vault-search" dir="auto" placeholder="Search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false"></div>
        <div class="search-options">
          <div class="search-scope" role="radiogroup" aria-label="Search in">
            <button type="button" class="search-chip" data-scope="note" role="radio" aria-checked="false">This note</button>
            <button type="button" class="search-chip" data-scope="all" role="radio" aria-checked="true">This space</button>
          </div>
          <div class="search-summary"></div>
        </div>
        <div class="nav-files-container search-results"></div>
      </section>
      <div class="nav-buttons-container">
        <button type="button" class="clickable-icon nav-action-button" data-act="collapse" aria-label="Collapse all">${ICONS.collapseAll}</button>
      </div>
    </div>`;
  const outlineTree = root.querySelector<HTMLElement>('.outline-tree')!;
  const filter = root.querySelector<HTMLInputElement>('.outline-filter')!;
  const searchInput = root.querySelector<HTMLInputElement>('.vault-search')!;
  const summary = root.querySelector<HTMLElement>('.search-summary')!;
  const results = root.querySelector<HTMLElement>('.search-results')!;
  const viewName = root.querySelector<HTMLElement>('.drawer-view-name')!;
  const noteName = root.querySelector<HTMLElement>('.drawer-note-name')!;
  const otherView = root.querySelector<HTMLButtonElement>('.drawer-other-view')!;
  const collapseButton = root.querySelector<HTMLButtonElement>('[data-act="collapse"]')!;
  let scope: 'all' | 'note' = 'all';
  let tab: View = 'outline';
  const collapsed = new Set<number>(); // outline branches closed by the user (by line)
  const collapsedNotes = new Set<string>();

  function renderChrome(): void {
    viewName.textContent = TITLES[tab];
    noteName.textContent = stem(deps.currentPath());
    const other: View = tab === 'outline' ? 'search' : 'outline';
    otherView.innerHTML = ICONS[other];
    otherView.dataset.tab = other;
    otherView.setAttribute('aria-label', TITLES[other]);
    const any = tab === 'outline' ? collapsed.size > 0 : collapsedNotes.size > 0;
    collapseButton.innerHTML = any ? ICONS.expandAll : ICONS.collapseAll;
    collapseButton.setAttribute('aria-label', any ? 'Expand all' : 'Collapse all');
  }

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
    renderChrome();
    if (!headings.length) {
      outlineTree.innerHTML = '<div class="pane-empty">No headings in this note</div>';
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
    outlineTree.innerHTML = html || '<div class="pane-empty">No matching headings</div>';
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
      renderChrome();
      return;
    }
    const item = target.closest<HTMLElement>('.tree-item-self');
    if (item) deps.onHeading(Number(item.dataset.line));
  });

  // ---- Search ----
  let searchTimer: number | undefined;
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
  let searchRun = 0;
  async function runSearch(): Promise<void> {
    window.clearTimeout(searchTimer);
    const run = ++searchRun;
    const re = globRegExp(searchInput.value);
    if (!re) { summary.textContent = ''; results.innerHTML = ''; return; }
    const current = deps.currentPath();
    const notes = scope === 'all' ? await deps.notes() : [{ path: current, text: deps.currentText() }];
    if (run !== searchRun) return; // a newer search started meanwhile
    // The open note first, then by name.
    notes.sort((a, b) => (a.path === current ? -1 : b.path === current ? 1 : stem(a.path).localeCompare(stem(b.path))));
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
        matches.push(`<div class="search-result-file-match" data-path="${escapeHtml(note.path)}" data-from="${m.index}" data-to="${m.index + m[0].length}" dir="auto">${snippet(note.text, m.index, m.index + m[0].length)}</div>`);
        if (matches.length >= MAX_PER_NOTE || total + matches.length >= MAX_TOTAL) break;
      }
      if (!matches.length) continue;
      if (matches.length >= MAX_PER_NOTE || total + matches.length >= MAX_TOTAL) capped = true;
      files += 1;
      total += matches.length;
      const isCollapsed = collapsedNotes.has(note.path);
      html += `<div class="tree-item search-result${isCollapsed ? ' is-collapsed' : ''}">`
        + `<div class="search-result-file-title tree-item-self is-clickable" data-note="${escapeHtml(note.path)}">`
        + `<span class="tree-item-icon collapse-icon">${ICONS.chevron}</span>`
        + `<span class="tree-item-inner" dir="auto">${escapeHtml(stem(note.path))}</span><span class="tree-item-flair">${matches.length}${matches.length >= MAX_PER_NOTE ? '+' : ''}</span></div>`
        + `<div class="search-result-file-matches">${matches.join('')}</div></div>`;
    }
    summary.textContent = total ? `${total}${capped ? '+' : ''} result${total === 1 ? '' : 's'}${scope === 'all' ? ` in ${files} note${files === 1 ? '' : 's'}` : ''}` : 'No results';
    results.innerHTML = html;
    searchInput.classList.toggle('mod-no-match', !total);
  }
  const searchSoon = (): void => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => void runSearch(), 180); };
  searchInput.addEventListener('input', searchSoon);
  searchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); void runSearch(); searchInput.blur(); } });
  root.querySelector('.search-scope')!.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-scope]');
    if (!button) return;
    scope = button.dataset.scope as 'all' | 'note';
    root.querySelectorAll<HTMLElement>('[data-scope]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scope === scope)));
    void runSearch();
  });
  results.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const title = target.closest<HTMLElement>('.search-result-file-title');
    if (title) {
      const path = title.dataset.note!;
      if (collapsedNotes.has(path)) collapsedNotes.delete(path); else collapsedNotes.add(path);
      title.parentElement!.classList.toggle('is-collapsed', collapsedNotes.has(path));
      renderChrome();
      return;
    }
    const match = target.closest<HTMLElement>('.search-result-file-match');
    if (match) deps.onResult(match.dataset.path!, Number(match.dataset.from), Number(match.dataset.to));
  });

  // ---- Views, header, buttons ----
  function setTab(next: View): void {
    tab = next;
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((v) => v.classList.toggle('is-active', v.dataset.view === next));
    renderChrome();
    if (next === 'outline') renderOutline(); else if (searchInput.value) void runSearch();
  }
  otherView.addEventListener('click', () => setTab(tab === 'outline' ? 'search' : 'outline'));
  root.querySelector('.workspace-drawer-vault-switcher')!.addEventListener('click', () => {
    openMenu((['outline', 'search'] as View[]).map((view) => ({
      title: TITLES[view], icon: ICONS[view], checked: view === tab, action: () => setTab(view),
    })), { title: 'Views' });
  });
  collapseButton.addEventListener('click', () => {
    if (tab === 'outline') {
      if (collapsed.size) collapsed.clear();
      else for (let i = 0; i < headings.length - 1; i += 1) if (headings[i + 1].level > headings[i].level) collapsed.add(headings[i].line);
      renderOutline();
    } else {
      const titles = [...results.querySelectorAll<HTMLElement>('.search-result-file-title')];
      if (collapsedNotes.size) collapsedNotes.clear();
      else for (const t of titles) collapsedNotes.add(t.dataset.note!);
      for (const t of titles) t.parentElement!.classList.toggle('is-collapsed', collapsedNotes.has(t.dataset.note!));
      renderChrome();
    }
  });
  renderChrome();

  return {
    /** Refresh for the current note (on open). */
    refresh(): void { if (tab === 'outline') renderOutline(); else { renderChrome(); if (searchInput.value) void runSearch(); } },
    markCurrent,
    setTab,
    focusSearch(): void { setTab('search'); searchInput.focus(); searchInput.select(); },
    get tab() { return tab; },
  };
}
