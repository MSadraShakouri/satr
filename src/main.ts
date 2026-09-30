import { readViewMemory, writeViewMemory, viewMemoryKey, type ViewIdentity, type SavedView } from './viewMemory';
import type { EditorState } from '@codemirror/state';
import '@codemirror/view';
import 'katex/dist/katex.min.css';
import './style.css';
import './externalFiles.css';
import { SatrEditor } from './editor';
import { renderMarkdown } from './markdown';
import { layoutMath, scheduleMathLayout } from './mathLayout';
import { applyEditorScroll, applyPreviewScroll, editorScroll, previewScroll } from './scrollSync';
import { footnoteLayout } from './footnoteDialog';
import { closePopover, isPopoverOpen, openPopover } from './popover';
import { createRightSidebar } from './rightSidebar';
import { majorityDirection } from './direction';
import { setMathDigits } from './math';
import { createLeftSidebar } from './leftSidebar';
import { initDrawers } from './drawers';
import { closeMenu, isMenuOpen, openMenu, type MenuEntry } from './menu';
import { showNotice, type NoticeHandle } from './notice';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { closeTabSwitcher, isTabSwitcherOpen, openTabSwitcher } from './tabs';
import { closeSettings, isSettingsOpen, loadSettings, openSettings, type QuickAction, type Settings } from './settings';
import { setHighlightAll } from './findBar';
import { exportPdf } from './exportPdf';
import { loadPrintOptions, printOptionsKey } from './printOptions';
import demoNote from '../demo.md?raw';
import { loadImages } from './images';
import { dropSnapshot, keepSnapshots } from './snapshot';
import { ensureFileAccess, setupSystemBars, systemBars } from './native';
import { onIncomingFile, openIncomingFile, openIncomingInOtherApp, pendingIncomingFile, readIncomingText, supportsIncomingFiles, writeIncomingText, type IncomingOpenFile } from './openWith';
import { currentScope, scopeName, scopeRoot } from './spaces';
import { backend, DEFAULT_FOLDER, dirname, extension, freeName, isNote, joinPath, looksBinary, migrateOldNotes, mimeType, stem, walkNotes, within } from './vault';

type Mode = 'edit' | 'preview';
// The first note in a fresh browser: the demo (demo.md, at the top of the repo).
const starter = demoNote;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="app-shell">
    <div class="topbar">
      <button class="floating-button sidebar-button" id="files" aria-label="Open files"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="2" width="22" height="20" rx="4"/><rect x="4" y="5" width="2" height="14" rx="2" fill="currentColor"/></svg></button>
      <div class="topbar-actions">
        <button class="floating-button" id="preview-toggle" aria-label="Toggle preview"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.75 5.25A2.25 2.25 0 0 1 5 3h3.25A3.75 3.75 0 0 1 12 6.75V20a3.75 3.75 0 0 0-3.75-3.75H5a2.25 2.25 0 0 0-2.25 2.25z"/><path d="M21.25 5.25A2.25 2.25 0 0 0 19 3h-3.25A3.75 3.75 0 0 0 12 6.75V20a3.75 3.75 0 0 1 3.75-3.75H19a2.25 2.25 0 0 1 2.25 2.25z"/></svg></button>
      </div>
    </div>
    <aside class="file-panel workspace-drawer mod-left" id="file-panel" aria-label="Files"></aside>
    <aside class="right-panel workspace-drawer mod-right" id="right-panel" aria-label="Outline and search"></aside>
    <div class="backdrop" id="backdrop"></div>
    <main class="workspace">
      <section class="editor-pane" id="editor-pane" aria-label="Editor"><div id="editor"></div></section>
      <section class="empty-state" id="empty-tab" aria-label="New tab"></section>
      <section class="preview-pane" id="preview-pane" aria-label="Preview"><article id="preview"></article></section>
    </main>
    <div class="edit-toolbar" id="edit-toolbar" role="toolbar" aria-label="Formatting" data-ignore-swipe>
      <div class="edit-toolbar-list-container"><div class="edit-toolbar-list" id="edit-toolbar-list">
        <button tabindex="-1" data-command="undo" aria-label="Undo"><svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>
        <button tabindex="-1" data-command="redo" aria-label="Redo"><svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg></button>
        <button tabindex="-1" data-command="heading" aria-label="Heading"><svg viewBox="0 0 24 24"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg></button>
        <button tabindex="-1" data-command="bullet" aria-label="Bulleted list"><svg viewBox="0 0 24 24"><path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13"/></svg></button>
        <button tabindex="-1" data-command="ordered" aria-label="Numbered list"><svg viewBox="0 0 24 24"><path d="M10 12h11M10 18h11M10 6h11M4 10h2M4 6h1v4M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg></button>
        <button tabindex="-1" data-command="task" aria-label="To-do"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/></svg></button>
        <button tabindex="-1" data-command="math" aria-label="Math"><svg viewBox="0 0 24 24"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></button>
        <button tabindex="-1" data-command="footnote" aria-label="Footnote"><svg viewBox="0 0 24 24"><path d="M3 7h10M3 12h10M3 17h7"/><path d="M17 5.5 19 4v7M17 11h4"/></svg></button>
        <button tabindex="-1" data-command="deleteLine" aria-label="Delete line"><svg viewBox="0 0 24 24"><path d="M10 11v6M14 11v6M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        <button tabindex="-1" data-command="lineBelow" aria-label="New line below"><svg viewBox="0 0 24 24"><path d="M20 4v7a4 4 0 0 1-4 4H4"/><path d="m9 10-5 5 5 5"/></svg></button>
        <button tabindex="-1" data-command="lineUp" aria-label="Move line up"><svg viewBox="0 0 24 24"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg></button>
        <button tabindex="-1" data-command="lineDown" aria-label="Move line down"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg></button>
      </div></div>
      <div class="edit-toolbar-floating"><button tabindex="-1" data-act="hide-keyboard" aria-label="Hide keyboard"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button></div>
    </div>
    <div class="navbar-wrap" id="navbar-wrap">
      <nav class="mobile-navbar" id="navbar" aria-label="Navigation" data-ignore-swipe>
        <div class="mobile-navbar-actions">
          <div class="mobile-navbar-action"><button type="button" id="nav-back" aria-label="Previous tab"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg></button></div>
          <div class="mobile-navbar-action"><button type="button" id="nav-forward" aria-label="Next tab"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button></div>
          <div class="mobile-navbar-action"><button type="button" id="nav-find" aria-label="Find in note"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg></button></div>
          <div class="mobile-navbar-action"><button type="button" id="nav-new" aria-label="New note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button></div>
          <div class="mobile-navbar-action"><button type="button" id="nav-tabs" class="mobile-navbar-action-tabs" aria-label="Tabs"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/></svg><span class="mobile-navbar-tabs-number">1</span></button></div>
          <div class="mobile-navbar-action"><button type="button" id="nav-menu" aria-label="Menu"></button></div>
        </div>
      </nav>
    </div>
    <section class="external-file-screen" id="external-file-screen" hidden></section>
  </div>`;

const preview = document.querySelector<HTMLElement>('#preview')!;
const externalFileScreen = document.querySelector<HTMLElement>('#external-file-screen')!;
const EXTERNAL_PATH_PREFIX = 'satr-open://';
const externalFilesByPath = new Map<string, IncomingOpenFile>();
const handledIncomingIds = new Set<string>();
const isExternalPath = (path: string): boolean => path.startsWith(EXTERNAL_PATH_PREFIX);
const externalPath = (id: string, name: string): string => `${EXTERNAL_PATH_PREFIX}${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
const displayNameForPath = (path: string): string => {
  const external = externalFilesByPath.get(path);
  return external ? (external.name.replace(/\.[^.]+$/, '') || external.name) : stem(path);
};
/** Any file opens: Satr shows what a picture or a binary contains as text if
 *  it must (see looksBinary). Only a file too large to load is refused. */
const isPicture = (path: string): boolean => {
  const external = externalFilesByPath.get(path);
  return (external ? external.mimeType : mimeType(path)).startsWith('image/');
};
/** The note's name, for the messages about files that wouldn't open. */
const fileName = (path: string): string => externalFilesByPath.get(path)?.name ?? path.slice(path.lastIndexOf('/') + 1);
/** Markdown and text notes can be renamed from the title; anything else is
 *  opened raw, and its name is changed from the sidebar's long-press menu. */
const canRenameInline = (path: string): boolean => !isExternalPath(path) && ['md', 'markdown'].includes(extension(path));
/** A picture the reading view can show: the data: URL of the file open in the
 *  tab (a photo from the file manager, or an image found in the folders). */
const picture = { path: '', url: '' };
function rememberPicture(path: string, url: string | null | undefined): boolean {
  if (!url?.startsWith('data:image/')) return false;
  picture.path = path;
  picture.url = url;
  return true;
}
let mode: Mode = 'edit';
/** The last file the "not plain text" notice was shown for. */
let lossyNoticed = '';
let saveTimer: number | undefined;
let viewTimer: number | undefined;
let viewGeneration = 0;
let restoringView = true; // until the saved position has been applied
const bookIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.75 5.25A2.25 2.25 0 0 1 5 3h3.25A3.75 3.75 0 0 1 12 6.75V20a3.75 3.75 0 0 0-3.75-3.75H5a2.25 2.25 0 0 0-2.25 2.25z"/><path d="M21.25 5.25A2.25 2.25 0 0 0 19 3h-3.25A3.75 3.75 0 0 0 12 6.75V20a3.75 3.75 0 0 1 3.75-3.75H19a2.25 2.25 0 0 1 2.25 2.25z"/></svg>';
const penIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.2 18.8 1.1-4.4L16.7 3a2.1 2.1 0 0 1 3 3L8.3 17.7z"/><path d="M11 18.8h8.5"/></svg>';
let editor: SatrEditor;
const toolbar = document.querySelector<HTMLElement>('#edit-toolbar')!;
const previewPane = preview.parentElement!;
// Keyboard toolbar strip height (Obsidian: --mobile-toolbar-height = 52px,
// holding a 44px pill).
const TOOLBAR_STRIP = 52;
/** How much of the layout viewport the on-screen keyboard covers (0 when the
 *  WebView is resized for it instead, as in the Capacitor app). */
function keyboardOverlap(): number {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, window.innerHeight - (viewport.offsetTop + viewport.height));
}
/** Height hidden at the bottom of the screen: keyboard overlap + toolbar. */
const obscuredBottom = (): number => keyboardOverlap() + (document.body.classList.contains('keyboard-open') ? TOOLBAR_STRIP : 0);
footnoteLayout.obscuredBottom = obscuredBottom;
// Split view (wide screens, same breakpoint as style.css): keep the other
// pane in step, by source line. The flag stops the follower's own scroll
// event from echoing back. A media query instead of measuring both panes on
// every scroll event, which forced a layout per event.
const splitView = window.matchMedia('(min-width: 761px)');
let syncingScroll = false;
// See holdEditorPosition().
let holdUntil = 0;
let holdLine = 0;
function follow(from: 'editor' | 'preview'): void {
  if (syncingScroll || restoringView || !splitView.matches) return;
  const generation = viewGeneration;
  syncingScroll = true;
  if (from === 'editor') applyPreviewScroll(previewPane, preview, editorScroll(editor.view));
  else applyEditorScroll(editor.view, previewScroll(previewPane, preview), () => generation === viewGeneration);
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => { if (generation === viewGeneration) syncingScroll = false; }));
}

