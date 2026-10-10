// The date picker: a bottom sheet that writes Discord timestamp codes.
//
// The grid is pure Intl arithmetic, so it answers in whatever calendar
// Settings → Dates has chosen — Gregorian or Jalali, in any of the offered
// languages — without a calendar library: every question ("which month is
// this date in?", "how long is it?", "what weekday does it start on?") is
// asked of Intl.DateTimeFormat over the chosen locale tag, and the answers
// walk a plain JS Date around. A cell IS a Date; picking it is keeping it.
//
// Three months sit on a sliding track, the current one centred: the arrows
// and a horizontal swipe on the calendar both turn the month with the same
// slide, and the swipe follows the finger and springs back when it is short.
// The month title opens a month/year box in the calendar the grid is wearing
// (Farvardin 1400 when the sheet is Jalali). The time fields validate live —
// an impossible time reddens and greys Insert out — and every keystroke
// re-words the format chips and the Insert code. The writer leaves with
// `<t:unix>` or `<t:unix:fmt>` in their hands — the note keeps the code, the
// words stay live, and how they read is the date style's business alone
// (src/timestamps.ts).
import { closeMenu, isMenuOpen } from './menu';
import { formatTimestamp, timestampLocaleTag, TIMESTAMP_FORMATS, type TimestampFormat } from './timestamps';

const FORMAT_LABELS: Record<TimestampFormat, string> = {
  t: 'Time', T: 'Time with seconds', d: 'Date', D: 'Long date',
  f: 'Date and time', F: 'Full — with the weekday', R: 'Relative',
};

/** Persian and Arabic-Indic digits, read as Latin ones. */
const latinDigits = (value: string): string => value
  .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
  .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));

/** Parts of a date as the chosen calendar counts them — in numbers, whatever
 *  digits the locale writes them with (a Jalali year is ۱۴۰۵ on paper). */
