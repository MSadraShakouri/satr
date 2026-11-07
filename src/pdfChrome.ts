// Obsidian's PDF chrome, rebuilt on our own viewer.
//
// Obsidian's PDF view is pdf.js's viewer with Obsidian's shell around it, and
// its shell is a strip across the top and a panel that slides in from the
// side. Its own stylesheet names every part of it, so the structure here is
// the structure there, class for class: a .pdf-toolbar holding
// .pdf-toolbar-left and .pdf-toolbar-right, and a .pdf-sidebar-container
// holding a .pdf-thumbnail-view, 140px wide, exactly the width its phone
// layout uses.
//
// Obsidian's panel has a second view, the table of contents. Ours does not:
// the app already has a panel that answers "where am I" for a note, and a
// document's contents go in the same one (src/rightSidebar.ts). The button
// is still here, in Obsidian's own place on the strip, and opens that
// drawer -- one outline, one place, one set of habits -- rather than a
// second tree of its own that happened to look the same.
//
// What its phone layout changes, and so does ours: the panel lies over the
// pages instead of pushing them aside, and the resizer between them is gone.
//
// The toolbar's controls, in Obsidian's own order: the panel toggle, the
// panel's view picker, then zoom out, zoom in, the display options, and the
// page box with the count beside it.
import { openMenu, type MenuEntry } from './menu';
import { ROTATIONS, type Rotation } from './orientation';
import type { PdfFit, PdfHandle, PdfHit } from './pdfView';
import { countLabel, markQuery } from './searchQuery';

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

export interface PdfChrome {
  destroy(): void;
  /** Open (or close) the find bar: the app's own find button drives this. */
  setFinding(on: boolean): void;
  /** Look for what the outline panel is looking for. */
  ask(query: string): void;
  finding(): boolean;
}

/** Light, dark, or whichever the app is — the same three the app's own
 *  theme has (src/theme.ts), said the same way. Obsidian ships one
 *  checkbox here, which cannot say "this document is a scan of a black
 *  page, leave it alone" or "keep these pages white while the app is
 *  dark". */
export type PdfTheme = 'auto' | 'light' | 'dark';
export interface PdfThemeControl { mode(): PdfTheme; set(next: PdfTheme): void }

/** Which way up this document is read — the same four Settings has
 *  (src/orientation.ts), asked where the reader is looking. Rotation is a
 *  property of the document on screen, not of the app, and a reader who
 *  wants a scanned page sideways is looking at the page. */
export interface PdfRotationControl { rotation(): Rotation; set(next: Rotation): void }

/** The sheet behind a document's Rotation: Dark pages' shape exactly, four
 *  choices instead of three, and the same one place the answer lives. */
export function openRotation(control: PdfRotationControl): void {
  const now = control.rotation();
  openMenu(ROTATIONS.map(([value, title]) => ({
    title,
    checked: now === value,
    action: () => control.set(value),
  })), { title: 'Rotation' });
}

/** The sheet behind Dark pages, opened from the toolbar's display options
 *  and from the file's ⋮ alike: one list, one place the answer lives. */
export function openDarkPages(themed: PdfThemeControl): void {
  const now = themed.mode();
  const choice = (title: string, value: PdfTheme): MenuEntry =>
    ({ title, checked: now === value, action: () => themed.set(value) });
  openMenu([
    choice('Automatic', 'auto'),
    choice('Always light', 'light'),
    choice('Always dark', 'dark'),
  ], { title: 'Dark pages' });
}

export interface PdfChromeDeps {
  /** What the bar is looking for, so the panel can list the same hits. */
  told?(query: string): void;
  /** Open the app's outline panel: where a document's contents live. */
  contents?(): void;
}

