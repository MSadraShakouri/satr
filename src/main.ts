import '@codemirror/view';
import 'katex/dist/katex.min.css';
import './style.css';
import { SatrEditor } from './editor';
import { renderMarkdown } from './markdown';
import { layoutMath, scheduleMathLayout } from './mathLayout';
import { applyEditorScroll, applyPreviewScroll, editorScroll, previewScroll } from './scrollSync';
import { footnoteLayout } from './footnoteDialog';
import { closePopover, isPopoverOpen, openPopover } from './popover';
import { createRightSidebar } from './rightSidebar';
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
import { ensureFileAccess, setupSystemBars, systemBars } from './native';
import { currentScope, scopeName, scopeRoot } from './spaces';
import { backend, DEFAULT_FOLDER, dirname, freeName, isNote, joinPath, migrateOldNotes, stem, walkNotes, within, writeNow } from './vault';

type Mode = 'edit' | 'preview';
const starter = `# Satr demo

This file demonstrates the features currently available in Satr.

## Text and direction

English text and متن فارسی در یک سند.

## Lists

- [ ] A task
- [x] A completed task

1. English numbering
2. Another item

۱. شماره‌گذاری فارسی
۲. مورد بعدی

## Table

| Name | Center | Right |
| :--- | :---: | ---: |
| Satr | aligned | 42 |
| Demo | content | 100 |

## Math

Inline math: $a^2 + b^2 = c^2$.

$$
E = mc^2
$$

## Code

~~~ts
const message = 'Hello from Satr';
console.log(message);
~~~

> A blockquote for preview testing.

~~Strikethrough~~ and [a link](https://github.com/MSadraShakouri/satr).

Mermaid diagrams are postponed for later.
`;

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
        <button tabindex="-1" data-command="footnote" aria-label="Footnote"><svg viewBox="0 0 24 24"><path d="M3 7h10M3 12h10M3 17h7"/><path d="M17 5.5 19 4v7M17 11h4"/></svg></button>
        <button tabindex="-1" data-command="math" aria-label="Math"><svg viewBox="0 0 24 24"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></button>
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
  </div>`;

const preview = document.querySelector<HTMLElement>('#preview')!;
let mode: Mode = 'edit';
let saveTimer: number | undefined;
let viewTimer: number | undefined;
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
function follow(from: 'editor' | 'preview'): void {
  if (syncingScroll || !splitView.matches) return;
  syncingScroll = true;
  if (from === 'editor') applyPreviewScroll(previewPane, preview, editorScroll(editor.view));
  else applyEditorScroll(editor.view, previewScroll(previewPane, preview));
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => { syncingScroll = false; }));
}

// Notes are files in folders (src/vault.ts: localStorage in the browser,
// the phone's storage in the app), addressed by path. The open note's path
// is remembered under satr:current; notes from earlier versions are moved
// into the "Notes" folder once.
const CURRENT_KEY = 'satr:current';
let filePath = migrateOldNotes() ?? localStorage.getItem(CURRENT_KEY) ?? '';
let fileBase = stem(filePath);
/** Names in the open note's folder (lower case), for checking a new title as you type. */
let siblingNames = new Set<string>();
async function loadSiblings(): Promise<void> {
  const dir = dirname(filePath);
  siblingNames = new Set((await backend.list(dir).catch(() => [])).map((e) => e.name.toLowerCase()));
}
const nameTaken = (base: string): boolean => base.toLowerCase() !== fileBase.toLowerCase() && siblingNames.has(`${base}.md`.toLowerCase());
// Per-file view memory, kept across sessions and app restarts: the mode and
// the scroll position (as a fractional source line, the same measure the
// edit/preview toggle uses), under satr:view:<path>.
const viewKey = (path: string): string => `satr:view:${path}`;
interface SavedView { mode: Mode; line: number; cursor?: [number, number]; folds?: number[] }
function readView(base: string): SavedView | null {
  try {
    const value = JSON.parse(localStorage.getItem(viewKey(base)) ?? 'null') as Partial<SavedView> | null;
    if (!value || (value.mode !== 'edit' && value.mode !== 'preview') || !Number.isFinite(value.line)) return null;
    const cursor = Array.isArray(value.cursor) && value.cursor.length === 2 && value.cursor.every(Number.isInteger)
      ? value.cursor as [number, number] : undefined;
    const folds = Array.isArray(value.folds) ? value.folds.filter((n) => Number.isInteger(n) && n >= 0) : undefined;
    return { mode: value.mode, line: Math.max(0, value.line as number), cursor, folds };
  } catch {
    return null;
  }
}

// The preview is rendered only when it can be seen. Rendering the whole note
// (markdown, highlight.js, KaTeX) on every keystroke into a hidden pane was
// most of the typing cost on long notes. In split view it follows typing
// after a short pause; switching to preview renders it at once if stale.
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
  preview.innerHTML = `<div class="inline-title" dir="auto">${escapeText(fileBase)}</div>${renderMarkdown(editor.getValue())}`;
  applyPreviewFolds();
  scheduleMathLayout(preview);
  markBrokenLinks();
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
function saveNow(): void {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (filePath) writeNow(filePath, editor.getValue());
}
function update(): void {
  previewDirty = true;
  window.clearTimeout(renderTimer);
  if (previewVisible()) renderTimer = window.setTimeout(renderPreview, 250);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 700);
}
splitView.addEventListener('change', () => { if (splitView.matches && previewDirty) renderPreview(); });
function setMode(next: Mode): void {
  // Read the position from the pane that is visible *now* — a display:none
  // pane reports scrollTop 0, which is what used to send preview to the top.
  const position = mode === 'preview' ? previewScroll(previewPane, preview) : editorScroll(editor.view);
  mode = next;
  document.body.dataset.mode = mode;
  const previewButton = document.querySelector<HTMLButtonElement>('#preview-toggle')!;
  previewButton.innerHTML = mode === 'edit' ? bookIcon : penIcon;
  previewButton.setAttribute('aria-label', mode === 'edit' ? 'Open preview' : 'Return to editor');
  syncingScroll = true;
  if (mode === 'preview') {
    if (previewDirty) renderPreview();
    layoutMath(preview); // settle math line breaks before measuring positions
    applyPreviewScroll(previewPane, preview, position);
  } else {
    applyEditorScroll(editor.view, position);
  }
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => { syncingScroll = false; }));
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
    if (nameTaken(base)) return 'There is already a file with that name';
    const from = filePath;
    const to = joinPath(dirname(from), `${base}.md`);
    // Write the text out first, then move it (a note that was never saved
    // is simply written under the new name).
    saveNow();
    void backend.stat(from).then((exists) => (exists ? backend.rename(from, to) : backend.write(to, editor.getValue())))
      .then(() => { pathMoved(from, to); void loadSiblings(); })
      .catch((error: unknown) => {
        editor.setTitle(fileBase);
        leftSidebar.hint(error instanceof Error ? error.message : String(error), true);
      });
    fileBase = base;
    setPreviewTitle();
    return null;
  },
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
editor.view.scrollDOM.addEventListener('scroll', () => {
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
  localStorage.setItem(viewKey(filePath), JSON.stringify({ mode, line: Math.round(line * 1000) / 1000, cursor: editor.getSelection(), ...(folds.length ? { folds } : {}) }));
}
function rememberViewSoon(): void {
  window.clearTimeout(viewTimer);
  viewTimer = window.setTimeout(rememberView, 400);
}
function restoreView(path: string, after?: () => void): void {
  const view = readView(path);
  restoringView = true;
  // The caret comes back where it was — without focus, so no keyboard and no
  // scroll. Otherwise it sat at the top of the note, and the first tap on a
  // toolbar command or the keyboard opening jumped the view back up there.
  if (view?.cursor) editor.setSelection(view.cursor[0], view.cursor[1]);
  if (view?.folds?.length) editor.restoreFolds(view.folds);
  setMode(view?.mode ?? 'edit');
  // Positions depend on fonts, KaTeX and math line breaks: apply once now,
  // and again when those have settled.
  const apply = (): void => {
    if (!view) return;
    syncingScroll = true;
    if (mode === 'preview') {
      layoutMath(preview);
      applyPreviewScroll(previewPane, preview, view.line);
    } else {
      applyEditorScroll(editor.view, view.line);
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => { syncingScroll = false; }));
  };
  apply();
  const settle = (): void => {
    apply();
    restoringView = false;
    after?.();
  };
  if (document.fonts?.ready) void document.fonts.ready.then(() => window.requestAnimationFrame(settle));
  else window.requestAnimationFrame(settle);
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
});

(document.querySelector('#preview-toggle') as HTMLButtonElement).onclick = () => setMode(mode === 'edit' ? 'preview' : 'edit');
document.querySelector('#files')!.addEventListener('click', () => toggleFiles());
// Tabs: every note opens in its own tab (a note that's already open just
// switches to its tab), and the bottom bar's arrows step to the previous /
// next tab. Tabs can be reordered in the switcher. Each note comes back
// with its own mode, position, caret and folds. Kept under satr:tabs.
interface Tab { path: string } // '' is an empty tab ("No file is open")
const TABS_KEY = 'satr:tabs';
let tabs: Tab[] = [{ path: '' }];
let activeTab = 0;
const curTab = (): Tab => tabs[activeTab];
function saveTabs(): void {
  localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active: activeTab }));
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
    tabs = (list as Tab[]).filter((t) => !t.path || (seen.has(t.path) ? false : (seen.add(t.path), true)));
    activeTab = Math.max(0, tabs.findIndex((t) => t === active || (t.path && t.path === active?.path)));
  } catch { /* keep the default */ }
}
loadTabs(); // before anything renders (and so saves) the navbar
/** Closed tabs, most recent last, for "Reopen closed tab". */
const closedTabs: Tab[] = [];
// Recently opened notes, newest first (the empty tab lists them).
const RECENT_KEY = 'satr:recent';
function recentNotes(): string[] {
  try { const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : []; } catch { return []; }
}
function setRecent(list: string[]): void { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12))); }
function leaveCurrent(): void {
  closePopover();
  editor.closeFind();
  saveNow();
  rememberView();
}
function showFile(path: string, content: string, after?: () => void): void {
  document.body.classList.remove('is-empty-tab');
  renderMenuButton();
  // Another note never opens the keyboard or shows the caret: it comes back
  // at its remembered place, unfocused, until you tap into it.
  editor.view.contentDOM.blur();
  curTab().path = path;
  setRecent([path, ...recentNotes().filter((p) => p !== path)]);
  filePath = path;
  fileBase = stem(path);
  localStorage.setItem(CURRENT_KEY, path);
  restoringView = true;
  editor.setValue(content);
  editor.setTitle(fileBase);
  window.clearTimeout(saveTimer); // loading isn't an edit
  saveTimer = undefined;
  previewDirty = true;
  if (previewVisible()) renderPreview();
  restoreView(path, after);
  renderNavButtons();
  sidebar.refresh();
  leftSidebar.reveal(path);
  void loadSiblings();
}
/** Open a note: its tab if it has one, else a new tab after this one (or
 *  this tab, when it's empty). */
async function openFile(path: string, after?: () => void): Promise<void> {
  if (path === filePath) { after?.(); return; }
  const existing = tabs.findIndex((t) => t.path === path);
  if (existing >= 0) { await switchTab(existing, after); return; }
  const text = await backend.read(path);
  if (text === null) { leftSidebar.hint('That note no longer exists.', true); void leftSidebar.refresh(); return; }
  leaveCurrent();
  if (curTab().path) { tabs.splice(activeTab + 1, 0, { path }); activeTab += 1; }
  showFile(path, text, after);
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
    if (key.startsWith('satr:view:') && within(key.slice(10), from)) keys.push(key);
  }
  for (const key of keys) {
    const value = localStorage.getItem(key);
    localStorage.removeItem(key);
    if (value !== null) localStorage.setItem(viewKey(move(key.slice(10))), value);
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
  linkIndexAt = 0; // the notes changed: rebuild the link index next time
  const path = joinPath(dir, await freeName(dir, 'Untitled', '.md'));
  try { await backend.write(path, ''); } catch (error) { leftSidebar.hint(error instanceof Error ? error.message : String(error), true); return; }
  leaveCurrent();
  if (curTab().path) { tabs.splice(activeTab + 1, 0, { path }); activeTab += 1; }
  localStorage.removeItem(viewKey(path));
  showFile(path, '');
  setMode('edit');
  toggleFiles(false);
  void leftSidebar.refresh();
  editor.focusTitle();
}

/** Show a tab's note, or the empty-tab page. A note that's gone closes
 *  its tab. */
async function openTab(tab: Tab, after?: () => void): Promise<void> {
  if (!tab.path) { showEmptyTab(); return; }
  const text = await backend.read(tab.path);
  if (text !== null) { showFile(tab.path, text, after); return; }
  if (tabs.length > 1) {
    const at = tabs.indexOf(tab);
    tabs.splice(at, 1);
    activeTab = Math.min(at, tabs.length - 1);
  } else tab.path = '';
  await openTab(curTab(), after);
}
async function switchTab(index: number, after?: () => void): Promise<void> {
  if (!tabs[index]) return;
  if (index === activeTab) { after?.(); return; }
  leaveCurrent();
  activeTab = index;
  await openTab(curTab(), after);
}
function newTab(): void {
  leaveCurrent();
  const empty = tabs.findIndex((t) => !t.path);
  if (empty >= 0) activeTab = empty;
  else { tabs.splice(activeTab + 1, 0, { path: '' }); activeTab += 1; }
  showEmptyTab();
}
function closeTab(index: number): void {
  if (tabs.length < 2 || !tabs[index]) return;
  if (tabs[index].path) { closedTabs.push({ ...tabs[index] }); if (closedTabs.length > 20) closedTabs.shift(); }
  if (index !== activeTab) {
    tabs.splice(index, 1);
    if (index < activeTab) activeTab -= 1;
    renderNavButtons();
    return;
  }
  leaveCurrent();
  tabs.splice(index, 1);
  activeTab = Math.min(index, tabs.length - 1); // the next tab, or the new last one
  void openTab(curTab());
}
function reopenClosedTab(): void {
  const tab = closedTabs.pop();
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
function openImage(src: string): void {
  if (/^https?:\/\//i.test(src)) { window.open(src, '_blank', 'noopener'); return; }
  leftSidebar.hint('Images in your folders open in the Android app.', false);
}

// The empty tab: Obsidian's "No file is open" page, with its actions and
// the recent notes.
const emptyTab = document.querySelector<HTMLElement>('#empty-tab')!;
function showEmptyTab(): void {
  closePopover();
  editor.closeFind();
  filePath = '';
  fileBase = '';
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
  leaveCurrent(); // the previews read the saved text
  openTabSwitcher({
    tabs: () => tabs.map((t, i) => ({ title: t.path ? stem(t.path) : 'New tab', active: i === activeTab })),
    preview: async (i) => {
      const path = tabs[i].path;
      if (!path) return '';
      const text = i === activeTab ? editor.getValue() : (await backend.read(path)) ?? '';
      return `<div class="inline-title" dir="auto">${escapeText(stem(path))}</div>${renderMarkdown(text.slice(0, 1500))}`;
    },
    select: (i) => void switchTab(i),
    close: closeTab,
    newTab,
    canReopen: () => closedTabs.length > 0,
    reopen: reopenClosedTab,
    closeOthers: () => { closedTabs.push(...tabs.filter((t) => t !== curTab() && t.path)); tabs = [curTab()]; activeTab = 0; renderNavButtons(); },
    move: moveTab,
  });
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
    case 'rename': return { title: 'Rename', icon: MENU_ICONS.rename, needsNote: true, run: () => { if (mode !== 'edit') setMode('edit'); editor.focusTitle(); } };
    case 'delete': return { title: 'Delete note', icon: MENU_ICONS.trash, needsNote: true, warning: true, run: () => { if (filePath) leftSidebar.deleteFile(filePath); } };
    case 'settings': return { title: 'Settings', icon: MENU_ICONS.settings, needsNote: false, run: showSettings };
  }
}
const hasNote = (): boolean => !document.body.classList.contains('is-empty-tab');
async function exportCurrentPdf(): Promise<void> {
  const notice = showNotice('Preparing the PDF…', 60000);
  try {
    await exportPdf(stem(filePath.split('/').pop() ?? 'Note') || 'Note', editor.getValue());
  } catch (error) {
    showNotice(`Couldn't export: ${error instanceof Error ? error.message : String(error)}`, 5000);
  } finally {
    notice.hide();
  }
}
function showNoteMenu(): void {
  const item = (key: Exclude<QuickAction, ''>): MenuEntry => {
    const a = noteAction(key);
    return { title: a.title, icon: a.icon, warning: a.warning, disabled: a.needsNote && !hasNote(), action: a.run };
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
  navMenu.disabled = a.needsNote && !hasNote();
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
  editor.revealLine(line, noteTopSpacing()); // also unfolds a folded parent
  if (mode === 'preview') {
    const section = preview.querySelector<HTMLElement>(`:scope > .md-section[data-line="${line}"]`);
    if (section) previewPane.scrollTop += section.getBoundingClientRect().top - previewPane.getBoundingClientRect().top - noteTopSpacing();
  }
}
const sidebar = createRightSidebar(rightPanel, {
  headings: () => editor.headings(),
  currentLine: () => (mode === 'preview' ? previewScroll(previewPane, preview) : editorScroll(editor.view)),
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
  scopeName: () => scopeName(currentScope()),
  onResult: (path, from, to) => {
    toggleOutline(false);
    void openFile(path, () => {
      if (mode !== 'edit') setMode('edit');
      ownScroll(400);
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
  }
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

async function boot(): Promise<void> {
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
  const image = target.closest<HTMLElement>('a.image-link');
  if (image) { event.preventDefault(); openImage(image.dataset.src ?? ''); return; }
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