// Notes are files in folders (src/vault.ts: localStorage in the browser,
// the phone's storage in the app), addressed by path. The open note's path
// is remembered under satr:current; notes from earlier versions are moved
// into the "Notes" folder once.
const CURRENT_KEY = 'satr:current';
let filePath = migrateOldNotes() ?? localStorage.getItem(CURRENT_KEY) ?? '';
if (isExternalPath(filePath)) { filePath = ''; localStorage.removeItem(CURRENT_KEY); }
let fileBase = stem(filePath);
interface FileVersion { text: string; mtime: number }
let diskBase: { path: string; text: string; mtime: number } | null = null;
let activeSave: Promise<boolean> | null = null;
/** Names in the open note's folder (lower case), for checking a new title as you type. */
let siblingNames = new Set<string>();
async function loadSiblings(): Promise<void> {
  if (isExternalPath(filePath)) { siblingNames = new Set(); return; }
  const dir = dirname(filePath);
  siblingNames = new Set((await backend.list(dir).catch(() => [])).map((e) => e.name.toLowerCase()));
}
const nameTaken = (base: string): boolean => base.toLowerCase() !== fileBase.toLowerCase() && siblingNames.has(`${base}.md`.toLowerCase());
// Per-file view memory, kept across sessions and app restarts: the mode and
// the scroll position (as a fractional source line, the same measure the
// edit/preview toggle uses), under satr:view:<path>.
function viewIdentity(path: string): ViewIdentity {
  const sourceId = externalFilesByPath.get(path)?.viewId;
  return { path, sourceId, temporary: isExternalPath(path) && !sourceId };
}
const viewKey = (path: string): string => viewMemoryKey(viewIdentity(path));
const readView = (path: string): SavedView | null => readViewMemory(viewIdentity(path));

// The preview is rendered only when it can be seen. Rendering the whole note
// (markdown, highlight.js, KaTeX) on every keystroke into a hidden pane was
// most of the typing cost on long notes. In split view it follows typing
// after a short pause; switching to preview renders it at once if stale.
let previewReady: Promise<unknown> = Promise.resolve();
let previewDirty = true;
let renderTimer: number | undefined;
const previewVisible = (): boolean => mode === 'preview' || splitView.matches;
// Reading view shows the note's name on top, like Obsidian's inline title.
const escapeText = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
let lastRender = 0;
function renderPreview(): void {
  window.clearTimeout(renderTimer);
  previewDirty = false;
  lastRender = Date.now();
  const title = `<div class="inline-title" dir="auto">${escapeText(fileBase)}</div>`;
  // A picture Satr can't edit (a photo opened from the file manager, say):
  // the reading view shows it as it is; the editor keeps the raw bytes.
  if (picture.url && picture.path === filePath) {
    preview.innerHTML = `${title}<p class="md-image-preview"><img class="md-image" src="${escapeText(picture.url)}" alt="${escapeText(fileName(filePath))}"></p>`;
    applyPreviewFolds();
    return;
  }
  preview.innerHTML = `${title}${renderMarkdown(editor.getValue())}`;
  applyPreviewFolds();
  scheduleMathLayout(preview);
  markBrokenLinks();
  const path = filePath;
  previewReady = loadImages(preview, path).then(() => { if (path === filePath) layoutMath(preview); });
}
function setPreviewTitle(): void {
  const title = preview.querySelector<HTMLElement>('.inline-title');
  if (title) title.textContent = fileBase;
}

// Folded headings in the preview mirror the editor's folds (one set of folds
// per note, shared by both modes): a section is hidden when a heading above
// it, of a higher level and with no heading of the same or higher level in
// between, is folded. Only headings with something under them get a chevron.
function applyPreviewFolds(): void {
  const folded = new Set(editor.foldedLines());
  let hideBelow = 7; // hide sections until a heading of this level or higher
  for (const section of preview.querySelectorAll<HTMLElement>(':scope > .md-section')) {
    const heading = section.firstElementChild as HTMLElement | null;
    const match = heading && /^H([1-6])$/.exec(heading.tagName);
    const level = match ? Number(match[1]) : 0;
    if (level && level <= hideBelow) hideBelow = 7;
    section.classList.toggle('is-folded-away', hideBelow < 7);
    if (!level || hideBelow < 7) continue;
    // Has content under it: the next section isn't a heading of the same or higher level.
    let next = section.nextElementSibling as HTMLElement | null;
    while (next && !next.classList.contains('md-section')) next = next.nextElementSibling as HTMLElement | null;
    const nextMatch = next && /^H([1-6])$/.exec(next.firstElementChild?.tagName ?? '');
    const hasContent = Boolean(next) && !(nextMatch && Number(nextMatch[1]) <= level);
    const isFolded = hasContent && folded.has(Number(section.dataset.line));
    heading!.classList.toggle('has-fold', hasContent);
    heading!.classList.toggle('is-folded', isFolded);
    if (isFolded) hideBelow = level;
  }
}
interface SaveConflict {
  path: string;
  remoteText: string | null;
  localText: string;
  mtime: number;
}

function setDiskBaseIfCurrent(path: string, version: FileVersion): void {
  if (filePath === path) diskBase = { path, ...version };
}

function closeSaveConflict(): void {
  document.querySelector('#save-conflict-dialog')?.remove();
}

function offerSaveConflict(conflict: SaveConflict): void {
  editor.view.contentDOM.blur(); // keep the choices above the keyboard on a phone
  document.querySelector('#save-conflict-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'save-conflict-overlay';
  overlay.id = 'save-conflict-dialog';
  overlay.innerHTML = `
    <section class="save-conflict-card" role="alertdialog" aria-modal="true" aria-labelledby="save-conflict-title" aria-describedby="save-conflict-message">
      <h2 id="save-conflict-title">${conflict.remoteText === null ? 'File missing' : 'File changed elsewhere'}</h2>
      <p id="save-conflict-message">${conflict.remoteText === null
        ? `“${escapeText(displayNameForPath(conflict.path))}” was removed or is no longer accessible. Re-create it with your edits, or keep editing without saving.`
        : `“${escapeText(displayNameForPath(conflict.path))}” has a newer version on disk. Choose which version to keep.`}</p>
      <div class="save-conflict-actions">
        ${conflict.remoteText !== null ? '<button type="button" data-conflict="reload">Reload disk version</button>' : ''}
        <button type="button" class="mod-warning" data-conflict="overwrite">${conflict.remoteText === null ? 'Save my version' : 'Overwrite with mine'}</button>
        <button type="button" data-conflict="cancel">Cancel</button>
      </div>
    </section>`;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeSaveConflict();
  });
  overlay.querySelector<HTMLButtonElement>('[data-conflict="reload"]')?.addEventListener('click', () => {
    if (conflict.remoteText !== null) {
      closeSaveConflict();
      reloadOpenText(conflict.path, conflict.remoteText, conflict.mtime);
    }
  });
  overlay.querySelector<HTMLButtonElement>('[data-conflict="overwrite"]')?.addEventListener('click', () => {
    closeSaveConflict();
    void overwriteConflict(conflict);
  });
  overlay.querySelector<HTMLButtonElement>('[data-conflict="cancel"]')?.addEventListener('click', closeSaveConflict);
  document.body.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>('[data-conflict="reload"], [data-conflict="overwrite"], [data-conflict="cancel"]')?.focus();
}

function reloadOpenText(path: string, text: string, mtime: number): void {
  if (path !== filePath) return;
  const selection = editor.view.state.selection.main;
  const position = mode === 'preview' ? previewScroll(previewPane, preview) : editorScroll(editor.view);
  const wasRestoring = restoringView;
  restoringView = true;
  editor.replaceValue(text);
  const length = editor.view.state.doc.length;
  editor.view.dispatch({ selection: {
    anchor: Math.min(selection.anchor, length),
    head: Math.min(selection.head, length),
  } });
  diskBase = { path, text, mtime };
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  previewDirty = true;
  if (previewVisible()) renderPreview();
  if (mode === 'preview') applyPreviewScroll(previewPane, preview, position);
  else applyEditorScroll(editor.view, position);
  restoringView = wasRestoring;
  ownScroll(250);
  void showNotice('Updated from the version on disk.', 2500);
}

async function readDiskVersion(path: string): Promise<FileVersion | null> {
  if (isExternalPath(path)) {
    const incoming = externalFilesByPath.get(path);
    if (!incoming) throw new Error('The incoming file is no longer available');
    const current = await readIncomingText(incoming.id);
    return { text: current.text, mtime: current.modified };
  }
  const [text, entry] = await Promise.all([backend.read(path), backend.stat(path)]);
  if (text === null && entry) throw new Error('The file exists but could not be read');
  return text === null ? null : { text, mtime: entry?.mtime ?? 0 };
}

let refreshingOnResume = false;
let lastResumeRefresh = 0;
async function refreshOnResume(): Promise<void> {
  const now = Date.now();
  if (refreshingOnResume || now - lastResumeRefresh < 800) return;
  refreshingOnResume = true;
  lastResumeRefresh = now;
  try {
    await Promise.allSettled([leftSidebar.refresh(), sidebar.refresh()]);
    editor.remeasure(); // font scale or WebView size may have changed while paused
    if (previewVisible()) scheduleMathLayout(preview);
    void refreshLinkIndex();
    const path = filePath;
    const baseline = diskBase?.path === path ? diskBase : null;
    if (!path || !baseline || (isExternalPath(path) && externalFilesByPath.get(path)?.kind !== 'text')) return;
    const disk = await readDiskVersion(path);
    if (filePath !== path || !disk) {
      if (filePath === path && !disk) offerSaveConflict({ path, remoteText: null, localText: editor.getValue(), mtime: 0 });
      return;
    }
    if (disk.text === baseline.text) {
      diskBase = { path, ...disk };
      return;
    }
    const localText = editor.getValue();
    if (localText === baseline.text) reloadOpenText(path, disk.text, disk.mtime);
    else offerSaveConflict({ path, remoteText: disk.text, localText, mtime: disk.mtime });
  } catch (error) {
    showNotice(`Couldn't refresh: ${error instanceof Error ? error.message : String(error)}`, 4000);
  } finally {
    refreshingOnResume = false;
  }
}

