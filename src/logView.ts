// The log, on screen. A full-screen page in the same style as Settings --
// the same header, the same groups -- opened from a row in it.
//
// Three filters, because three dials is what the log has: a search over the
// words, the areas as chips, and the volume. Plus one more that is not a
// filter but a choice of source: this run, or everything the database still
// holds from the runs before it.
//
// The list is capped at what a phone can lay out without stuttering. A log
// is read from the bottom -- the last thing that happened is the thing being
// asked about -- so the cap keeps the newest and says how many it is not
// showing, rather than quietly drawing half of it.

import {
  dropped, forget, format, lineText, lines as liveLines, onLine, setVolume, volume,
  type Area, type Line, type Volume,
} from './log';
import { earlier, flush, forgetStored } from './logStore';

const AREAS: Area[] = ['launch', 'file', 'pdf', 'tabs', 'search', 'storage', 'native'];
const VOLUMES: Volume[] = ['quiet', 'normal', 'verbose'];
/** Rows drawn at once. Two thousand <div>s is a visible pause on a phone,
 *  and nobody reads two thousand rows: they read the last few dozen and
 *  search for the rest. */
const DRAW = 400;

const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const BACK = icon('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>');
const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

let page: HTMLElement | null = null;
let unwatch: (() => void) | null = null;
let redrawSoon: ReturnType<typeof setTimeout> | null = null;

let source: 'run' | 'all' = 'run';
let query = '';
const muted = new Set<Area>();
/** Lines from runs before this one, once they have been fetched. */
let older: Line[] = [];

export const isLogOpen = (): boolean => page !== null;

export function closeLog(): void {
  const el = page;
  if (!el) return;
  page = null;
  unwatch?.();
  unwatch = null;
  if (redrawSoon !== null) { clearTimeout(redrawSoon); redrawSoon = null; }
  el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], { duration: 200, easing: 'ease-in' }).onfinish = () => el.remove();
  el.style.transform = 'translateX(100%)';
}

/** What the filters leave, oldest first. */
function chosen(): Line[] {
  const all = source === 'all' ? older.concat(liveLines()) : liveLines();
  const wanted = query.trim().toLowerCase();
  return all.filter((line) => {
    if (muted.has(line.area)) return false;
    if (!wanted) return true;
    return lineText(line).toLowerCase().includes(wanted);
  });
}

function rowsHtml(some: Line[]): string {
  const shown = some.slice(-DRAW);
  const over = some.length - shown.length;
  const head = over > 0 ? `<div class="log-note">${over} older line${over === 1 ? '' : 's'} above, not drawn. Search to narrow it.</div>` : '';
  if (!some.length) return '<div class="log-note">Nothing matches.</div>';
  return head + shown.map((line) => `<div class="log-row is-${line.kind}">${escapeHtml(lineText(line))}</div>`).join('');
}

function draw(): void {
  if (!page) return;
  const list = page.querySelector<HTMLElement>('.log-list');
  if (!list) return;
  const some = chosen();
  const atFoot = list.scrollTop + list.clientHeight >= list.scrollHeight - 24;
  list.innerHTML = rowsHtml(some);
  // A log is read from the bottom, so a reader who was already at the bottom
  // is kept there when a new line arrives, and a reader who had scrolled up
  // to look at something is left where they were.
  if (atFoot) list.scrollTop = list.scrollHeight;
  const count = page.querySelector<HTMLElement>('.log-count');
  if (count) {
    const lost = dropped();
    count.textContent = `${some.length} line${some.length === 1 ? '' : 's'}${lost ? `, ${lost} dropped` : ''}`;
  }
}

/** The text a copy or an export would carry: what is on screen, not the lot. */
export function shownText(): string {
  return format('text', chosen());
}

async function copyOut(button: HTMLElement): Promise<void> {
  const text = shownText();
  let done = false;
  try {
    // Chrome 66 and so everywhere Android can reach, but it needs a secure
    // context -- which the app has (capacitor serves https) and a browser on
    // a plain http address does not.
    await navigator.clipboard.writeText(text);
    done = true;
  } catch { /* the old way, below */ }
  if (!done) {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    try { done = document.execCommand('copy'); } catch { done = false; }
    field.remove();
  }
  const was = button.textContent;
  button.textContent = done ? 'Copied' : 'Could not copy';
  setTimeout(() => { button.textContent = was; }, 1400);
}

/** A file, for a browser. The app's own share sheet is a separate step; this
 *  is what the web build does and what the tests can check. */
