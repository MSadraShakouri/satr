// Discord-style timestamps: <t:UNIX> or <t:UNIX:FORMAT>, UNIX in seconds.
// The formats are Discord's: t short time, T long time, d short date, D long
// date, f (the default) date and short time, F the same with the weekday, and
// R relative ("in 3 hours", "2 days ago"), which keeps itself up to date while
// it is on screen. The text follows the device's language and numbers, as the
// rest of the app's dates do. The note keeps the code as written.

export const TIMESTAMP_FORMATS = ['t', 'T', 'd', 'D', 'f', 'F', 'R'] as const;
export type TimestampFormat = (typeof TIMESTAMP_FORMATS)[number];

/** A timestamp at the start of a string: <t:UNIX> or <t:UNIX:F>. */
export const TIMESTAMP_START = /^<t:(-?\d{1,15})(?::([tTdDfFR]))?>/;

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** The text a timestamp shows. `now` is in milliseconds. */
export function formatTimestamp(seconds: number, format: TimestampFormat, now = Date.now()): string {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const at = (options: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(undefined, options).format(date);
  switch (format) {
    case 't': return at({ hour: 'numeric', minute: '2-digit' });
    case 'T': return at({ hour: 'numeric', minute: '2-digit', second: '2-digit' });
    case 'd': return at({ year: 'numeric', month: 'numeric', day: 'numeric' });
    case 'D': return at({ year: 'numeric', month: 'long', day: 'numeric' });
    case 'F': return at({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    case 'R': {
      const diff = seconds - now / 1000;
      const abs = Math.abs(diff);
      const [unit, size] = RELATIVE_UNITS.find(([, s]) => abs >= s) ?? ['second', 1];
      const count = Math.trunc(diff / size);
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(count, unit);
    }
    case 'f':
    default: return at({ year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}

/** The full date and time, for the tooltip of every timestamp. */
export function fullTimestamp(seconds: number): string {
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' }).format(date);
}

/** The HTML for a timestamp in the reading view. */
export function timestampTag(seconds: number, format: TimestampFormat): string {
  const text = formatTimestamp(seconds, format);
  const escape = (value: string): string => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
  return `<time class="discord-timestamp" data-ts="${seconds}" data-format="${format}" title="${escape(fullTimestamp(seconds))}">${escape(text)}</time>`;
}

/** Brings every relative timestamp on the page up to date. */
export function refreshTimestamps(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.discord-timestamp[data-format="R"]').forEach((el) => {
    const next = formatTimestamp(Number(el.dataset.ts), 'R');
    if (next && el.textContent !== next) el.textContent = next;
  });
}

/** Keeps the relative ones current: once a second while the app is shown, so a
 *  "in 45 seconds" counts down. Only the relative ones are touched. */
export function keepTimestampsCurrent(): void {
  window.setInterval(() => { if (!document.hidden) refreshTimestamps(); }, 1_000);
}
