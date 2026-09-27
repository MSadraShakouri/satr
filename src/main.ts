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
      <div class="topbar-center"><span class="save-state" id="save-state" aria-live="polite">Saved</span></div>
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
      <section class="editor-pane" id="editor-pane" aria-label="Editor"><div class="file-name" id="file-name">Main</div><div id="editor"></div></section>
      <section class="preview-pane" id="preview-pane" aria-label="Preview"><article id="preview"></article></section>
    </main>
  </div>`;

const preview = document.querySelector<HTMLElement>('#preview')!;
const fileName = document.querySelector<HTMLElement>('#file-name')!;
const state = document.querySelector<HTMLElement>('#save-state')!;
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
  state.textContent = 'Unsaved';
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { localStorage.setItem('satr:untitled.md', source); state.textContent = 'Saved'; }, 700);
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
  document.body.classList.toggle('files-open', open);
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
  fileName.style.opacity = current > 4 ? '0' : '1';
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
let gestureStartX = 0;
let gestureStartY = 0;
let gestureId = -1;
let gestureStartTime = 0;
let gestureLastX = 0;
let gestureLastTime = 0;
let gestureVelocity = 0;
let gestureMode: 'edge-open' | 'panel-close' | null = null;
const panel = document.querySelector<HTMLElement>('.file-panel')!;
const editorPane = document.querySelector<HTMLElement>('.editor-pane')!;
const previewPane = document.querySelector<HTMLElement>('.preview-pane')!;
const topbar = document.querySelector<HTMLElement>('.topbar')!;
const workspace = document.querySelector<HTMLElement>('.workspace')!;
const drawerWidth = (): number => Math.min(window.innerWidth * .84, 420);
function dragDrawer(dx: number, opening: boolean): void {
  const width = drawerWidth();
  const amount = opening ? Math.max(0, Math.min(width, dx)) : Math.max(-width, Math.min(0, dx));
  panel.style.transition = 'none';
  const progress = opening ? amount / width : 1 + amount / width;
  panel.style.transform = opening ? `translate3d(calc(-105% + ${amount}px),0,0)` : `translate3d(${amount}px,0,0)`;
  workspace.style.transition = 'none';
  topbar.style.transition = 'none';
  const contentOffset = opening ? amount : width + amount;
  workspace.style.transform = `translate3d(${contentOffset}px,0,0)`;
  topbar.style.transform = `translate3d(${contentOffset}px,0,0)`;
  const backdrop = document.querySelector<HTMLElement>('#backdrop')!;
  backdrop.style.display = 'block';
  backdrop.style.opacity = String(Math.max(0, Math.min(.5, progress * .5)));
}
function clearDrawerDrag(): void {
  window.requestAnimationFrame(() => {
    panel.style.transition = '';
    panel.style.transform = '';
    workspace.style.transition = '';
    workspace.style.transform = '';
    topbar.style.transition = '';
    topbar.style.transform = '';
    const backdrop = document.querySelector<HTMLElement>('#backdrop')!;
    backdrop.style.display = '';
    backdrop.style.opacity = '';
  });
}
document.addEventListener('touchstart', (event) => {
  if (gestureId !== -1 || event.touches.length !== 1) return;
  const touch = event.touches[0];
  gestureId = touch.identifier;
  gestureStartX = touch.clientX;
  gestureStartY = touch.clientY;
  gestureStartTime = performance.now();
  gestureLastX = touch.clientX;
  gestureLastTime = gestureStartTime;
  gestureVelocity = 0;
  gestureMode = document.body.classList.contains('files-open') ? 'panel-close' : 'edge-open';
}, { passive: true, capture: true });
document.addEventListener('touchmove', (event) => {
  if (gestureId === -1 || !gestureMode) return;
  const touch = [...event.touches].find((item) => item.identifier === gestureId);
  if (!touch) return;
  const dx = touch.clientX - gestureStartX;
  const now = performance.now();
  const elapsed = Math.max(1, now - gestureLastTime);
  gestureVelocity = (touch.clientX - gestureLastX) / elapsed;
  gestureLastX = touch.clientX;
  gestureLastTime = now;
  const dy = Math.abs(touch.clientY - gestureStartY);
  if (dy > 80 || Math.abs(dx) <= Math.abs(touch.clientY - gestureStartY) || (gestureMode === 'edge-open' && dx < 4) || (gestureMode === 'panel-close' && dx > -4)) return;
  event.preventDefault();
  dragDrawer(dx, gestureMode === 'edge-open');
}, { passive: false, capture: true });
const finishGesture = (event: TouchEvent, cancelled = false): void => {
  if (gestureId === -1) return;
  const touch = [...event.changedTouches].find((item) => item.identifier === gestureId);
  const dx = touch ? touch.clientX - gestureStartX : 0;
  const dy = touch ? Math.abs(touch.clientY - gestureStartY) : 999;
  const opening = gestureMode === 'edge-open';
  const fastEnough = opening ? gestureVelocity > .55 : gestureVelocity < -.55;
  const shouldChange = !cancelled && dy < 80 && Math.abs(dx) > dy && ((opening && (dx > drawerWidth() * .35 || fastEnough)) || (!opening && (dx < -drawerWidth() * .35 || fastEnough)));
  if (shouldChange) toggleFiles(opening);
  clearDrawerDrag();
  gestureMode = null;
  gestureId = -1;
};
document.addEventListener('touchend', finishGesture, { passive: true, capture: true });
document.addEventListener('touchcancel', (event) => finishGesture(event, true), { passive: true, capture: true });