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
import type { PdfFit, PdfHandle, PdfHit, PdfOutlineItem } from './pdfView';

const ICONS: Record<string, string> = {
  // Obsidian's own pair: lucide-layout-list for the toggle, a plain chevron
  // for the options beside it. The chevron is the whole point -- two icons of
  // equal weight read as two unrelated switches, a chevron reads as "more of
  // the button next to me".
  panel: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 4h7"/><path d="M14 9h7"/><path d="M14 15h7"/><path d="M14 20h7"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  options: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};
const svg = (path: string): string => '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';

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
    markButtons();
  };
  const setView = (view: SidebarView): void => {
    sidebar.dataset.view = view;
    thumbs.classList.toggle('hidden', view !== '1');
    outline.classList.toggle('hidden', view !== '2');
    if (!open) setOpen(true);
    markButtons();
  };

  // Two buttons, not a button and a menu behind it. Obsidian ships a
  // toggle plus a chevron that opens a switcher, which is a tap and a
  // read to do what the panel has only two of: each view gets its own
  // button, each button says whether its view is the one on screen, and
  // tapping the view that is already up shuts the panel.
  const showing = (view: SidebarView): boolean => open && sidebar.dataset.view === view;
  const pick = (view: SidebarView): void => {
    if (showing(view)) { setOpen(false); return; }
    setView(view);
    if (view === '2') revealOutline(shownPage); // the contents open at where you are
  };
  const toThumbs = button('grid', 'Thumbnails');
  toThumbs.onclick = () => pick('1');
  const toOutline = button('list', 'Table of contents');
  toOutline.onclick = () => pick('2');
  const markButtons = (): void => {
    toThumbs.classList.toggle('is-active', showing('1'));
    toThumbs.setAttribute('aria-pressed', String(showing('1')));
    toOutline.classList.toggle('is-active', showing('2'));
    toOutline.setAttribute('aria-pressed', String(showing('2')));
  };
  left.append(toThumbs, toOutline);

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
  const search = button('search', 'Find in document');
  search.onclick = () => setFinding(true);
  right.append(search, out, into, divider, display, box, count);

  // ---- the find bar ----------------------------------------------------
  // Obsidian's lies across the top of the pages, above everything, and on a
  // phone it sheds its divider, its settings button and its message line
  // and keeps the field, the count and the two arrows.
  const findbar = document.createElement('div');
  findbar.className = 'pdf-findbar mod-hidden';
  const wrap = document.createElement('div');
  wrap.className = 'pdf-search-wrapper';
  const field = document.createElement('input');
  field.className = 'pdf-toolbar-field';
  field.setAttribute('type', 'text');
  field.setAttribute('aria-label', 'Find');
  field.setAttribute('placeholder', 'Find in document');
  const tally = document.createElement('span');
  tally.className = 'pdf-find-results-count';
  const previous = button('up', 'Previous match');
  const next = button('down', 'Next match');
  const shut = button('close', 'Close find');
  wrap.append(field, tally, previous, next, shut);
  findbar.append(wrap);

  let hits: PdfHit[] = [];
  let at = -1;
  const show = (): void => {
    tally.textContent = hits.length ? `${at + 1} of ${hits.length}` : (field.value.trim() ? 'No matches' : '');
    field.classList.toggle('mod-not-found', Boolean(field.value.trim()) && !hits.length);
    handle.showHits(hits, at);
  };
  const step = (by: number): void => {
    if (!hits.length) return;
    at = (at + by + hits.length) % hits.length;
    show();
  };
  previous.onclick = () => step(-1);
  next.onclick = () => step(1);
  let asking = 0;
  const look = (): void => {
    const asked = field.value;
    window.clearTimeout(asking);
    asking = window.setTimeout(async () => {
      hits = await handle.find(asked);
      if (field.value !== asked) return;
      at = hits.length ? 0 : -1;
      show();
    }, 200);
  };
  field.oninput = look;
  field.onkeydown = (event) => {
    if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
    if (event.key === 'Escape') setFinding(false);
  };
  function setFinding(on: boolean): void {
    findbar.classList.toggle('mod-hidden', !on);
    document.body.classList.toggle('is-pdf-finding', on);
    if (on) { field.focus(); field.select(); return; }
    hits = [];
    at = -1;
    field.value = '';
    tally.textContent = '';
    handle.showHits([], -1);
  }
  shut.onclick = () => setFinding(false);

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
    // What the document says about itself wins. Only when it says nothing
    // is one read off the type — every PDF printed by a browser, which is
    // every PDF this app and Markor export, carries no bookmarks at all.
    let items = await handle.outline();
    if (!items.length) {
      const scanning = document.createElement('div');
      scanning.className = 'pdf-outline-empty';
      scanning.textContent = 'Reading the document…';
      outline.append(scanning);
      items = await handle.derivedOutline();
      scanning.remove();
    }
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
    // The scan outlives the tap that opened the panel, so the row for the
    // page being read is found once there are rows to find it among.
    if (sidebar.dataset.view === '2') revealOutline(shownPage);
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
  // The strip and the findbar go INSIDE the header, as a second line of it.
  // Not beside it: two bars that each paint their own frosted background
  // show a line between them wherever the thing behind them changes colour,
  // because each blurs its own patch of it. One element cannot do that, and
  // it rides the drawer's slide for free -- the header is already one of the
  // movers (src/drawers.ts). The panel stays in the workspace, where the
  // bottom sheet still comes up over it.
  const header = document.querySelector<HTMLElement>('.topbar');
  (header ?? document.body).append(toolbar, findbar);
  (document.querySelector<HTMLElement>('.workspace') ?? document.body).append(sidebar);

  return {
    destroy: () => {
      unfollow();
      window.clearTimeout(asking);
      toolbar.remove();
      sidebar.remove();
      findbar.remove();
      document.body.classList.remove('is-pdf-chrome', 'is-pdf-sidebar', 'is-pdf-finding');
    },
  };
}