async function performSave(path: string, text: string, authorization?: SaveConflict): Promise<boolean> {
  const disk = await readDiskVersion(path);
  const baseline = diskBase?.path === path ? diskBase : null;
  if (disk?.text === text) {
    setDiskBaseIfCurrent(path, disk);
    return true;
  }
  const externalChange = baseline ? (!disk || disk.text !== baseline.text) : disk !== null;
  const authorized = Boolean(authorization && authorization.path === path
    && authorization.remoteText === (disk?.text ?? null));

  if (externalChange && !authorized) {
    // The note has no local edits: follow the external write automatically.
    if (baseline && text === baseline.text && disk) {
      reloadOpenText(path, disk.text, disk.mtime);
      return true;
    }
    offerSaveConflict({ path, remoteText: disk?.text ?? null, localText: text, mtime: disk?.mtime ?? 0 });
    return false;
  }

  if (isExternalPath(path)) {
    const incoming = externalFilesByPath.get(path);
    if (!incoming || incoming.readOnly) return false;
    await writeIncomingText(incoming.id, text);
    const updated = await readIncomingText(incoming.id);
    setDiskBaseIfCurrent(path, { text: updated.text, mtime: updated.modified });
  } else {
    // A file that isn't text was opened read-only, and it stays that way:
    // writing the decoded text back would destroy the original bytes.
    if (diskBase?.path === path && looksBinary(diskBase.text)) {
      showNotice('This file isn’t plain text; Satr won’t write over it.', 5000);
      return false;
    }
    await backend.write(path, text);
    const entry = await backend.stat(path);
    setDiskBaseIfCurrent(path, { text, mtime: entry?.mtime ?? Date.now() });
  }
  return true;
}

async function overwriteConflict(conflict: SaveConflict): Promise<void> {
  const text = filePath === conflict.path ? editor.getValue() : conflict.localText;
  try {
    if (!await performSave(conflict.path, text, conflict)) {
      showNotice('The file changed again. Review the newer conflict before saving.', 5000);
    }
  } catch (error) {
    showNotice(`Couldn’t overwrite: ${error instanceof Error ? error.message : String(error)}`, 5000);
  }
}

async function saveNow(): Promise<boolean> {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  const path = filePath;
  if (!path) return false;
  if (isExternalPath(path)) {
    const incoming = externalFilesByPath.get(path);
    if (!incoming || (incoming.kind !== 'text' && incoming.kind !== 'shared-text') || incoming.readOnly || incoming.kind === 'shared-text') return true;
  }
  if (activeSave) {
    const pending = activeSave;
    let previousSave = false;
    try { previousSave = await pending; } catch { /* the owner already reported its error */ }
    if (!previousSave || filePath !== path) return false;
    const current = editor.getValue();
    if (diskBase?.path !== path || current !== diskBase.text) return saveNow();
    return true;
  }
  const text = editor.getValue();
  const task = performSave(path, text);
  activeSave = task;
  let saved = false;
  try {
    saved = await task;
  } catch (error) {
    showNotice(`Couldn't save: ${error instanceof Error ? error.message : String(error)}`, 5000);
    return false;
  } finally {
    if (activeSave === task) activeSave = null;
  }
  if (saved && filePath === path && editor.getValue() !== diskBase?.text) return saveNow();
  return saved;
}
function update(): void {
  previewDirty = true;
  window.clearTimeout(renderTimer);
  if (previewVisible()) renderTimer = window.setTimeout(renderPreview, 250);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 700);
}
splitView.addEventListener('change', () => { if (splitView.matches && previewDirty) renderPreview(); });
function setMode(next: Mode, restoredLine?: number): void {
  if (restoredLine === undefined) releaseHold();
  const generation = viewGeneration;
  // Read the position from the pane that is visible *now* — a display:none
  // pane reports scrollTop 0, which is what used to send preview to the top.
  const position = restoredLine ?? (mode === 'preview' ? previewScroll(previewPane, preview) : editorScroll(editor.view));
  mode = next;
  document.body.dataset.mode = mode;
  const previewButton = document.querySelector<HTMLButtonElement>('#preview-toggle')!;
  previewButton.innerHTML = mode === 'edit' ? bookIcon : penIcon;
  previewButton.setAttribute('aria-label', mode === 'edit' ? 'Open preview' : 'Return to editor');
  syncingScroll = true;
  if (mode === 'preview') {
    if (previewDirty) renderPreview();
    layoutMath(preview); // settle math line breaks before measuring positions
    // Switching only: the mapping re-measures the rendered math/table heights
    // as they settle and compensates (src/scrollSync.ts).
    applyPreviewScroll(previewPane, preview, position, () => generation === viewGeneration, true);
  } else {
    applyEditorScroll(editor.view, position, () => generation === viewGeneration, true);
    holdEditorPosition(position);
  }
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => { if (generation === viewGeneration) syncingScroll = false; }));
  rememberViewSoon();
}
function toggleFiles(open?: boolean): void { drawers.toggle('left', open); }
function toggleOutline(open?: boolean): void { drawers.toggle('right', open); }

editor = new SatrEditor(document.querySelector('#editor')!, update, {
  title: fileBase,
  onSelection: () => rememberViewSoon(),
  onFold: () => { applyPreviewFolds(); renderMenuButton(); rememberViewSoon(); },
  linkNames: () => { if (Date.now() - linkIndexAt > 30000) void refreshLinkIndex(); return noteNames(); },
  openLink: (target, heading) => openLink(target, heading),
  obscuredBottom: () => obscuredBottom(),
  checkName: (base) => (nameTaken(base) ? 'There is already a file with that name' : null),
  onRename: (base) => {
    if (isExternalPath(filePath)) return 'Files opened from another app cannot be renamed in Satr';
    if (nameTaken(base)) return 'There is already a file with that name';
    const from = filePath;
    const oldBase = fileBase;
    const to = joinPath(dirname(from), `${base}.md`);
    editor.setReadOnly(true); // avoid edits racing the path move
    void (async () => {
      try {
        if (!await saveNow()) { fileBase = oldBase; editor.setTitle(oldBase); setPreviewTitle(); return; }
        const exists = await backend.stat(from);
        if (exists) await backend.rename(from, to);
        else {
          if (await backend.stat(to)) throw new Error('Something with that name already exists');
          await backend.write(to, editor.getValue());
        }
        pathMoved(from, to);
        const [text, entry] = await Promise.all([backend.read(to), backend.stat(to)]);
        diskBase = { path: to, text: text ?? editor.getValue(), mtime: entry?.mtime ?? 0 };
        void loadSiblings();
      } catch (error) {
        fileBase = oldBase;
        editor.setTitle(oldBase);
        setPreviewTitle();
        leftSidebar.hint(error instanceof Error ? error.message : String(error), true);
      } finally {
        editor.setReadOnly(false);
      }
    })();
    fileBase = base;
    setPreviewTitle();
    return null;
  },
});
window.addEventListener('satr:font-scale-change', () => {
  editor.remeasure();
  if (previewVisible()) { layoutMath(preview); scheduleMathLayout(preview); }
});
// Auto-hide navigation, as Obsidian's "auto full screen" (MobileNavbar.
// onScroll, read in its app.js): scrolling down hides the header buttons,
// the bottom bar and the Android status bar (in the app); scrolling up, or a
// tap, brings them back. What makes it feel calm:
// - movement is measured against the position where the bars last changed
//   (or last passed the threshold), not per scroll event, and it takes 1/8
//   of a line (Obsidian's 0.125 in line units) to count;
// - scrolls the app makes itself — restoring a position, keeping split view
//   in step, CodeMirror correcting its height estimates, a re-render — are
//   ignored (Obsidian skips scrolls within 100ms of a render the same way).
// Nothing hides while the keyboard is up.
const LINE_PX = 16 * 1.5;
const NAV_THRESHOLD = 0.125 * LINE_PX;
let navHidden = false;
function hideNavigation(): void {
  if (navHidden) return;
  navHidden = true;
  document.body.classList.add('is-hidden-nav');
  void systemBars()?.hide().catch(() => undefined);
}
function restoreNavigation(): void {
  if (!navHidden) return;
  navHidden = false;
  document.body.classList.remove('is-hidden-nav');
  void systemBars()?.show().catch(() => undefined);
}
const scrollAnchors = new WeakMap<Element, number>();
let programmaticUntil = 0;
/** Mark the next moment's scroll events as the app's own. */
function ownScroll(ms = 150): void { programmaticUntil = Math.max(programmaticUntil, performance.now() + ms); }
function onNavScroll(el: HTMLElement): void {
  const top = el.scrollTop;
  const anchor = scrollAnchors.get(el) ?? 0; // panes start at the top
  if (syncingScroll || restoringView || performance.now() < programmaticUntil
    || Date.now() - lastRender < 100 || el.getBoundingClientRect().height === 0
    || editor.findOpen) { // jumping between matches is the app scrolling, not you
    scrollAnchors.set(el, top);
    return;
  }
  if (document.body.classList.contains('keyboard-open') || keyboardOverlap() > 120) { scrollAnchors.set(el, top); return; }
  if (top <= 0) { scrollAnchors.set(el, 0); restoreNavigation(); return; }
  const delta = top - anchor;
  if (Math.abs(delta) < NAV_THRESHOLD) return;
  scrollAnchors.set(el, top);
  if (delta > 0) hideNavigation();
  else restoreNavigation();
}
// mousedown, not pointerdown: on touch screens it only fires for taps, not
// for the start of a scroll (same event Obsidian listens to).
window.addEventListener('mousedown', restoreNavigation);
// For a moment after a note or the editing view is shown, its place is held:
// a scroll nobody asked for (the caret being pulled into view while the
// keyboard or the system bars settle) is undone. Any touch, wheel or key
// on the note ends the hold at once.
function holdEditorPosition(line: number): void {
  holdLine = line;
  holdUntil = performance.now() + 1200;
}
const releaseHold = (): void => {
  holdUntil = 0;
  ++viewGeneration; // user intent cancels every outstanding restore/correction
  restoringView = false;
  syncingScroll = false;
};
for (const type of ['touchstart', 'wheel', 'keydown', 'mousedown'] as const) {
  editor.view.dom.addEventListener(type, releaseHold, { passive: true, capture: true });
  previewPane.addEventListener(type, releaseHold, { passive: true, capture: true });
}
editor.view.scrollDOM.addEventListener('scroll', () => {
  if (mode === 'edit' && performance.now() < holdUntil && !syncingScroll && Math.abs(editorScroll(editor.view) - holdLine) > 0.5) {
    const generation = viewGeneration;
    syncingScroll = true;
    applyEditorScroll(editor.view, holdLine, () => generation === viewGeneration);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => { if (generation === viewGeneration) syncingScroll = false; }));
    return;
  }
  onNavScroll(editor.view.scrollDOM);
  follow('editor');
  rememberViewSoon();
}, { passive: true });
previewPane.addEventListener('scroll', () => { onNavScroll(previewPane); follow('preview'); rememberViewSoon(); }, { passive: true });
new ResizeObserver(() => scheduleMathLayout(preview)).observe(previewPane);
document.fonts?.addEventListener?.('loadingdone', () => scheduleMathLayout(preview));

