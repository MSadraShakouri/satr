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
import { strongDirection } from './direction';
import { closeMenu, isMenuOpen } from './menu';
import { loadSettings } from './settings';
import { formatTimestamp, timestampLocaleTag, TIMESTAMP_FORMATS, type TimestampFormat } from './timestamps';

const FORMAT_LABELS: Record<TimestampFormat, string> = {
  t: 'Time', T: 'Time with seconds', d: 'Date', D: 'Long date',
  f: 'Date and time', F: 'Full — with the weekday', R: 'Relative',
};

/** Persian and Arabic-Indic digits, read as Latin ones. */
const latinDigits = (value: string): string => value
  .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
  .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));

/** Intl formatters are costly to build and this sheet needs them by the
 *  hundred: one month page asks the calendar for its parts eighty-odd times,
 *  once per day cell and again for every step of the month walk. They are
 *  pure functions of their locale and shape, so one of each is kept for the
 *  life of the tab. Building them per call cost about fifteen milliseconds a
 *  page — a dropped frame every time a page was drawn, which is what a swipe
 *  felt like when it stuck for a moment. */
const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(tag: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${tag}|${options.year ?? ''}|${options.month ?? ''}|${options.day ?? ''}|${options.weekday ?? ''}`;
  const known = dateFormats.get(key);
  if (known) return known;
  const made = new Intl.DateTimeFormat(tag, options);
  dateFormats.set(key, made);
  return made;
}
const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(tag: string): Intl.NumberFormat {
  const known = numberFormats.get(tag);
  if (known) return known;
  const made = new Intl.NumberFormat(tag);
  numberFormats.set(tag, made);
  return made;
}

/** Parts of a date as the chosen calendar counts them — in numbers, whatever
 *  digits the locale writes them with (a Jalali year is ۱۴۰۵ on paper). */
function calParts(tag: string, date: Date): { year: number; month: number; day: number } {
  const parts = dateFormat(tag, { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  const read = (type: string): number => Number(latinDigits(parts.find((part) => part.type === type)?.value ?? ''));
  return { year: read('year'), month: read('month'), day: read('day') };
}

/** The first day of `date`'s month, in the calendar `tag` counts in. The tag
 *  is the sheet's — its in-sheet switch included — never the Dates setting's
 *  alone: a date is its month's first day only as the calendar that reads it
 *  says so. Answering with the setting's calendar while the grid was labelled
 *  with the other one walked a Jalali month and wrote Gregorian numbers on it
 *  (the "months don't start at 1" bug). */
function monthStart(date: Date, tag: string): Date {
  const walk = new Date(date);
  walk.setHours(12, 0, 0, 0); // noon: a DST or day-count edge cannot skip a month
  for (let guard = 0; guard < 40 && calParts(tag, walk).day > 1; guard += 1) walk.setDate(walk.getDate() - 1);
  return walk;
}

function addMonths(date: Date, months: number, tag: string): Date {
  let walk = monthStart(date, tag);
  for (; months > 0; months -= 1) { walk.setDate(walk.getDate() + 40); walk = monthStart(walk, tag); }
  for (; months < 0; months += 1) { walk.setDate(walk.getDate() - 1); walk = monthStart(walk, tag); }
  return walk;
}

/** The days of `date`'s month, as Dates (all at noon), in `tag`'s calendar. */
function monthDays(date: Date, tag: string): Date[] {
  const first = monthStart(date, tag);
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

/** Weekday names in order, starting the week where Settings says it starts.
 *
 *  The first column is the READER's choice (`weekStart` in src/settings.ts),
 *  never the device's: `Intl.Locale.weekInfo.firstDay` was consulted here
 *  before, which meant an English phone began the week on Monday while the
 *  writer's own calendar begins it on Saturday — a mismatch no setting could
 *  fix, in an app whose whole Dates section is deliberately device-blind.
 *  The names themselves are still the Dates language's (the tag), so the row
 *  and the month grid can never disagree about what a day is called. */
function weekdayRow(tag: string, weekStart: number): string[] {
  // 2023-11-12 is a Sunday: seven days of known names, indexed from Sunday.
  const names: string[] = [];
  const naming = dateFormat(tag, { weekday: 'short' });
  for (let day = 0; day < 7; day += 1) {
    names.push(naming.format(new Date(2023, 10, 12 + day)));
  }
  const cut = ((Math.trunc(weekStart) % 7) + 7) % 7; // 0 = Sunday … 6 = Saturday
  return [...names.slice(cut), ...names.slice(0, cut)];
}

/** Where the first day of the month sits in a grid whose week starts at
 *  `row[0]`: how many lead cells come before it. */
function leadCells(tag: string, first: Date, row: string[]): number {
  const name = dateFormat(tag, { weekday: 'short' }).format(first);
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

/** How tall the on-screen keyboard is right now. main.ts measures it (the
 *  VirtualKeyboard API where there is one, the visual viewport otherwise)
 *  and installs the real reading here; 0 everywhere else, which is every
 *  desktop and every test. */
export const keyboardWatch = { height: (): number => 0 };

/** Wait for the keyboard to have gone, then run. The caller has let the note
 *  go already, but a keyboard takes a quarter-second to slide away: a tall
 *  sheet opened into the short window it still holds lays itself out against
 *  that window, and when the keyboard leaves, the sheet jumps. Waiting is
 *  capped, so a keyboard that never reports itself down cannot swallow the
 *  tap that opened the sheet. */
function afterKeyboardDown(then: () => void): void {
  const deadline = performance.now() + 450;
  const look = (): void => {
    if (keyboardWatch.height() <= 0 || performance.now() >= deadline) { then(); return; }
    window.requestAnimationFrame(look);
  };
  window.requestAnimationFrame(look);
}

export function createTimestampPicker(): TimestampPicker {
  let sheet: HTMLElement | null = null;
  let backdrop: HTMLElement | null = null;
  let viewMonth: Date | null = null;
  let chosen: Date | null = null;
  let format: TimestampFormat = 'f';
  let onInsert: ((code: string) => void) | null = null;
  /** The week's first column, read from Settings when the sheet opens — never
   *  from the device (see weekdayRow). */
  let weekStart = 6;
  /** The time row is a row of digit slots: behind each field a buffer holds
   *  what was typed, and the field always SHOWS two digits, zero-padded and
   *  live — typing 9 into the hour shows 09 at once. A slot can never be
   *  empty (backspace stops at 00) and is red only when the value it SHOWS
   *  is impossible — a complete two digits over the ceiling. What you see is
   *  what you get: 03 is a real hour, never a warning. */
  const slots: Record<'hour' | 'minute' | 'second', string> = { hour: '', minute: '', second: '' };
  /** The writer has focused a slot without typing yet: the first digit
   *  replaces, the way a slot takes a new value. */
  const fresh: Record<'hour' | 'minute' | 'second', boolean> = { hour: false, minute: false, second: false };
  const SLOT_MAX: Record<'hour' | 'minute' | 'second', number> = { hour: 23, minute: 59, second: 59 };
  const padded = (buffer: string): string => buffer.padStart(2, '0');
  const slotNum = (name: 'hour' | 'minute' | 'second'): number => Number(slots[name] || '0');
  const slotRed = (name: 'hour' | 'minute' | 'second'): boolean =>
    slots[name].length === 2 && Number(slots[name]) > SLOT_MAX[name];
  /** The month title replaced by month/year inputs, until applied or left. */
  let jumping = false;
  /** Armed when the jump applies: the very next focus to land in the time row
   *  is bounced to the title (keyboards that advance without a key event). */
  let reentry = false;
  /** Sheets fading out after a close: a fresh open sweeps them out of the
   *  DOM at once, so nothing half-transparent is left catching taps. */
  const fading: HTMLElement[] = [];

  /** The calendar the sheet wears: the Dates setting, or the in-sheet
   *  override — a way to change the system right here. The code inserted is
   *  a unix number and calendar-blind either way; the note's words stay the
   *  Dates setting's business. */
  let calendarOverride: 'gregory' | 'persian' | null = null;
  const tag = (): string => {
    const base = timestampLocaleTag();
    return calendarOverride ? `${base.split('-u-ca-')[0]}-u-ca-${calendarOverride}` : base;
  };
  const number = (value: number): string => numberFormat(tag()).format(value);

  const close = (): void => {
    waiting = null; // a sheet still waiting for the keyboard is called off
    if (!sheet) return;
    const el = sheet; const cover = backdrop;
    sheet = null; backdrop = null; onInsert = null;
    el.classList.add('is-closing');
    cover?.classList.remove('is-open');
    fading.push(el);
    if (cover) fading.push(cover);
    window.setTimeout(() => { el.remove(); cover?.remove(); }, 220);
  };

  /** Put the scroll on the page that carries the viewed month, instantly. */
  const centerTrack = (): void => {
    const viewport = sheet?.querySelector<HTMLElement>('.timestamp-picker-viewport');
    if (viewport) viewport.scrollLeft = indexFor(0) * viewport.clientWidth;
  };

  /** What goes INSIDE one page: the weekday row and a FIXED six-week grid —
   *  42 cells whatever the month, so no page grows or shrinks and the sheet
   *  never changes height under the finger. The page frames themselves are
   *  laid out once, by buildTrack, and never move again. */
  function pageInner(monthDate: Date): string {
    const localeTag = tag();
    const row = weekdayRow(localeTag, weekStart);
    const days = monthDays(monthDate, localeTag);
    const lead = leadCells(localeTag, monthStart(monthDate, localeTag), row);
    const chosenParts = chosen ? calParts(localeTag, chosen) : null;
    const cells = Array.from({ length: lead }, () => '<span class="timestamp-picker-day is-blank"></span>').join('')
      + days.map((day, index) => {
        const parts = calParts(localeTag, day);
        // The chosen day is marked on WHICHEVER page holds it, not only on
        // the one at rest in the middle: swiping to its month used to bring
        // up a grid with nothing lit on it until the track settled.
        const selected = chosenParts !== null
          && parts.year === chosenParts.year && parts.month === chosenParts.month && parts.day === chosenParts.day;
        return `<button type="button" class="timestamp-picker-day${selected ? ' is-selected' : ''}" data-stamp-day="${index}" aria-label="${number(parts.day)}" aria-pressed="${selected}" tabindex="-1">${number(parts.day)}</button>`;
      }).join('')
      + Array.from({ length: 42 - lead - days.length }, () => '<span class="timestamp-picker-day is-blank"></span>').join('');
    const weekdays = `<div class="timestamp-picker-weekdays">${row.map((name) => `<span>${escapeHtml(name)}</span>`).join('')}</div>`;
    // One direction for the whole page, read from the WEEKDAY NAMES — so the
    // header row and the day grid can never disagree about which column is
    // which. Persian names turn the month right-to-left (Saturday on the
    // right, as every Jalali wall calendar prints it), English ones keep it
    // left-to-right. The language decides, never the app's own direction:
    // the row used to be dir="auto" (RTL for Persian) inside a grid that
    // followed the SHEET (LTR for an English app), which mirrored every
    // column against its own label.
    return `${weekdays}<div class="timestamp-picker-grid">${cells}</div>`;
  }

  /** The month's own reading direction, taken from the weekday names of the
   *  Dates language — the single answer the header row, the day grid, the
   *  track's order and the step arrows all read. */
  let monthDirFor: { key: string; dir: 'ltr' | 'rtl' } | null = null;
  function monthDir(): 'ltr' | 'rtl' {
    // Remembered per language: this is read on every scroll frame, and a
    // weekday row costs a date formatter and seven dates.
    const key = `${tag()}|${weekStart}`;
    if (monthDirFor?.key !== key) monthDirFor = { key, dir: strongDirection(weekdayRow(tag(), weekStart).join('')) ?? 'ltr' };
    return monthDirFor.dir;
  }

  /** The month a page carries, from where it sits on the track — the whole
   *  of the carousel's arithmetic. In Persian the months run right to left
   *  like everything else on the page, so the track is laid out latest-first
   *  and the index counts the other way. */
  const offsetAt = (index: number): number => anchor + (monthDir() === 'rtl' ? -index : index);
  /** Where a month sits: the inverse of offsetAt. */
  const indexFor = (offset: number): number => (monthDir() === 'rtl' ? anchor - offset : offset - anchor);

  function render(): void {
    if (!sheet || !viewMonth || !chosen) return;
    const localeTag = tag();
    const first = monthStart(viewMonth, localeTag);
    const heading = sheet.querySelector<HTMLElement>('.timestamp-picker-month')!;
    if (!jumping) {
      heading.textContent = dateFormat(localeTag, { year: 'numeric', month: 'long' }).format(first);
      heading.dir = 'auto';
      titleIndex = indexFor(0);
    }
    // The calendar switch: both calendars stay where they are, in one fixed
    // order, and only the highlight moves to the one the sheet is wearing.
    const calButton = sheet.querySelector<HTMLButtonElement>('[data-stamp-cal]');
    if (calButton) {
      const active = calendarOverride ?? (/persian/.test(timestampLocaleTag()) ? 'persian' : 'gregory');
      for (const option of calButton.querySelectorAll<HTMLElement>('[data-stamp-cal-option]')) {
        option.classList.toggle('is-active', option.dataset.stampCalOption === active);
      }
    }
    // The grids are NOT rebuilt here, and the scroll is not touched: the
    // ladder is fixed and its pages are drawn once. Only the mark on the
    // chosen day travels between them. rebase() is what re-lays the track,
    // and only the sheet's own deliberate moves call it.
    syncChosen();
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
  /** The moment the row says: the chosen date carries the date, the slots
   *  the time — a waiting slot (buffer 9, shown 09) reads as its padded
   *  value, so the code is always whole. */
  const unixOf = (date: Date): number => {
    const at = new Date(date);
    at.setHours(slotNum('hour'), slotNum('minute'), slotNum('second'), 0);
    return Math.floor(at.getTime() / 1000);
  };
  /** Red sticks to the impossible field alone; Insert greys out for that
   *  alone — waiting never blocks the writer. */
  function syncTime(): void {
    if (!sheet) return;
    for (const name of ['hour', 'minute', 'second'] as const) {
      sheet.querySelector<HTMLInputElement>(`[data-stamp-${name}]`)?.classList.toggle('is-invalid', slotRed(name));
    }
    const insert = sheet.querySelector<HTMLButtonElement>('[data-stamp-insert]');
    if (insert) insert.disabled = (['hour', 'minute', 'second'] as const).some(slotRed);
  }

  // ---- The month turn ----
  /** One month toward `dir`, by the rule the Persian Calendar app uses for
   *  its own arrows (CalendarPager.kt `arrowAction`, WeekScreen.kt:203):
   *  the NEIGHBOURING page is animated, anything further is jumped to. A
   *  press that lands while a turn still glides therefore overtakes it
   *  instead of queueing behind it — nothing remembers presses any more,
   *  the destination is one page number. The old sheet kept a backlog and
   *  played it back one animation at a time, which is why holding the arrow
   *  felt like waiting in a queue. */
  function turnMonth(dir: -1 | 1): void {
    const viewport = sheet?.querySelector<HTMLElement>('.timestamp-picker-viewport');
    if (!viewport) return;
    const width = viewport.clientWidth || 1;
    const here = nearestIndex();
    const step = monthDir() === 'rtl' ? -dir : dir;
    let want = clampIndex(toIndex + step);
    // The track already drifted onto the target by itself (a swipe still
    // settling): then the press means the page after it, not this one.
    if (want === here) want = clampIndex(here + step);
    toIndex = want;
    viewport.scrollTo({ left: want * width, behavior: Math.abs(want - here) > 1 ? 'auto' : 'smooth' });
  }

  /** The track is a FIXED ladder of month pages — the model the Persian
   *  Calendar app's carousel uses (CalendarPager.kt: a pager of 5000 pages
   *  whose index IS the month, `applyOffset(page) = monthsLimit / 2 - page`).
   *  Pages are never inserted, removed, re-ordered or re-centred while the
   *  sheet lives, so the sheet's own bookkeeping can never disturb a
   *  gesture: all that changes as the track moves is which frames have a
   *  grid drawn inside them, and drawing inside a frame moves nothing.
   *  A century of months is 1201 pages; the jump box reaches further. */
  const PAGES = 1201;
  const CENTRE = 600;
  /** Which frames hold a grid. The far ones are emptied again — the frames
   *  stay, so nothing moves, and only a handful of grids are ever alive. */
  const filled = new Set<number>();
  /** The page a turn is heading for: the pager's `targetPage`, not a queue. */
  let toIndex = CENTRE;
  /** The month offset of page 0 relative to `viewMonth`. Coming to rest on
   *  another page moves this number and nothing else — no rebuild, no
   *  re-centring. Read it through offsetAt/indexFor, never by hand. */
  let anchor = -CENTRE;
  /** Which page the title is wearing. */
  let titleIndex = CENTRE;

  const clampIndex = (index: number): number => Math.max(0, Math.min(PAGES - 1, index));
  const pageAt = (index: number): HTMLElement | null =>
    (sheet?.querySelector<HTMLElement>('.timestamp-picker-track')?.children[index] as HTMLElement | undefined) ?? null;
  /** Where the scroll stands, in pages. */
  function nearestIndex(): number {
    const viewport = sheet?.querySelector<HTMLElement>('.timestamp-picker-viewport');
    if (!viewport) return CENTRE;
    return clampIndex(Math.round(viewport.scrollLeft / (viewport.clientWidth || 1)));
  }

  /** Draw the grid of the month this frame carries. Nothing moves: the frame
   *  already has its width (flex: 0 0 100%) and takes its height from the
   *  row, so this is safe with a finger on the track — which is the whole
   *  point of a fixed ladder. */
  function fillPage(index: number): void {
    if (!viewMonth || index < 0 || index >= PAGES || filled.has(index)) return;
    const page = pageAt(index);
    if (!page) return;
    page.style.direction = monthDir();
    page.innerHTML = pageInner(addMonths(viewMonth, offsetAt(index), tag()));
    filled.add(index);
  }
  /** Grids exist near the reader and nowhere else. */
  function fillAround(index: number, reach = 2): void {
    for (let at = index - reach; at <= index + reach; at += 1) fillPage(at);
    if (filled.size <= 12) return;
    for (const at of [...filled]) {
      if (Math.abs(at - index) > 6) { pageAt(at)?.replaceChildren(); filled.delete(at); }
    }
  }
  /** The page the reader is on: the only one that takes taps (the rest are
   *  pointer-events:none in the stylesheet) and the only one in the tab
   *  order. */
  function markCurrent(index: number): void {
    const track = sheet?.querySelector<HTMLElement>('.timestamp-picker-track');
    const page = pageAt(index);
    if (!track || !page) return;
    for (const other of track.querySelectorAll<HTMLElement>('.timestamp-picker-page.is-current')) {
      if (other === page) continue;
      other.classList.remove('is-current');
      other.setAttribute('aria-hidden', 'true');
      for (const day of other.querySelectorAll<HTMLElement>('[data-stamp-day]')) day.tabIndex = -1;
    }
    page.classList.add('is-current');
    page.removeAttribute('aria-hidden');
    for (const day of page.querySelectorAll<HTMLElement>('[data-stamp-day]')) day.removeAttribute('tabindex');
  }
  /** The mark on the chosen day, moved between the grids that exist. The
   *  grids are not redrawn for it: a tap never rebuilds what it landed on. */
  function syncChosen(): void {
    if (!viewMonth || !chosen) return;
    const localeTag = tag();
    const want = calParts(localeTag, chosen);
    for (const index of filled) {
      const page = pageAt(index);
      if (!page) continue;
      const here = calParts(localeTag, monthStart(addMonths(viewMonth, offsetAt(index), localeTag), localeTag));
      const sameMonth = here.year === want.year && here.month === want.month;
      for (const day of page.querySelectorAll<HTMLElement>('[data-stamp-day]')) {
        const on = sameMonth && Number(day.dataset.stampDay) + 1 === want.day;
        day.classList.toggle('is-selected', on);
        day.setAttribute('aria-pressed', String(on));
      }
    }
  }
  /** Lay the ladder out around the viewed month. Only the sheet's own
   *  deliberate moves do this — opening, Today, a jump, a calendar switch —
   *  never a gesture, and never a settle. */
  function buildTrack(): void {
    if (!sheet || !viewMonth) return;
    const track = sheet.querySelector<HTMLElement>('.timestamp-picker-track')!;
    const rtl = monthDir() === 'rtl';
    track.innerHTML = Array.from({ length: PAGES }, (_unused, index) => `<div class="timestamp-picker-page" data-stamp-page="${index}" aria-hidden="true"></div>`).join('');
    filled.clear();
    anchor = rtl ? CENTRE : -CENTRE;
    titleIndex = CENTRE;
    toIndex = CENTRE;
    // The head reads the month's way too, so the step arrows sit where that
    // language expects them: in Persian the month before is to the right.
    const head = sheet.querySelector<HTMLElement>('.timestamp-picker-head');
    if (head) head.dir = rtl ? 'rtl' : 'ltr';
    fillAround(CENTRE, 3);
    markCurrent(CENTRE);
    centerTrack();
  }
  /** The viewed month moved by something other than the reader's finger. */
  function rebase(): void { buildTrack(); render(); }

  /** The track came to rest. Whichever page it stopped on IS the viewed
   *  month now — and saying so costs two numbers, because the ladder is
   *  fixed: no rebuild, no re-centring, no scroll write, nothing for the
   *  next swipe to trip over. (The old track was five pages that had to be
   *  re-laid and re-centred around every settle. That rebuild is what made
   *  a quick swipe stick for a moment before it moved on.) */
  function adopt(): void {
    if (!sheet || !viewMonth) return;
    const index = nearestIndex();
    const offset = offsetAt(index);
    if (offset !== 0) {
      viewMonth = addMonths(viewMonth, offset, tag());
      anchor -= offset; // page `index` carries the viewed month from here on
    }
    toIndex = index;
    titleIndex = index;
    markCurrent(index);
    fillAround(index, 3);
    // A reader who swiped a century has reached the end of the ladder: lay
    // it out again around here, while nothing is moving.
    if (index < 4 || index > PAGES - 5) buildTrack();
  }

  /** The title follows the finger: the page nearest the snap point names the
   *  month *while* the track moves — not after it stops. The grids and the
   *  chips stay until the settle; the title is cheap, it may anticipate. */
  function followTitle(index: number): void {
    titleIndex = index;
    const heading = sheet?.querySelector<HTMLElement>('.timestamp-picker-month');
    if (!heading || !viewMonth || jumping) return;
    heading.textContent = dateFormat(tag(), { year: 'numeric', month: 'long' }).format(monthStart(addMonths(viewMonth, offsetAt(index), tag()), tag()));
  }

  /** The keyboard goes down BEFORE the sheet comes up — the writer sees one
   *  movement instead of a sheet that flickers as the keyboard leaves under
   *  it. Nothing waits when no keyboard is up, which is every desktop and
   *  every test. A second tap while waiting replaces the first; a close
   *  cancels it. */
  let waiting: { initial?: { seconds: number; format: TimestampFormat }; onInsert(code: string): void } | null = null;
  function open(options: { initial?: { seconds: number; format: TimestampFormat }; onInsert(code: string): void }): void {
    if (keyboardWatch.height() <= 0) { buildSheet(options); return; }
    const already = waiting !== null;
    waiting = options;
    if (already) return;
    afterKeyboardDown(() => {
      const next = waiting;
      waiting = null;
      if (next) buildSheet(next);
    });
  }

  function buildSheet(options: { initial?: { seconds: number; format: TimestampFormat }; onInsert(code: string): void }): void {
    // A second open (a double-tap on the toolbar) replaces the sheet at once:
    // no fading copy may linger in the DOM to catch the next tap or locator.
    if (sheet) { sheet.remove(); backdrop?.remove(); sheet = null; backdrop = null; onInsert = null; }
    for (const el of fading.splice(0)) el.remove();
    if (isMenuOpen()) closeMenu();
    weekStart = loadSettings().weekStart;
    onInsert = options.onInsert;
    format = options.initial?.format ?? 'f';
    const start = options.initial ? new Date(options.initial.seconds * 1000) : new Date();
    chosen = start;
    jumping = false;
    calendarOverride = null;
    viewMonth = monthStart(start, tag());
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
        <div class="timestamp-picker-nowrow">
          <button type="button" class="timestamp-picker-today" data-stamp-today>Today</button>
          <button type="button" class="timestamp-picker-cal" data-stamp-cal aria-label="Switch calendar"><span class="timestamp-picker-cal-option" data-stamp-cal-option="gregory">Gregorian</span><span class="timestamp-picker-cal-swap">⇄</span><span class="timestamp-picker-cal-option" data-stamp-cal-option="persian">شمسی</span></button>
          <button type="button" class="timestamp-picker-now" data-stamp-now>Now</button>
        </div>
        <div class="timestamp-picker-time">
          <input class="timestamp-picker-field" data-stamp-hour type="text" inputmode="numeric" enterkeyhint="next" aria-label="Hour">
          <span class="timestamp-picker-colon">:</span>
          <input class="timestamp-picker-field" data-stamp-minute type="text" inputmode="numeric" enterkeyhint="next" aria-label="Minute">
          <span class="timestamp-picker-colon">:</span>
          <input class="timestamp-picker-field" data-stamp-second type="text" inputmode="numeric" enterkeyhint="done" aria-label="Second">
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
    const second = sheet.querySelector<HTMLInputElement>('[data-stamp-second]')!;
    slots.hour = String(start.getHours()).padStart(2, '0');
    slots.minute = String(start.getMinutes()).padStart(2, '0');
    slots.second = String(start.getSeconds()).padStart(2, '0');
    hour.value = padded(slots.hour);
    minute.value = padded(slots.minute);
    second.value = padded(slots.second);
    sheet.addEventListener('input', (event) => {
      const el = event.target as HTMLInputElement;
      const monthField = el.closest<HTMLInputElement>('[data-stamp-jump-month]');
      const yearField = el.closest<HTMLInputElement>('[data-stamp-jump-year]');
      if (yearField) {
        const digits = latinDigits(el.value).replace(/\D/g, '').slice(0, 4);
        if (el.value !== digits) el.value = digits;
        return;
      }
      if (monthField) {
        const digits = latinDigits(el.value).replace(/\D/g, '').slice(0, 2);
        if (el.value !== digits) el.value = digits;
        monthField.classList.toggle('is-invalid', digits.length === 2 && Number(digits) > 12);
        if (digits.length === 2 && Number(digits) >= 1 && Number(digits) <= 12) {
          sheet!.querySelector<HTMLInputElement>('[data-stamp-jump-year]')!.focus();
        }
        return;
      }
      const name = el.closest('[data-stamp-hour]') ? 'hour'
        : el.closest('[data-stamp-minute]') ? 'minute'
        : el.closest('[data-stamp-second]') ? 'second' : null;
      if (!name) return;
      // The register: the browser shows the padded buffer plus whatever the
      // writer just did; the diff against it is the keystroke. First digit
      // after a focus replaces, the rest shift the register along; removing
      // characters pops it — never past 00.
      const kind = (event as InputEvent).inputType ?? '';
      if (kind.startsWith('delete')) {
        slots[name] = slots[name].slice(0, -1); // never past 00
      } else if (kind === 'insertReplacementText') {
        // A programmatic value-set (autofill, tests): the whole value IS the
        // new buffer, no register arithmetic.
        slots[name] = latinDigits(el.value).replace(/\D/g, '').slice(-2);
        fresh[name] = false;
      } else {
        let typed = ((event as InputEvent).data ?? '').replace(/\D/g, '');
        if (!typed) {
          // A composition or a paste: the digits are whatever arrived whole.
          const afterDigits = latinDigits(el.value).replace(/\D/g, '');
          const before = padded(slots[name]);
          typed = afterDigits.startsWith(before) ? afterDigits.slice(before.length) : afterDigits.slice(-2);
        }
        if (typed) {
          if (fresh[name]) { slots[name] = typed[0]; typed = typed.slice(1); fresh[name] = false; }
          for (const digit of typed) slots[name] = (slots[name] + digit).slice(-2);
        }
      }
      el.value = padded(slots[name]);
      const atEnd = slots[name].length;
      el.setSelectionRange(atEnd, atEnd);
      syncTime();
      render(); // the chips and the Insert code follow every digit
      // Completed and legal: the chain moves by itself. Completed and
      // impossible: the field is red and HOLDS the advance until fixed.
      if (slots[name].length === 2 && !slotRed(name)) {
        const nextFor = name === 'hour' ? '[data-stamp-minute]' : name === 'minute' ? '[data-stamp-second]' : null;
        const next = nextFor ? sheet!.querySelector<HTMLInputElement>(nextFor) : null;
        if (next) next.focus();
        else el.blur(); // seconds done: one quiet keyboard close, no focus slam
      }
    });
    // The month title, tapped: two fields in the calendar's own count.
    const enterJump = (): void => {
      const heading = sheet!.querySelector<HTMLElement>('.timestamp-picker-month')!;
      const parts = calParts(tag(), monthStart(viewMonth!, tag()));
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
      const parts = calParts(tag(), monthStart(viewMonth!, tag()));
      const delta = (year - parts.year) * 12 + (month - parts.month);
      jumping = false;
      // The keyboard's work is done: the focus belongs to the title, so the
      // IME closes instead of walking on. A focus a delinquent keyboard moved
      // into the time row anyway is bounced here (the focusin guard below).
      reentry = true;
      window.setTimeout(() => { reentry = false; }, 300); // a beat, then the guard rests
      if (delta) viewMonth = addMonths(viewMonth!, delta, tag());
      rebase(); // the whole distance at once, the ladder re-laid around it
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
      const name = el.closest?.('[data-stamp-hour]') ? 'hour'
        : el.closest?.('[data-stamp-minute]') ? 'minute'
        : el.closest?.('[data-stamp-second]') ? 'second' : null;
      if (name) fresh[name] = true;
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
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const slotName = target.closest?.('[data-stamp-hour]') ? 'hour'
          : target.closest?.('[data-stamp-minute]') ? 'minute'
          : target.closest?.('[data-stamp-second]') ? 'second' : null;
        if (slotName) {
          // The picker's own arrows: the value steps, wrapping at the
          // ceiling — and the sheet does not scroll a pixel.
          event.preventDefault();
          const max = SLOT_MAX[slotName];
          const value = (slotNum(slotName) + (event.key === 'ArrowUp' ? 1 : -1) + max + 1) % (max + 1);
          slots[slotName] = String(value).padStart(2, '0');
          (target as HTMLInputElement).value = padded(slots[slotName]);
          syncTime();
          render();
          return;
        }
        if (!jumping && target.closest?.('[data-stamp-jump]')) {
          event.preventDefault();
          turnMonth(event.key === 'ArrowUp' ? 1 : -1);
          return;
        }
      }
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
        if (!slotRed('hour')) minute.focus(); // impossible: the advance holds
        return;
      }
      if (event.key === 'Enter' && target.closest('[data-stamp-minute]')) {
        event.preventDefault();
        if (!slotRed('minute')) second.focus();
        return;
      }
      if (event.key === 'Enter' && target.closest('[data-stamp-second]')) {
        event.preventDefault();
        if (!slotRed('second')) (target as HTMLElement).blur(); // the keyboard closes, quietly
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
        turnMonth(Number(step.dataset.stampStep) as -1 | 1);
        return;
      }
      if (target.closest('[data-stamp-jump-month], [data-stamp-jump-year]')) return;
      if (target.closest('[data-stamp-jump]')) { enterJump(); return; }
      if (target.closest('[data-stamp-today]')) {
        // Today's date, the typed time kept.
        const today = new Date();
        const at = new Date(today);
        at.setHours(slotNum('hour'), slotNum('minute'), slotNum('second'), 0);
        chosen = at;
        viewMonth = monthStart(today, tag());
        rebase(); // a different month: the ladder is laid out around it
        return;
      }
      if (target.closest('[data-stamp-cal]')) {
        const active = calendarOverride ?? (/persian/.test(timestampLocaleTag()) ? 'persian' : 'gregory');
        // Re-anchor the view BEFORE the words change: a month's first day in
        // one calendar sits mid-month in the other, so carrying that Date
        // over opened the neighbouring month — on 23 October the Jalali grid
        // came up on Mehr, the month that holds 1 October, and the chosen day
        // was nowhere on it. Anchor on the chosen day when it is in view, on
        // the middle of the viewed month otherwise.
        if (viewMonth) {
          // Whatever the track is showing IS the month being re-worded, even
          // if the scroll has not settled into it yet: reading the stale
          // viewMonth is how a switch mid-swipe landed a month or two away.
          const offset = offsetAt(nearestIndex());
          if (offset !== 0) viewMonth = addMonths(viewMonth, offset, tag());
          const was = tag();
          const first = monthStart(viewMonth, was);
          const here = calParts(was, first);
          const at = chosen ? calParts(was, chosen) : null;
          const middle = new Date(first);
          middle.setDate(middle.getDate() + 14);
          viewMonth = chosen && at && at.year === here.year && at.month === here.month ? new Date(chosen) : middle;
        }
        calendarOverride = active === 'persian' ? 'gregory' : 'persian';
        rebase(); // the same Dates, re-worded — and the months may now read the other way
        return;
      }
      if (target.closest('[data-stamp-now]')) {
        // The current hh:mm:ss, the picked date kept.
        const now = new Date();
        slots.hour = String(now.getHours()).padStart(2, '0');
        slots.minute = String(now.getMinutes()).padStart(2, '0');
        slots.second = String(now.getSeconds()).padStart(2, '0');
        hour.value = padded(slots.hour);
        minute.value = padded(slots.minute);
        second.value = padded(slots.second);
        const at = new Date(chosen!);
        at.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
        chosen = at;
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
        // The page's month comes from where it sits on the ladder, which is
        // fixed: the frame carries its own index and the anchor does the rest.
        const pageIndex = Number(day.closest<HTMLElement>('.timestamp-picker-page')!.dataset.stampPage);
        const picked = monthDays(addMonths(viewMonth!, offsetAt(pageIndex), tag()), tag())[Number(day.dataset.stampDay)];
        if (picked) {
          const at = new Date(picked);
          at.setHours(slotNum('hour'), slotNum('minute'), slotNum('second'), 0);
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
    // the fling and the snap (one page per flick, scroll-snap-stop: always).
    // The sheet only listens — there is no runway to grow, nothing to
    // compensate and nothing to re-centre, because the ladder is fixed.
    // These handlers name the month under the finger, draw the grids coming
    // up, and hear where the scroll came to rest.
    const viewport = sheet.querySelector<HTMLElement>('.timestamp-picker-viewport')!;
    let settleTimer = 0;
    let fingerDown = false;
    /** The scroll now under way was started by a finger or by an arrow. Only
     *  those settle the moment they stop: a scroll nobody asked for — the
     *  browser bringing a focused day into view, which mandatory snap then
     *  rounds up to a whole page — is given the slow path, so it can come
     *  back before the sheet reads it as a month. */
    let gestured = false;
    const defer = (): void => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, 120);
    };
    function settle(): void {
      settleTimer = 0;
      if (fingerDown) { defer(); return; } // nothing settles under the writer's hand
      gestured = false;
      adopt();
    }
    viewport.addEventListener('touchstart', () => {
      fingerDown = true;
      gestured = true;
      toIndex = nearestIndex(); // the finger takes the wheel from any glide
    }, { passive: true });
    const fingerUp = (): void => {
      fingerDown = false;
      // Every lift ends in a settle, scroll or no scroll: the scroll events
      // of a slow drag may have stopped arriving well before the finger
      // left, and nothing else would then ask the track to come to rest.
      defer();
    };
    viewport.addEventListener('touchend', fingerUp, { passive: true });
    viewport.addEventListener('touchcancel', fingerUp, { passive: true });
    // scrollend is rest, by definition; the debounce is the fallback for
    // engines that do not fire it.
    viewport.addEventListener('scrollend', () => {
      if (!fingerDown && gestured) { window.clearTimeout(settleTimer); settle(); } else defer();
    });
    viewport.addEventListener('scroll', () => {
      const index = nearestIndex();
      if (index !== titleIndex) {
        if (fingerDown) toIndex = index; // a swipe moves the target with it
        followTitle(index);
        fillAround(index);
      }
      defer();
    }, { passive: true });
        rebase();
  }

  document.addEventListener('keydown', function onKey(event) {
    if (!sheet) { document.removeEventListener('keydown', onKey, true); return; }
    if (event.key === 'Escape' && !document.querySelector('.menu.is-open:not(.timestamp-picker)')) { event.preventDefault(); close(); }
  }, true);

  return { open, close };
}