export function download(): void {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const blob = new Blob([shownText()], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `satr-log-${stamp}.log`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

function controlsHtml(): string {
  const chips = AREAS.map((area) =>
    `<button type="button" class="log-chip${muted.has(area) ? '' : ' is-on'}" data-area="${area}" aria-pressed="${!muted.has(area)}">${area}</button>`).join('');
  const level = volume();
  return `
    <div class="log-controls">
      <input type="search" class="log-search" placeholder="Search the log" aria-label="Search the log" value="${escapeHtml(query)}">
      <div class="log-chips">${chips}</div>
      <div class="log-row-of-two">
        <div class="segmented-control" role="radiogroup" aria-label="Volume" style="--count: 3; --index: ${VOLUMES.indexOf(level)}">
          <div class="segmented-control-thumb"></div>
          ${VOLUMES.map((v) => `<button type="button" class="segmented-control-option" role="radio" data-volume="${v}" aria-checked="${v === level}">${v}</button>`).join('')}
        </div>
        <div class="segmented-control" role="radiogroup" aria-label="Which runs" style="--count: 2; --index: ${source === 'run' ? 0 : 1}">
          <div class="segmented-control-thumb"></div>
          <button type="button" class="segmented-control-option" role="radio" data-source="run" aria-checked="${source === 'run'}">This run</button>
          <button type="button" class="segmented-control-option" role="radio" data-source="all" aria-checked="${source === 'all'}">Everything</button>
        </div>
      </div>
      <div class="log-actions">
        <span class="log-count"></span>
        <button type="button" class="log-action" data-act="copy">Copy</button>
        <button type="button" class="log-action" data-act="save">Save</button>
        <button type="button" class="log-action is-danger" data-act="clear">Clear</button>
      </div>
    </div>`;
}

function redrawControls(): void {
  if (!page) return;
  const holder = page.querySelector<HTMLElement>('.log-controls');
  if (!holder) return;
  const focused = document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains('log-search');
  const at = focused ? (document.activeElement as HTMLInputElement).selectionStart : null;
  holder.outerHTML = controlsHtml();
  if (focused) {
    const field = page.querySelector<HTMLInputElement>('.log-search');
    field?.focus();
    if (at !== null) field?.setSelectionRange(at, at);
  }
  draw();
}

export function openLog(): void {
  if (page) return;
  const el = document.createElement('div');
  el.className = 'settings-screen log-screen';
  el.innerHTML = `
    <div class="settings-header">
      <button type="button" class="clickable-icon settings-back" aria-label="Back">${BACK}</button>
      <div class="settings-title">Log</div>
    </div>
    ${controlsHtml()}
    <div class="log-list" tabindex="0"></div>`;
  document.body.appendChild(el);
  page = el;
  el.style.transform = 'translateX(100%)';
  el.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: 200, easing: 'ease-out' }).onfinish = () => { el.style.transform = ''; };

  el.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.settings-back')) { closeLog(); return; }
    const chip = target.closest<HTMLElement>('[data-area]');
    if (chip) {
      const area = chip.dataset.area as Area;
      if (muted.has(area)) muted.delete(area); else muted.add(area);
      redrawControls();
      return;
    }
    const level = target.closest<HTMLElement>('[data-volume]');
    if (level) { setVolume(level.dataset.volume as Volume); redrawControls(); return; }
    const which = target.closest<HTMLElement>('[data-source]');
    if (which) {
      source = which.dataset.source === 'all' ? 'all' : 'run';
      if (source === 'all' && !older.length) {
        void earlier().then((rows) => {
          // Only the runs before this one: the live ones are already here,
          // and a line would otherwise be shown twice.
          const now = liveLines();
          const here = new Set(now.map((line) => `${line.at}|${line.text}`));
          older = rows.filter((row) => !here.has(`${row.at}|${row.text}`));
          draw();
        });
      }
      redrawControls();
      return;
    }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'copy') { void copyOut(target.closest<HTMLElement>('[data-act]')!); return; }
    if (act === 'save') { download(); return; }
    if (act === 'clear') {
      forget();
      older = [];
      void forgetStored();
      draw();
    }
  });

  el.addEventListener('input', (event) => {
    const field = event.target as HTMLElement;
    if (!field.classList.contains('log-search')) return;
    query = (field as HTMLInputElement).value;
    draw();
  });

  // A line arriving redraws, but not once per line: a busy moment would
  // otherwise spend more time drawing the log than doing the thing.
  unwatch = onLine(() => {
    if (redrawSoon !== null) return;
    redrawSoon = setTimeout(() => { redrawSoon = null; draw(); }, 400);
  });

  void flush();
  draw();
}
