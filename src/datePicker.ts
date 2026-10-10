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

  /** The sliding calendar: three months on a track, the current one centred
   *  (the track is three pages wide, so the centre is one page in). */
  const centerTrack = (): void => {
    const viewport = sheet?.querySelector<HTMLElement>('.timestamp-picker-viewport');
    const track = sheet?.querySelector<HTMLElement>('.timestamp-picker-track');
    if (viewport && track) track.style.transform = `translateX(${-viewport.clientWidth}px)`;
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
    }
    const weekdays = sheet.querySelector<HTMLElement>('.timestamp-picker-weekdays')!;
    weekdays.innerHTML = row.map((name) => `<span>${escapeHtml(name)}</span>`).join('');
    weekdays.dir = 'auto';
    const chosenParts = calParts(localeTag, chosen);
    const current = viewMonth;
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
      return `<div class="timestamp-picker-page${offset === 0 ? ' is-current' : ''}" data-page-offset="${offset}"${offset === 0 ? '' : ' aria-hidden="true"'}>${cells}</div>`;
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

  // ---- The month turn, shared by the arrows and the swipe ----
  /** The settle slide still running, if any. A new turn cancels it, and a
   *  grabbing finger does too — a quick second swipe must land on a still,
   *  centred track, never fight an animation that owns the transform. */
  let settle: Animation | null = null;
  function slideTrack(track: HTMLElement, width: number, from: number, duration = 200): void {
    settle?.cancel();
    settle = track.animate(
      [{ transform: `translateX(${from}px)` }, { transform: `translateX(${-width}px)` }],
      { duration, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
    );
  }
  /** Re-render on the new month, then slide from where the old one sat to
   *  the centre, so the pages pass as content, not as a fade. */
  function turnMonth(dir: -1 | 1, fromOffset?: number): void {
    if (!viewMonth) return;
    viewMonth = addMonths(viewMonth, dir);
    render();
    const viewport = sheet?.querySelector<HTMLElement>('.timestamp-picker-viewport');
    const track = sheet?.querySelector<HTMLElement>('.timestamp-picker-track');
    if (!viewport || !track) return;
    const width = viewport.clientWidth;
    // Before the re-render the old track sat at `fromOffset` pages; sliding
    // from there to the centre carries the pages across.
    const from = fromOffset !== undefined ? Math.max(-2, Math.min(0, fromOffset)) * width : (dir > 0 ? 0 : -2 * width);
    slideTrack(track, width, from);
  }

  function bindSwipe(): void {
    // The whole calendar — the weekday row included; a swipe may land there
    // as well as on the grid.
    const surface = sheet!.querySelector<HTMLElement>('.timestamp-picker-calendar')!;
    const viewport = sheet!.querySelector<HTMLElement>('.timestamp-picker-viewport')!;
    const track = () => sheet!.querySelector<HTMLElement>('.timestamp-picker-track')!;
    let drag: { id: number; x0: number; y0: number; xe: number; base: number; lastX: number; lastT: number; v: number; engaged: boolean } | null = null;
    let swallowClick = false;
    surface.addEventListener('touchstart', (event) => {
      if (drag || event.touches.length !== 1) return;
      const touch = event.touches[0] as Touch & { touchType?: string };
      if (touch.touchType === 'stylus') return;
      drag = { id: touch.identifier, x0: touch.clientX, y0: touch.clientY, xe: touch.clientX, base: -viewport.clientWidth, lastX: touch.clientX, lastT: event.timeStamp, v: 0, engaged: false };
    }, { passive: true });
    surface.addEventListener('touchmove', (event) => {
      if (!drag) return;
      const touch = [...event.touches].find((item) => item.identifier === drag!.id);
      if (!touch) return;
      const dx = touch.clientX - drag.x0;
      const dy = touch.clientY - drag.y0;
      drag.v = 0.8 * drag.v + 0.2 * ((touch.clientX - drag.lastX) / Math.max(1, event.timeStamp - drag.lastT));
      drag.lastX = touch.clientX;
      drag.lastT = event.timeStamp;
      if (!drag.engaged) {
        // Horizontal dominion, decided fast: a real finger is never perfectly
        // level, so claim the drag before the browser turns it into a sheet
        // scroll. A vertical drag keeps scrolling the sheet.
        if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy) + 2) {
          drag.engaged = true;
          drag.xe = touch.clientX;
          // Catch a mid-slide track where it is — a settle from an earlier
          // turn hands its current position over to the finger.
          const matrix = getComputedStyle(track()).transform;
          drag.base = matrix === 'none' ? -viewport.clientWidth : new DOMMatrixReadOnly(matrix).m41;
          settle?.cancel();
          settle = null;
          track().style.transform = `translateX(${drag.base}px)`;
        } else return;
      }
      event.preventDefault();
      track().style.transform = `translateX(${drag.base + touch.clientX - drag.xe}px)`;
    }, { passive: false });
    const end = (event: TouchEvent, cancelled: boolean): void => {
      if (!drag) return;
      const state = drag;
      drag = null;
      if (!state.engaged) return;
      // The grid was dragged: the release click must not fall through onto a day.
      swallowClick = true;
      window.setTimeout(() => { swallowClick = false; }, 350);
      const touch = [...event.changedTouches].find((item) => item.identifier === state.id);
      const dx = cancelled ? 0 : (touch ? touch.clientX - state.xe : 0);
      const pulled = state.base + dx; // where the finger left the track
      const width = viewport.clientWidth;
      const distance = pulled + width; // signed travel from the centre
      // A turn: a real pull (a quarter of the calendar) or a flick — fast AND
      // travelled a little, so a slow short drag always springs home.
      const flick = Math.abs(state.v) > 0.5 && Math.abs(distance) > 32;
      if (!cancelled && (Math.abs(distance) > width / 4 || flick)) {
        // The turn completes in the direction the finger was going.
        turnMonth(distance < 0 ? 1 : -1, pulled / width);
      } else {
        // A short drag springs back to the current month. The style parks at
        // the centre first: when the animation ends, the style is what shows.
        const el = track();
        el.style.transform = `translateX(${-width}px)`;
        settle = el.animate(
          [{ transform: `translateX(${pulled}px)` }, { transform: `translateX(${-width}px)` }],
          { duration: 200, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
        );
      }
    };
    surface.addEventListener('touchend', (event) => end(event, false), { passive: true });
    surface.addEventListener('touchcancel', (event) => end(event, true), { passive: true });
    surface.addEventListener('click', (event) => {
      if (!swallowClick) return;
      event.stopImmediatePropagation();
      event.preventDefault();
    }, { capture: true });
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
        <div class="timestamp-picker-calendar">
          <div class="timestamp-picker-weekdays"></div>
          <div class="timestamp-picker-viewport"><div class="timestamp-picker-track"></div></div>
        </div>
        <div class="timestamp-picker-time">
          <input class="timestamp-picker-field" data-stamp-hour type="number" min="0" max="23" inputmode="numeric" enterkeyhint="next" aria-label="Hour">
          <span class="timestamp-picker-colon">:</span>
          <input class="timestamp-picker-field" data-stamp-minute type="number" min="0" max="59" inputmode="numeric" enterkeyhint="done" aria-label="Minute">
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
      if ((event.target as HTMLElement).closest('.timestamp-picker-time')) {
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
      heading.innerHTML = '<input class="timestamp-picker-field timestamp-picker-jump-month" data-stamp-jump-month type="number" min="1" max="12" inputmode="numeric" enterkeyhint="next" aria-label="Month" placeholder="M">'
        + '<input class="timestamp-picker-field timestamp-picker-jump-year" data-stamp-jump-year type="number" min="1" max="9999" inputmode="numeric" enterkeyhint="done" aria-label="Year" placeholder="YYYY">';
      const monthField = heading.querySelector<HTMLInputElement>('[data-stamp-jump-month]')!;
      monthField.value = String(parts.month);
      heading.querySelector<HTMLInputElement>('[data-stamp-jump-year]')!.value = String(parts.year);
      monthField.focus();
      monthField.select();
    };
    const applyJump = (): void => {
      if (!jumping || !sheet) return;
      const month = Number(sheet.querySelector<HTMLInputElement>('[data-stamp-jump-month]')?.value);
      const year = Number(sheet.querySelector<HTMLInputElement>('[data-stamp-jump-year]')?.value);
      if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12 || year < 1) return;
      const parts = calParts(tag(), monthStart(viewMonth!));
      const delta = (year - parts.year) * 12 + (month - parts.month);
      jumping = false;
      // From here the keyboard's business is done: the focus belongs to the
      // title, so the IME closes instead of walking into the time row.
      reentry = true;
      const heading = sheet.querySelector<HTMLElement>('.timestamp-picker-month')!;
      if (!delta) { render(); heading.focus(); return; }
      // The whole distance at once; the slide starts from where the old month
      // now sits — one page over — so the pages pass as content.
      viewMonth = addMonths(viewMonth!, delta);
      render();
      heading.focus();
      const viewport = sheet.querySelector<HTMLElement>('.timestamp-picker-viewport');
      const track = sheet.querySelector<HTMLElement>('.timestamp-picker-track');
      if (!viewport || !track) return;
      slideTrack(track, viewport.clientWidth, delta > 0 ? 0 : -2 * viewport.clientWidth);
    };
    // Some keyboards deliver the advance key as a next-action that moves the
    // focus with no key event at all — nothing to intercept. The guard is the
    // focus itself: whatever moved it, if it lands in the time row straight
    // after an applied jump, it goes to the title instead.
    sheet.addEventListener('focusin', (event) => {
      if (reentry && (event.target as HTMLElement).closest?.('.timestamp-picker-time')) {
        sheet?.querySelector<HTMLElement>('.timestamp-picker-month')?.focus();
      }
      reentry = false;
    });
    // Enter applies the jump; focus leaving the title applies it too. A mere
    // change (tabbing from the month to the year, a fill) must NOT: half a
    // date would jump the grid and tear the second field away mid-edit.
    // The keyboard's advance key — Tab, or the IME's → — is enforced here,
    // not trusted to enterkeyhint: some keyboards walk the focusable list no
    // matter what the hint promises. The chain is month → year, then it
    // applies; hour → minute, then it stops. It can never wander into the
    // other row.
    sheet.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      if (event.key === 'Tab' || event.key === 'ArrowRight') {
        if (jumping && target.closest('[data-stamp-jump-month]')) {
          event.preventDefault();
          const yearField = sheet!.querySelector<HTMLInputElement>('[data-stamp-jump-year]')!;
          yearField.focus();
          yearField.select();
          return;
        }
        if (jumping && target.closest('[data-stamp-jump-year]')) { event.preventDefault(); applyJump(); return; }
        if (target.closest('[data-stamp-hour]')) {
          event.preventDefault();
          minute.focus();
          minute.select();
          return;
        }
        // The chain's last stop: the advance key does nothing further.
        if (target.closest('[data-stamp-minute]')) event.preventDefault();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        if (jumping && target.closest('[data-stamp-jump-month], [data-stamp-jump-year]')) {
          if (event.key === 'Enter') { event.preventDefault(); applyJump(); }
          return;
        }
        if (!jumping && target.closest('[data-stamp-jump]')) { event.preventDefault(); enterJump(); }
      }
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
      if (step) { jumping = false; turnMonth(Number(step.dataset.stampStep) as -1 | 1); return; }
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
    bindSwipe();
    render();
  }

  document.addEventListener('keydown', function onKey(event) {
    if (!sheet) { document.removeEventListener('keydown', onKey, true); return; }
    if (event.key === 'Escape' && !document.querySelector('.menu.is-open:not(.timestamp-picker)')) { event.preventDefault(); close(); }
  }, true);

  return { open, close };
}
