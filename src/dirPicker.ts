// A folder chosen by walking to it, rather than picked off a flat list.
//
// His words: "making the pop-up be able to walk like sidebar, in space only
// the space and in all files everywhere and a confirm button". The flat list
// this replaces mixed two different acts in one row -- going deeper and
// choosing -- which is exactly why it needed a diagram to explain. Here one
// folder is shown at a time, a row goes into a folder, and nothing is chosen
// until the button at the bottom is pressed.
//
// The ceiling is the caller's: a space passes its own root and the walk
// cannot rise above it; All files passes the vault root, so everywhere is
// reachable. It wears the bottom sheet's own chrome (src/menu.ts) so it
// looks like every other sheet in the app.

import { backend, basename, dirname, freeName, joinPath, within, type Entry } from './vault';

export interface FolderWalk {
  /** The folder to open on. */
  start: string;
  /** The highest folder the walk may reach. '' is the vault root. */
  ceiling: string;
  /** The sheet's heading. */
  title: string;
  /** The button that commits. */
  confirm: string;
  /** How a folder's path is written in this scope. */
  label: (dir: string) => string;
  /** Moving a folder must not offer itself or its descendants. */
  canEnter?: (dir: string) => boolean;
  /** Some destinations, such as the file's current folder, are no-ops. */
  canConfirm?: (dir: string) => boolean;
}

const ICON = {
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  into: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5l-7 7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  empty: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
};

/**
 * The path with everything above the last folder dimmed. The folder being
 * stood in is the answer to "where am I"; the ones above it are only there
 * so the answer means something, and reading as one dense line made the
 * head of the sheet the busiest thing in it.
 */
function pathHtml(label: string): string {
  const parts = label.split('/');
  const here = escapeHtml(parts.pop() ?? label);
  const above = parts.length ? `<span class="dir-walk-above">${escapeHtml(parts.join('/'))}/</span>` : '';
  return `${above}<span class="dir-walk-current" dir="auto">${here}</span>`;
}
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

let open: { close(): void } | null = null;
export const isFolderWalkOpen = (): boolean => open !== null;
export const closeFolderWalk = (): void => open?.close();

