// The date picker: a bottom sheet that writes Discord timestamp codes.
//
// The grid is pure Intl arithmetic, so it answers in whatever calendar
// Settings → Dates has chosen — Gregorian or Jalali, in any of the offered
// languages — without a calendar library: every question ("which month is
// this date in?", "how long is it?", "what weekday does it start on?") is
// asked of Intl.DateTimeFormat over the chosen locale tag, and the answers
// walk a plain JS Date around. A cell IS a Date; picking it is keeping it.
//
// The writer leaves with `<t:unix>` or `<t:unix:fmt>` in their hands — the
// note keeps the code, the words stay live, and how they read is the date
// style's business alone (src/timestamps.ts).
import { closeMenu, isMenuOpen } from './menu';
import { formatTimestamp, timestampLocaleTag, TIMESTAMP_FORMATS, type TimestampFormat } from './timestamps';

const FORMAT_LABELS: Record<TimestampFormat, string> = {
  t: 'Time', T: 'Time with seconds', d: 'Date', D: 'Long date',
  f: 'Date and time', F: 'Full — with the weekday', R: 'Relative',
};

/** Parts of a date as the chosen calendar counts them. */
function calParts(tag: string, date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat(tag, { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value.replace(/[^0-9]/g, ''));
  return { year: read('year'), month: read('month'), day: read('day') };
}

/** The first day of `date`'s month, in the chosen calendar. */
function monthStart(date: Date): Date {
  const tag = timestampLocaleTag();
  const walk = new Date(date);
  walk.setHours(12, 0, 0, 0); // noon: a DST or day-count edge cannot skip a month
  for (let guard = 0; guard < 40 && calParts(tag, walk).day > 1; guard += 1) walk.setDate(walk.getDate() - 1);
  return walk;
}

function addMonths(date: Date, months: number): Date {
  let walk = monthStart(date);
  for (; months > 0; months -= 1) { walk.setDate(walk.getDate() - 1); walk = monthStart(walk); }
  for (; months < 0; months += 1) { walk.setDate(walk.getDate() + 40); walk = monthStart(walk); }
  return walk;
}

/** The days of `date`'s month, as Dates (all at noon). */
function monthDays(date: Date): Date[] {
  const tag = timestampLocaleTag();
  const first = monthStart(date);
  const month = calParts(tag, first).month;
  const days: Date[] = [];
  const walk = new Date(first);
  for (let guard = 0; guard < 40; guard += 1) {
    days.push(new Date(walk));
    walk.setDate(walk.getDate() + 1);
    if (calParts(tag, walk).month !== month) break;
  }
  return days;
}

/** Weekday names in order, starting the week where the locale starts it. */
function weekdayRow(tag: string): string[] {
  // 2023-11-12 is a Sunday: seven days of known names, indexed from Sunday.
  const names: string[] = [];
  for (let day = 0; day < 7; day += 1) {
    names.push(new Intl.DateTimeFormat(tag, { weekday: 'short' }).format(new Date(2023, 10, 12 + day)));
  }
  const firstDay = (Intl.Locale.prototype as { weekInfo?: { firstDay: number } }).weekInfo
    ? (new Intl.Locale(tag) as unknown as { weekInfo: { firstDay: number } }).weekInfo.firstDay
    : 1; // 1 = Monday … 7 = Sunday
  const cut = firstDay % 7; // Sunday (7) → 0; Monday (1) → 1 … Saturday (6) → 6
  return [...names.slice(cut), ...names.slice(0, cut)];
}

/** Where the first day of the month sits in a grid whose week starts at
 *  `row[0]`: how many lead cells come before it. */
function leadCells(tag: string, first: Date, row: string[]): number {
  const name = new Intl.DateTimeFormat(tag, { weekday: 'short' }).format(first);
  return Math.max(0, row.indexOf(name));
}

const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

export interface TimestampPicker {
  /** Ask for a timestamp code. `initial` seeds the sheet (an existing
   *  `<t:…>` being edited); the code goes to `onInsert`, or nothing happens
   *  when the sheet is dismissed. */
  open(options: { initial?: { seconds: number; format: TimestampFormat }; onInsert(code: string): void }): void;
  close(): void;
}

export function createTimestampPicker(): TimestampPicker {
  let sheet: HTMLElement | null = null;
  let backdrop: HTMLElement | null = null;
  let viewMonth: Date | null = null;
  let chosen: Date | null = null;
  let format: TimestampFormat = 'f';
  let onInsert: ((code: string) => void) | null = null;
  /** The seconds of a seeded moment. The sheet has no seconds field, so an
   *  edited chip keeps the seconds it had — until the writer touches the
   *  time themselves, which is theirs to round. */
  let seededSeconds: number | null = null;

  const tag = timestampLocaleTag;
  const number = (value: number): string => new Intl.NumberFormat(tag()).format(value);
  const close = (): void => {
    if (!sheet) return;
    const el = sheet; const cover = backdrop;
    sheet = null; backdrop = null; onInsert = null;
    el.classList.add('is-closing');
    cover?.classList.remove('is-open');
    window.setTimeout(() => { el.remove(); cover?.remove(); }, 220);
  };

  function render(): void {
    if (!sheet || !viewMonth || !chosen) return;
    const localeTag = tag();
    const first = monthStart(viewMonth);
    const days = monthDays(viewMonth);
    const row = weekdayRow(localeTag);
    const lead = leadCells(localeTag, first, row);
    const title = new Intl.DateTimeFormat(localeTag, { year: 'numeric', month: 'long' }).format(first);
    const heading = sheet.querySelector<HTMLElement>('.timestamp-picker-month')!;
    heading.textContent = title;
    heading.dir = 'auto';
    const weekdays = sheet.querySelector<HTMLElement>('.timestamp-picker-weekdays')!;
    weekdays.innerHTML = row.map((name) => `<span>${escapeHtml(name)}</span>`).join('');
    weekdays.dir = 'auto';
    const chosenParts = calParts(localeTag, chosen);
    const grid = sheet.querySelector<HTMLElement>('.timestamp-picker-grid')!;
    grid.innerHTML = Array.from({ length: lead }, () => '<span class="timestamp-picker-day is-blank"></span>').join('')
      + days.map((day) => {
        const parts = calParts(localeTag, day);
        const selected = parts.year === chosenParts.year && parts.month === chosenParts.month && parts.day === chosenParts.day;
        const label = number(parts.day);
        return `<button type="button" class="timestamp-picker-day${selected ? ' is-selected' : ''}" data-stamp-day="${days.indexOf(day)}" aria-label="${label}" aria-pressed="${selected}">${label}</button>`;
      }).join('');
    // The format chips and the Insert button say the same moment the grid does.
    const unix = unixOf(chosen);
    sheet.querySelectorAll<HTMLElement>('.timestamp-picker-format').forEach((chip) => {
      const value = chip.dataset.stampFormat as TimestampFormat;
      chip.classList.toggle('is-selected', value === format);
      chip.querySelector('.timestamp-picker-format-sample')!.textContent = formatTimestamp(unix, value);
    });
    const insert = sheet.querySelector<HTMLButtonElement>('[data-stamp-insert]')!;
    insert.textContent = `<${code(unix)}>`;
  }

  const code = (unix: number): string => (format === 'f' ? `t:${unix}` : `t:${unix}:${format}`);
  const unixOf = (date: Date): number => {
    const at = new Date(date);
    const hour = Number(sheet?.querySelector<HTMLInputElement>('[data-stamp-hour]')?.value ?? at.getHours());
    const minute = Number(sheet?.querySelector<HTMLInputElement>('[data-stamp-minute]')?.value ?? at.getMinutes());
    at.setHours(
      Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 0,
      Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0,
      seededSeconds ?? 0, 0);
    return Math.floor(at.getTime() / 1000);
  };

  function open(options: { initial?: { seconds: number; format: TimestampFormat }; onInsert(code: string): void }): void {
    close();
    if (isMenuOpen()) closeMenu();
    onInsert = options.onInsert;
    format = options.initial?.format ?? 'f';
    const start = options.initial ? new Date(options.initial.seconds * 1000) : new Date();
    chosen = start;
    seededSeconds = options.initial ? start.getSeconds() : null;
    viewMonth = monthStart(start);
    backdrop = document.createElement('div');
    backdrop.className = 'menu-backdrop';
    backdrop.addEventListener('click', close);
    sheet = document.createElement('div');
    sheet.className = 'menu mod-bottom-sheet timestamp-picker';
    sheet.dataset.ignoreSwipe = '';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Insert a timestamp');
    sheet.innerHTML = `
      <div class="menu-grabber"></div>
      <div class="menu-scroll">
        <div class="timestamp-picker-head">
          <button type="button" class="timestamp-picker-step" data-stamp-step="-1" aria-label="Previous month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
          <div class="timestamp-picker-month"></div>
          <button type="button" class="timestamp-picker-step" data-stamp-step="1" aria-label="Next month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
        </div>
        <div class="timestamp-picker-weekdays"></div>
        <div class="timestamp-picker-grid"></div>
        <div class="timestamp-picker-time">
          <input class="timestamp-picker-field" data-stamp-hour type="number" min="0" max="23" inputmode="numeric" aria-label="Hour">
          <span class="timestamp-picker-colon">:</span>
          <input class="timestamp-picker-field" data-stamp-minute type="number" min="0" max="59" inputmode="numeric" aria-label="Minute">
          <button type="button" class="timestamp-picker-now" data-stamp-now>Now</button>
        </div>
        <div class="timestamp-picker-formats">
          ${TIMESTAMP_FORMATS.map((value) => `
          <button type="button" class="timestamp-picker-format" data-stamp-format="${value}">
            <span class="timestamp-picker-format-name">${FORMAT_LABELS[value]}</span>
            <span class="timestamp-picker-format-sample"></span>
          </button>`).join('')}
        </div>
        <button type="button" class="timestamp-picker-insert" data-stamp-insert></button>
      </div>`;
    const hour = sheet.querySelector<HTMLInputElement>('[data-stamp-hour]')!;
    const minute = sheet.querySelector<HTMLInputElement>('[data-stamp-minute]')!;
    hour.value = String(start.getHours());
    minute.value = String(start.getMinutes());
    sheet.addEventListener('input', (event) => {
      if ((event.target as HTMLElement).closest('.timestamp-picker-time')) seededSeconds = null;
    });
    sheet.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const step = target.closest<HTMLElement>('[data-stamp-step]');
      if (step) { viewMonth = addMonths(viewMonth!, Number(step.dataset.stampStep)); render(); return; }
      if (target.closest('[data-stamp-now]')) {
        const now = new Date();
        seededSeconds = now.getSeconds();
        chosen = now;
        viewMonth = monthStart(now);
        hour.value = String(now.getHours());
        minute.value = String(now.getMinutes());
        render();
        return;
      }
      const chip = target.closest<HTMLElement>('.timestamp-picker-format');
      if (chip) { format = chip.dataset.stampFormat as TimestampFormat; render(); return; }
      const day = target.closest<HTMLElement>('[data-stamp-day]');
      if (day) {
        const picked = monthDays(viewMonth!)[Number(day.dataset.stampDay)];
        if (picked) {
          const at = new Date(picked);
          at.setHours(Number(hour.value) || 0, Number(minute.value) || 0, 0, 0);
          chosen = at;
          render();
        }
        return;
      }
      if (target.closest('[data-stamp-insert]')) {
        const insertCallback = onInsert;
        const unix = unixOf(chosen!);
        close();
        insertCallback?.(`<${code(unix)}>`);
      }
    });
    document.body.append(backdrop, sheet);
    window.requestAnimationFrame(() => {
      backdrop!.classList.add('is-open');
      sheet!.classList.add('is-open');
    });
    render();
  }

  document.addEventListener('keydown', function onKey(event) {
    if (!sheet) { document.removeEventListener('keydown', onKey, true); return; }
    if (event.key === 'Escape' && !document.querySelector('.menu.is-open:not(.timestamp-picker)')) { event.preventDefault(); close(); }
  }, true);

  return { open, close };
}