function rememberView(): void {
  window.clearTimeout(viewTimer);
  if (restoringView) return;
  const line = mode === 'preview' ? previewScroll(previewPane, preview) : editorScroll(editor.view);
  const folds = editor.foldedLines();
  if (!filePath) return;
  const saved: SavedView = { mode, line: Math.round(line * 1000) / 1000, cursor: editor.getSelection(), ...(folds.length ? { folds } : {}) };
  writeViewMemory(viewIdentity(filePath), saved);
}
function rememberViewSoon(): void {
  window.clearTimeout(viewTimer);
  if (restoringView) return;
  viewTimer = window.setTimeout(rememberView, 400);
}
function restoreView(path: string, after?: () => void, unvisited: Mode = 'edit'): void {
  window.clearTimeout(viewTimer);
  const generation = ++viewGeneration;
  const current = () => generation === viewGeneration && path === filePath;
  const view = readView(path);
  const line = view?.line ?? 0;
  restoringView = true;
  if (view?.cursor) editor.setSelection(view.cursor[0], view.cursor[1]);
  if (view?.folds?.length) editor.restoreFolds(view.folds);
  // Never sample the previous file's pane while installing the new file.
  setMode(view?.mode ?? unvisited, line);
  const apply = (): void => {
    if (!current()) return;
    ownScroll();
    syncingScroll = true;
    if (mode === 'preview') {
      layoutMath(preview);
      applyPreviewScroll(previewPane, preview, line);
    } else {
      applyEditorScroll(editor.view, line, current);
      holdEditorPosition(line);
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (current()) syncingScroll = false;
    }));
  };
  apply();
  void (document.fonts?.ready ?? Promise.resolve()).then(() => window.requestAnimationFrame(() => {
    if (!current()) return;
    apply();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (!current()) return;
      restoringView = false;
      after?.();
    }));
  }));
  // Images can settle after fonts. Correct only if this is still the same
  // reading session and the reader has not touched/scrolled/jumped since.
  if (previewVisible()) void previewReady.then(() => window.requestAnimationFrame(apply));
}
// Leaving the app (switching away, closing, the OS killing it later): write
// the note and the view out now instead of waiting for the debounce timers.
const flush = (): void => {
  if (saveTimer !== undefined) saveNow();
  rememberView();
};
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
  else if (document.visibilityState === 'visible') void refreshOnResume();
});

(document.querySelector('#preview-toggle') as HTMLButtonElement).onclick = () => setMode(mode === 'edit' ? 'preview' : 'edit');
document.querySelector('#files')!.addEventListener('click', () => toggleFiles());
// Tabs: every note opens in its own tab (a note that's already open just
// switches to its tab), and the bottom bar's arrows step to the previous /
// next tab. Tabs can be reordered in the switcher. Each note comes back
// with its own mode, position, caret and folds. Kept under satr:tabs.
interface Tab { path: string; session?: EditorState } // '' is an empty tab ("No file is open")
const TABS_KEY = 'satr:tabs';
let tabs: Tab[] = [{ path: '' }];
let activeTab = 0;
let displayedTab: Tab | null = null;
const curTab = (): Tab => tabs[activeTab];
function saveTabs(): void {
  const safeTabs = tabs.filter((tab) => !isExternalPath(tab.path));
  if (!safeTabs.length) safeTabs.push({ path: '' });
  const active = safeTabs.findIndex((tab) => tab === curTab());
  const savedActive = active >= 0 ? active : Math.min(Math.max(0, activeTab - 1), safeTabs.length - 1);
  localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: safeTabs.map(({ path }) => ({ path })), active: savedActive }));
}
function loadTabs(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null') as { tabs: unknown[]; active: number } | null;
    if (!saved || !Array.isArray(saved.tabs) || !saved.tabs.length) return;
    // Also reads the older format, {history, index} per tab.
    const read = (t: unknown): Tab | null => {
      const o = t as { path?: unknown; history?: unknown; index?: unknown };
      if (typeof o?.path === 'string') return { path: o.path };
      if (Array.isArray(o?.history) && typeof o.index === 'number') { const p = o.history[o.index]; return { path: typeof p === 'string' ? p : '' }; }
      return null;
    };
    const list = saved.tabs.map(read);
    if (list.some((t) => !t)) return;
    // One tab per note.
    const seen = new Set<string>();
    const active = list[Math.min(Math.max(0, saved.active | 0), list.length - 1)];
    tabs = (list as Tab[]).filter((t) => !isExternalPath(t.path) && (!t.path || (seen.has(t.path) ? false : (seen.add(t.path), true))));
    if (!tabs.length) tabs = [{ path: '' }];
    activeTab = Math.max(0, tabs.findIndex((t) => t === active || (t.path && t.path === active?.path)));
  } catch { /* keep the default */ }
}
loadTabs(); // before anything renders (and so saves) the navbar
/** Closed tabs, most recent last, for "Reopen closed tab". */
const closedTabs: Tab[] = [];
// Recently opened notes, newest first (the empty tab lists them).
const RECENT_KEY = 'satr:recent';
function recentNotes(): string[] {
  try { const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(list) ? list.filter((p) => typeof p === 'string' && !isExternalPath(p)) : []; } catch { return []; }
}
function setRecent(list: string[]): void { localStorage.setItem(RECENT_KEY, JSON.stringify(list.filter((p) => !isExternalPath(p)).slice(0, 12))); }
async function leaveCurrent(): Promise<boolean> {
  closePopover();
  editor.closeFind();
  const leaving = displayedTab;
  const saved = !filePath || await saveNow();
  if (saved && leaving === displayedTab) { rememberView(); if (leaving) leaving.session = editor.view.state; }
  return saved;
}
function showFile(path: string, content: string, after?: () => void, options?: { lossy?: boolean }): void {
  ++viewGeneration;
  window.clearTimeout(viewTimer);
  window.clearTimeout(renderTimer);
  holdUntil = 0;
  const incoming = externalFilesByPath.get(path);
  // Text Satr had to guess at (a photo's bytes, an old encoding) is shown but
  // never saved back over the original.
  const lossy = options?.lossy ?? (incoming ? Boolean(incoming.lossy) : looksBinary(content));
  externalFileScreen.hidden = true;
  document.body.classList.remove('external-file-active', 'is-empty-tab');
  renderMenuButton();
  // Another note never opens the keyboard or shows the caret: it comes back
  // at its remembered place, unfocused, until you tap into it.
  editor.view.contentDOM.blur();
  curTab().path = path;
  displayedTab = curTab();
  filePath = path;
  fileBase = displayNameForPath(path);
  // A picture is worth showing: the reading view gets it (a data: URL from
  // the file manager, or read here), the editor the bytes as they decode.
  picture.path = '';
  picture.url = '';
  let opening: Mode = 'edit';
  if (isPicture(path)) {
    if (incoming) { if (rememberPicture(path, incoming.dataUrl)) opening = 'preview'; }
    else if (lossy) {
      opening = 'preview'; // the picture is read below, a moment from now
      void backend.readDataUrl(path).then((url) => {
        if (filePath === path && rememberPicture(path, url) && mode === 'preview') renderPreview();
      });
    }
  }
  if (incoming) {
    diskBase = { path, text: content, mtime: incoming.modified ?? 0 };
    localStorage.removeItem(CURRENT_KEY); // incoming URI ids only last for this app session
  } else {
    diskBase = { path, text: content, mtime: 0 };
    localStorage.setItem(CURRENT_KEY, path);
    setRecent([path, ...recentNotes().filter((p) => p !== path)]);
    void backend.stat(path).then((entry) => {
      if (filePath !== path || diskBase?.path !== path || diskBase.text !== content) return;
      if (entry) diskBase.mtime = entry.mtime;
      else diskBase = null; // firstNote() can return an as-yet-unsaved new note
    });
  }
  restoringView = true;
  const session = curTab().session;
  if (session) { editor.restoreSession(session); editor.replaceValue(content); }
  else editor.setValue(content);
  // Inactive states may predate a global settings change.
  editor.setLineNumbers(loadSettings().lineNumbers);
  editor.setReadOnly(Boolean(incoming?.readOnly || incoming?.kind === 'shared-text' || lossy));
  // Say it once per file: the editor takes no writing because the bytes are
  // not text, and nobody should wonder why nothing happens.
  if (lossy && !incoming && !isPicture(path) && lossyNoticed !== path) {
    lossyNoticed = path;
    showNotice('Not plain text: shown read-only, exactly as it decodes.', 4500);
  }
  editor.setTitle(fileBase);
  editor.setTitleEditable(canRenameInline(path));
  window.clearTimeout(saveTimer); // loading isn't an edit
  saveTimer = undefined;
  previewDirty = true;
  if (previewVisible()) renderPreview();
  // A picture opens in the reading view, unless this file has a remembered
  // mode; anything else comes back where it was left.
  restoreView(path, after, opening);
  renderNavButtons();
  sidebar.refresh();
  // Mark the open note, and clear the mark when this file isn't in the tree
  // (opened from another app, or read-only rubbish).
  leftSidebar.reveal(path);
  if (!incoming) void loadSiblings();
}
/** Open a file: its tab if it has one, else a new tab after this one (or
 *  this tab, when it's empty). Any file opens; one that can't be loaded
 *  (too large, or gone) leaves a message in the sidebar instead. */