export function mountPdfChrome(handle: PdfHandle, themed: PdfThemeControl, deps: PdfChromeDeps = {}): PdfChrome {
  const { told, contents } = deps;
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
  const content = document.createElement('div');
  content.className = 'pdf-sidebar-content';
  content.append(thumbs);
  sidebar.append(content);

  // ---- the panel -----------------------------------------------------
  let open = false;
  const setOpen = (next: boolean): void => {
    open = next;
    document.body.classList.toggle('is-pdf-sidebar', open);
    if (open) void fillThumbs();
    markButtons();
  };

  // Two buttons, in Obsidian's own order and its own place: the panel of
  // thumbnails, which is this view's own, and the contents, which are the
  // app's. Tapping the thumbnails while they are up shuts them; the
  // contents open the drawer and the drawer closes the way every drawer
  // in the app does.
  const toThumbs = button('grid', 'Thumbnails');
  toThumbs.onclick = () => setOpen(!open);
  const toOutline = button('list', 'Table of contents');
  toOutline.onclick = () => { setOpen(false); contents?.(); };
  const markButtons = (): void => {
    toThumbs.classList.toggle('is-active', open);
    toThumbs.setAttribute('aria-pressed', String(open));
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
      { title: 'Dark pages', action: () => openDarkPages(themed) },
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
  // No search icon in the strip: finding something in what is open is what
  // the magnifier at the bottom of the screen does in every other kind of
  // tab, and two ways in -- one of them a second, smaller icon up here --
  // was one too many.
  right.append(out, into, divider, display, box, count);

  // ---- the find bar ----------------------------------------------------
  // Obsidian's lies across the top of the pages, above everything, and on a
  // phone it sheds its divider, its settings button and its message line
  // and keeps the field, the count and the two arrows.
  // The same bar the app finds things in a note with, down to its class
  // names: a reader should not meet a second, lesser search field just
  // because the tab holds a document. It has no replace row -- there is
  // nothing to write back into a document -- so the chevron is left off.
  const findbar = document.createElement('div');
  findbar.className = 'pdf-findbar document-search-container mod-hidden';
  findbar.dataset.ignoreSwipe = '';
  findbar.innerHTML = `
    <div class="document-search">
      <div class="search-input-container document-search-input">
        <input type="search" dir="auto" placeholder="Find" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Find in document">
        <div class="document-search-count"></div>
      </div>
      <div class="document-search-buttons">
        <button type="button" class="document-search-button clickable-icon" data-act="prev" aria-label="Previous match"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.up}</svg></button>
        <button type="button" class="document-search-button clickable-icon" data-act="next" aria-label="Next match"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.down}</svg></button>
      </div>
      <button type="button" class="document-search-close-button clickable-icon" data-act="close" aria-label="Close find"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.close}</svg></button>
    </div>`;
  const field = findbar.querySelector('input') as HTMLInputElement;
  const tally = findbar.querySelector('.document-search-count') as HTMLElement;
  const previous = findbar.querySelector('[data-act="prev"]') as HTMLButtonElement;
  const next = findbar.querySelector('[data-act="next"]') as HTMLButtonElement;
  const shut = findbar.querySelector('[data-act="close"]') as HTMLButtonElement;

  let hits: PdfHit[] = [];
  let at = -1;
  const show = (): void => {
    // The same count the note's bar shows, from the same place: "۳ / ۱۴۱"
    // for a Persian query, with the bar laid out for it.
    markQuery(findbar, tally, field.value);
    tally.textContent = countLabel(field.value, at, hits.length);
    tally.style.display = field.value.trim() ? '' : 'none';
    findbar.classList.toggle('mod-no-match', Boolean(field.value.trim()) && !hits.length);
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
      told?.(asked); // the panel lists what the bar is looking for
    }, 200);
  };
  field.oninput = () => {
    // the side the count sits on follows the typing, not the search
    markQuery(findbar, tally, field.value);
    look();
  };
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
    markQuery(findbar, tally, '');
    findbar.classList.remove('mod-no-match');
    handle.showHits([], -1);
    told?.('');
  }
  /** What the panel beside it is looking for: one word for the two of them,
   *  rather than a bar and a panel searching the same document apart. */
  function ask(query: string): void {
    if (field.value === query) return;
    field.value = query;
    // The panel and the bar are one search in two places: a word typed in
    // the panel brings the bar up showing it, and clearing the panel puts
    // the bar away. The bar is shown without being focused -- the reader
    // is typing in the panel, and taking the keyboard off them mid-word
    // would be the opposite of showing them their search.
    findbar.classList.toggle('mod-hidden', !query);
    document.body.classList.toggle('is-pdf-finding', Boolean(query));
    markQuery(findbar, tally, query);
    if (!query) {
      hits = [];
      at = -1;
      tally.textContent = '';
      findbar.classList.remove('mod-no-match');
      handle.showHits([], -1);
      return;
    }
    look();
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
    setFinding,
    ask,
    finding: () => !findbar.classList.contains('mod-hidden'),
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
