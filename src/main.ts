import '@codemirror/view';
import { cycleTheme, onThemeChange, themeChoice, type ThemeChoice } from './theme';
import 'katex/dist/katex.min.css';
import './style.css';
import { SatrEditor } from './editor';
import { renderMarkdown } from './markdown';
import { layoutMath, scheduleMathLayout } from './mathLayout';
import { applyEditorScroll, applyPreviewScroll, editorScroll, previewScroll } from './scrollSync';

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
      <button class="floating-button sidebar-button" id="files" aria-label="Open files"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="15" height="16" rx="2"/><path d="M8 7v10"/></svg></button>
      <div class="topbar-actions">
        <button class="floating-button" id="preview-toggle" aria-label="Toggle preview"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.75 5.25A2.25 2.25 0 0 1 5 3h3.25A3.75 3.75 0 0 1 12 6.75V20a3.75 3.75 0 0 0-3.75-3.75H5a2.25 2.25 0 0 0-2.25 2.25z"/><path d="M21.25 5.25A2.25 2.25 0 0 0 19 3h-3.25A3.75 3.75 0 0 0 12 6.75V20a3.75 3.75 0 0 1 3.75-3.75H19a2.25 2.25 0 0 1 2.25 2.25z"/></svg></button>
      </div>
    </div>
    <aside class="file-panel" id="file-panel" aria-label="Files">
      <div class="panel-head"><strong>Files</strong><button class="close-button" id="close-files">×</button></div>
      <button class="new-file" id="new-file">＋ New file</button>
      <div class="recent-label">Recent</div>
      <button class="file-row active" id="file-current">untitled.md</button>
      <button class="theme-row" id="theme-toggle" type="button"></button>
    </aside>
    <div class="backdrop" id="backdrop"></div>
    <main class="workspace">
      <section class="editor-pane" id="editor-pane" aria-label="Editor"><div id="editor"></div></section>
      <section class="preview-pane" id="preview-pane" aria-label="Preview"><article id="preview"></article></section>
    </main>
    <div class="edit-toolbar" id="edit-toolbar" role="toolbar" aria-label="Formatting" data-ignore-swipe>
      <div class="edit-toolbar-list" id="edit-toolbar-list">
        <button tabindex="-1" data-command="undo" aria-label="Undo"><svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>
        <button tabindex="-1" data-command="redo" aria-label="Redo"><svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg></button>
        <button tabindex="-1" data-command="heading" aria-label="Heading">#</button>
        <button tabindex="-1" data-command="bullet" aria-label="Bulleted list"><svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="18" r=".6"/></svg></button>
        <button tabindex="-1" data-command="ordered" aria-label="Numbered list">1.</button>
        <button tabindex="-1" data-command="task" aria-label="To-do"><svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12.5 3 3 5-6"/></svg></button>
        <button tabindex="-1" data-command="footnote" aria-label="Footnote"><svg viewBox="0 0 24 24"><path d="M3 7h10M3 12h10M3 17h7"/><path d="M17 5.5 19 4v7M17 11h4"/></svg></button>
        <button tabindex="-1" data-command="deleteLine" aria-label="Delete line"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button>
        <button tabindex="-1" data-command="math" aria-label="Math">$</button>
        <button tabindex="-1" data-command="lineUp" aria-label="Move line up"><svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
        <button tabindex="-1" data-command="lineDown" aria-label="Move line down"><svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg></button>
      </div>
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

// Files persist in localStorage under satr:<base>.md; the current file's
// base name (no extension) under satr:file-name. Renaming moves the content.
const NAME_KEY = 'satr:file-name';
const storageKey = (base: string): string => `satr:${base}.md`;
const nameExists = (base: string): boolean => localStorage.getItem(storageKey(base)) !== null;
let fileBase = localStorage.getItem(NAME_KEY) ?? 'untitled';
// Per-file view memory, kept across sessions and app restarts: the mode and
// the scroll position (as a fractional source line, the same measure the
// edit/preview toggle uses), under satr:view:<base>.
const viewKey = (base: string): string => `satr:view:${base}`;
interface SavedView { mode: Mode; line: number; cursor?: [number, number] }
function readView(base: string): SavedView | null {
  try {
    const value = JSON.parse(localStorage.getItem(viewKey(base)) ?? 'null') as Partial<SavedView> | null;
    if (!value || (value.mode !== 'edit' && value.mode !== 'preview') || !Number.isFinite(value.line)) return null;
    const cursor = Array.isArray(value.cursor) && value.cursor.length === 2 && value.cursor.every(Number.isInteger)
      ? value.cursor as [number, number] : undefined;
    return { mode: value.mode, line: Math.max(0, value.line as number), cursor };
  } catch {
    return null;
  }
}
const fileRow = document.querySelector<HTMLElement>('#file-current')!;
fileRow.textContent = `${fileBase}.md`;