async function openFile(path: string, after?: () => void): Promise<void> {
  if (path === filePath) { after?.(); return; }
  const existing = tabs.findIndex((t) => t.path === path);
  if (existing >= 0) { await switchTab(existing, after); return; }
  const opened = await backend.readText(path);
  if (opened.status !== 'text') {
    leftSidebar.hint(opened.status === 'too-large'
      ? `“${fileName(path)}” is too large to open here (${formatBytes(opened.size)}).`
      : (await backend.stat(path).catch(() => null) ? 'That file could not be read.' : 'That file no longer exists.'), true);
    void leftSidebar.refresh();
    return;
  }
  if (!await leaveCurrent()) return;
  if (curTab().path) { tabs.splice(activeTab + 1, 0, { path }); activeTab += 1; }
  showFile(path, opened.text, after, { lossy: !opened.clean });
}
/** The bottom bar's arrows: the previous / next tab. */
async function stepTab(step: number): Promise<void> {
  await switchTab(activeTab + step);
}
/** A file or folder moved (renamed): the open note, history and view memory follow. */
function pathMoved(from: string, to: string): void {
  linkIndexAt = 0; // the notes changed: rebuild the link index next time
  const move = (p: string): string => (within(p, from) ? to + p.slice(from.length) : p);
  for (const tab of [...tabs, ...closedTabs]) tab.path = tab.path && move(tab.path);
  setRecent(recentNotes().map(move));
  saveTabs();
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)!;
    const prefix = ['satr:view:', 'satr:pdf:'].find((p) => key.startsWith(p));
    if (prefix && within(key.slice(prefix.length), from)) keys.push(key);
  }
  for (const key of keys) {
    const value = localStorage.getItem(key);
    localStorage.removeItem(key);
    const prefix = key.startsWith('satr:view:') ? 'satr:view:' : 'satr:pdf:';
    if (value !== null) localStorage.setItem(prefix + move(key.slice(prefix.length)), value);
  }
  if (within(filePath, from)) {
    filePath = move(filePath);
    fileBase = stem(filePath);
    localStorage.setItem(CURRENT_KEY, filePath);
    editor.setTitle(fileBase);
    setPreviewTitle();
    void loadSiblings();
  }
  void leftSidebar.refresh();
}
/** A file or folder was deleted: forget it; if the open note went, open another. */
function pathDeleted(path: string): void {
  linkIndexAt = 0; // the notes changed: rebuild the link index next time
  setRecent(recentNotes().filter((p) => !within(p, path)));
  for (let i = closedTabs.length - 1; i >= 0; i -= 1) if (within(closedTabs[i].path, path)) closedTabs.splice(i, 1);
  // Tabs of deleted notes close; the open one hands over to its neighbour.
  const active = curTab();
  const activeGone = Boolean(active.path) && within(active.path, path);
  const kept = tabs.filter((t) => !t.path || !within(t.path, path));
  if (activeGone) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    filePath = '';
    const at = tabs.indexOf(active);
    const next = tabs.slice(at + 1).find((t) => kept.includes(t)) ?? tabs.slice(0, at).reverse().find((t) => kept.includes(t));
    tabs = kept.length ? kept : [{ path: '' }];
    activeTab = next ? tabs.indexOf(next) : 0;
    void openTab(curTab());
  } else {
    tabs = kept;
    activeTab = tabs.indexOf(active);
  }
  renderNavButtons();
}
/** The note to show when none is open: the first in the space, or a new one. */
// Where new notes go: the space's folder; with "All files" in the app, a
// Notes folder rather than the top of the phone's storage (it's created with
// the first note written there).
function notesHome(): string {
  const scope = currentScope();
  return scope.kind === 'all' && backend.kind === 'device' ? DEFAULT_FOLDER : scopeRoot(scope);
}
async function firstNote(): Promise<{ path: string; text: string }> {
  const root = notesHome();
  const notes = (await backend.list(root).catch(() => [])).filter((e) => e.kind === 'file' && isNote(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const note of notes) {
    const text = await backend.read(note.path);
    if (text !== null) return { path: note.path, text };
  }
  // Nothing there. The note is only written once you type in it.
  return { path: joinPath(root, await freeName(root, 'Untitled', '.md')), text: '' };
}
async function openFallback(): Promise<void> {
  const { path, text } = await firstNote();
  filePath = '';
  showFile(path, text);
}
async function newFile(dir = notesHome()): Promise<void> {
  if (!await leaveCurrent()) return;
  linkIndexAt = 0; // the notes changed: rebuild the link index next time
  const path = joinPath(dir, await freeName(dir, 'Untitled', '.md'));
  try { await backend.write(path, ''); } catch (error) { leftSidebar.hint(error instanceof Error ? error.message : String(error), true); return; }
  if (curTab().path) { tabs.splice(activeTab + 1, 0, { path }); activeTab += 1; }
  localStorage.removeItem(viewKey(path));
  localStorage.removeItem(printOptionsKey(path));
  showFile(path, '');
  setMode('edit');
  toggleFiles(false);
  void leftSidebar.refresh();
  editor.focusTitle();
}

function showIncomingScreen(path: string, file: IncomingOpenFile): void {
  ++viewGeneration;
  window.clearTimeout(viewTimer);
  holdUntil = 0;
  restoringView = true; // there is no text viewport to bookmark on this screen
  displayedTab = null;
  filePath = path;
  fileBase = file.name;
  diskBase = null;
  curTab().path = path;
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  editor.view.contentDOM.blur();
  editor.setReadOnly(true);
  editor.setTitle(file.name);
  editor.setTitleEditable(false);
  externalFileScreen.hidden = false;
  document.body.classList.remove('is-empty-tab');
  document.body.classList.add('external-file-active');
  const description = file.dataUrl?.startsWith('data:image/')
    ? 'Shown as a picture, read-only. Open it in another app to edit it.'
    : file.kind === 'too-large'
      ? `Too large for Satr to open as text (${formatBytes(file.size)}). Open it in another app to view or edit it.`
      : 'Satr couldn’t read this file. Open it in another app to view or edit it.';
  externalFileScreen.innerHTML = `
    <div class="external-file-card">
      <button type="button" class="external-file-back" data-external-act="back" aria-label="Back">‹</button>
      <div class="external-file-icon" aria-hidden="true">${file.kind === 'too-large' ? '…' : '↗'}</div>
      <h1 dir="auto">${escapeText(file.name)}</h1>
      <p class="external-file-meta">${escapeText(file.mimeType || 'Unknown file type')}${file.size > 0 ? ` · ${formatBytes(file.size)}` : ''}</p>
      <div class="external-file-preview" id="external-file-preview"></div>
      <p class="external-file-description">${description}</p>
      <div class="external-file-actions">
        <button type="button" class="external-file-primary" data-external-act="other">Open in another app</button>
        <button type="button" data-external-act="back">Back to Satr</button>
      </div>
    </div>`;
  const previewEl = externalFileScreen.querySelector<HTMLElement>('#external-file-preview');
  if (file.dataUrl?.startsWith('data:image/') && previewEl) {
    const image = document.createElement('img');
    image.alt = file.name;
    image.src = file.dataUrl;
    previewEl.appendChild(image);
  }
  externalFileScreen.querySelectorAll<HTMLButtonElement>('[data-external-act="back"]').forEach((button) => {
    button.addEventListener('click', returnFromIncomingFile);
  });
  externalFileScreen.querySelector<HTMLButtonElement>('[data-external-act="other"]')?.addEventListener('click', () => {
    void openIncomingInOtherApp(file.id).catch((error: unknown) => {
      showNotice(error instanceof Error ? error.message : String(error), 5000);
    });
  });
  renderNavButtons();
  // A file from another app isn't in the tree: nothing stays selected there.
  leftSidebar.reveal('');
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function returnFromIncomingFile(): void {
  if (tabs.length > 1) closeTab(activeTab);
  else {
    tabs[0] = { path: '' };
    activeTab = 0;
    showEmptyTab();
  }
}

async function openIncomingPath(path: string, after?: () => void): Promise<void> {
  const existing = externalFilesByPath.get(path);
  if (!existing) { showNotice('This incoming file is no longer available. Open it from the file manager again.', 5000); return; }
  if (existing.kind === 'text' || existing.kind === 'shared-text') {
    try {
      const current = await readIncomingText(existing.id);
      const updated = { ...existing, text: current.text, modified: current.modified, lossy: current.lossy, readOnly: existing.readOnly || current.lossy };
      externalFilesByPath.set(path, updated);
      if (curTab().path === path) showFile(path, current.text, after, { lossy: current.lossy });
    } catch (error) {
      const unavailable: IncomingOpenFile = { ...existing, kind: 'binary', readOnly: true, text: undefined, dataUrl: undefined };
      externalFilesByPath.set(path, unavailable);
      if (curTab().path === path) showIncomingScreen(path, unavailable);
      showNotice(error instanceof Error ? error.message : String(error), 5000);
    }
  } else if (curTab().path === path) showIncomingScreen(path, existing);
}

async function handleIncomingId(id: string): Promise<void> {
  if (!id || handledIncomingIds.has(id)) return;
  handledIncomingIds.add(id);
  try {
    const file = await openIncomingFile(id);
    closeMenu();
    closeTabSwitcher();
    closeSettings();
    const path = externalPath(file.id, file.name);
    externalFilesByPath.set(path, file);
    const existingTab = tabs.findIndex((tab) => tab.path === path);
    if (existingTab >= 0) {
      await switchTab(existingTab);
    } else {
      if (!await leaveCurrent()) return;
      if (curTab().path) { tabs.splice(activeTab + 1, 0, { path }); activeTab += 1; }
      else curTab().path = path;
      await openIncomingPath(path);
      if (file.lossy) showNotice('Not plain text: shown as it decodes, and read-only.', 4500);
      else if (file.kind === 'shared-text') showNotice('Shared text opens read-only.', 4500);
      else if (file.readOnly) showNotice('Opened as read-only; the original file will not be changed.', 4500);
    }
    toggleFiles(false);
    renderNavButtons();
  } catch (error) {
    handledIncomingIds.delete(id);
    showNotice(error instanceof Error ? error.message : String(error), 5000);
  }
}

/** Show a tab's note, or the empty-tab page. A note that's gone closes
 *  its tab. */
async function openTab(tab: Tab, after?: () => void): Promise<void> {
  if (!tab.path) { showEmptyTab(); return; }
  if (isExternalPath(tab.path)) { await openIncomingPath(tab.path, after); return; }
  const opened = await backend.readText(tab.path);
  if (curTab() !== tab) return; // a newer tab activation won the read race
  if (opened.status === 'text') { showFile(tab.path, opened.text, after, { lossy: !opened.clean }); return; }
  if (opened.status === 'too-large') leftSidebar.hint(`“${fileName(tab.path)}” is too large to open here (${formatBytes(opened.size)}).`, true);
  if (tabs.length > 1) {
    const at = tabs.indexOf(tab);
    tabs.splice(at, 1);
    activeTab = Math.min(at, tabs.length - 1);
  } else { tab.path = ''; tab.session = undefined; }
  await openTab(curTab(), after);
}
async function switchTab(index: number, after?: () => void): Promise<void> {
  if (!tabs[index]) return;
  if (index === activeTab) { after?.(); return; }
  if (!await leaveCurrent()) return;
  activeTab = index;
  await openTab(curTab(), after);
}
function newTab(): void {
  void (async () => {
    if (!await leaveCurrent()) return;
    const empty = tabs.findIndex((t) => !t.path);
    if (empty >= 0) activeTab = empty;
    else { tabs.splice(activeTab + 1, 0, { path: '' }); activeTab += 1; }
    showEmptyTab();
  })();
}
function closeTab(index: number): void {
  if (tabs.length < 2 || !tabs[index]) return;
  if (index !== activeTab) {
    if (tabs[index].path) { closedTabs.push({ path: tabs[index].path }); if (closedTabs.length > 20) closedTabs.shift(); }
    tabs.splice(index, 1);
    if (index < activeTab) activeTab -= 1;
    renderNavButtons();
    return;
  }
  void (async () => {
    if (!await leaveCurrent()) return;
    if (tabs[index].path) { closedTabs.push({ path: tabs[index].path }); if (closedTabs.length > 20) closedTabs.shift(); }
    tabs.splice(index, 1);
    activeTab = Math.min(index, tabs.length - 1); // the next tab, or the new last one
    await openTab(curTab());
  })();
}
function reopenClosedTab(): void {
  // A file opened from another app can't come back on its own: its permission
  // lasts for this session only, and its tab has no path in the tree.
  let tab = closedTabs.pop();
  while (tab && isExternalPath(tab.path)) tab = closedTabs.pop();
  if (tab) void openFile(tab.path);
}
/** Drag to reorder in the switcher; the open tab stays the open tab. */
function moveTab(from: number, to: number): void {
  if (!tabs[from] || to < 0 || to >= tabs.length || from === to) return;
  const active = curTab();
  const [tab] = tabs.splice(from, 1);
  tabs.splice(to, 0, tab);
  activeTab = tabs.indexOf(active);
  renderNavButtons();
}

// Wiki links: [[Note]] resolves by name within the space (a note in the same
// folder first, then the shortest path); [[Folder/Note]] by path; [[#Heading]]
// within the note. The index is rebuilt when notes come and go.
let linkIndex: string[] = [];
let linkIndexAt = 0;
async function refreshLinkIndex(): Promise<void> {
  linkIndexAt = Date.now();
  linkIndex = await walkNotes(scopeRoot(currentScope())).catch(() => []);
  markBrokenLinks();
}
const noteNames = (): string[] => [...new Set(linkIndex.map((p) => stem(p)))].sort((a, b) => a.localeCompare(b));
function resolveLink(target: string): string | null {
  if (!target) return filePath || null;
  const want = target.replace(/\.(md|markdown)$/i, '').toLocaleLowerCase();
  const candidates = linkIndex.filter((p) => {
    const bare = p.replace(/\.(md|markdown|txt)$/i, '').toLocaleLowerCase();
    return want.includes('/') ? bare === want || bare.endsWith(`/${want}`) : stem(p).toLocaleLowerCase() === want;
  });
  if (!candidates.length) return null;
  const here = dirname(filePath);
  return candidates.find((p) => dirname(p) === here) ?? candidates.sort((a, b) => a.length - b.length)[0];
}
function markBrokenLinks(): void {
  if (Date.now() - linkIndexAt > 30000) { void refreshLinkIndex(); return; }
  for (const a of preview.querySelectorAll<HTMLElement>('a.internal-link')) {
    a.classList.toggle('is-unresolved', resolveLink(a.dataset.href ?? '') === null);
  }
}
function jumpToHeading(heading: string): void {
  const want = heading.trim().toLocaleLowerCase();
  const found = editor.headings().find((h) => h.text.toLocaleLowerCase() === want);
  if (!found) return;
  ownScroll(400);
  releaseHold(); // a jump the reader asked for
  editor.revealLine(found.line, noteTopSpacing());
  if (mode === 'preview') {
    const section = preview.querySelector<HTMLElement>(`:scope > .md-section[data-line="${found.line}"]`);
    if (section) previewPane.scrollTop += section.getBoundingClientRect().top - previewPane.getBoundingClientRect().top - noteTopSpacing();
  }
}
function openLink(target: string, heading = ''): void {
  const path = resolveLink(target);
  if (!path) { leftSidebar.hint(`No note called "${target}" in this space.`, true); return; }
  if (path === filePath) { if (heading) jumpToHeading(heading); return; }
  void openFile(path, heading ? () => jumpToHeading(heading) : undefined);
}
// The empty tab: Obsidian's "No file is open" page, with its actions and
// the recent notes.
const emptyTab = document.querySelector<HTMLElement>('#empty-tab')!;
function showEmptyTab(): void {
  displayedTab = curTab();
  ++viewGeneration;
  window.clearTimeout(viewTimer);
  holdUntil = 0;
  closePopover();
  editor.closeFind();
  externalFileScreen.hidden = true;
  document.body.classList.remove('external-file-active');
  filePath = '';
  fileBase = '';
  diskBase = null;
  picture.path = '';
  picture.url = '';
  editor.setReadOnly(false);
  editor.setTitleEditable(true);
  restoringView = true;
  editor.setValue('');
  editor.setTitle('');
  restoringView = false;
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  editor.view.contentDOM.blur();
  document.body.classList.add('is-empty-tab');
  renderMenuButton();
  void renderEmptyTab();
  renderNavButtons();
  sidebar.refresh();
  // No file is open: nothing is selected in the file tree either. Without
  // this the row of the note that was just closed stayed highlighted.
  void leftSidebar.refresh();
}
async function renderEmptyTab(): Promise<void> {
  const recent: string[] = [];
  for (const path of recentNotes()) {
    if (recent.length >= 8) break;
    if (await backend.stat(path)) recent.push(path);
  }
  emptyTab.innerHTML = `
    <div class="empty-state-container">
      <div class="empty-state-title">No file is open</div>
      <div class="empty-state-action-list">
        <button type="button" class="empty-state-action" data-act="new">Create new note</button>
        <button type="button" class="empty-state-action" data-act="files">Go to file</button>
        ${tabs.length > 1 ? '<button type="button" class="empty-state-action" data-act="close">Close</button>' : ''}
      </div>
      ${recent.length ? `<div class="empty-state-recent"><div class="empty-state-recent-title">Recent notes</div>${recent.map((p) =>
        `<button type="button" class="empty-state-recent-item" data-path="${escapeText(p)}"><span class="empty-state-recent-name" dir="auto">${escapeText(stem(p))}</span><span class="empty-state-recent-dir" dir="auto">${escapeText(dirname(p))}</span></button>`).join('')}</div>` : ''}
    </div>`;
}
emptyTab.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const recent = target.closest<HTMLElement>('[data-path]');
  if (recent) { void openFile(recent.dataset.path!); return; }
  const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act === 'new') void newFile();
  else if (act === 'files') toggleFiles(true);
  else if (act === 'close') closeTab(activeTab);
});

