// Left sidebar: the file explorer, after Obsidian's phone drawer.
// - Header: the space's name with a chevron (tap to switch spaces, like the
//   vault switcher) and a small line under it; the theme button on the side.
// - In a space: its folder as a tree. The root itself isn't shown; folders
//   open in place (remembered per space), folders first then by the chosen
//   order, the open note highlighted.
// - In "All files": a folder walker, as in Markor. Only the current folder,
//   with ".." on top to go up; tap a folder to go into it.
// - Long-press (or right-click) a file or folder for its actions: new note,
//   new folder, rename (in place), move, delete, use a folder as a space.
// - A floating row of buttons at the bottom: new note, new folder, sort,
//   collapse all (or go up, in the walker).
import { closeMenu, confirmMenu, openMenu, type MenuEntry } from './menu';
import {
  addSpace, currentScope, loadSpaces, moveSpaces, removeSpace, scopeName, scopeRoot, setScope, setWalkDir, walkDir, type Scope,
} from './spaces';
import { backend, basename, dirname, extension, freeName, isNote, joinPath, within, type Entry } from './vault';
import { shortenPath, siblingList } from './pathShort';

export interface LeftSidebarDeps {
  currentPath(): string;
  /** Open the folder export page for a folder (a folder row's menu). */
  exportFolder(folder: string): void;
  /** Open all of a folder's notes as tabs, in order; `replace` closes the other tabs first. */
  openFolderTabs(folder: string, replace: boolean): void;
  /** Export one text file as a single-note PDF (a file row's menu). */
  exportNote(path: string): void;
  /** Open a note (the sidebar closes the drawer itself). */
  open(path: string): void;
  /** Open a note in a new tab. */
  /** Create a note in a folder and open it. */
  createNote(dir: string): void;
  /** A file or folder was renamed or moved. */
  renamed(from: string, to: string): void;
  /** A file or folder was deleted. */
  deleted(path: string): void;
  /** The space changed (new scope for search, maybe a new note to open). */
  scopeChanged(): void;
  closeDrawer(): void;
  headerIcons: HTMLElement[];
}

