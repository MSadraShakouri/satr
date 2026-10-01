// Folder export: one page for a folder, one PDF out of it.
//
// Reached by pressing and holding the settings gear at the foot of the left
// drawer (the same long-press in a browser, and the context menu), because
// that is where a folder-wide decision belongs: it is not a note's business.
//
// The page is built in the app's own clothes: the settings page's header
// (44px round raised buttons, a centred title), its 30px cards on the
// secondary background, its pill toggles and 44px dropdowns, and its
// bottom-sheet menu for each file's own actions — the handle on the left of
// the row, the row's submenu on the right.
//
// Order, ticks and settings are remembered per folder (localStorage,
// satr:folderExport:<folder>): a folder you export twice is the same document
// twice, with the files you added since at the end.
//
// The export itself is src/exportPdf.ts's: the same renderer, the same
// Paged.js pages, the same print WebView. What it adds is a page break before
// every file after the first, so each file starts on a fresh page.
import './folderExport.css';
import { openMenu, type MenuEntry } from './menu';
import type { NoticeHandle } from './notice';
import type { PrintOptions } from './printOptions';
import { exportFolder, type ExportDocument } from './exportPdf';
import { backend, basename, dirname, isNote, stem, walkNotes, type Entry } from './vault';

export interface FolderExportState {
  /** The order the writer put the files in; files not named here (new ones)
   *  follow, by name. */
  order: string[];
  /** The files taken out of the export. They keep their place in the order,
   *  so ticking one back in does not send it to the end. */
  excluded: string[];
  includeSubfolders: boolean;
  /** The file's name above its first page. */
  heading: boolean;
  /** One page shape for the whole document. */
  columns: 1 | 2;
  /** The folder's own numbering, or the app's setting. */
  pageNumbers: 'inherit' | 'persian' | 'latin' | 'none';
}

export const defaultFolderExport: FolderExportState = {
  order: [], excluded: [], includeSubfolders: true, heading: true, columns: 1, pageNumbers: 'inherit',
};

export const folderExportKey = (folder: string): string => `satr:folderExport:${folder}`;

export function validFolderExport(value: Partial<FolderExportState> | null): FolderExportState {
  const list = (candidate: unknown): string[] => (Array.isArray(candidate) ? candidate.filter((item): item is string => typeof item === 'string') : []);
  const numbers = ['inherit', 'persian', 'latin', 'none'] as const;
  const pageNumbers = numbers.find((number) => number === value?.pageNumbers) ?? 'inherit';
  return {
    order: list(value?.order),
    excluded: list(value?.excluded),
    includeSubfolders: value?.includeSubfolders !== false,
    heading: value?.heading !== false,
    columns: value?.columns === 2 ? 2 : 1,
    pageNumbers,
  };
}

export function loadFolderExport(folder: string): FolderExportState {
  try { return validFolderExport(JSON.parse(localStorage.getItem(folderExportKey(folder)) ?? 'null')); }
  catch { return { ...defaultFolderExport }; }
}

export function saveFolderExport(folder: string, state: FolderExportState): void {
  localStorage.setItem(folderExportKey(folder), JSON.stringify(validFolderExport(state)));
}

/** The folder's notes as the page will show them: the remembered order first
 *  (only the files still there), then the folder's own listing — subfolders
 *  included or not — by name. */
export async function folderNotes(folder: string, state: FolderExportState): Promise<string[]> {
  let found: string[];
  if (state.includeSubfolders) {
    found = await walkNotes(folder).catch(() => []);
  } else {
    const entries = await backend.list(folder).catch(() => [] as Entry[]);
    found = entries.filter((entry) => entry.kind === 'file' && isNote(entry.name)).map((entry) => entry.path);
  }
  const there = new Set(found);
  const remembered = state.order.filter((path) => there.has(path));
  const seen = new Set(remembered);
  const rest = found.filter((path) => !seen.has(path))
    .sort((a, b) => basename(a).localeCompare(basename(b), undefined, { numeric: true, sensitivity: 'base' }));
  return [...remembered, ...rest];
}

/** The files the export carries, in order. */
export function includedNotes(notes: string[], state: FolderExportState): string[] {
  const out = new Set(state.excluded);
  return notes.filter((path) => !out.has(path));
}

/** Put `path` at the top / the foot, keeping everything else where it was. */
export function moveNote(notes: string[], path: string, where: 'top' | 'bottom'): string[] {
  const rest = notes.filter((note) => note !== path);
  return where === 'top' ? [path, ...rest] : [...rest, path];
}