function calParts(tag: string, date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat(tag, { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  const read = (type: string): number => Number(latinDigits(parts.find((part) => part.type === type)?.value ?? ''));
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
  for (; months > 0; months -= 1) { walk.setDate(walk.getDate() + 40); walk = monthStart(walk); }
  for (; months < 0; months += 1) { walk.setDate(walk.getDate() - 1); walk = monthStart(walk); }
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
  /** The month title replaced by month/year inputs, until applied or left. */
  let jumping = false;
  /** Armed when the jump applies: the very next focus to land in the time row
   *  is bounced to the title (keyboards that advance without a key event). */
  let reentry = false;
  /** Sheets fading out after a close: a fresh open sweeps them out of the
   *  DOM at once, so nothing half-transparent is left catching taps. */
  const fading: HTMLElement[] = [];

  const tag = timestampLocaleTag;
  const number = (value: number): string => new Intl.NumberFormat(tag()).format(value);

  const close = (): void => {
    if (!sheet) return;
    const el = sheet; const cover = backdrop;
    sheet = null; backdrop = null; onInsert = null;
    el.classList.add('is-closing');
    cover?.classList.remove('is-open');
    fading.push(el);
    if (cover) fading.push(cover);
    window.setTimeout(() => { el.remove(); cover?.remove(); }, 220);
  };

  /** The current page sits one page in: instant, and a no-op when the track
   *  already rests there. */
  const centerTrack = (): void => {
    const viewport = sheet?.querySelector<HTMLElement>('.timestamp-picker-viewport');
    if (viewport) viewport.scrollLeft = viewport.clientWidth;
  };

  function render(): void {
    if (!sheet || !viewMonth || !chosen) return;
    const localeTag = tag();
    const first = monthStart(viewMonth);
    const row = weekdayRow(localeTag);
    const heading = sheet.querySelector<HTMLElement>('.timestamp-picker-month')!;
    if (!jumping) {
      heading.textContent = new Intl.DateTimeFormat(localeTag, { year: 'numeric', month: 'long' }).format(first);
      heading.dir = 'auto';
      titleIndex = 1;
    }
    const chosenParts = calParts(localeTag, chosen);
    const current = viewMonth;
    const dirText = getComputedStyle(sheet).direction;
    const track = sheet.querySelector<HTMLElement>('.timestamp-picker-track')!;
    track.innerHTML = [-1, 0, 1].map((offset) => {
      const monthDate = addMonths(current, offset);
      const days = monthDays(monthDate);
      const lead = leadCells(localeTag, monthStart(monthDate), row);
      const cells = Array.from({ length: lead }, () => '<span class="timestamp-picker-day is-blank"></span>').join('')
        + days.map((day, index) => {
          const parts = calParts(localeTag, day);
          const selected = parts.year === chosenParts.year && parts.month === chosenParts.month && parts.day === chosenParts.day;
          return `<button type="button" class="timestamp-picker-day${selected ? ' is-selected' : ''}" data-stamp-day="${index}" aria-label="${number(parts.day)}" aria-pressed="${selected}"${offset === 0 ? '' : ' tabindex="-1"'}>${number(parts.day)}</button>`;
        }).join('');
      const weekdays = `<div class="timestamp-picker-weekdays" dir="auto">${row.map((name) => `<span>${escapeHtml(name)}</span>`).join('')}</div>`;
      return `<div class="timestamp-picker-page${offset === 0 ? ' is-current' : ''}" data-page-offset="${offset}"${offset === 0 ? '' : ' aria-hidden="true"'} style="direction:${dirText}">${weekdays}<div class="timestamp-picker-grid">${cells}</div></div>`;
    }).join('');
    centerTrack();
    // The format chips and the Insert button say the same moment the grid does.
    const picked = chosen;
    const unix = unixOf(picked);
    sheet.querySelectorAll<HTMLElement>('.timestamp-picker-format').forEach((chip) => {
      const value = chip.dataset.stampFormat as TimestampFormat;
      chip.classList.toggle('is-selected', value === format);
      chip.querySelector('.timestamp-picker-format-sample')!.textContent = formatTimestamp(unix, value);
    });
    const insert = sheet.querySelector<HTMLButtonElement>('[data-stamp-insert]')!;
    insert.textContent = `<${code(unix)}>`;
    syncTime();
  }

  const code = (unix: number): string => (format === 'f' ? `t:${unix}` : `t:${unix}:${format}`);
  /** What the time fields say right now, and whether it is a real time.
   *  Empty or impossible (25 o'clock, 99 minutes) is invalid, live. */
  function timeState(): { hour: number; minute: number; valid: boolean } {
    const hourRaw = sheet?.querySelector<HTMLInputElement>('[data-stamp-hour]')?.value.trim() ?? '';
    const minuteRaw = sheet?.querySelector<HTMLInputElement>('[data-stamp-minute]')?.value.trim() ?? '';
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const valid = hourRaw !== '' && minuteRaw !== ''
      && Number.isInteger(hour) && Number.isInteger(minute)
      && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    return { hour, minute, valid };
  }
  const unixOf = (date: Date): number => {
    const at = new Date(date);
    const { hour, minute } = timeState();
    at.setHours(Math.min(23, Math.max(0, hour)), Math.min(59, Math.max(0, minute)), seededSeconds ?? 0, 0);
    return Math.floor(at.getTime() / 1000);
  };
  /** Refuse an impossible time at once: the field reddens, Insert greys out. */
  function syncTime(): void {
    if (!sheet) return;
    const { valid } = timeState();
    sheet.querySelector<HTMLInputElement>('[data-stamp-hour]')?.classList.toggle('is-invalid', !valid);
    sheet.querySelector<HTMLInputElement>('[data-stamp-minute]')?.classList.toggle('is-invalid', !valid);
    const insert = sheet.querySelector<HTMLButtonElement>('[data-stamp-insert]');
    if (insert) insert.disabled = !valid;
  }

  // ---- The month turn ----
  /** One page toward `dir` — the platform's own physics: a smooth scroll to
   *  the neighbouring page. Nothing here measures the gesture; the settle
   *  (normalize) hears where the scroll came to rest. */
  function turnMonth(dir: -1 | 1): void {
    const viewport = sheet?.querySelector<HTMLElement>('.timestamp-picker-viewport');
    if (!viewport) return;
    viewport.scrollTo({ left: viewport.clientWidth * (1 + dir), behavior: 'smooth' });
  }

  /** Arrow presses landing while a turn still glides chain through the
   *  settle, one month each, instead of being swallowed mid-flight. */
  let pendingTurn = 0;

  /** The track came to rest: whichever page the scroll ended on IS the month
   *  now — re-render with it centred (render() re-centres at once, so the
   *  content swap is invisible). scrollsnapchange is the fast path; a short
   *  scroll debounce covers engines without it. */
  function normalize(): void {
    const viewport = sheet?.querySelector<HTMLElement>('.timestamp-picker-viewport');
    if (!viewport || !viewMonth) return;
    const width = viewport.clientWidth;
    const index = Math.max(0, Math.min(2, Math.round(viewport.scrollLeft / width)));
    if (index !== 1) {
      viewMonth = addMonths(viewMonth, index - 1);
      render();
    } else {
      titleIndex = 1;
    }
    if (pendingTurn) {
      const dir = (pendingTurn > 0 ? 1 : -1) as -1 | 1;
      pendingTurn -= dir;
      turnMonth(dir);
    }
  }

  /** Which page's month the title is wearing (0 left, 1 centre, 2 right).
   *  render() resets it: render owns the heading. */
  let titleIndex = 1;
  /** The title follows the finger: the page nearest the snap point names the
   *  month *while* the track moves — not after it stops. The grid and the
   *  chips stay until the settle; the title is cheap, it may anticipate. */
  function followTitle(): void {
    const viewport = sheet?.querySelector<HTMLElement>('.timestamp-picker-viewport');
    const heading = sheet?.querySelector<HTMLElement>('.timestamp-picker-month');
    if (!viewport || !heading || !viewMonth || jumping) return;
    const width = viewport.clientWidth;
    if (!width) return;
    const index = Math.max(0, Math.min(2, Math.round(viewport.scrollLeft / width)));
    if (index === titleIndex) return;
    titleIndex = index;
    heading.textContent = new Intl.DateTimeFormat(tag(), { year: 'numeric', month: 'long' }).format(monthStart(addMonths(viewMonth, index - 1)));
  }

  function open(options: { initial?: { seconds: number; format: TimestampFormat }; onInsert(code: string): void }): void {
    // A second open (a double-tap on the toolbar) replaces the sheet at once:
    // no fading copy may linger in the DOM to catch the next tap or locator.
    if (sheet) { sheet.remove(); backdrop?.remove(); sheet = null; backdrop = null; onInsert = null; }
    for (const el of fading.splice(0)) el.remove();
    if (isMenuOpen()) closeMenu();
    onInsert = options.onInsert;
    format = options.initial?.format ?? 'f';
    const start = options.initial ? new Date(options.initial.seconds * 1000) : new Date();
    chosen = start;
    seededSeconds = options.initial ? start.getSeconds() : null;
    jumping = false;
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
          <div class="timestamp-picker-month" data-stamp-jump role="button" tabindex="0" aria-label="Choose a month and year"></div>
          <button type="button" class="timestamp-picker-step" data-stamp-step="1" aria-label="Next month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
        </div>
        <div class="timestamp-picker-viewport"><div class="timestamp-picker-track"></div></div>
        <div class="timestamp-picker-time">
          <input class="timestamp-picker-field" data-stamp-hour type="text" inputmode="numeric" maxlength="2" enterkeyhint="next" aria-label="Hour">
          <span class="timestamp-picker-colon">:</span>
          <input class="timestamp-picker-field" data-stamp-minute type="text" inputmode="numeric" maxlength="2" enterkeyhint="done" aria-label="Minute">
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
      const el = event.target as HTMLInputElement;
      // The fields count digits: anything a paste or a stray key brought is
      // stripped, and a field that is full moves the writer on by itself —
      // two digits in the month mean the year is next, in the hour the
      // minute, in the minute done. No keyboard's action key decides that.
      const cap = el.closest('[data-stamp-jump-month], [data-stamp-hour], [data-stamp-minute]') ? 2
        : el.closest('[data-stamp-jump-year]') ? 4 : 0;
      if (cap) {
        const digits = latinDigits(el.value).replace(/\D/g, '').slice(0, cap);
        if (el.value !== digits) el.value = digits;
        if (digits.length === cap) {
          const nextFor = el.closest('[data-stamp-jump-month]') ? '[data-stamp-jump-year]'
            : el.closest('[data-stamp-hour]') ? '[data-stamp-minute]' : null;
          const next = nextFor ? sheet!.querySelector<HTMLInputElement>(nextFor) : null;
          if (next) next.focus();
          else if (el.closest('[data-stamp-minute]')) sheet!.querySelector<HTMLElement>('.timestamp-picker-month')!.focus();
        }
      }
      if (el.closest('.timestamp-picker-time')) {
        seededSeconds = null;
        // Live: the chips and the Insert code re-word on every keystroke,
        // an impossible time reddens its field and greys Insert out.
        render();
      }
    });
    // The month title, tapped: two fields in the calendar's own count.
    const enterJump = (): void => {
      const heading = sheet!.querySelector<HTMLElement>('.timestamp-picker-month')!;
      const parts = calParts(tag(), monthStart(viewMonth!));
      jumping = true;
      heading.innerHTML = '<input class="timestamp-picker-field timestamp-picker-jump-month" data-stamp-jump-month type="text" inputmode="numeric" maxlength="2" enterkeyhint="next" aria-label="Month" placeholder="M">'
        + '<input class="timestamp-picker-field timestamp-picker-jump-year" data-stamp-jump-year type="text" inputmode="numeric" maxlength="4" enterkeyhint="done" aria-label="Year" placeholder="YYYY">';
      const monthField = heading.querySelector<HTMLInputElement>('[data-stamp-jump-month]')!;
      monthField.value = String(parts.month);
      heading.querySelector<HTMLInputElement>('[data-stamp-jump-year]')!.value = String(parts.year);
      monthField.focus();
    };
    const applyJump = (): void => {
      if (!jumping || !sheet) return;
      const month = Number(sheet.querySelector<HTMLInputElement>('[data-stamp-jump-month]')?.value);
      const year = Number(sheet.querySelector<HTMLInputElement>('[data-stamp-jump-year]')?.value);
      if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12 || year < 1) return;
      const parts = calParts(tag(), monthStart(viewMonth!));
      const delta = (year - parts.year) * 12 + (month - parts.month);
      jumping = false;
      // The keyboard's work is done: the focus belongs to the title, so the
      // IME closes instead of walking on. A focus a delinquent keyboard moved
      // into the time row anyway is bounced here (the focusin guard below).
      reentry = true;
      window.setTimeout(() => { reentry = false; }, 300); // a beat, then the guard rests
      if (delta) viewMonth = addMonths(viewMonth!, delta);
      render(); // the whole distance at once, centred instantly
      sheet.querySelector<HTMLElement>('.timestamp-picker-month')!.focus();
    };
    // Some keyboards deliver the advance key as a next-action that moves the
    // focus with no key event at all — nothing to intercept. The guard is the
    // focus itself: whatever moved it, if it lands in the time row straight
    // after an applied jump, it goes to the title instead.
    sheet.addEventListener('focusin', (event) => {
      const el = event.target as HTMLElement;
      if (reentry && el.closest?.('.timestamp-picker-time')) {
        sheet?.querySelector<HTMLElement>('.timestamp-picker-month')?.focus();
      }
    });
    // Enter decides the chain: the catchable action key arrives as Enter
    // (enterkeyhint only labels it), and each field's Enter moves where the
    // chain says — month to year, year applies, hour to minute, minute
    // closes the keyboard on the title. Tab and the arrows are the caret's
    // and the browser's: their DOM order happens to be the chain's anyway,
    // and a keyboard that advances with no key event at all is met by the
    // focusin guard and the apply-on-focusout below.
    sheet.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (jumping && target.closest('[data-stamp-jump-month]')) {
        if (event.key === 'Enter') {
          event.preventDefault();
          sheet!.querySelector<HTMLInputElement>('[data-stamp-jump-year]')!.focus();
        }
        return;
      }
      if (jumping && target.closest('[data-stamp-jump-year]')) {
        if (event.key === 'Enter') { event.preventDefault(); applyJump(); }
        return;
      }
      if (event.key === 'Enter' && target.closest('[data-stamp-hour]')) {
        event.preventDefault();
        minute.focus();
        return;
      }
      if (event.key === 'Enter' && target.closest('[data-stamp-minute]')) {
        event.preventDefault();
        sheet!.querySelector<HTMLElement>('.timestamp-picker-month')!.focus();
        return;
      }
      if (!jumping && target.closest('[data-stamp-jump]')) { event.preventDefault(); enterJump(); }
    });
    sheet.addEventListener('focusout', (event) => {
      if (!jumping) return;
      const to = event.relatedTarget as Node | null;
      const heading = sheet!.querySelector('.timestamp-picker-month');
      if (!to || !(to instanceof Node && heading?.contains(to))) applyJump();
    });
    sheet.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const step = target.closest<HTMLElement>('[data-stamp-step]');
      if (step) {
        jumping = false;
        const viewport = sheet!.querySelector<HTMLElement>('.timestamp-picker-viewport');
        const dir = Number(step.dataset.stampStep) as -1 | 1;
        if (viewport && Math.abs(viewport.scrollLeft - viewport.clientWidth) > 2) pendingTurn += dir;
        else turnMonth(dir);
        return;
      }
      if (target.closest('[data-stamp-jump-month], [data-stamp-jump-year]')) return;
      if (target.closest('[data-stamp-jump]')) { enterJump(); return; }
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
        // A day click with the jump box open cancels the jump: the grid under
        // the finger is the one that answers.
        if (jumping) { jumping = false; render(); }
        const pageOffset = Number(day.closest<HTMLElement>('.timestamp-picker-page')!.dataset.pageOffset);
        const picked = monthDays(addMonths(viewMonth!, pageOffset))[Number(day.dataset.stampDay)];
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
    // The scroll itself is the gesture: the browser owns the follow-finger,
    // the fling and the snap (one page at a time); the sheet only hears
    // where it came to rest.
    const viewport = sheet.querySelector<HTMLElement>('.timestamp-picker-viewport')!;
    let settleTimer = 0;
    viewport.addEventListener('scrollsnapchange', normalize);
    viewport.addEventListener('scroll', () => {
      followTitle(); // the month name tracks the finger as it moves
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(normalize, 120);
    });
    render();
  }

  document.addEventListener('keydown', function onKey(event) {
    if (!sheet) { document.removeEventListener('keydown', onKey, true); return; }
    if (event.key === 'Escape' && !document.querySelector('.menu.is-open:not(.timestamp-picker)')) { event.preventDefault(); close(); }
  }, true);

  return { open, close };
}