type Sort = 'name' | 'name-desc' | 'mtime' | 'mtime-old';
const SORT_KEY = 'satr:sort';
const SORT_LABEL: Record<Sort, string> = {
  name: 'File name (A to Z)', 'name-desc': 'File name (Z to A)', mtime: 'Modified time (new to old)', 'mtime-old': 'Modified time (old to new)',
};
const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
// Lucide icons, as Obsidian uses.
const ICONS = {
  chevronDown: icon('<path d="m6 9 6 6 6-6"/>'),
  collapse: icon('<path d="M3 8 L12 17 L21 8"/>'), // right-triangle-ish chevron for folders
  newNote: icon('<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>'),
  newFolder: icon('<path d="M12 10v6M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  sort: icon('<path d="m3 16 4 4 4-4M7 20V4M11 4h10M11 8h7M11 12h4"/>'),
  collapseAll: icon('<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>'),
  expandAll: icon('<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>'),
  up: icon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  folder: icon('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  file: icon('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'),
  pencil: icon('<path d="M21.2 5.8a2.8 2.8 0 0 0-4-4L3.8 15.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z"/>'),
  move: icon('<path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1"/><path d="M2 13h10M9 16l3-3-3-3"/>'),
  trash: icon('<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  vault: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="7.5" cy="7.5" r=".5"/><path d="m7.9 7.9 2.7 2.7"/><circle cx="16.5" cy="7.5" r=".5"/><path d="m13.4 10.6 2.7-2.7"/><circle cx="7.5" cy="16.5" r=".5"/><path d="m7.9 16.1 2.7-2.7"/><circle cx="16.5" cy="16.5" r=".5"/><path d="m13.4 13.4 2.7 2.7"/><circle cx="12" cy="12" r="2"/>'),
  hardDrive: icon('<path d="M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6 16h.01M10 16h.01"/>'),
  plus: icon('<path d="M5 12h14M12 5v14"/>'),
  newTab: icon('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>'),
  x: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  // The same file-down glyph the ≡ menu uses for Export to PDF: the two
  // exports are one thing with two entrances.
  exportPdf: icon('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>'),
};

export function createLeftSidebar(root: HTMLElement, deps: LeftSidebarDeps) {
  root.innerHTML = `
    <div class="workspace-drawer-inner">
      <div class="search-input-container nav-filter">${ICONS.search}<input type="search" class="nav-filter-input" dir="auto" placeholder="Filter by name" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></div>
      <div class="workspace-drawer-tab-container">
        <div class="nav-files-container" role="tree"></div>
        <div class="nav-buttons-container">
          <button type="button" class="clickable-icon nav-action-button" data-act="new-note" aria-label="New note">${ICONS.newNote}</button>
          <button type="button" class="clickable-icon nav-action-button" data-act="new-folder" aria-label="New folder">${ICONS.newFolder}</button>
          <button type="button" class="clickable-icon nav-action-button" data-act="sort" aria-label="Change sort order">${ICONS.sort}</button>
          <button type="button" class="clickable-icon nav-action-button" data-act="collapse" aria-label="Collapse all">${ICONS.collapseAll}</button>
        </div>
      </div>
      <div class="workspace-drawer-header mod-vault-profile">
        <div class="workspace-drawer-header-left">
          <button type="button" class="workspace-drawer-vault-switcher" aria-haspopup="menu">
            <span class="workspace-drawer-vault-name" dir="auto"></span>
            <span class="workspace-drawer-vault-switcher-icon">${ICONS.chevronDown}</span>
          </button>
          <div class="workspace-drawer-header-info" dir="auto"></div>
        </div>
        <div class="workspace-drawer-header-icons"></div>
      </div>
    </div>`;
  root.querySelector('.workspace-drawer-header-icons')!.append(...deps.headerIcons);
  const list = root.querySelector<HTMLElement>('.nav-files-container')!;
  const nameEl = root.querySelector<HTMLElement>('.workspace-drawer-vault-name')!;
  const infoEl = root.querySelector<HTMLElement>('.workspace-drawer-header-info')!;
  const collapseButton = root.querySelector<HTMLButtonElement>('[data-act="collapse"]')!;
  const filterInput = root.querySelector<HTMLInputElement>('.nav-filter-input')!;
  const filterQuery = (): string => filterInput.value.trim().toLocaleLowerCase();

  let scope: Scope = currentScope();
  let sort: Sort = (localStorage.getItem(SORT_KEY) as Sort | null) ?? 'name';
  if (!(sort in SORT_LABEL)) sort = 'name';
  const expandedKey = (): string => `satr:expanded:${scope.kind === 'space' ? scope.space.id : 'all'}`;
  let expanded = new Set<string>();
  const loadExpanded = (): void => {
    try { expanded = new Set(JSON.parse(localStorage.getItem(expandedKey()) ?? '[]') as string[]); } catch { expanded = new Set(); }
  };
  const saveExpanded = (): void => localStorage.setItem(expandedKey(), JSON.stringify([...expanded]));
  loadExpanded();
  let renderToken = 0;
  let renaming: string | null = null;
  /** The note the drawn tree belongs to; compared with the open one when the
   *  drawer comes back, so a highlight can never outlive the note it marks. */
  let renderedPath = deps.currentPath();

  const sorted = (entries: Entry[]): Entry[] => entries
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      switch (sort) {
        case 'name-desc': return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
        case 'mtime': if (a.kind === 'file' && b.mtime !== a.mtime) return b.mtime - a.mtime; break;
        case 'mtime-old': if (a.kind === 'file' && b.mtime !== a.mtime) return a.mtime - b.mtime; break;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  const list$ = async (dir: string): Promise<Entry[]> => sorted(await backend.list(dir).catch(() => [] as Entry[]));

  function rowHtml(entry: Entry, opts: { collapsed?: boolean; walker?: boolean } = {}): string {
    const current = deps.currentPath();
    const isFolder = entry.kind === 'folder';
    const ext = extension(entry.name);
    const note = isNote(entry.name);
    const title = note && (ext === 'md' || ext === 'markdown') ? entry.name.replace(/\.(md|markdown)$/i, '') : entry.name;
    const classes = ['tree-item-self', 'is-clickable', isFolder ? 'nav-folder-title' : 'nav-file-title',
      isFolder && !opts.walker ? 'mod-collapsible' : '', entry.path === current ? 'is-active' : '', !isFolder && !note ? 'is-plain-file' : ''];
    return `<div class="${classes.filter(Boolean).join(' ')}" data-path="${escapeHtml(entry.path)}" data-kind="${entry.kind}" role="treeitem"${isFolder && !opts.walker ? ` aria-expanded="${!opts.collapsed}"` : ''}>`
      + (isFolder && !opts.walker ? `<div class="tree-item-icon collapse-icon">${ICONS.chevronDown}</div>` : '')
      + (opts.walker ? `<div class="tree-item-icon nav-entry-icon">${isFolder ? ICONS.folder : ICONS.file}</div>` : '')
      + `<div class="tree-item-inner ${isFolder ? 'nav-folder-title-content' : 'nav-file-title-content'}" dir="auto">${escapeHtml(title)}</div>`
      + (!isFolder && ext && ext !== 'md' ? `<div class="nav-file-tag">${escapeHtml(ext)}</div>` : '')
      + '</div>';
  }
  async function treeHtml(dir: string, token: number): Promise<string> {
    let html = '';
    for (const entry of await list$(dir)) {
      if (token !== renderToken) return '';
      if (entry.kind === 'folder') {
        const open = expanded.has(entry.path);
        html += `<div class="tree-item nav-folder${open ? '' : ' is-collapsed'}">${rowHtml(entry, { collapsed: !open })}`
          + `<div class="tree-item-children nav-folder-children">${open ? await treeHtml(entry.path, token) : ''}</div></div>`;
      } else {
        html += `<div class="tree-item nav-file">${rowHtml(entry)}</div>`;
      }
    }
    return html;
  }

  async function render(): Promise<void> {
    const token = ++renderToken;
    scope = currentScope();
    nameEl.textContent = scopeName(scope);
    const walking = scope.kind === 'all';
    root.classList.toggle('mod-walker', walking);
    collapseButton.innerHTML = walking ? ICONS.up : (expanded.size ? ICONS.collapseAll : ICONS.expandAll);
    collapseButton.setAttribute('aria-label', walking ? 'Up one folder' : expanded.size ? 'Collapse all' : 'Expand all');
    let html: string;
    root.classList.toggle('mod-filtering', Boolean(filterQuery()));
    if (filterQuery()) {
      html = await filterHtml(walking ? walkDir() : (scope as Extract<Scope, { kind: 'space' }>).space.path, token);
      if (token !== renderToken) return;
      if (!walking) infoEl.textContent = (scope as Extract<Scope, { kind: 'space' }>).space.path === scopeName(scope) ? '' : (scope as Extract<Scope, { kind: 'space' }>).space.path;
    } else if (walking) {
      const dir = walkDir();
      collapseButton.disabled = !dir;
      infoEl.textContent = dir ? `/${dir}` : backend.kind === 'web' ? 'Browser storage' : 'Internal storage';
      const entries = await list$(dir);
      if (token !== renderToken) return;
      html = (dir ? `<div class="tree-item nav-folder mod-parent"><div class="tree-item-self is-clickable nav-folder-title" data-path="${escapeHtml(dirname(dir))}" data-kind="parent" role="treeitem">`
        + `<div class="tree-item-icon nav-entry-icon">${ICONS.folder}</div><div class="tree-item-inner nav-folder-title-content">..</div></div></div>` : '')
        + entries.map((e) => `<div class="tree-item ${e.kind === 'folder' ? 'nav-folder' : 'nav-file'}">${rowHtml(e, { walker: true })}</div>`).join('');
      if (!entries.length) html += '<div class="pane-empty">This folder is empty</div>';
    } else {
      collapseButton.disabled = false;
      const space = (scope as Extract<Scope, { kind: 'space' }>).space;
      infoEl.textContent = space.path === space.name ? '' : space.path;
      void showCount(space.path, space.path === space.name ? '' : space.path, token);
      html = await treeHtml(space.path, token);
      if (token !== renderToken) return;
      if (!html) html = '<div class="pane-empty">No notes yet</div>';
    }
    list.innerHTML = html;
    renderedPath = deps.currentPath();
    if (renaming) startRename(renaming);
  }
  // Filter by name: files and folders anywhere under the space (or the
  // walker's folder) whose name has every word typed, as a flat list with
  // the folder they're in; the matched text highlighted.
  // Under the space's name, as Obsidian under the vault's: "12 files, 3 folders".
  async function showCount(dir: string, prefix: string, token: number): Promise<void> {
    let files = 0;
    let folders = 0;
    const queue = [dir];
    while (queue.length && files + folders < 5000) {
      const entries = await list$(queue.shift()!);
      if (token !== renderToken) return;
      for (const entry of entries) {
        if (entry.kind === 'folder') { folders += 1; queue.push(entry.path); } else files += 1;
      }
    }
    const count = `${files} ${files === 1 ? 'file' : 'files'}, ${folders} ${folders === 1 ? 'folder' : 'folders'}`;
    infoEl.textContent = prefix ? `${prefix} · ${count}` : count;
  }
  async function filterHtml(dir: string, token: number): Promise<string> {
    const words = filterQuery().split(/\s+/).filter(Boolean);
    const found: Entry[] = [];
    const queue = [dir];
    // What each folder the walk passes through holds: a row's path is
    // shortened against its own siblings, and the walk has already listed
    // them (src/pathShort.ts).
    const siblings = siblingList();
    while (queue.length && found.length < 300) {
      const current = queue.shift()!;
      const entries = await list$(current);
      if (token !== renderToken) return '';
      siblings.record(current, entries.map((entry) => entry.name));
      for (const entry of entries) {
        if (entry.kind === 'folder') queue.push(entry.path);
        const name = entry.name.toLocaleLowerCase();
        if (words.every((w) => name.includes(w))) found.push(entry);
      }
    }
    if (!found.length) return '<div class="pane-empty">No files or folders found</div>';
    const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
    return found.map((entry) => {
      const parent = dirname(entry.path);
      const relative = parent === dir ? '' : (dir ? parent.slice(dir.length + 1) : parent);
      // p10k-style: the ancestors cut to their shortest unique prefix, the
      // folder the hit lives in in full.
      const shownParent = relative ? shortenPath(relative, siblings.of, { base: dir, anchor: true }) : '';
      const row = rowHtml(entry, { walker: true }).replace(/(<div class="tree-item-inner[^>]*>)([^<]*)(<\/div>)/, (_, open: string, text: string, close: string) =>
        `${open}<span class="nav-filter-name">${text.replace(pattern, (m) => `<span class="search-result-file-matched-text">${m}</span>`)}</span>${shownParent ? `<span class="nav-filter-path">${escapeHtml(shownParent)}</span>` : ''}${close}`);
      return `<div class="tree-item ${entry.kind === 'folder' ? 'nav-folder' : 'nav-file'} mod-found">${row}</div>`;
    }).join('');
  }
  let filterTimer: number | undefined;
  filterInput.addEventListener('input', () => { window.clearTimeout(filterTimer); filterTimer = window.setTimeout(() => void render(), 120); });
  filterInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); filterInput.blur(); }
    if (event.key === 'Escape' && filterInput.value) { event.preventDefault(); filterInput.value = ''; void render(); }
  });
  const rowOf = (path: string): HTMLElement | null => list.querySelector<HTMLElement>(`.tree-item-self[data-path="${CSS.escape(path)}"]`);

  /** Folder new things go into: the space root, or the walker's folder. */
  const baseDir = (): string => (scope.kind === 'all' ? walkDir() : scope.space.path);

  // ---- Actions ----
  async function newFolder(dir: string): Promise<void> {
    const name = await freeName(dir, 'Untitled');
    const path = joinPath(dir, name);
    try { await backend.mkdir(path); } catch (error) { alertError(error); return; }
    if (dir && scope.kind === 'space') expanded.add(dir);
    saveExpanded();
    renaming = path;
    await render();
  }
  function startRename(path: string): void {
    renaming = null;
    const row = rowOf(path);
    const inner = row?.querySelector<HTMLElement>('.tree-item-inner');
    if (!row || !inner) return;
    const isFolder = row.dataset.kind === 'folder';
    const ext = isFolder ? '' : extension(basename(path));
    const keepExt = ext === 'md' || ext === 'markdown';
    const original = inner.textContent ?? '';
    row.classList.add('is-being-renamed');
    inner.contentEditable = 'plaintext-only';
    if (inner.contentEditable !== 'plaintext-only') inner.contentEditable = 'true';
    inner.spellcheck = false;
    inner.focus();
    const range = document.createRange();
    range.selectNodeContents(inner);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    let done = false;
    const finish = async (commit: boolean): Promise<void> => {
      if (done) return;
      done = true;
      inner.contentEditable = 'false';
      row.classList.remove('is-being-renamed');
      const value = (inner.textContent ?? '').replace(/[\n\r]/g, '').trim();
      if (!commit || !value || value === original) { inner.textContent = original; return; }
      if (/[\\/:]/.test(value)) { inner.textContent = original; showError('File names cannot contain \\ / or :'); return; }
      const to = joinPath(dirname(path), keepExt ? `${value}.${ext}` : value);
      try {
        await backend.rename(path, to);
      } catch (error) {
        inner.textContent = original;
        alertError(error);
        return;
      }
      afterMove(path, to, isFolder);
    };
    inner.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); void finish(true); inner.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); void finish(false); inner.blur(); }
    });
    inner.addEventListener('blur', () => void finish(true), { once: true });
  }
  function afterMove(from: string, to: string, isFolder: boolean): void {
    if (isFolder) {
      expanded = new Set([...expanded].map((p) => (within(p, from) ? to + p.slice(from.length) : p)));
      saveExpanded();
      moveSpaces(from, to);
      if (scope.kind === 'all' && within(walkDir(), from)) setWalkDir(to + walkDir().slice(from.length));
    }
    deps.renamed(from, to);
    void render();
  }
  async function moveTo(path: string, isFolder: boolean): Promise<void> {
    // Pick a folder in the space (or, in All files, around the current one).
    const rootDir = scope.kind === 'space' ? scope.space.path : walkDir();
    const folders: string[] = scope.kind === 'all' && rootDir ? [dirname(rootDir)] : [];
    folders.push(rootDir);
    const queue = [rootDir];
    while (queue.length && folders.length < 300) {
      for (const entry of await list$(queue.shift()!)) {
        if (entry.kind !== 'folder' || (isFolder && within(entry.path, path))) continue;
        folders.push(entry.path);
        if (scope.kind === 'space') queue.push(entry.path);
      }
    }
    const current = dirname(path);
    const label = (dir: string): string => {
      if (scope.kind === 'space') return dir === rootDir ? scope.space.name : dir.slice(rootDir.length + 1);
      return dir ? `/${dir}` : '/';
    };
    openMenu(folders.filter((d) => d !== current).map((dir) => ({
      title: label(dir),
      icon: ICONS.folder,
      action: async () => {
        const to = joinPath(dir, basename(path));
        try { await backend.rename(path, to); } catch (error) { alertError(error); return; }
        afterMove(path, to, isFolder);
      },
    })), { title: `Move “${basename(path)}” to…` });
  }
  function remove(path: string, isFolder: boolean): void {
    confirmMenu(`Delete “${basename(path)}”${isFolder ? ' and everything in it' : ''}? This can't be undone.`, 'Delete', async () => {
      try { await backend.remove(path); } catch (error) { alertError(error); return; }
      if (isFolder) {
        for (const s of loadSpaces()) if (within(s.path, path)) removeSpace(s.id);
      }
      deps.deleted(path);
      void render();
    });
  }
  function itemMenu(path: string, kind: string): void {
    const isFolder = kind === 'folder';
    const entries: MenuEntry[] = [];
    if (isFolder) {
      entries.push(
        { title: 'New note', icon: ICONS.newNote, action: () => { deps.createNote(path); } },
        { title: 'New folder', icon: ICONS.newFolder, action: () => { void newFolder(path); } },
        'separator',
      );
    }
    entries.push(
      { title: 'Rename…', icon: ICONS.pencil, action: () => startRename(path) },
      { title: 'Move to…', icon: ICONS.move, action: () => { void moveTo(path, isFolder); } },
    );
    if (isFolder) entries.push('separator', { title: 'Use as a space', icon: ICONS.vault, action: () => switchTo({ kind: 'space', space: addSpace(path) }) });
    // Every note of a folder as tabs, in alphabetical order. \"Replace\" also
    // closes the tabs that are open now (they can be reopened).
    if (isFolder) entries.push('separator', { title: 'Open all notes in tabs', icon: ICONS.newNote, action: () => deps.openFolderTabs(path, false) }, { title: 'Replace tabs with this folder', icon: ICONS.newNote, warning: true, action: () => deps.openFolderTabs(path, true) });
    // Export, on its own line like Delete: a folder exports as one PDF of its
    // notes, a text file as a PDF of itself. Only text files can: the
    // single-file path renders markdown, and a picture or a .json is not that.
    if (isFolder) {
      entries.push('separator', { title: 'Export folder as PDF…', icon: ICONS.exportPdf, action: () => deps.exportFolder(path) });
    } else if (isNote(path.split('/').pop() ?? '')) {
      entries.push('separator', { title: 'Export file as PDF…', icon: ICONS.exportPdf, action: () => deps.exportNote(path) });
    }
    entries.push('separator', { title: 'Delete', icon: ICONS.trash, warning: true, action: () => remove(path, isFolder) });
    const row = rowOf(path);
    row?.classList.add('has-active-menu');
    openMenu(entries, { title: basename(path) });
    // Drop the ring once the sheet is gone.
    const clear = (): void => { if (!document.querySelector('.menu.is-open:not(.is-closing)')) { row?.classList.remove('has-active-menu'); return; } window.setTimeout(clear, 200); };
    window.setTimeout(clear, 300);
  }
  function switchTo(next: Scope): void {
    setScope(next);
    scope = next;
    loadExpanded();
    void render();
    deps.scopeChanged();
  }
  function spaceMenu(): void {
    const entries: MenuEntry[] = loadSpaces().map((s) => ({
      title: s.name, icon: ICONS.vault, checked: scope.kind === 'space' && scope.space.id === s.id,
      action: () => switchTo({ kind: 'space', space: s }),
    }));
    entries.push({ title: 'All files', icon: ICONS.hardDrive, checked: scope.kind === 'all', action: () => switchTo({ kind: 'all' }) });
    entries.push('separator');
    const dir = walkDir();
    if (scope.kind === 'all' && dir) {
      entries.push({ title: `Use “${basename(dir)}” as a space`, icon: ICONS.plus, action: () => switchTo({ kind: 'space', space: addSpace(dir) }) });
    } else if (scope.kind === 'space') {
      entries.push({ title: 'Add a space…', icon: ICONS.plus, action: () => { switchTo({ kind: 'all' }); showHint('Open a folder, then choose “Use as a space” from the space menu.'); } });
    } else {
      entries.push({ title: 'Open a folder to use it as a space', icon: ICONS.plus, disabled: true });
    }
    if (scope.kind === 'space') {
      const space = (scope as Extract<Scope, { kind: 'space' }>).space;
      entries.push({
        title: `Remove “${space.name}” from spaces`, icon: ICONS.x,
        action: () => { removeSpace(space.id); switchTo(currentScope()); showHint('The folder and its notes were left as they are.'); },
      });
    }
    openMenu(entries, { title: 'Spaces' });
  }
  function sortMenu(): void {
    openMenu((Object.keys(SORT_LABEL) as Sort[]).map((key) => ({
      title: SORT_LABEL[key], checked: key === sort,
      action: () => { sort = key; localStorage.setItem(SORT_KEY, key); void render(); },
    })), { title: 'Sort by' });
  }
  function showError(message: string): void { showHint(message, true); }
  function alertError(error: unknown): void { showError(error instanceof Error ? error.message : String(error)); }
  let hintTimer: number | undefined;
  function showHint(message: string, isError = false): void {
    let hint = root.querySelector<HTMLElement>('.nav-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'nav-hint';
      list.before(hint);
    }
    hint.textContent = message;
    hint.classList.toggle('mod-error', isError);
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => hint?.remove(), 5000);
  }

  // ---- Events ----
  root.querySelector('.workspace-drawer-vault-switcher')!.addEventListener('click', spaceMenu);
  root.querySelector('.nav-buttons-container')!.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
    if (!button) return;
    switch (button.dataset.act) {
      case 'new-note': deps.createNote(baseDir()); break;
      case 'new-folder': void newFolder(baseDir()); break;
      case 'sort': sortMenu(); break;
      case 'collapse':
        if (scope.kind === 'all') { setWalkDir(dirname(walkDir())); void render(); break; }
        if (expanded.size) expanded.clear();
        else void expandAll();
        saveExpanded();
        void render();
        break;
    }
  });
  async function expandAll(): Promise<void> {
    if (scope.kind !== 'space') return;
    const queue = [scope.space.path];
    while (queue.length && expanded.size < 500) {
      for (const entry of await list$(queue.shift()!)) {
        if (entry.kind === 'folder') { expanded.add(entry.path); queue.push(entry.path); }
      }
    }
    saveExpanded();
    void render();
  }
  let suppressClick = false;
  list.addEventListener('click', (event) => {
    if (suppressClick) { suppressClick = false; return; }
    const row = (event.target as HTMLElement).closest<HTMLElement>('.tree-item-self');
    if (!row || row.classList.contains('is-being-renamed')) return;
    const path = row.dataset.path!;
    const kind = row.dataset.kind;
    if (filterQuery() && kind === 'folder') {
      // A found folder: back to the tree, opened at it.
      filterInput.value = '';
      if (scope.kind === 'all') setWalkDir(path);
      else {
        for (let dir = path; dir && within(dir, scope.space.path) && dir !== scope.space.path; dir = dirname(dir)) expanded.add(dir);
        saveExpanded();
      }
      void render().then(() => rowOf(path)?.scrollIntoView({ block: 'center' }));
      return;
    }
    if (kind === 'parent' || (kind === 'folder' && scope.kind === 'all')) {
      setWalkDir(path);
      void render().then(() => { list.scrollTop = 0; });
      return;
    }
    if (kind === 'folder') {
      const item = row.parentElement!;
      const open = item.classList.contains('is-collapsed');
      if (open) expanded.add(path); else expanded.delete(path);
      saveExpanded();
      if (open && !item.querySelector('.tree-item-children')!.childElementCount) void render();
      else {
        item.classList.toggle('is-collapsed', !open);
        row.setAttribute('aria-expanded', String(open));
        collapseButton.innerHTML = expanded.size ? ICONS.collapseAll : ICONS.expandAll;
      }
      return;
    }
    // Everything opens: notes as notes, and anything else as the text its
    // bytes decode to (read-only, so the original is never overwritten).
    deps.open(path);
  });
  // Long press (touch) / right-click (mouse): the item's actions.
  let pressTimer: number | undefined;
  let pressX = 0;
  let pressY = 0;
  list.addEventListener('touchstart', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.tree-item-self');
    window.clearTimeout(pressTimer);
    if (!row || row.dataset.kind === 'parent' || row.classList.contains('is-being-renamed') || event.touches.length !== 1) return;
    pressX = event.touches[0].clientX;
    pressY = event.touches[0].clientY;
    pressTimer = window.setTimeout(() => {
      pressTimer = undefined;
      suppressClick = true;
      navigator.vibrate?.(10);
      itemMenu(row.dataset.path!, row.dataset.kind!);
    }, 500);
  }, { passive: true });
  list.addEventListener('touchmove', (event) => {
    const t = event.touches[0];
    if (Math.hypot(t.clientX - pressX, t.clientY - pressY) > 8) window.clearTimeout(pressTimer);
  }, { passive: true });
  list.addEventListener('touchend', () => {
    window.clearTimeout(pressTimer);
    // A long press ends without a click on some browsers; don't eat the next tap.
    if (suppressClick) window.setTimeout(() => { suppressClick = false; }, 400);
  });
  list.addEventListener('contextmenu', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.tree-item-self');
    if (!row || row.dataset.kind === 'parent' || row.classList.contains('is-being-renamed')) return;
    event.preventDefault();
    if (document.querySelector('.menu.is-open:not(.is-closing)')) return; // the long press got there first
    itemMenu(row.dataset.path!, row.dataset.kind!);
  });

  function scrollActive(): void {
    const row = list.querySelector<HTMLElement>('.tree-item-self.is-active');
    if (!row) return;
    const box = row.getBoundingClientRect();
    const view = list.getBoundingClientRect();
    if (box.top < view.top || box.bottom > view.bottom - 96) list.scrollTop += box.top - view.top - view.height / 3;
  }

  return {
    refresh: render,
    /** Ask, then delete a note (the ≡ menu's Delete note). */
    deleteFile: (path: string) => remove(path, false),
    /** Mark the open note, and open the folders above it (tree only). */
    reveal(path: string): void {
      if (scope.kind === 'space' && within(path, scope.space.path)) {
        let changed = false;
        for (let dir = dirname(path); dir && dir !== scope.space.path && within(dir, scope.space.path); dir = dirname(dir)) {
          if (!expanded.has(dir)) { expanded.add(dir); changed = true; }
        }
        if (changed) { saveExpanded(); void render(); return; }
      }
      list.querySelectorAll('.tree-item-self.is-active').forEach((el) => el.classList.remove('is-active'));
      rowOf(path)?.classList.add('is-active');
      renderedPath = deps.currentPath(); // drawn, marks and all
    },
    /** Open a folder in the tree and bring it into view — the search's folder
     *  rows (src/rightSidebar.ts, the new tab's search) and nothing else. The
     *  folder and every folder above it open, so the row is really on screen. */
    openFolder(path: string): void {
      const stop = scope.kind === 'space' ? scope.space.path : '';
      for (let dir = path; dir && dir !== stop; dir = dirname(dir)) expanded.add(dir);
      saveExpanded();
      void render().then(() => rowOf(path)?.scrollIntoView({ block: 'center' }));
    },
    /** Bring the open note into view, redrawing first when the tree is older
     *  than the note it should mark (a tab closed, a file opened from another
     *  app, a rename): a stale highlight should never be what you see. */
    scrollToActive(): void {
      if (renderedPath !== deps.currentPath()) { void render().then(scrollActive); return; }
      scrollActive();
    },
    scope: () => scope,
    /** The folder the walker is in (All files). */
    walkRoot: () => walkDir(),
    root: () => scopeRoot(scope),
    closeMenus: closeMenu,
    hint: showHint,
  };
}
