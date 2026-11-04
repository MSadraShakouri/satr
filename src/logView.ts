// The log, on screen. A full-screen page in the same style as Settings --
// the same header, the same groups -- opened from a row in it.
//
// Four filters, and all four act here rather than at the pen: a search over
// the words, the areas as chips, how much detail to show, and a choice of
// source -- this run, or everything the database still holds from the runs
// before it. Nothing on this screen can make the app record less; the log
// records everything and these decide what you are looking at.
//
// The list is capped at what a phone can lay out without stuttering. A log
// is read from the bottom -- the last thing that happened is the thing being
// asked about -- so the cap keeps the newest and says how many it is not
// showing, rather than quietly drawing half of it.

import {
  detail, dropped, fail, forget, format, lineText, lines as liveLines, onLine, setDetail, shows, weight,
  type Area, type Detail, type Line,
} from './log';
import { earlier, flush, forgetStored } from './logStore';
import { shareText, canShare } from './share';

const AREAS: Area[] = ['launch', 'app', 'file', 'pdf', 'tabs', 'search', 'storage', 'native'];
const DETAILS: Detail[] = ['quiet', 'normal', 'verbose'];
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
  const at = detail();
  return all.filter((line) => {
    if (!shows(line, at)) return false;
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
  return head + shown.map((line) => `<div class="log-row-line is-${line.kind}">${escapeHtml(lineText(line))}</div>`).join('');
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
    const mb = weight() / 1_000_000;
    const all = liveLines().length;
    // Shown out of kept, always both. A reader at the quiet setting sees one
    // line on screen; if the count said "1 line" he would reasonably believe
    // one line was all the app had, which is the misreading the old dial
    // actually earned.
    const how = some.length === all ? `${all} line${all === 1 ? '' : 's'}` : `${some.length} of ${all} lines`;
    count.textContent = `${how} · ${mb < 0.1 ? '<0.1' : mb.toFixed(1)}MB kept${lost ? `, ${lost} dropped` : ''}`;
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

/** Off the phone: the share sheet where there is one, a downloaded file in a
 *  browser. The same text either way -- what the filters left. */
export async function sendOut(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  if (canShare()) {
    try {
      await shareText(shownText(), `satr-log-${stamp}.log`, 'Send the log');
    } catch (error) {
      // There is no second way off a phone -- a browser download does nothing
      // inside a WebView -- so the only useful thing left is to say so, in
      // the log, on the screen the reader is already looking at.
      fail('native', 'the share sheet would not open', { why: String(error) });
      draw();
    }
    return;
  }
  download();
}

/** A file, for a browser, and the fallback when the share sheet is not there. */
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
  // The chip row is the segmented control generalised to more than one
  // choice: the same track, the same thumb, the same height. Nothing here
  // invents a control the rest of the app does not already have.
  const chips = AREAS.map((area) =>
    `<button type="button" class="log-chip${muted.has(area) ? '' : ' is-on'}" data-area="${area}" aria-pressed="${!muted.has(area)}">${area}</button>`).join('');
  const level = detail();
  const segment = (label: string, options: [string, string][], chosenOne: string, key: string): string => `
      <div class="log-row">
        <span class="log-label">${label}</span>
        <div class="segmented-control" role="radiogroup" aria-label="${label}" style="--count: ${options.length}; --index: ${options.findIndex(([value]) => value === chosenOne)}">
          <div class="segmented-control-thumb"></div>
          ${options.map(([value, said]) => `<button type="button" class="segmented-control-option" role="radio" data-${key}="${value}" aria-checked="${value === chosenOne}">${said}</button>`).join('')}
        </div>
      </div>`;
  return `
    <div class="log-controls">
      <input type="search" class="log-search" placeholder="Search the log" aria-label="Search the log" value="${escapeHtml(query)}">
      <div class="log-chips">${chips}</div>
      ${segment('Showing', [['run', 'This run'], ['all', 'Everything']], source, 'source')}
      ${segment('Detail', DETAILS.map((v) => [v, v] as [string, string]), level, 'detail')}
      <div class="log-hint">Everything is always recorded; this decides how much of it you are shown, and what Copy and Share carry. Quiet leaves failures and warnings only. The log keeps the last megabyte in memory and ten on the device, oldest lines first out.</div>
      <div class="log-buttons">
        <button type="button" class="log-button" data-act="copy">Copy</button>
        <button type="button" class="log-button" data-act="save">${canShare() ? 'Share' : 'Save'}</button>
        <button type="button" class="log-button is-danger" data-act="clear">Clear</button>
      </div>
    </div>
    <div class="search-summary log-count"></div>`;
}

function redrawControls(): void {
  if (!page) return;
  const holder = page.querySelector<HTMLElement>('.log-controls');
  const count = page.querySelector<HTMLElement>('.log-count');
  if (!holder || !count) return;
  count.remove();
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
    const level = target.closest<HTMLElement>('[data-detail]');
    if (level) { setDetail(level.dataset.detail as Detail); redrawControls(); return; }
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
    if (act === 'save') { void sendOut(); return; }
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