// The preview is rendered only when it can be seen. Rendering the whole note
// (markdown, highlight.js, KaTeX) on every keystroke into a hidden pane was
// most of the typing cost on long notes. In split view it follows typing
// after a short pause; switching to preview renders it at once if stale.
let previewDirty = true;
let renderTimer: number | undefined;
const previewVisible = (): boolean => mode === 'preview' || splitView.matches;
function renderPreview(): void {
  window.clearTimeout(renderTimer);
  previewDirty = false;
  preview.innerHTML = renderMarkdown(editor.getValue());
  scheduleMathLayout(preview);
}
function saveNow(): void {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  localStorage.setItem(storageKey(fileBase), editor.getValue());
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
function toggleFiles(open = !document.body.classList.contains('files-open')): void {
  cancelSettle();
  document.body.classList.toggle('files-open', open);
  clearDrawerDrag();
}

editor = new SatrEditor(document.querySelector('#editor')!, update, {
  title: fileBase,
  onSelection: () => rememberViewSoon(),
  obscuredBottom: () => keyboardOverlap() + (document.body.classList.contains('keyboard-open') ? TOOLBAR_STRIP : 0),
  checkName: (base) => (nameExists(base) && base !== fileBase ? 'There is already a file with that name' : null),
  onRename: (base) => {
    if (nameExists(base) && base !== fileBase) return 'There is already a file with that name';
    const content = editor.getValue();
    localStorage.setItem(storageKey(base), content);
    localStorage.removeItem(storageKey(fileBase));
    const view = localStorage.getItem(viewKey(fileBase));
    localStorage.removeItem(viewKey(fileBase));
    if (view) localStorage.setItem(viewKey(base), view);
    fileBase = base;
    localStorage.setItem(NAME_KEY, base);
    fileRow.textContent = `${base}.md`;
    return null;
  },
});
// Auto-hide navigation, as Obsidian's "auto full screen" (MobileNavbar.
// onScroll): any scroll down hides the floating buttons (and the Android
// status bar, in the app); any scroll up, or a tap, brings them back.
// Nothing hides while the keyboard is up. Deltas under 0.125px are noise.
const topbarEl = document.querySelector<HTMLElement>('.topbar')!;
type StatusBarPlugin = { hide(options?: { animation?: string }): Promise<void>; show(options?: { animation?: string }): Promise<void> };
const statusBar = (): StatusBarPlugin | undefined =>
  (window as unknown as { Capacitor?: { Plugins?: { StatusBar?: StatusBarPlugin } } }).Capacitor?.Plugins?.StatusBar;
let navHidden = false;
function hideNavigation(): void {
  if (navHidden) return;
  navHidden = true;
  topbarEl.classList.add('is-hidden-nav');
  void statusBar()?.hide({ animation: 'FADE' }).catch(() => undefined);
}
function restoreNavigation(): void {
  if (!navHidden) return;
  navHidden = false;
  topbarEl.classList.remove('is-hidden-nav');
  void statusBar()?.show({ animation: 'FADE' }).catch(() => undefined);
}
const scrollTops = new WeakMap<Element, number>();
function onNavScroll(el: HTMLElement): void {
  const top = el.scrollTop;
  const previous = scrollTops.get(el) ?? 0;
  scrollTops.set(el, top);
  if (document.body.classList.contains('keyboard-open') || keyboardOverlap() > 120) return;
  const delta = top - previous;
  if ((top < 0.1 && previous < 0.1) || Math.abs(delta) < 0.125) return;
  if (delta > 0 && top > 0) hideNavigation();
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
const saved = localStorage.getItem(storageKey(fileBase));
editor.setValue(saved ?? starter);
renderPreview();

function rememberView(): void {
  window.clearTimeout(viewTimer);
  if (restoringView) return;
  const line = mode === 'preview' ? previewScroll(previewPane, preview) : editorScroll(editor.view);
  localStorage.setItem(viewKey(fileBase), JSON.stringify({ mode, line: Math.round(line * 1000) / 1000, cursor: editor.getSelection() }));
}
function rememberViewSoon(): void {
  window.clearTimeout(viewTimer);
  viewTimer = window.setTimeout(rememberView, 400);
}
function restoreView(base: string): void {
  const view = readView(base);
  restoringView = true;
  // The caret comes back where it was — without focus, so no keyboard and no
  // scroll. Otherwise it sat at the top of the note, and the first tap on a
  // toolbar command or the keyboard opening jumped the view back up there.
  if (view?.cursor) editor.setSelection(view.cursor[0], view.cursor[1]);
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
  };
  if (document.fonts?.ready) void document.fonts.ready.then(() => window.requestAnimationFrame(settle));
  else window.requestAnimationFrame(settle);
}
restoreView(fileBase);
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
document.querySelector('#close-files')!.addEventListener('click', () => toggleFiles(false));
document.querySelector('#backdrop')!.addEventListener('click', () => toggleFiles(false));
document.querySelector('#new-file')!.addEventListener('click', () => {
  let index = 0;
  let base = 'untitled';
  while (nameExists(base)) base = `untitled ${(index += 1) + 1}`;
  const content = editor.getValue();
  localStorage.setItem(storageKey(fileBase), content);
  rememberView();
  fileBase = base;
  localStorage.setItem(NAME_KEY, base);
  localStorage.setItem(storageKey(base), '');
  localStorage.removeItem(viewKey(base));
  fileRow.textContent = `${base}.md`;
  editor.setValue('');
  editor.setTitle(base);
  setMode('edit');
  toggleFiles(false);
  editor.focusTitle();
});
// Theme switch in the drawer: Auto (follows the system) → Light → Dark.
const themeButton = document.querySelector<HTMLButtonElement>('#theme-toggle')!;
const THEME_LABEL: Record<ThemeChoice, string> = { auto: 'Theme: Auto', light: 'Theme: Light', dark: 'Theme: Dark' };
const THEME_ICON: Record<ThemeChoice, string> = {
  auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/></svg>',
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.6 6.6 0 0 0 10.7 10.7z"/></svg>',
};
function renderThemeButton(choice: ThemeChoice): void {
  themeButton.innerHTML = `${THEME_ICON[choice]}<span>${THEME_LABEL[choice]}</span>`;
}
renderThemeButton(themeChoice());
onThemeChange(renderThemeButton);
themeButton.addEventListener('click', () => cycleTheme());

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
  const link = target.closest<HTMLAnchorElement>('a.footnote-link, a.footnote-backref');
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

// Drawer gesture, modeled on Obsidian's mobile drawer physics (measured in its
// production bundle): EMA-smoothed velocity, fling projection on release
// (position + 1s of velocity must cross half the width), a settle animation
// whose duration scales with remaining distance (200ms for a full traversal),
// and cancellation rules for scrollable content, selections and safe areas.
const MOVE_DEADLINE_MS = 200;
const SETTLE_MS = 200;
const PROJECT_MS = 1000;
const EMA_ALPHA = 0.2;
const HIDE_FACTOR = 1.05;
let gestureStartX = 0;
let gestureStartY = 0;
let gestureId = -1;
let gestureStartTime = 0;
let gestureLastX = 0;
let gestureLastTime = 0;
let gestureVelocity = 0;
let gestureStartShift = 0;
let gestureEngaged = false;
let gestureWidth = 0;
let resumeTarget: boolean | null = null;
let settleTarget: boolean | null = null;
let settleAnims: Animation[] = [];
const panel = document.querySelector<HTMLElement>('.file-panel')!;
const topbar = document.querySelector<HTMLElement>('.topbar')!;
const workspace = document.querySelector<HTMLElement>('.workspace')!;
const backdrop = document.querySelector<HTMLElement>('#backdrop')!;
const drawerWidth = (): number => Math.min(window.innerWidth * .84, 420);
const insetProbe = document.createElement('div');
insetProbe.setAttribute('aria-hidden', 'true');
insetProbe.style.cssText = 'position:fixed;inset:auto 0 0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)';
document.body.appendChild(insetProbe);
const bottomInset = (): number => parseFloat(getComputedStyle(insetProbe).paddingBottom) || 0;
const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function drawerShiftOf(): number {
  // Current visual open-amount of the drawer in px (0 = closed, width = open),
  // measured from the panel's computed transform so re-grabbing mid-settle
  // continues from exactly where the animation left off.
  const width = drawerWidth();
  const m = new DOMMatrixReadOnly(getComputedStyle(panel).transform);
  return Math.max(0, Math.min(width, width + m.m41 / HIDE_FACTOR));
}
function renderDrawer(shift: number): void {
  const width = gestureWidth || drawerWidth();
  const s = Math.max(0, Math.min(width, shift));
  for (const el of [panel, workspace, topbar, backdrop]) el.style.transition = 'none';
  panel.style.transform = `translate3d(${-HIDE_FACTOR * (width - s)}px,0,0)`;
  workspace.style.transform = `translate3d(${s}px,0,0)`;
  topbar.style.transform = `translate3d(${s}px,0,0)`;
  // A fully closed drawer must not leave the (invisible) backdrop covering the
  // editor, or it becomes the scroll target and vertical scrolling dies.
  backdrop.style.display = s > 0 ? 'block' : 'none';
  backdrop.style.opacity = String(s / width);
}
function clearDrawerDrag(): void {
  // Restore steady state from the .files-open class; it equals the visual end
  // state of the settle animation, so nothing visibly moves here.
  for (const el of [panel, workspace, topbar, backdrop]) el.style.transition = '';
  panel.style.transform = '';
  workspace.style.transform = '';
  topbar.style.transform = '';
  backdrop.style.display = '';
  backdrop.style.opacity = '';
}
function cancelSettle(): void {
  if (settleTarget === null && settleAnims.length === 0) return;
  const shift = drawerShiftOf();
  for (const anim of settleAnims) anim.cancel();
  settleAnims = [];
  settleTarget = null;
  gestureWidth = drawerWidth();
  renderDrawer(shift);
}
function freezeDrawer(): number {
  // Pin every drawer element to its computed (true visual) state with
  // transitions off. Covers any animation source — a WAAPI settle AND the
  // steady-state CSS class transition from button/backdrop toggles — so a
  // re-grab mid-animation starts from where the drawer actually is instead
  // of snapping back to a stale touchstart measurement.
  gestureWidth = drawerWidth();
  const shift = drawerShiftOf();
  // At rest there is nothing in flight to pin; leave the DOM untouched so a
  // plain scroll/tap never pays for inline styles or a shown backdrop.
  const open = document.body.classList.contains('files-open');
  if ((!open && shift <= 0) || (open && shift >= gestureWidth)) return shift;
  renderDrawer(shift);
  return shift;
}
function settleDrawer(open: boolean): void {
  const width = gestureWidth || drawerWidth();
  const from = drawerShiftOf();
  const end = open ? width : 0;
  const duration = reducedMotion() ? 0 : Math.max(SETTLE_MS * (width ? Math.abs(end - from) / width : 1), 1);
  const easing = 'ease-out';
  settleTarget = open;
  settleAnims = [
    panel.animate([
      { transform: `translate3d(${-HIDE_FACTOR * (width - from)}px,0,0)` },
      { transform: open ? 'translate3d(0px,0,0)' : `translate3d(${-HIDE_FACTOR * width}px,0,0)` },
    ], { duration, easing, fill: 'forwards' }),
    workspace.animate(
      [{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${end}px,0,0)` }],
      { duration, easing, fill: 'forwards' }),
    topbar.animate(
      [{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${end}px,0,0)` }],
      { duration, easing, fill: 'forwards' }),
    backdrop.animate(
      [{ opacity: width ? from / width : 0 }, { opacity: open ? 1 : 0 }],
      { duration, easing, fill: 'forwards' }),
  ];
  for (const el of [panel, workspace, topbar, backdrop]) el.style.transition = 'none';
  settleAnims[0].onfinish = () => {
    document.body.classList.toggle('files-open', open);
    clearDrawerDrag();
    for (const anim of settleAnims) anim.cancel();
    settleAnims = [];
    settleTarget = null;
  };
}
document.addEventListener('touchstart', (event) => {
  if (gestureId !== -1 || event.touches.length !== 1) return;
  const touch = event.touches[0] as Touch & { touchType?: string };
  if (touch.touchType === 'stylus') return;
  for (let el = event.target as HTMLElement | null; el; el = el.parentElement) {
    if (el.dataset && el.dataset.ignoreSwipe !== undefined) return;
  }
  // Ignore touches in the bottom gesture-navigation zone.
  if (window.innerHeight - touch.clientY < bottomInset() + 4) return;
  resumeTarget = settleTarget;
  cancelSettle();
  const frozenShift = freezeDrawer();
  gestureId = touch.identifier;
  gestureStartX = touch.clientX;
  gestureStartY = touch.clientY;
  gestureStartTime = performance.now();
  gestureLastX = touch.clientX;
  gestureLastTime = gestureStartTime;
  gestureVelocity = 0;
  gestureStartShift = frozenShift;
  gestureEngaged = false;
}, { passive: true, capture: true });
function abortGesture(): void {
  // Not a drawer swipe. If the drag already engaged, settle back to the state
  // the drawer came from; if we only froze a settle on touchstart, resume it.
  // Either way the drawer can never be left hanging mid-position.
  if (gestureEngaged) {
    settleDrawer(resumeTarget ?? document.body.classList.contains('files-open'));
  } else if (resumeTarget !== null) {
    settleDrawer(resumeTarget);
  } else {
    clearDrawerDrag(); // release the touchstart freeze; a class transition resumes
  }
  resumeTarget = null;
  gestureEngaged = false;
  gestureId = -1;
}
document.addEventListener('touchmove', (event) => {
  if (gestureId === -1) return;
  if (event.touches.length !== 1) { abortGesture(); return; }
  const touch = [...event.touches].find((item) => item.identifier === gestureId);
  if (!touch) return;
  const now = performance.now();
  const dx = touch.clientX - gestureStartX;
  const dy = touch.clientY - gestureStartY;
  gestureVelocity = (1 - EMA_ALPHA) * gestureVelocity + EMA_ALPHA * ((touch.clientX - gestureLastX) / Math.max(1, now - gestureLastTime));
  gestureLastX = touch.clientX;
  gestureLastTime = now;
  if (!gestureEngaged) {
    // Not ours: held still too long, moved vertically, or overshot vertically.
    if (now - gestureStartTime > MOVE_DEADLINE_MS || Math.abs(dy) > 80) { abortGesture(); return; }
    if (Math.abs(dx) <= Math.abs(dy)) return;
    // Only a horizontal drag away from the settled edge counts.
    if (!((dx > 4 && gestureStartShift < gestureWidth) || (dx < -4 && gestureStartShift > 0))) return;
    // Horizontally scrollable content under the finger wins.
    for (let el = event.target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
      if (el.scrollWidth <= el.clientWidth) continue;
      if (!['auto', 'scroll'].includes(getComputedStyle(el).overflowX)) continue;
      if ((dx > 0 && el.scrollLeft > 0) || (dx < 0 && el.scrollLeft < el.scrollWidth - el.clientWidth - 1)) {
        abortGesture(); return;
      }
    }
    // An active text selection takes priority over the drawer.
    if (window.getSelection()?.toString()) { abortGesture(); return; }
    gestureEngaged = true;
  }
  event.preventDefault();
  renderDrawer(gestureStartShift + dx);
}, { passive: false, capture: true });
const finishGesture = (event: TouchEvent, cancelled = false): void => {
  if (gestureId === -1) return;
  if (gestureEngaged) {
    const touch = [...event.changedTouches].find((item) => item.identifier === gestureId);
    const dx = touch ? touch.clientX - gestureStartX : 0;
    const dy = touch ? Math.abs(touch.clientY - gestureStartY) : 999;
    if (cancelled) {
      settleDrawer(resumeTarget ?? document.body.classList.contains('files-open'));
    } else {
      // Fling projection: where the drawer would land after 1s of coasting.
      const projected = gestureStartShift + dx + gestureVelocity * PROJECT_MS;
      settleDrawer(projected > gestureWidth / 2 && dy < 80 && Math.abs(dx) > dy);
    }
  } else if (resumeTarget !== null) {
    settleDrawer(resumeTarget);
  } else {
    clearDrawerDrag(); // plain tap: release the touchstart freeze
  }
  resumeTarget = null;
  gestureEngaged = false;
  gestureId = -1;
};
document.addEventListener('touchend', finishGesture, { passive: true, capture: true });
document.addEventListener('touchcancel', (event) => finishGesture(event, true), { passive: true, capture: true });