/** Direct children, folders first, with hidden entries left out. */
async function childrenOf(dir: string): Promise<Entry[]> {
  const entries = await backend.list(dir).catch(() => [] as Entry[]);
  return entries.filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Walk to a folder and confirm it. Resolves with the folder, or null if the
 * sheet was dismissed -- backdrop, Escape, back button or a drag down.
 */
export function walkToFolder(options: FolderWalk): Promise<string | null> {
  open?.close();
  const ceiling = options.ceiling;
  let at = within(options.start, ceiling) || options.start === ceiling ? options.start : ceiling;
  let naming = false;
  let renderToken = 0;

  const backdrop = document.createElement('div');
  backdrop.className = 'menu-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'menu mod-bottom-sheet dir-walk';
  sheet.dataset.ignoreSwipe = '';

  let settle: (dir: string | null) => void = () => {};
  const done = new Promise<string | null>((resolve) => { settle = resolve; });

  let closed = false;
  const close = (dir: string | null): void => {
    if (closed) return;
    closed = true;
    if (open === handle) open = null;
    document.removeEventListener('keydown', onKey, true);
    sheet.classList.add('is-closing');
    backdrop.classList.add('is-closing');
    const remove = (): void => { sheet.remove(); backdrop.remove(); };
    sheet.addEventListener('transitionend', remove, { once: true });
    window.setTimeout(remove, 260);
    settle(dir);
  };
  const handle = { close: () => { close(null); } };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (naming) { naming = false; void render(); return; }
    close(null);
  };

  async function render(): Promise<void> {
    const token = ++renderToken;
    const children = await childrenOf(at);
    if (closed || token !== renderToken) return;
    const folders = children.filter((entry) => entry.kind === 'folder' && (options.canEnter?.(entry.path) ?? true));
    const files = children.filter((entry) => entry.kind === 'file');
    const rows = folders.map((entry) => `
      <div class="menu-item" role="menuitem" data-into="${escapeHtml(entry.path)}">
        <div class="menu-item-icon">${ICON.folder}</div>
        <div class="menu-item-title" dir="auto">${escapeHtml(entry.name)}</div>
        <div class="menu-item-icon mod-into">${ICON.into}</div>
      </div>`).join('');
    const fileRows = files.map((entry) => `
      <div class="menu-item dir-walk-file" aria-disabled="true">
        <div class="menu-item-icon">${ICON.file}</div>
        <div class="menu-item-title" dir="auto">${escapeHtml(entry.name)}</div>
      </div>`).join('');
    sheet.innerHTML = `
      <div class="menu-grabber"></div>
      <div class="menu-title">${escapeHtml(options.title)}</div>
      <div class="dir-walk-path">
        ${at === ceiling ? '' : `<button type="button" class="dir-walk-round dir-walk-up" data-up aria-label="Up one folder">${ICON.up}</button>`}
        <span class="dir-walk-here" dir="auto">${pathHtml(options.label(at))}</span>
        <button type="button" class="dir-walk-round dir-walk-add" data-add aria-label="New folder here">${ICON.plus}</button>
      </div>
      <div class="menu-scroll">
        ${naming ? `<div class="dir-walk-name"><input type="text" class="dir-walk-input" placeholder="Folder name" dir="auto" autocomplete="off" spellcheck="false"></div>` : ''}
        ${rows || fileRows ? `<div class="menu-group">${rows}${fileRows}</div>` : `<div class="dir-walk-empty">${ICON.empty}
          <span class="dir-walk-empty-say">Nothing in here</span>
          <span class="dir-walk-empty-how">Choose this folder, or make another with +</span>
        </div>`}
      </div>
      <div class="dir-walk-foot">
        <button type="button" class="dir-walk-confirm" data-confirm${options.canConfirm && !options.canConfirm(at) ? ' disabled' : ''}>${escapeHtml(options.confirm)}</button>
      </div>`;
    if (naming) {
      const input = sheet.querySelector<HTMLInputElement>('.dir-walk-input');
      input?.focus();
      input?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); void make(input.value); }
      });
      input?.addEventListener('blur', () => { void make(input.value); });
    }
  }

  /** A folder made where the walk is standing, which the walk then enters. */
  async function make(raw: string): Promise<void> {
    if (!naming) return;
    naming = false;
    const wanted = raw.trim().replace(/[\\/]/g, ' ').trim();
    if (!wanted) { void render(); return; }
    const name = await freeName(at, wanted);
    const path = joinPath(at, name);
    try { await backend.mkdir(path); at = path; } catch { /* stay where we are */ }
    await render();
  }

  sheet.addEventListener('mousedown', (event) => {
    // Keep the keyboard where it is, except for the name box, which wants it.
    if (!(event.target as HTMLElement).closest('.dir-walk-input')) event.preventDefault();
  });
  sheet.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-confirm]')) { if (options.canConfirm?.(at) ?? true) close(at); return; }
    if (target.closest('[data-up]')) { if (at !== ceiling) { at = dirname(at); void render(); } return; }
    if (target.closest('[data-add]')) { naming = true; void render(); return; }
    const into = target.closest<HTMLElement>('[data-into]')?.dataset.into;
    if (into !== undefined && dirname(into) === at && (options.canEnter?.(into) ?? true)) { at = into; void render(); }
  });
  backdrop.addEventListener('click', () => { close(null); });
  document.addEventListener('keydown', onKey, true);

  // Drag down to dismiss, the same gesture every other sheet answers to.
  let startY = -1;
  let dragging = false;
  sheet.addEventListener('touchstart', (event) => {
    const scroll = sheet.querySelector<HTMLElement>('.menu-scroll');
    startY = (scroll?.scrollTop ?? 0) <= 0 ? event.touches[0].clientY : -1;
    dragging = false;
  }, { passive: true });
  sheet.addEventListener('touchmove', (event) => {
    if (startY < 0) return;
    const dy = event.touches[0].clientY - startY;
    if (!dragging && dy > 8) { dragging = true; sheet.style.transition = 'none'; }
    if (!dragging) return;
    event.preventDefault();
    sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  sheet.addEventListener('touchend', (event) => {
    if (!dragging) return;
    const dy = event.changedTouches[0].clientY - startY;
    sheet.style.transition = '';
    sheet.style.transform = '';
    dragging = false;
    if (dy > Math.min(120, sheet.offsetHeight / 3)) close(null);
  });

  document.body.append(backdrop, sheet);
  void sheet.offsetWidth;
  sheet.classList.add('is-open');
  backdrop.classList.add('is-open');
  open = handle;
  void render();
  return done;
}