function showTabs(): void {
  void (async () => {
    if (!await leaveCurrent()) return;
    openTabSwitcher({
      tabs: () => tabs.map((t, i) => ({ title: t.path ? displayNameForPath(t.path) : 'New tab', active: i === activeTab })),
      preview: async (i) => {
        const path = tabs[i].path;
        if (!path) return '';
        if (isExternalPath(path)) {
          const file = externalFilesByPath.get(path);
          return `<div class="inline-title" dir="auto">${escapeText(file?.name ?? 'Incoming file')}</div><p>${escapeText(file?.mimeType ?? 'External file')}</p>`;
        }
        const text = i === activeTab ? editor.getValue() : (await backend.read(path)) ?? '';
        return `<div class="inline-title" dir="auto">${escapeText(displayNameForPath(path))}</div>${renderMarkdown(text.slice(0, 1500))}`;
      },
      select: (i) => void switchTab(i),
      close: closeTab,
      newTab,
      canReopen: () => closedTabs.length > 0,
      reopen: reopenClosedTab,
      closeOthers: () => { closedTabs.push(...tabs.filter((t) => t !== curTab() && t.path).map(({ path }) => ({ path }))); tabs = [curTab()]; activeTab = 0; renderNavButtons(); },
      move: moveTab,
    });
  })();
}

