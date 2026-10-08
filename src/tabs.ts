// Tab switcher, after Obsidian's mobile one (MobileTabSwitcher, read in its
// app.js): a full-screen sheet on the secondary background, the tabs as
// cards in two columns (200px previews, the title under each, a close button
// in the corner, the active one ringed in the accent colour), and a bar at
// the bottom: "+" (new tab), "N tabs ⌄" (tab menu), "Done". It appears with
// a 90ms fade and scale (1.1 → 1). Obsidian shows screenshots of the tabs;
// here each preview is the start of the note, rendered and shrunk; an empty
// tab shows a faint page icon. Swipe a card sideways to close it; press and
// hold a card to pick it up and drag it to a new place.
import { openMenu } from './menu';

export interface TabCard { title: string; active: boolean; empty: boolean }
export interface TabSwitcherDeps {
  tabs(): TabCard[];
  /** Rendered HTML of the start of a tab's note. */
  preview(index: number): Promise<string>;
  select(index: number): void;
  /** Resolves once the tab is gone (or the close was refused). */
  close(index: number): Promise<void>;
  newTab(): void;
  canReopen(): boolean;
  reopen(): void;
  closeOthers(): void;
  closeAll(): Promise<void>;
  /** Reorder: the tab at `from` goes to `to`. */
  move(from: number, to: number): void;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  plus: icon('<path d="M5 12h14M12 5v14"/>'),
  x: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
  chevron: icon('<path d="m6 9 6 6 6-6"/>'),
  file: icon('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'),
  undo: icon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
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
            ${tabs.length > 1 || !tabs[0].empty ? `<div class="close-button" data-close="${i}" role="button" aria-label="Close tab">${ICONS.x}</div>` : ''}
            <div class="mobile-tab-preview-embed"><div class="mobile-tab-preview-page markdown-preview-view"></div></div>
            <div class="mobile-tab-preview-empty">${ICONS.file}</div>
          </div>
          <div class="mobile-tab-title" dir="auto">${escapeHtml(tab.title)}</div>
        </div>
      </div>`).join('');
    tabs.forEach((_, i) => {
      void deps.preview(i).then((html) => {
        const page = group.querySelector<HTMLElement>(`.mobile-tab[data-index="${i}"] .mobile-tab-preview-page`);
        if (!page) return;
        page.innerHTML = html;
        page.closest('.mobile-tab')!.classList.toggle('is-empty', !html);
      });
    });
    window.requestAnimationFrame(() => group.querySelector('.mobile-tab.is-active')?.scrollIntoView({ block: 'nearest' }));
  }
  el.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const close = target.closest<HTMLElement>('[data-close]');
    if (close) {
      void deps.close(Number(close.dataset.close)).then(render);
      return;
    }
    const card = target.closest<HTMLElement>('.mobile-tab');
    if (card && swiped) { swiped = false; return; }
    if (card) { closeTabSwitcher(); deps.select(Number(card.dataset.index)); return; }
    const button = target.closest<HTMLElement>('[data-act]');
    if (!button) return;
    if (button.dataset.act === 'done') closeTabSwitcher();
    else if (button.dataset.act === 'new') { closeTabSwitcher(); deps.newTab(); }
    else if (button.dataset.act === 'menu') {
      const n = deps.tabs().length;
      openMenu([
        { title: 'New tab', icon: ICONS.plus, action: () => { closeTabSwitcher(); deps.newTab(); } },
        { title: 'Reopen closed tab', icon: ICONS.undo, disabled: !deps.canReopen(), action: () => { closeTabSwitcher(); deps.reopen(); } },
        'separator',
        { title: 'Close other tabs', icon: ICONS.archiveX, warning: true, disabled: n < 2, action: () => { deps.closeOthers(); render(); } },
        { title: 'Close all tabs', icon: ICONS.archiveX, warning: true, disabled: deps.tabs().every((t) => t.empty), action: () => { void deps.closeAll().then(render); } },
      ]);
    }
  });
  // Swipe a card sideways to close it: it follows the finger and fades; past a
  // quarter of its width (or a flick — the direction the finger was already
  // going at, a moment further) it flies off and the tab closes. The gesture is
  // read before it is claimed: a drag that starts a little downward, or whose
  // first millimetres are not perfectly horizontal, used to be thrown away
  // outright — which is what made closing a tab feel like it needed the whole
  // card's width, twice, at the right angle.
  let swiped = false;
  let drag: { card: HTMLElement; x: number; y: number; t: number; dx: number; on: boolean } | null = null;
  /** The flick that counts: how far this drag would still travel at the speed
   *  it is going, over the moment after the lift. */
  const projected = (dx: number, dt: number): number => dx + (dx / Math.max(1, dt)) * 100;
  // Press and hold (350ms, finger still) picks a card up to reorder.
  let holdTimer: number | undefined;
  let lift: { card: HTMLElement; wrapper: HTMLElement; from: number; x: number; y: number; left: number; top: number } | null = null;
  const scroller = el.querySelector<HTMLElement>('.mobile-tab-switcher-scroll')!;
  const cancelHold = (): void => { window.clearTimeout(holdTimer); holdTimer = undefined; };
  function startLift(card: HTMLElement, x: number, y: number): void {
    drag = null;
    const wrapper = card.parentElement!;
    const box = wrapper.getBoundingClientRect();
    lift = { card, wrapper, from: [...group.children].indexOf(wrapper), x, y, left: box.left, top: box.top };
    card.classList.add('is-lifted');
    navigator.vibrate?.(10);
  }
  function moveLift(x: number, y: number): void {
    if (!lift) return;
    // The wrapper under the finger swaps places with the lifted one.
    const over = [...group.children].find((w) => {
      if (w === lift!.wrapper) return false;
      const r = w.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    if (over) {
      const order = [...group.children];
      group.insertBefore(lift.wrapper, order.indexOf(over) > order.indexOf(lift.wrapper) ? over.nextSibling : over);
    }
    // Near the top or bottom edge, scroll.
    const edge = scroller.getBoundingClientRect();
    if (y < edge.top + 60) scroller.scrollTop -= 10;
    else if (y > edge.bottom - 60) scroller.scrollTop += 10;
    const box = lift.wrapper.getBoundingClientRect();
    lift.card.style.transform = `translate(${x - lift.x - (box.left - lift.left)}px, ${y - lift.y - (box.top - lift.top)}px) scale(1.04)`;
  }
  function endLift(): void {
    if (!lift) return;
    const { card, wrapper, from } = lift;
    lift = null;
    swiped = true;
    window.setTimeout(() => { swiped = false; }, 400);
    card.classList.remove('is-lifted');
    card.style.transform = '';
    const to = [...group.children].indexOf(wrapper);
    if (to !== from) deps.move(from, to);
    render();
  }
  el.addEventListener('contextmenu', (event) => { if ((event.target as HTMLElement).closest('.mobile-tab')) event.preventDefault(); });
  el.addEventListener('touchstart', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.mobile-tab');
    if (!card || (event.target as HTMLElement).closest('.close-button')) return;
    const t = event.touches[0];
    cancelHold();
    // Press and hold picks a card up; the hold is long enough that a swipe
    // that starts a moment slow is still a swipe.
    if (deps.tabs().length > 1) holdTimer = window.setTimeout(() => startLift(card, t.clientX, t.clientY), 450);
    if (deps.tabs().length < 2 && deps.tabs()[0].empty) return; // nothing to close
    drag = { card, x: t.clientX, y: t.clientY, t: event.timeStamp, dx: 0, on: false };
  }, { passive: true });
  el.addEventListener('touchmove', (event) => {
    const t = event.touches[0];
    if (lift) { event.preventDefault(); moveLift(t.clientX, t.clientY); return; }
    if (!drag) { cancelHold(); return; }
    const dx = t.clientX - drag.x;
    const dy = t.clientY - drag.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) cancelHold();
    if (!drag.on) {
      // The switcher's own scroll keeps a gesture that is mostly up and down;
      // this drag takes one that is clearly sideways, whenever it becomes
      // that. A finger that starts a little downward and then travels
      // sideways is a swipe — it used to be thrown away by the first sample
      // that leaned vertical, which is why closing a card felt like it took
      // the card's whole width, twice, at the right angle. Nothing is
      // claimed until the movement is sideways, so a scroll never loses its
      // first pixels to this.
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) + 8) return;
      drag.on = true;
    }
    event.preventDefault();
    drag.dx = dx;
    drag.card.style.transition = 'none';
    drag.card.style.transform = `translateX(${dx}px)`;
    // Fading as the card travels, so the quarter of the way it takes to close
    // is visible while the finger is still down.
    drag.card.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / (drag.card.offsetWidth / 2)));
  }, { passive: false });
  const endDrag = (event: TouchEvent): void => {
    cancelHold();
    if (lift) { endLift(); return; }
    if (!drag) return;
    const { card, dx, on, t } = drag;
    drag = null;
    if (!on) return;
    swiped = true;
    window.setTimeout(() => { swiped = false; }, 400);
    const width = card.offsetWidth;
    const reach = Math.abs(dx) > width / 4 || Math.abs(projected(dx, event.timeStamp - t)) > width / 2;
    card.style.transition = 'transform 180ms ease-out, opacity 180ms ease-out';
    if (reach) {
      card.style.transform = `translateX(${Math.sign(dx) * window.innerWidth}px)`;
      card.style.opacity = '0';
      window.setTimeout(() => { void deps.close(Number(card.dataset.index)).then(render); }, 180);
    } else {
      card.style.transform = '';
      card.style.opacity = '';
    }
  };
  el.addEventListener('touchend', endDrag);
  el.addEventListener('touchcancel', endDrag);
  document.addEventListener('keydown', function onKey(event) {
    if (!open) { document.removeEventListener('keydown', onKey, true); return; }
    if (event.key === 'Escape' && !document.querySelector('.menu.is-open')) { event.preventDefault(); closeTabSwitcher(); }
  }, true);
  render();
  document.body.appendChild(el);
  open = el;
  el.animate([{ opacity: 0, transform: 'scale(1.1)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 90, easing: 'cubic-bezier(0, 0.55, 0.45, 1)' });
}
