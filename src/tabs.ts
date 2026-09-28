// Tab switcher, after Obsidian's mobile one (MobileTabSwitcher, read in its
// app.js): a full-screen sheet on the secondary background, the tabs as
// cards in two columns (200px previews, the title under each, a close button
// in the corner, the active one ringed in the accent colour), and a bar at
// the bottom: "+" (new tab), "N tabs ⌄" (tab menu), "Done". It appears with
// a 90ms fade and scale (1.1 → 1). Obsidian shows screenshots of the tabs;
// here each preview is the start of the note, rendered and shrunk.
import { openMenu } from './menu';

export interface TabCard { title: string; active: boolean }
export interface TabSwitcherDeps {
  tabs(): TabCard[];
  /** Rendered HTML of the start of a tab's note. */
  preview(index: number): Promise<string>;
  select(index: number): void;
  close(index: number): void;
  newTab(): void;
  closeOthers(): void;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  plus: icon('<path d="M5 12h14M12 5v14"/>'),
  x: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
  chevron: icon('<path d="m6 9 6 6 6-6"/>'),
  archiveX: icon('<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M9.5 12l5 5M14.5 12l-5 5"/>'),
};

let open: HTMLElement | null = null;
export const isTabSwitcherOpen = (): boolean => open !== null;

export function closeTabSwitcher(): void {
  const el = open;
  if (!el) return;
  open = null;
  el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.1)' }], { duration: 90, easing: 'ease-in' })
    .onfinish = () => el.remove();
  el.style.opacity = '0';
}

export function openTabSwitcher(deps: TabSwitcherDeps): void {
  if (open) return;
  const el = document.createElement('div');
  el.className = 'mobile-tab-switcher';
  el.dataset.ignoreSwipe = '';
  el.innerHTML = `
    <div class="mobile-tab-switcher-scroll"><div class="mobile-tab-switcher-inner-scroll"><div class="mobile-tab-group-container"></div></div></div>
    <div class="mobile-tab-switcher-menubar">
      <div class="mobile-tab-switcher-menu-spacer"><button type="button" class="clickable-icon" data-act="new" aria-label="New tab">${ICONS.plus}</button></div>
      <button type="button" class="mobile-tab-switcher-menu-button" data-act="menu"><span class="mobile-tab-switcher-count"></span><span class="mobile-tab-switcher-menu-button-chevron">${ICONS.chevron}</span></button>
      <div class="mobile-tab-switcher-menu-spacer"><button type="button" class="clickable-icon mod-text" data-act="done">Done</button></div>
    </div>`;
  const group = el.querySelector<HTMLElement>('.mobile-tab-group-container')!;
  const count = el.querySelector<HTMLElement>('.mobile-tab-switcher-count')!;

  function render(): void {
    const tabs = deps.tabs();
    count.textContent = `${tabs.length} tab${tabs.length === 1 ? '' : 's'}`;
    group.innerHTML = tabs.map((tab, i) => `
      <div class="mobile-tab-wrapper">
        <div class="mobile-tab${tab.active ? ' is-active' : ''}" data-index="${i}">
          <div class="mobile-tab-preview">
            ${tabs.length > 1 ? `<div class="close-button" data-close="${i}" role="button" aria-label="Close tab">${ICONS.x}</div>` : ''}
            <div class="mobile-tab-preview-embed"><div class="mobile-tab-preview-page markdown-preview-view"></div></div>
          </div>
          <div class="mobile-tab-title" dir="auto">${escapeHtml(tab.title)}</div>
        </div>
      </div>`).join('');
    tabs.forEach((_, i) => {
      void deps.preview(i).then((html) => {
        const page = group.querySelector<HTMLElement>(`.mobile-tab[data-index="${i}"] .mobile-tab-preview-page`);
        if (page) page.innerHTML = html;
      });
    });
    window.requestAnimationFrame(() => group.querySelector('.mobile-tab.is-active')?.scrollIntoView({ block: 'nearest' }));
  }
  el.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const close = target.closest<HTMLElement>('[data-close]');
    if (close) {
      deps.close(Number(close.dataset.close));
      render();
      return;
    }
    const card = target.closest<HTMLElement>('.mobile-tab');
    if (card) { closeTabSwitcher(); deps.select(Number(card.dataset.index)); return; }
    const button = target.closest<HTMLElement>('[data-act]');
    if (!button) return;
    if (button.dataset.act === 'done') closeTabSwitcher();
    else if (button.dataset.act === 'new') { closeTabSwitcher(); deps.newTab(); }
    else if (button.dataset.act === 'menu') {
      const n = deps.tabs().length;
      openMenu([
        { title: 'New tab', icon: ICONS.plus, action: () => { closeTabSwitcher(); deps.newTab(); } },
        'separator',
        { title: 'Close other tabs', icon: ICONS.archiveX, warning: true, disabled: n < 2, action: () => { deps.closeOthers(); render(); } },
      ]);
    }
  });
  document.addEventListener('keydown', function onKey(event) {
    if (!open) { document.removeEventListener('keydown', onKey, true); return; }
    if (event.key === 'Escape' && !document.querySelector('.menu.is-open')) { event.preventDefault(); closeTabSwitcher(); }
  }, true);
  render();
  document.body.appendChild(el);
  open = el;
  el.animate([{ opacity: 0, transform: 'scale(1.1)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 90, easing: 'cubic-bezier(0, 0.55, 0.45, 1)' });
}
