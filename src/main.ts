import '@codemirror/view';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
import './style.css';
import { SatrEditor } from './editor';
import { renderMarkdown } from './markdown';

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
      <button class="file-row active">Untitled.md</button>
    </aside>
    <div class="backdrop" id="backdrop"></div>
    <main class="workspace">
      <section class="editor-pane" id="editor-pane" aria-label="Editor"><div id="editor"></div></section>
      <section class="preview-pane" id="preview-pane" aria-label="Preview"><article id="preview"></article></section>
    </main>
  </div>`;

const preview = document.querySelector<HTMLElement>('#preview')!;
let mode: Mode = 'edit';
let saveTimer: number | undefined;
const bookIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.75 5.25A2.25 2.25 0 0 1 5 3h3.25A3.75 3.75 0 0 1 12 6.75V20a3.75 3.75 0 0 0-3.75-3.75H5a2.25 2.25 0 0 0-2.25 2.25z"/><path d="M21.25 5.25A2.25 2.25 0 0 0 19 3h-3.25A3.75 3.75 0 0 0 12 6.75V20a3.75 3.75 0 0 1 3.75-3.75H19a2.25 2.25 0 0 1 2.25 2.25z"/></svg>';
const penIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.2 18.8 1.1-4.4L16.7 3a2.1 2.1 0 0 1 3 3L8.3 17.7z"/><path d="M11 18.8h8.5"/></svg>';
let editor: SatrEditor;
let syncingScroll = false;
function syncScroll(source: HTMLElement, target: HTMLElement): void {
  if (syncingScroll) return;
  const sourceMax = Math.max(1, source.scrollHeight - source.clientHeight);
  const targetMax = Math.max(0, target.scrollHeight - target.clientHeight);
  syncingScroll = true;
  target.scrollTop = (source.scrollTop / sourceMax) * targetMax;
  window.requestAnimationFrame(() => { syncingScroll = false; });
}

function update(text?: string): void {
  const source = text ?? editor.getValue();
  preview.innerHTML = renderMarkdown(source);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { localStorage.setItem('satr:untitled.md', source); }, 700);
}
function setMode(next: Mode): void {
  const previous = mode;
  const sourceScroll = previous === 'preview' ? preview : editor.view.scrollDOM;
  mode = next;
  document.body.dataset.mode = mode;
  const previewButton = document.querySelector<HTMLButtonElement>('#preview-toggle')!;
  previewButton.innerHTML = mode === 'edit' ? bookIcon : penIcon;
  previewButton.setAttribute('aria-label', mode === 'edit' ? 'Open preview' : 'Return to editor');
  window.requestAnimationFrame(() => {
    const target = mode === 'preview' ? preview : editor.view.scrollDOM;
    syncScroll(sourceScroll, target);
  });
}
function toggleFiles(open = !document.body.classList.contains('files-open')): void {
  cancelSettle();
  document.body.classList.toggle('files-open', open);
  clearDrawerDrag();
}

editor = new SatrEditor(document.querySelector('#editor')!, update);
let lastScrollTop = 0;
let lastScrollTime = performance.now();
let buttonHideTimer: number | undefined;
editor.view.scrollDOM.addEventListener('scroll', () => {
  const current = editor.view.scrollDOM.scrollTop;
  const now = performance.now();
  const delta = current - lastScrollTop;
  const speed = delta / Math.max(1, now - lastScrollTime);
  if (delta > 2 && speed > 2.0) {
    document.body.classList.add('editor-scrolling-down');
    window.clearTimeout(buttonHideTimer);
    buttonHideTimer = window.setTimeout(() => document.body.classList.remove('editor-scrolling-down'), 450);
  } else if (delta < -2 || current <= 2) {
    document.body.classList.remove('editor-scrolling-down');
    window.clearTimeout(buttonHideTimer);
  }
  lastScrollTop = current;
  lastScrollTime = now;
  syncScroll(editor.view.scrollDOM, preview);
}, { passive: true });
preview.addEventListener('scroll', () => syncScroll(preview, editor.view.scrollDOM), { passive: true });
const saved = localStorage.getItem('satr:untitled.md');
editor.setValue(saved ?? starter);
update(editor.getValue());

(document.querySelector('#preview-toggle') as HTMLButtonElement).onclick = () => setMode(mode === 'edit' ? 'preview' : 'edit');
document.querySelector('#files')!.addEventListener('click', () => toggleFiles());
document.querySelector('#close-files')!.addEventListener('click', () => toggleFiles(false));
document.querySelector('#backdrop')!.addEventListener('click', () => toggleFiles(false));
document.querySelector('#new-file')!.addEventListener('click', () => { editor.setValue(''); setMode('edit'); toggleFiles(false); });
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
