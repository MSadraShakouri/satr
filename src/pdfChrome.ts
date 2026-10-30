// Obsidian's PDF chrome, rebuilt on our own viewer.
//
// Obsidian's PDF view is pdf.js's viewer with Obsidian's shell around it, and
// its shell is a strip across the top and a panel that slides in from the
// side. Its own stylesheet names every part of it, so the structure here is
// the structure there, class for class: a .pdf-toolbar holding
// .pdf-toolbar-left and .pdf-toolbar-right, and a .pdf-sidebar-container
// holding a .pdf-thumbnail-view and a .pdf-outline-view, one shown at a
// time, the panel addressed by data-view — 1 for thumbnails at 140px, 2 for
// the table of contents at 275px, exactly the two widths its phone layout
// uses.
//
// What its phone layout changes, and so does ours: the panel lies over the
// pages instead of pushing them aside, and the resizer between them is gone.
//
// The toolbar's controls, in Obsidian's own order: the panel toggle, the
// panel's view picker, then zoom out, zoom in, the display options, and the
// page box with the count beside it.
import { openMenu, type MenuEntry } from './menu';
import type { PdfFit, PdfHandle, PdfOutlineItem } from './pdfView';

const ICONS: Record<string, string> = {
  panel: '<path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5z"/><path d="M9 3v18"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  options: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/>',
};
const button = (name: string, label: string): HTMLButtonElement => {
  const el = document.createElement('button');
  el.className = 'pdf-toolbar-button';
  el.setAttribute('aria-label', label);
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return el;
};

export interface PdfChrome { destroy(): void }

/** Which of the two panels is up. Obsidian keeps the same two and addresses
 *  them by number on the container, so the stylesheet can give each its own
 *  width without knowing what is inside. */
type SidebarView = '1' | '2';