const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const stroke = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  handle: stroke('<path d="M4 8h16M4 12h16M4 16h16"/>'), // lucide menu, the grip the writer calls “=”
  submenu: stroke('<path d="m9 18 6-6-6-6"/>'), // lucide chevron-right: this row has a submenu
  back: stroke('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>'),
  up: stroke('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>'), // lucide arrow-up
  down: stroke('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'), // lucide arrow-down
  toTop: stroke('<path d="M19 3H5"/><path d="M12 17V7"/><path d="m5 12 7-7 7 7"/>'), // arrow-up-to-line
  toBottom: stroke('<path d="M19 21H5"/><path d="M12 7v10"/><path d="m19 12-7 7-7-7"/>'), // arrow-down-to-line
  check: stroke('<path d="M20 6 9 17l-5-5"/>'),
  folder: stroke('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
} as const;

export interface FolderExportDeps {
  /** The folder the page opens on: the drawer's folder, or the space's. */
  currentFolder(): string;
  /** The note's own print options (direction, equations, custom CSS). */
  noteOptions(path: string): PrintOptions;
  /** Short messages, as elsewhere in the app. */
  notice(message: string, ms?: number): NoticeHandle;
  /** The folder chosen, for the caller to remember if it wants to. */
  onFolder?(folder: string): void;
}

export interface FolderExportPage {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export function createFolderExport(root: HTMLElement, deps: FolderExportDeps): FolderExportPage {
  let folder = '';
  let state = { ...defaultFolderExport };
  let notes: string[] = [];
  let picking = false;
  let pickDir = '';
  let pickFolders = 0;
  let busy = false;

  root.innerHTML = `
    <div class="folder-export-page">
      <div class="settings-header folder-export-header">
        <button type="button" class="clickable-icon folder-export-close" data-act="close" aria-label="Back">${ICONS.back}</button>
        <div class="folder-export-heading">
          <div class="folder-export-title" dir="auto"></div>
          <button type="button" class="folder-export-path" data-act="pick" dir="auto" aria-label="Choose a folder"></button>
        </div>
      </div>
      <div class="folder-export-scroll">
        <div class="folder-export-actions">
          <button type="button" class="folder-export-pill" data-act="all">Select all</button>
          <button type="button" class="folder-export-pill" data-act="none">Deselect all</button>
          <button type="button" class="folder-export-pill" data-act="sort">Sort A–Z</button>
        </div>
        <div class="setting-group-title folder-export-group-title">Files</div>
        <div class="setting-group folder-export-list" role="list"></div>
        <div class="setting-group-title folder-export-group-title">Export options</div>
        <div class="setting-group folder-export-options">
          <div class="setting-item">
            <div class="setting-item-info"><div class="setting-item-name">Include subfolders</div><div class="setting-item-description">Notes in the folders under this one</div></div>
            <div class="checkbox-container" role="switch" aria-checked="true" data-toggle="includeSubfolders"><input type="checkbox" tabindex="-1" checked></div>
          </div>
          <div class="setting-item">
            <div class="setting-item-info"><div class="setting-item-name">File name as a heading</div><div class="setting-item-description">The name above each file’s first page</div></div>
            <div class="checkbox-container" role="switch" aria-checked="true" data-toggle="heading"><input type="checkbox" tabindex="-1" checked></div>
          </div>
          <div class="setting-item">
            <div class="setting-item-info"><div class="setting-item-name">Layout</div></div>
            <select class="dropdown" data-setting="columns" aria-label="Layout for this folder">
              <option value="1">One column</option>
              <option value="2">Two columns</option>
            </select>
          </div>
          <div class="setting-item">
            <div class="setting-item-info"><div class="setting-item-name">Page numbers</div></div>
            <select class="dropdown" data-setting="pageNumbers" aria-label="Page numbers for this folder">
              <option value="inherit">As in Settings</option>
              <option value="persian">۱ ۲ ۳</option>
              <option value="latin">1 2 3</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
      </div>
      <div class="folder-export-footer">
        <div class="folder-export-summary" dir="auto"></div>
        <button type="button" class="folder-export-go" data-act="export">Export</button>
      </div>
    </div>`;

