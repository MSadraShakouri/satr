// Bottom-sheet menu, after Obsidian's phone menu: slides up from the bottom
// over a dimmed backdrop, rounded top corners, a grabber, items in rounded
// groups with inset dividers. Tap outside, drag it down or press Escape to
// dismiss. Used for file actions, the space switcher, sorting and the find
// button's long press.

export interface MenuItem {
  title: string;
  icon?: string;
  checked?: boolean;
  warning?: boolean;
  disabled?: boolean;
  action?: () => void;
}
export type MenuEntry = MenuItem | 'separator';

const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
let current: { close(): void } | null = null;

export function closeMenu(): void {
  current?.close();
}

export function openMenu(entries: MenuEntry[], options: { title?: string } = {}): { close(): void } {
  current?.close();
  // Groups between separators.
  const groups: MenuItem[][] = [[]];
  for (const entry of entries) {
    if (entry === 'separator') { if (groups[groups.length - 1].length) groups.push([]); }
    else groups[groups.length - 1].push(entry);
  }
  if (!groups[groups.length - 1].length) groups.pop();

  const backdrop = document.createElement('div');
  backdrop.className = 'menu-backdrop';
  const menu = document.createElement('div');
  menu.className = 'menu mod-bottom-sheet';
  menu.setAttribute('role', 'menu');
  menu.dataset.ignoreSwipe = '';
  let index = 0;
  const actions: MenuItem[] = [];
  menu.innerHTML = '<div class="menu-grabber"></div><div class="menu-scroll">'
    + (options.title ? `<div class="menu-title" dir="auto">${escapeHtml(options.title)}</div>` : '')
    + groups.map((group) => `<div class="menu-group">${group.map((item) => {
      actions.push(item);
      const cls = ['menu-item', item.warning ? 'is-warning' : '', item.disabled ? 'is-disabled' : '', item.checked ? 'mod-selected' : ''].filter(Boolean).join(' ');
      return `<div class="${cls}" role="menuitem" data-index="${index++}" tabindex="-1">`
        + `<div class="menu-item-icon">${item.icon ?? ''}</div>`
        + `<div class="menu-item-title" dir="auto">${escapeHtml(item.title)}</div>`
        + (item.checked ? `<div class="menu-item-icon mod-checked">${CHECK}</div>` : '')
        + '</div>';
    }).join('')}</div>`).join('<div class="menu-separator"></div>')
    + '</div>';

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (current === handle) current = null;
    document.removeEventListener('keydown', onKey, true);
    menu.classList.add('is-closing');
    backdrop.classList.add('is-closing');
    const remove = (): void => { menu.remove(); backdrop.remove(); };
    menu.addEventListener('transitionend', remove, { once: true });
    window.setTimeout(remove, 260);
  };
  const handle = { close };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('click', close);
  // Keep focus (and the keyboard) where it is.
  menu.addEventListener('mousedown', (event) => event.preventDefault());
  menu.addEventListener('click', (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>('.menu-item');
    if (!el) return;
    const item = actions[Number(el.dataset.index)];
    if (!item || item.disabled) return;
    close();
    item.action?.();
  });
  // Drag down to dismiss.
  let startY = -1;
  let dragging = false;
  const scroller = (): HTMLElement => menu.querySelector<HTMLElement>('.menu-scroll')!;
  menu.addEventListener('touchstart', (event) => {
    startY = scroller().scrollTop <= 0 ? event.touches[0].clientY : -1;
    dragging = false;
  }, { passive: true });
  menu.addEventListener('touchmove', (event) => {
    if (startY < 0) return;
    const dy = event.touches[0].clientY - startY;
    if (!dragging && dy > 8) { dragging = true; menu.style.transition = 'none'; }
    if (!dragging) return;
    event.preventDefault();
    menu.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  menu.addEventListener('touchend', (event) => {
    if (!dragging) return;
    const dy = event.changedTouches[0].clientY - startY;
    menu.style.transition = '';
    menu.style.transform = '';
    dragging = false;
    if (dy > Math.min(120, menu.offsetHeight / 3)) close();
  });

  document.body.append(backdrop, menu);
  void menu.offsetWidth;
  menu.classList.add('is-open');
  backdrop.classList.add('is-open');
  current = handle;
  return handle;
}

/** A yes/no question as a bottom sheet. */
export function confirmMenu(title: string, confirm: string, action: () => void): void {
  openMenu([{ title: confirm, warning: true, action }, 'separator', { title: 'Cancel' }], { title });
}