// Bottom bar (no keyboard), in Obsidian's order: previous / next tab, find,
// new note, tabs, and the ≡ menu. Obsidian's floating navbar: a 52px pill,
// at most 316px wide, max(safe area, 12px) from the bottom; hidden while
// typing and while scrolling down, like the header buttons.
const navBack = document.querySelector<HTMLButtonElement>('#nav-back')!;
const navForward = document.querySelector<HTMLButtonElement>('#nav-forward')!;
const navMenu = document.querySelector<HTMLButtonElement>('#nav-menu')!;
const navTabsCount = document.querySelector<HTMLElement>('#nav-tabs .mobile-navbar-tabs-number')!;
document.querySelector('#nav-tabs')!.addEventListener('click', showTabs);
const svg = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const MENU_ICONS = {
  menu: svg('<path d="M4 12h16"/><path d="M4 18h16"/><path d="M4 6h16"/>'),
  collapse: svg('<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>'), // chevrons-down-up
  expand: svg('<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>'), // chevrons-up-down
  pdf: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>'), // file-down
  rename: svg('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'), // pencil
  trash: svg('<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  settings: svg('<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>'),
};
const FLAIR = '<span class="mobile-navbar-action-flair"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg></span>';

// The ≡ menu (Obsidian's ribbon menu, as a bottom sheet): each item knows
// its current title and icon, so the quick action button can show them too.
interface NoteAction { title: string; icon: string; needsNote: boolean; warning?: boolean; run(): void }
function noteAction(key: Exclude<QuickAction, ''>): NoteAction {
  const anyFolded = editor.foldedLines().length > 0;
  switch (key) {
    case 'fold': return {
      title: anyFolded ? 'Expand all headings' : 'Collapse all headings', icon: anyFolded ? MENU_ICONS.expand : MENU_ICONS.collapse, needsNote: true,
      run: () => { ownScroll(); if (editor.foldedLines().length) editor.unfoldAll(); else editor.foldAll(); renderMenuButton(); },
    };
    case 'view': return {
      title: mode === 'edit' ? 'Reading view' : 'Editing view', icon: mode === 'edit' ? bookIcon : penIcon, needsNote: true,
      run: () => { setMode(mode === 'edit' ? 'preview' : 'edit'); renderMenuButton(); },
    };
    case 'pdf': return { title: 'Export to PDF', icon: MENU_ICONS.pdf, needsNote: true, run: () => void exportCurrentPdf() };
    case 'rename': return { title: 'Rename', icon: MENU_ICONS.rename, needsNote: true, run: () => { if (canRenameInline(filePath)) { if (mode !== 'edit') setMode('edit'); editor.focusTitle(); } } };
    case 'delete': return { title: 'Delete note', icon: MENU_ICONS.trash, needsNote: true, warning: true, run: () => { if (filePath && !isExternalPath(filePath)) leftSidebar.deleteFile(filePath); } };
    case 'settings': return { title: 'Settings', icon: MENU_ICONS.settings, needsNote: false, run: showSettings };
  }
}
const hasNote = (): boolean => !document.body.classList.contains('is-empty-tab');
async function exportCurrentPdf(): Promise<void> {
  const path = filePath;
  const name = displayNameForPath(path) || 'Note';
  const markdown = editor.getValue();
  const options = loadPrintOptions(path);
  const notice = showNotice('Preparing the PDF…', 60000);
  try {
    await exportPdf(name, markdown, isExternalPath(path) ? '' : path, options);
  } catch (error) {
    showNotice(`Couldn't export: ${error instanceof Error ? error.message : String(error)}`, 5000);
  } finally {
    notice.hide();
  }
}
function showNoteMenu(): void {
  const item = (key: Exclude<QuickAction, ''>): MenuEntry => {
    const a = noteAction(key);
    const externalRestriction = isExternalPath(filePath) && (key === 'rename' || key === 'delete');
    return { title: a.title, icon: a.icon, warning: a.warning, disabled: (a.needsNote && !hasNote()) || externalRestriction, action: a.run };
  };
  openMenu([item('fold'), item('view'), 'separator', item('pdf'), 'separator', item('rename'), item('delete'), 'separator', item('settings')]);
}
function renderMenuButton(): void {
  const quick = loadSettings().quickAction;
  if (!quick) {
    navMenu.innerHTML = MENU_ICONS.menu;
    navMenu.setAttribute('aria-label', 'Menu');
    navMenu.disabled = false;
    return;
  }
  const a = noteAction(quick);
  navMenu.innerHTML = a.icon + FLAIR;
  navMenu.setAttribute('aria-label', `${a.title} (hold for the menu)`);
  navMenu.disabled = (a.needsNote && !hasNote()) || (isExternalPath(filePath) && (quick === 'rename' || quick === 'delete'));
}
// A tap runs the quick action (or opens the menu); holding opens the menu.
let menuPress: { timer: number; long: boolean } | null = null;
navMenu.addEventListener('pointerdown', () => {
  if (menuPress) window.clearTimeout(menuPress.timer);
  const press = { timer: 0, long: false };
  press.timer = window.setTimeout(() => { press.long = true; showNoteMenu(); navigator.vibrate?.(10); }, 450);
  menuPress = press;
});
const cancelMenuPress = (): void => { if (menuPress && !menuPress.long) window.clearTimeout(menuPress.timer); };
navMenu.addEventListener('pointerup', cancelMenuPress);
navMenu.addEventListener('pointercancel', cancelMenuPress);
navMenu.addEventListener('pointerleave', cancelMenuPress);
navMenu.addEventListener('contextmenu', (event) => event.preventDefault());
navMenu.addEventListener('click', () => {
  const press = menuPress;
  menuPress = null;
  if (press?.long) return;
  if (press) window.clearTimeout(press.timer);
  const quick = loadSettings().quickAction;
  if (quick) noteAction(quick).run();
  else showNoteMenu();
});
function renderNavButtons(): void {
  navBack.disabled = activeTab <= 0;
  navForward.disabled = activeTab >= tabs.length - 1;
  navTabsCount.textContent = String(tabs.length);
  saveTabs();
  renderMenuButton();
}
navBack.addEventListener('click', () => void stepTab(-1));
navForward.addEventListener('click', () => void stepTab(1));
document.querySelector('#nav-new')!.addEventListener('click', () => void newFile());
// The bar never takes focus from the note (no keyboard flicker).
document.querySelector('#navbar')!.addEventListener('mousedown', (event) => event.preventDefault());
renderNavButtons();
// Find: one bar for find and replace (its chevron drops the replace row).
function find(replace = false): void {
  if (mode !== 'edit') setMode('edit');
  editor.openFind(replace);
}
document.querySelector('#nav-find')!.addEventListener('click', () => find(false));

// ---- Right sidebar: outline + search (src/rightSidebar.ts) ----
const rightPanel = document.querySelector<HTMLElement>('#right-panel')!;
const noteTopSpacing = (): number => parseFloat(getComputedStyle(editor.view.contentDOM).paddingTop) || 60;
/** Notes to search: every note in the space (in All files, under the folder
 *  being browsed); the open one with its live text. */
async function allNotes(): Promise<{ path: string; text: string }[]> {
  const scope = currentScope();
  const root = scope.kind === 'space' ? scope.space.path : leftSidebar.walkRoot();
  const notes = [{ path: filePath, text: editor.getValue() }];
  for (const path of await walkNotes(root)) {
    if (path === filePath) continue;
    const text = await backend.read(path);
    if (text !== null) notes.push({ path, text });
  }
  return notes;
}
function sidebarGoToLine(line: number): void {
  ownScroll(400);
  releaseHold(); // a jump the reader asked for
  editor.revealLine(line, noteTopSpacing()); // also unfolds a folded parent
  if (mode === 'preview') {
    const section = preview.querySelector<HTMLElement>(`:scope > .md-section[data-line="${line}"]`);
    if (section) previewPane.scrollTop += section.getBoundingClientRect().top - previewPane.getBoundingClientRect().top - noteTopSpacing();
  }
}
const sidebar = createRightSidebar(rightPanel, {
  headings: () => editor.headings(),
  // The outline follows the line two thirds down the page, not the line at the
  // very top: the heading you are reading is the one around the middle of the
  // screen, not the one that has just left it (21).
  currentLine: () => {
    const pane = mode === 'preview' ? previewPane : editor.view.scrollDOM;
    const anchor = pane.clientHeight * (2 / 3);
    return mode === 'preview' ? previewScroll(previewPane, preview, anchor) : editorScroll(editor.view, anchor);
  },
  onHeading: (line, path) => {
    toggleOutline(false);
    if (path && path !== filePath) {
      // Another note: open it, then go to the heading (in whatever mode the
      // note was left in).
      void openFile(path, line < 0 ? undefined : () => sidebarGoToLine(line));
      return;
    }
    if (line >= 0) sidebarGoToLine(line);
  },
  notes: allNotes,
  currentPath: () => filePath,
  currentText: () => editor.getValue(),
  noteDir: () => majorityDirection(editor.getValue()),
  scopeName: () => scopeName(currentScope()),
  onResult: (path, from, to) => {
    toggleOutline(false);
    void openFile(path, () => {
      if (mode !== 'edit') setMode('edit');
      ownScroll(400);
      releaseHold(); // a jump the reader asked for
      editor.revealRange(from, to);
    });
  },
});
let outlineTimer: number | undefined;
function outlineOpen(): boolean { return document.body.classList.contains('outline-open'); }
// The right drawer has no button on screen (as in Obsidian): swipe in from
// the right edge, or Ctrl/Cmd+Shift+F to search.
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    toggleOutline(true);
    sidebar.focusSearch();
    return;
  }
  // Select all, also when the note itself hasn't got the focus (a tap on the
  // file title, the drawers, the tab strip, the toolbar...): the note is what
  // "all" means on this screen. Fields with their own select-all (the find
  // bar, settings) keep theirs, and the reading view keeps the browser's own.
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'a') return;
  if (mode === 'preview') return;
  const target = event.target as HTMLElement | null;
  if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
  if (editor.view.hasFocus) return; // the editor's own keymap has it
  event.preventDefault();
  editor.selectAll();
});
editor.view.scrollDOM.addEventListener('scroll', () => { if (outlineOpen()) sidebar.markCurrent(); }, { passive: true });
previewPane.addEventListener('scroll', () => { if (outlineOpen()) sidebar.markCurrent(); }, { passive: true });
const refreshOutlineSoon = (): void => {
  if (!outlineOpen()) return;
  window.clearTimeout(outlineTimer);
  outlineTimer = window.setTimeout(() => sidebar.refresh(), 400);
};
editor.view.dom.addEventListener('input', refreshOutlineSoon);



// Settings (src/settings.ts): the raised gear at the bottom of the left
// drawer, as Obsidian's. The theme is chosen there.
function applySettings(settings: Settings): void {
  const root = document.documentElement.style;
  root.setProperty('--note-font-size', `${settings.fontSize}px`);
  root.setProperty('--note-line-height', String(settings.lineHeight));
  editor.setLineNumbers(settings.lineNumbers);
  document.body.classList.toggle('no-line-numbers', !settings.lineNumbers);
  editor.remeasure();
  setHighlightAll(settings.highlightAll);
  setMathDigits(settings.mathDigits);
  if (previewVisible()) renderPreview();
  toolbar.querySelectorAll<HTMLElement>('button[data-command]').forEach((b) => { b.hidden = settings.hiddenTools.includes(b.dataset.command!); });
  updateToolbarFades();
  renderMenuButton();
}
const settingsButton = document.createElement('button');
settingsButton.type = 'button';
settingsButton.className = 'clickable-icon workspace-drawer-header-icon mod-raised mod-settings';
settingsButton.id = 'settings-button';
settingsButton.setAttribute('aria-label', 'Settings');
settingsButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>'; // lucide settings
settingsButton.addEventListener('click', () => showSettings());
function showSettings(): void {
  toggleFiles(false);
  openSettings({
    notePath: hasNote() ? filePath : undefined,
    noteName: hasNote() ? displayNameForPath(filePath) : undefined,
    apply: applySettings,
    tools: () => [...toolbar.querySelectorAll<HTMLElement>('button[data-command]')].map((b) => ({ command: b.dataset.command!, label: b.getAttribute('aria-label') ?? b.dataset.command!, icon: b.querySelector('svg')?.outerHTML ?? '' })),
  });
}

// Left sidebar: spaces and the file explorer (src/leftSidebar.ts).
const leftSidebar = createLeftSidebar(document.querySelector<HTMLElement>('#file-panel')!, {
  currentPath: () => filePath,
  open: (path) => { toggleFiles(false); void openFile(path); },
  createNote: (dir) => void newFile(dir),
  renamed: pathMoved,
  deleted: pathDeleted,
  scopeChanged: () => {
    // A note outside the new space stays open (like switching vaults
    // wouldn't); search follows the space.
    sidebar.refresh();
  },
  closeDrawer: () => toggleFiles(false),
  headerIcons: [settingsButton],
});
// The Android back button, in Obsidian's order: close whatever is on top
// (menu, popover, tab switcher, settings, the find bar), then the left
// drawer, then the right one. With nothing left to close, the first press
// shows "Press back again to exit." for five seconds and a second press
// within them leaves the app (minimised, as Obsidian does, so it comes back
// as it was). In a browser the back button (or gesture) does the same,
// through a guard entry in the page history; the exit press really leaves.
let exitArmedAt = 0;
let exitNotice: NoticeHandle | null = null;
/** Returns true when the press should leave the app. */
function handleBack(): boolean {
  if (isMenuOpen()) closeMenu();
  else if (isPopoverOpen()) closePopover();
  else if (isTabSwitcherOpen()) closeTabSwitcher();
  else if (isSettingsOpen()) closeSettings();
  else if (document.querySelector('#save-conflict-dialog')) closeSaveConflict();
  else if (document.body.classList.contains('external-file-active')) returnFromIncomingFile();
  else if (editor.findOpen) editor.closeFind();
  else if (document.body.classList.contains('files-open')) toggleFiles(false);
  else if (document.body.classList.contains('outline-open')) toggleOutline(false);
  else if (Date.now() - exitArmedAt < 5000) {
    exitNotice?.hide();
    exitNotice = null;
    exitArmedAt = 0;
    flush();
    if (Capacitor.isNativePlatform()) void CapacitorApp.minimizeApp();
    return true;
  } else {
    exitArmedAt = Date.now();
    exitNotice = showNotice('Press back again to exit.', 5000);
    return false;
  }
  // Anything else closed: the next press starts over.
  exitArmedAt = 0;
  exitNotice?.hide();
  exitNotice = null;
  return false;
}
if (Capacitor.isNativePlatform()) {
  void CapacitorApp.addListener('backButton', () => { handleBack(); });
  void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void refreshOnResume();
  });
} else {
  // The guard entry: back pops it (popstate), we handle the press and put it
  // back. On the exit press it stays popped and we step back once more,
  // off the app.
  // Chrome skips entries pushed before the user has touched the page, so it
  // goes in on the first tap or key press.
  const GUARD = { satrBackGuard: true };
  const addGuard = (): void => {
    if (!(history.state as typeof GUARD | null)?.satrBackGuard) history.pushState(GUARD, '');
  };
  for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, addGuard, { capture: true, once: true });
  window.addEventListener('popstate', () => {
    if (handleBack()) history.back();
    else history.pushState(GUARD, '');
  });
}
document.addEventListener('satr:back', () => { handleBack(); });