  const title = root.querySelector<HTMLElement>('.folder-export-title')!;
  const pathButton = root.querySelector<HTMLButtonElement>('.folder-export-path')!;
  const list = root.querySelector<HTMLElement>('.folder-export-list')!;
  const actions = root.querySelector<HTMLElement>('.folder-export-actions')!;
  const optionsBox = root.querySelector<HTMLElement>('.folder-export-options')!;
  const summary = root.querySelector<HTMLElement>('.folder-export-summary')!;
  const exportButton = root.querySelector<HTMLButtonElement>('.folder-export-go')!;
  const toggles = [...root.querySelectorAll<HTMLElement>('[data-toggle]')];
  const columnsSelect = root.querySelector<HTMLSelectElement>('[data-setting="columns"]')!;
  const numbersSelect = root.querySelector<HTMLSelectElement>('[data-setting="pageNumbers"]')!;

  const fileName = (path: string): string => stem(path) || basename(path);

  /** A row's second line: where the file sits under this folder. */
  const relativeDir = (path: string): string => {
    const dir = dirname(path);
    if (!dir || dir === folder) return '';
    return folder && dir.startsWith(`${folder}/`) ? dir.slice(folder.length + 1) : dir;
  };

  const buttons = (selector: string): HTMLButtonElement[] => [...actions.querySelectorAll<HTMLButtonElement>(selector)];

  function updateSummary(): void {
    const included = includedNotes(notes, state);
    summary.textContent = picking
      ? `${pickFolders} folder${pickFolders === 1 ? '' : 's'} here · tap the folder you want`
      : notes.length
        ? `${included.length} of ${notes.length} file${notes.length === 1 ? '' : 's'}`
        : 'No notes in this folder';
    exportButton.disabled = !included.length || picking;
    buttons('button[data-act="all"],button[data-act="none"],button[data-act="sort"]').forEach((button) => { button.disabled = !notes.length || picking; });
  }

  function rowHtml(path: string): string {
    const excluded = state.excluded.includes(path);
    const sub = state.includeSubfolders ? relativeDir(path) : '';
    return `<div class="folder-export-row${excluded ? ' is-excluded' : ''}" data-path="${escapeHtml(path)}" role="listitem">`
      + `<span class="folder-export-handle" role="button" tabindex="0" aria-label="Reorder ${escapeHtml(fileName(path))}">${ICONS.handle}</span>`
      + `<input type="checkbox" class="folder-export-check"${excluded ? '' : ' checked'} aria-label="Include ${escapeHtml(fileName(path))}">`
      + `<div class="folder-export-text"><div class="folder-export-name" dir="auto">${escapeHtml(fileName(path))}</div>`
      + (sub ? `<div class="folder-export-sub" dir="auto">${escapeHtml(sub)}</div>` : '')
      + '</div>'
      + `<button type="button" class="clickable-icon folder-export-menu" aria-label="Actions for ${escapeHtml(fileName(path))}" aria-haspopup="menu">${ICONS.submenu}</button>`
      + '</div>';
  }

  function renderList(): void {
    list.innerHTML = notes.map(rowHtml).join('');
  }