export function mountPdfChrome(handle: PdfHandle, themed: { on(): boolean; toggle(): void }): PdfChrome {
  const toolbar = document.createElement('div');
  toolbar.className = 'pdf-toolbar';
  const left = document.createElement('div');
  left.className = 'pdf-toolbar-left';
  const right = document.createElement('div');
  right.className = 'pdf-toolbar-right';
  toolbar.append(left, right);

  const sidebar = document.createElement('div');
  sidebar.className = 'pdf-sidebar-container';
  sidebar.dataset.view = '1';
  const thumbs = document.createElement('div');
  thumbs.className = 'pdf-thumbnail-view';
  const outline = document.createElement('div');
  outline.className = 'pdf-outline-view hidden';
  const content = document.createElement('div');
  content.className = 'pdf-sidebar-content';
  content.append(thumbs, outline);
  sidebar.append(content);

  // ---- the panel -----------------------------------------------------
  let open = false;
  const setOpen = (next: boolean): void => {
    open = next;
    document.body.classList.toggle('is-pdf-sidebar', open);
    if (open) { void fillThumbs(); void fillOutline(); }
  };
  const setView = (view: SidebarView): void => {
    sidebar.dataset.view = view;
    thumbs.classList.toggle('hidden', view !== '1');
    outline.classList.toggle('hidden', view !== '2');
    if (!open) setOpen(true);
  };

  const toggle = button('panel', 'Toggle sidebar');
  toggle.onclick = () => setOpen(!open);
  const picker = button('list', 'Sidebar options');
  picker.onclick = () => {
    openMenu([
      { title: 'Thumbnails', checked: sidebar.dataset.view === '1', action: () => setView('1') },
      { title: 'Table of contents', checked: sidebar.dataset.view === '2', action: () => setView('2') },
      'separator',
      { title: 'Reveal page in table of contents', action: () => { setView('2'); revealOutline(shownPage); } },
    ] as MenuEntry[]);
  };
  left.append(toggle, picker);

  // ---- zoom, display options, the page box ---------------------------
  const out = button('minus', 'Zoom out');
  out.onclick = () => handle.zoomBy(1 / 1.25);
  const into = button('plus', 'Zoom in');
  into.onclick = () => handle.zoomBy(1.25);
  const divider = document.createElement('div');
  divider.className = 'pdf-toolbar-divider';
  const display = button('options', 'Display options');
  display.onclick = () => {
    const fit = handle.fitNow();
    const stop = (title: string, mode: PdfFit): MenuEntry =>
      ({ title, checked: fit === mode, action: () => handle.fitTo(mode) });
    openMenu([
      stop('Fit width', 'width'), stop('Fit height', 'height'),
      'separator',
      { title: 'Adapt to theme', checked: themed.on(), action: () => themed.toggle() },
    ]);
  };

  const box = document.createElement('input');
  box.className = 'pdf-page-input';
  box.setAttribute('type', 'text');
  box.setAttribute('inputmode', 'numeric');
  box.setAttribute('aria-label', 'Page');
  const count = document.createElement('span');
  count.className = 'pdf-page-numbers';
  count.textContent = `of ${handle.pages}`;
  const jump = (): void => {
    const asked = Number.parseInt(box.value, 10);
    if (Number.isFinite(asked)) handle.goTo(Math.min(Math.max(asked, 1), handle.pages));
    box.value = String(shownPage);
    box.blur();
  };
  box.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); jump(); } };
  box.onblur = () => { box.value = String(shownPage); };
  box.onfocus = () => box.select();
  right.append(out, into, divider, display, box, count);

  // ---- what follows the reader ---------------------------------------
  let shownPage = handle.place().page;
  const follow = (page: number): void => {
    shownPage = page;
    if (document.activeElement !== box) box.value = String(page);
    for (const el of thumbs.querySelectorAll('.thumbnail')) {
      el.classList.toggle('selected', Number((el as HTMLElement).dataset.page) === page);
    }
  };
  const unfollow = handle.onPage(follow);

  // ---- thumbnails ------------------------------------------------------
  // Drawn when the panel is opened and not before: a page is a render, and
  // a document nobody opened the panel on should not pay for one.
  let drewThumbs = false;
  async function fillThumbs(): Promise<void> {
    if (drewThumbs) return;
    drewThumbs = true;
    for (let page = 1; page <= handle.pages; page += 1) {
      const link = document.createElement('a');
      link.className = 'thumbnail';
      link.dataset.page = String(page);
      link.dataset.pageLabel = String(page);
      link.onclick = () => { handle.goTo(page); setOpen(false); };
      thumbs.append(link);
    }
    follow(shownPage);
    for (let page = 1; page <= handle.pages; page += 1) {
      const url = await handle.thumbnail(page, 100);
      const link = thumbs.querySelector<HTMLElement>(`.thumbnail[data-page="${page}"]`);
      if (!url || !link) continue;
      const picture = document.createElement('img');
      picture.className = 'thumbnailImage';
      picture.src = url;
      picture.alt = '';
      link.append(picture);
      link.dataset.loaded = '';
    }
  }

  // ---- the table of contents ------------------------------------------
  let drewOutline = false;
  const rows: { page: number; el: HTMLElement }[] = [];
  async function fillOutline(): Promise<void> {
    if (drewOutline) return;
    drewOutline = true;
    const items = await handle.outline();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'pdf-outline-empty';
      empty.textContent = 'No table of contents';
      outline.append(empty);
      return;
    }
    const draw = (list: PdfOutlineItem[], depth: number, into: HTMLElement): void => {
      for (const item of list) {
        const row = document.createElement('div');
        row.className = 'tree-item-self';
        row.style.paddingInlineStart = `${8 + depth * 17}px`;
        row.textContent = item.title;
        if (item.page !== null) {
          const flair = document.createElement('span');
          flair.className = 'tree-item-flair';
          flair.textContent = String(item.page);
          row.append(flair);
          row.onclick = () => { handle.goTo(item.page!); setOpen(false); };
          rows.push({ page: item.page, el: row });
        }
        into.append(row);
        if (item.children.length) draw(item.children, depth + 1, into);
      }
    };
    draw(items, 0, outline);
  }
  /** Obsidian's "Reveal page in table of contents": the last heading at or
   *  before the page being read is the one you are inside. */
  const revealOutline = (page: number): void => {
    let found: HTMLElement | null = null;
    for (const row of rows) if (row.page <= page) found = row.el;
    for (const row of rows) row.el.classList.toggle('mod-active', row.el === found);
    found?.scrollIntoView({ block: 'center' });
  };

  box.value = String(shownPage);
  document.body.append(toolbar, sidebar);

  return {
    destroy: () => {
      unfollow();
      toolbar.remove();
      sidebar.remove();
      document.body.classList.remove('is-pdf-chrome', 'is-pdf-sidebar');
    },
  };
}