let bootReady = false;
let queuedIncomingId = '';
async function boot(): Promise<void> {
  keepSnapshots();
  try {
    if (supportsIncomingFiles()) {
      await onIncomingFile((id) => {
        if (!bootReady) queuedIncomingId = id;
        else void handleIncomingId(id);
      });
    }
    await openFirstNote();
    bootReady = true;
    if (supportsIncomingFiles()) {
      const pending = await pendingIncomingFile().catch(() => null);
      if (pending) await handleIncomingId(pending);
      const queued = queuedIncomingId;
      queuedIncomingId = '';
      if (queued && queued !== pending) await handleIncomingId(queued);
    }
  } finally {
    bootReady = true;
    dropSnapshot(); // the real note is on screen: lift the start-up copy
  }
}
async function openFirstNote(): Promise<void> {
  await ensureFileAccess(); // the app: all-files access first (src/native.ts)
  if (!curTab().path && tabs.length > 1) { showEmptyTab(); void leftSidebar.refresh(); return; }
  let path = curTab().path || filePath;
  let text = path ? await backend.read(path) : null;
  if (text === null) {
    ({ path, text } = await firstNote());
    // Very first start in a browser: the demo note.
    if (backend.kind === 'web' && !text && !(await backend.stat(path))) {
      path = joinPath(DEFAULT_FOLDER, 'Untitled.md');
      text = starter;
      await backend.write(path, text);
    }
  }
  filePath = '';
  showFile(path, text);
  void leftSidebar.refresh();
  void refreshLinkIndex();
}

// Preview links that stay inside the note: footnote references and back
// references scroll within the preview pane (centred) and flash the target,
// as in Obsidian's reading view. Copy buttons copy their code block.
function flash(el: HTMLElement): void {
  el.classList.remove('is-flashing');
  void el.offsetWidth; // restart the transition when tapped twice
  el.classList.add('is-flashing');
  window.setTimeout(() => el.classList.remove('is-flashing'), 3000);
}
preview.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const wiki = target.closest<HTMLElement>('a.internal-link');
  if (wiki) { event.preventDefault(); openLink(wiki.dataset.href ?? '', wiki.dataset.heading ?? ''); return; }
  const copy = target.closest<HTMLButtonElement>('.copy-code-button');
  if (copy) {
    event.preventDefault();
    const code = copy.parentElement?.querySelector('code')?.textContent ?? '';
    void navigator.clipboard?.writeText(code).then(() => {
      copy.classList.add('is-copied');
      window.setTimeout(() => copy.classList.remove('is-copied'), 1500);
    });
    return;
  }
  // Heading chevron (at the end of the heading line): fold / unfold.
  const heading = target.closest<HTMLElement>('.md-section > .has-fold');
  if (heading) {
    const box = heading.getBoundingClientRect();
    const rtl = getComputedStyle(heading).direction === 'rtl';
    const lineHeight = parseFloat(getComputedStyle(heading).lineHeight) || box.height;
    const onChevron = (rtl ? event.clientX <= box.left + 36 : event.clientX >= box.right - 36) && event.clientY <= box.top + lineHeight + 4;
    if (onChevron) {
      event.preventDefault();
      ownScroll();
      editor.toggleFold(Number(heading.parentElement!.dataset.line));
      return;
    }
  }
  // Footnote reference: show the note in a popover at the reference, as
  // Obsidian's reading view does, instead of scrolling away to it.
  const ref = target.closest<HTMLAnchorElement>('a.footnote-link');
  if (ref) {
    const id = decodeURIComponent(ref.getAttribute('href')?.slice(1) ?? '');
    const definition = [...preview.querySelectorAll<HTMLElement>('[data-footnote-id]')].find((el) => el.dataset.footnoteId === id);
    if (definition) {
      event.preventDefault();
      const content = document.createElement('div');
      content.className = 'markdown-embed footnote-embed markdown-rendered';
      content.dataset.type = 'footnote';
      content.innerHTML = definition.innerHTML;
      content.querySelectorAll('.footnote-backref').forEach((el) => el.remove());
      content.dir = 'auto';
      openPopover({
        className: 'footnote-popover',
        anchor: () => (ref.isConnected ? ref.getBoundingClientRect() : null),
        rtl: getComputedStyle(ref).direction === 'rtl',
        content,
        scrollers: [previewPane],
      });
      return;
    }
  }
  const link = target.closest<HTMLAnchorElement>('a.footnote-backref');
  const href = link?.getAttribute('href');
  if (!link || !href?.startsWith('#')) return;
  event.preventDefault();
  const id = decodeURIComponent(href.slice(1));
  const destination = [...preview.querySelectorAll<HTMLElement>('[data-footnote-id]')].find((el) => el.dataset.footnoteId === id);
  if (!destination) return;
  const paneBox = previewPane.getBoundingClientRect();
  const box = destination.getBoundingClientRect();
  previewPane.scrollTop += box.top - paneBox.top - (previewPane.clientHeight - box.height) / 2;
  flash(destination);
});

// Keyboard toolbar: shown while the note body has focus and the on-screen
// keyboard is up, pinned to the top of the keyboard. Keyboard detection
// compares the visual viewport against the tallest height seen at this width,
// which works both when the keyboard overlays the page (Chrome's default) and
// when it resizes the WebView (Capacitor's adjustResize).
let fullHeight = 0;
let fullHeightWidth = 0;
function layoutToolbar(): void {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  if (window.innerWidth !== fullHeightWidth) { fullHeightWidth = window.innerWidth; fullHeight = 0; }
  fullHeight = Math.max(fullHeight, height, window.innerHeight);
  const keyboardUp = fullHeight - height > 120;
  const show = keyboardUp && editor.hasFocus && mode === 'edit';
  document.body.classList.toggle('keyboard-open', show);
  // Any field with the keyboard up (find bar, sidebar search): no bottom bar.
  document.body.classList.toggle('keyboard-up', keyboardUp);
  // Placed from the top, like Obsidian's .mobile-toolbar
  // (top: 100vh - keyboard height - toolbar height): a 52px strip whose 44px
  // pill sits 8px above the keyboard. Anchoring to the bottom instead put it
  // ~30px too high in Chrome, where position:fixed; bottom:0 is measured
  // against a box taller than what is visible above the keyboard.
  const top = (viewport?.offsetTop ?? 0) + height - TOOLBAR_STRIP;
  toolbar.style.transform = `translate3d(0, ${Math.round(top)}px, 0)`;
}
window.visualViewport?.addEventListener('resize', layoutToolbar);
window.visualViewport?.addEventListener('scroll', layoutToolbar);
window.addEventListener('resize', layoutToolbar);
document.addEventListener('focusin', () => window.requestAnimationFrame(layoutToolbar));
document.addEventListener('focusout', () => window.setTimeout(layoutToolbar, 50));
// Never take focus from the editor (that would close the keyboard).
toolbar.addEventListener('pointerdown', (event) => event.preventDefault());
toolbar.addEventListener('mousedown', (event) => event.preventDefault());
toolbar.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('[data-act="hide-keyboard"]')) { editor.view.contentDOM.blur(); return; }
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-command]');
  if (!button) return;
  editor.run(button.dataset.command!);
});
const toolbarList = document.querySelector<HTMLElement>('#edit-toolbar-list')!;
function updateToolbarFades(): void {
  const max = toolbarList.scrollWidth - toolbarList.clientWidth;
  toolbar.classList.toggle('can-scroll-start', toolbarList.scrollLeft > 1);
  toolbar.classList.toggle('can-scroll-end', toolbarList.scrollLeft < max - 1);
}
toolbarList.addEventListener('scroll', updateToolbarFades, { passive: true });
new ResizeObserver(updateToolbarFades).observe(toolbarList);
layoutToolbar();

// Double-tap the preview to enter editing at the same spot, without a caret
// (and so without the keyboard) — Obsidian's reading-view double tap. The
// position carries over through the same source-line mapping as the toggle.
function editFromPreview(): void {
  if (mode !== 'preview') return;
  if (window.getSelection()?.toString()) return;
  (document.activeElement as HTMLElement | null)?.blur?.();
  setMode('edit');
}
// Touch double taps are detected on touchend so the second one can be
// cancelled: otherwise its synthetic mousedown/click lands on the editor that
// just replaced the preview and focuses it (caret + keyboard).
let tapTime = 0;
let tapX = 0;
let tapY = 0;
let downX = 0;
let downY = 0;
let tapMoved = false;
previewPane.addEventListener('touchstart', (event) => {
  const touch = event.touches[0];
  downX = touch.clientX;
  downY = touch.clientY;
  tapMoved = event.touches.length > 1;
}, { passive: true });
previewPane.addEventListener('touchmove', (event) => {
  const touch = event.touches[0];
  if (Math.hypot(touch.clientX - downX, touch.clientY - downY) > 10) tapMoved = true;
}, { passive: true });
previewPane.addEventListener('touchend', (event) => {
  if (tapMoved || event.touches.length > 0) { tapTime = 0; return; }
  const now = performance.now();
  if (now - tapTime < 300 && Math.hypot(downX - tapX, downY - tapY) < 30) {
    tapTime = 0;
    event.preventDefault(); // no synthetic click on whatever is underneath now
    editFromPreview();
    return;
  }
  tapTime = now;
  tapX = downX;
  tapY = downY;
}, { passive: false });
previewPane.addEventListener('dblclick', (event) => {
  if ((event as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents) return;
  event.preventDefault();
  editFromPreview();
});

// Both drawers (src/drawers.ts): the same physics on both sides.
const drawers = initDrawers({
  panels: { left: document.querySelector<HTMLElement>('#file-panel')!, right: rightPanel },
  movers: [document.querySelector<HTMLElement>('.workspace')!, document.querySelector<HTMLElement>('.topbar')!, document.querySelector<HTMLElement>('#navbar-wrap')!],
  backdrop: document.querySelector<HTMLElement>('#backdrop')!,
  classes: { left: 'files-open', right: 'outline-open' },
  onOpening: (side) => {
    closePopover();
    restoreNavigation();
    (document.activeElement as HTMLElement | null)?.blur?.(); // keyboard down
    if (side === 'right') sidebar.refresh();
    else window.requestAnimationFrame(() => leftSidebar.scrollToActive());
  },
});
applySettings(loadSettings());
setupSystemBars();
void boot();