  async function renderPicker(): Promise<void> {
    const entries = await backend.list(pickDir).catch(() => [] as Entry[]);
    const folders = entries.filter((entry) => entry.kind === 'folder' && !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const name = basename(pickDir) || 'All files';
    const relative = folder && pickDir.startsWith(`${folder}/`) ? pickDir.slice(folder.length + 1) : pickDir;
    list.innerHTML = `<div class="folder-export-row is-pick is-choose" data-choose="${escapeHtml(pickDir)}" role="listitem">`
      + `<span class="folder-export-pick-icon">${ICONS.check}</span><div class="folder-export-text"><div class="folder-export-name" dir="auto">Export “${escapeHtml(name)}”</div>`
      + `<div class="folder-export-sub" dir="auto">${escapeHtml(relative || 'the top of the space')}</div></div></div>`
      + (pickDir ? `<div class="folder-export-row is-pick" data-pick="${escapeHtml(dirname(pickDir))}" role="listitem"><span class="folder-export-pick-icon">${ICONS.up}</span><div class="folder-export-text"><div class="folder-export-name" dir="auto">..</div></div></div>` : '')
      + folders.map((entry) => `<div class="folder-export-row is-pick" data-pick="${escapeHtml(entry.path)}" role="listitem"><span class="folder-export-pick-icon">${ICONS.folder}</span><div class="folder-export-text"><div class="folder-export-name" dir="auto">${escapeHtml(entry.name)}</div></div></div>`).join('');
    title.textContent = 'Choose a folder';
    pathButton.textContent = pickDir || 'the top of the space';
    pickFolders = folders.length;
    updateSummary();
  }

  function applySettingsToInputs(): void {
    for (const toggle of toggles) {
      const on = toggle.dataset.toggle === 'includeSubfolders' ? state.includeSubfolders : state.heading;
      toggle.classList.toggle('is-enabled', on);
      toggle.setAttribute('aria-checked', String(on));
      const input = toggle.querySelector('input');
      if (input) input.checked = on;
    }
    columnsSelect.value = String(state.columns);
    numbersSelect.value = state.pageNumbers;
  }

  async function render(): Promise<void> {
    picking = false;
    notes = await folderNotes(folder, state);
    title.textContent = basename(folder) || 'All files';
    pathButton.textContent = folder || 'the top of the space';
    applySettingsToInputs();
    renderList();
    updateSummary();
  }

  /** The remembered order is the list, every time the list changes. */
  function persistOrder(): void {
    state.order = notes.slice();
    saveFolderExport(folder, state);
  }

  function moveTo(path: string, where: 'top' | 'bottom'): void {
    notes = moveNote(notes, path, where);
    persistOrder();
    renderList();
    updateSummary();
  }

  function setIncluded(path: string, included: boolean): void {
    const excluded = new Set(state.excluded);
    if (included) excluded.delete(path); else excluded.add(path);
    state.excluded = [...excluded];
    const row = list.querySelector<HTMLElement>(`.folder-export-row[data-path="${CSS.escape(path)}"]`);
    row?.classList.toggle('is-excluded', !included);
    const check = row?.querySelector<HTMLInputElement>('.folder-export-check');
    if (check) check.checked = included;
    saveFolderExport(folder, state);
    updateSummary();
  }

  /** Each row's own submenu: the app's bottom-sheet menu, as everywhere else. */
  function openRowMenu(path: string): void {
    const index = notes.indexOf(path);
    const included = !state.excluded.includes(path);
    const entries: MenuEntry[] = [
      { title: 'Move to top', icon: ICONS.toTop, disabled: index <= 0, action: () => moveTo(path, 'top') },
      { title: 'Move to bottom', icon: ICONS.toBottom, disabled: index >= notes.length - 1, action: () => moveTo(path, 'bottom') },
      'separator',
      {
        title: included ? 'Don’t include' : 'Include in the export', icon: ICONS.check, checked: included,
        action: () => setIncluded(path, !included),
      },
    ];
    openMenu(entries, { title: fileName(path) });
  }

  // ---- the drag handle: the row follows the finger, the order follows the row
  let dragging: HTMLElement | null = null;
  let dragPointer = -1;
  let dragY = 0;
  let autoScroll = 0;

  function dragTarget(y: number): Element | null {
    const rows = [...list.querySelectorAll<HTMLElement>('.folder-export-row')].filter((row) => row !== dragging);
    for (const row of rows) {
      const box = row.getBoundingClientRect();
      if (y < box.top + box.height / 2) return row;
    }
    return null;
  }

  function dragMove(): void {
    if (!dragging) return;
    const before = dragTarget(dragY);
    if (before) list.insertBefore(dragging, before);
    else list.appendChild(dragging);
  }

  function dragScrollStep(): void {
    autoScroll = 0;
    if (!dragging) return;
    const box = list.getBoundingClientRect();
    const edge = Math.min(72, box.height / 3);
    if (dragY < box.top + edge) list.scrollTop -= 14;
    else if (dragY > box.bottom - edge) list.scrollTop += 14;
    else return;
    dragMove();
    autoScroll = window.setTimeout(dragScrollStep, 16);
  }

  list.addEventListener('pointerdown', (event) => {
    const handle = (event.target as HTMLElement).closest('.folder-export-handle');
    const row = (event.target as HTMLElement).closest<HTMLElement>('.folder-export-row');
    if (!handle || !row || picking) return;
    event.preventDefault();
    dragging = row;
    dragPointer = event.pointerId;
    dragY = event.clientY;
    row.classList.add('is-dragging');
    // A synthetic pointer (tests, automation) has nothing to capture; the
    // drag works either way, because the list also hears the moves.
    try { (handle as Element).setPointerCapture(event.pointerId); } catch { /* no active pointer */ }
  });
  list.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== dragPointer) return;
    event.preventDefault();
    dragY = event.clientY;
    dragMove();
    if (!autoScroll) autoScroll = window.setTimeout(dragScrollStep, 16);
  }, { passive: false });
  const endDrag = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== dragPointer) return;
    dragging.classList.remove('is-dragging');
    dragging = null;
    dragPointer = -1;
    window.clearTimeout(autoScroll);
    autoScroll = 0;
    notes = [...list.querySelectorAll<HTMLElement>('.folder-export-row')].map((row) => row.dataset.path ?? '').filter(Boolean);
    persistOrder();
  };
  list.addEventListener('pointerup', endDrag);
  list.addEventListener('pointercancel', endDrag);

  list.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('.folder-export-row');
    if (!row) return;
    if (picking) {
      const choose = row.dataset.choose;
      if (choose !== undefined) {
        folder = choose;
        state = loadFolderExport(folder);
        deps.onFolder?.(folder);
        void render();
        return;
      }
      const into = row.dataset.pick;
      if (into !== undefined) { pickDir = into; void renderPicker(); }
      return;
    }
    if (target.closest('.folder-export-menu')) { openRowMenu(row.dataset.path ?? ''); return; }
  });

  list.addEventListener('change', (event) => {
    const check = event.target as HTMLInputElement;
    if (!check.classList.contains('folder-export-check')) return;
    const row = check.closest<HTMLElement>('.folder-export-row');
    setIncluded(row?.dataset.path ?? '', check.checked);
  });

  actions.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!button || picking) return;
    switch (button.dataset.act) {
      case 'all':
        state.excluded = [];
        saveFolderExport(folder, state);
        renderList();
        updateSummary();
        break;
      case 'none':
        state.excluded = notes.slice();
        saveFolderExport(folder, state);
        renderList();
        updateSummary();
        break;
      case 'sort':
        notes = [...notes].sort((a, b) => basename(a).localeCompare(basename(b), undefined, { numeric: true, sensitivity: 'base' }));
        persistOrder();
        renderList();
        updateSummary();
        break;
    }
  });

  root.querySelector('.folder-export-close')!.addEventListener('click', () => close());
  pathButton.addEventListener('click', () => {
    picking = true;
    pickDir = folder;
    void renderPicker();
  });

  optionsBox.addEventListener('click', (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLElement>('[data-toggle]');
    if (!toggle) return;
    const name = toggle.dataset.toggle;
    const on = !toggle.classList.contains('is-enabled');
    if (name === 'includeSubfolders') state.includeSubfolders = on;
    else if (name === 'heading') state.heading = on;
    saveFolderExport(folder, state);
    applySettingsToInputs();
    if (name === 'includeSubfolders') void render();
  });
  optionsBox.addEventListener('change', (event) => {
    const input = event.target as HTMLSelectElement;
    if (input.dataset.setting === 'columns') state.columns = input.value === '2' ? 2 : 1;
    else if (input.dataset.setting === 'pageNumbers') state.pageNumbers = validFolderExport({ pageNumbers: input.value as FolderExportState['pageNumbers'] }).pageNumbers;
    else return;
    saveFolderExport(folder, state);
  });

  exportButton.addEventListener('click', () => void doExport());

  async function doExport(): Promise<void> {
    if (busy) return;
    const included = includedNotes(notes, state);
    if (!included.length) return;
    busy = true;
    exportButton.disabled = true;
    const name = basename(folder) || 'Notes';
    const notice = deps.notice('Preparing the PDF…', 60000);
    try {
      const documents: ExportDocument[] = [];
      for (const path of included) {
        const markdown = await backend.read(path);
        if (markdown === null) continue;
        documents.push({ name: fileName(path), markdown, path, options: deps.noteOptions(path) });
      }
      if (!documents.length) throw new Error('nothing to export');
      await exportFolder(name, documents, {
        columns: state.columns,
        heading: state.heading,
        ...(state.pageNumbers === 'inherit' ? {} : { pageNumbers: state.pageNumbers }),
      });
    } catch (error) {
      deps.notice(`Couldn’t export: ${error instanceof Error ? error.message : String(error)}`, 5000);
    } finally {
      notice.hide();
      busy = false;
      updateSummary();
    }
  }

  function close(): void {
    if (root.hidden) return;
    root.hidden = true;
    document.body.classList.remove('folder-export-active');
  }

  return {
    open(): void {
      folder = deps.currentFolder();
      state = loadFolderExport(folder);
      root.hidden = false;
      document.body.classList.add('folder-export-active');
      void render();
    },
    close,
    isOpen: (): boolean => !root.hidden,
  };
}
