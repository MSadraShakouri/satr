// What the app did, in order, with a clock on every line.
//
// The app had nothing of this kind: not one console call in src/. So three
// questions that come up constantly -- where did the time go, what happened
// before it broke, and did the last run end by itself -- could only be
// answered by guessing, or by building a throwaway instrument and then
// believing it.
//
// One stream answers all three, on one condition: every line carries a clock,
// and a line that measures something carries what it took. Then the record
// and the stopwatch are the same feature rather than two.
//
//   0.00s  launch   cold start
//   0.31s  launch   webview ready                     took 310ms
//  14.02s  pdf      open  path=books/book.pdf 31.0MB
//  16.84s  pdf      pdfium loaded  pages=528          took 2750ms
//
// Three dials, not five levels. VOLUME is the author's own word -- quiet,
// normal, verbose -- and is the only one most days. KIND is note, warning or
// failure, and a failure is kept whatever the volume, because the one line
// worth having is never the one you remembered to turn on. AREA tags where a
// line came from, and is the filter that actually gets used ("pdf only").
//
// It must not become the slowness it was built to find, so: nothing is turned
// into text when it is written -- a line is kept as its pieces and formatted
// only when it is read -- the clock is performance.now() rather than a Date
// object per line, and a call that the volume drops is a comparison and a
// return.

/** Where a line came from. The filter the viewer offers as chips. */
export type Area = 'launch' | 'file' | 'pdf' | 'tabs' | 'search' | 'storage' | 'native';

/** A failure survives every volume. The other two do not. */
export type Kind = 'note' | 'warning' | 'failure';

/** quiet: failures only. normal: everything but the verbose extras.
 *  verbose: all of it, for a hunt. */
export type Volume = 'quiet' | 'normal' | 'verbose';

/** The varying part of a line. Numbers and short strings only: this is held
 *  as it is given and turned into text once, if the line is ever read. */
export type Facts = Record<string, string | number | boolean>;

export interface Line {
  /** Milliseconds since this run started. One number, not a Date. */
  at: number;
  area: Area;
  kind: Kind;
  /** A short constant. Anything that varies belongs in `facts`. */
  text: string;
  facts?: Facts;
  /** Set only on a line made by time(): what the thing took, in ms. */
  ms?: number;
  /** A verbose extra, kept only on verbose. */
  loud?: boolean;
}

/** Lines held in memory. A line is a little object, so this is a few hundred
 *  kB at worst -- and "grows forever" is what went wrong the last time
 *  something kept a record (see src/viewStore.ts), so there is a bound and it
 *  is a small one. */
export const KEEP = 2000;

/** When this run began, in wall-clock terms, so an exported log can say what
 *  time of day it was without every line carrying a date. */
export const startedAt = Date.now();

const VOLUME_KEY = 'satr:log:volume';

/** A ring rather than an array that shifts: once it is full, every single
 *  line would otherwise move two thousand pointers to make room. */
const ring: (Line | undefined)[] = new Array<Line | undefined>(KEEP);
let next = 0;
let held = 0;
/** Lines dropped off the end, so the viewer can say so rather than quietly
 *  showing a log with a hole at the top. */
let lost = 0;

let level: Volume = 'normal';
try {
  const saved = localStorage.getItem(VOLUME_KEY);
  if (saved === 'quiet' || saved === 'normal' || saved === 'verbose') level = saved;
} catch { /* a browser with no storage still logs, it just forgets the choice */ }

type Listener = (line: Line) => void;
const listeners = new Set<Listener>();

/** Whether a line of this kind would be kept. Exported because a caller that
 *  would have to do real work to build its facts can ask first. */
export function keeps(kind: Kind, loud = false): boolean {
  if (kind === 'failure') return true;
  if (level === 'quiet') return false;
  return !loud || level === 'verbose';
}

function put(area: Area, kind: Kind, text: string, facts?: Facts, ms?: number, loud?: boolean): void {
  if (!keeps(kind, loud)) return;
  const line: Line = { at: Math.round(performance.now()), area, kind, text };
  if (facts) line.facts = facts;
  if (ms !== undefined) line.ms = ms;
  if (loud) line.loud = true;
  if (ring[next]) lost += 1;
  ring[next] = line;
  next = (next + 1) % KEEP;
  if (held < KEEP) held += 1;
  for (const listener of listeners) listener(line);
}

/** Something happened. */
export function note(area: Area, text: string, facts?: Facts): void { put(area, 'note', text, facts); }
/** Something happened that should not have, but the app carried on. */
export function warn(area: Area, text: string, facts?: Facts): void { put(area, 'warning', text, facts); }
/** Something did not work. Kept whatever the volume. */
export function fail(area: Area, text: string, facts?: Facts): void { put(area, 'failure', text, facts); }
/** Detail that is only wanted during a hunt. Dropped unless verbose. */
export function loud(area: Area, text: string, facts?: Facts): void { put(area, 'note', text, facts, undefined, true); }

/** Measure something. Returns the function that ends it:
 *
 *      const done = time('pdf', 'pdfium loaded');
 *      ...
 *      done({ pages: 528 });
 *
 *  One line, written when it finishes, carrying what it took. Two lines for
 *  one event would double the log to say the same thing, and the clock on the
 *  line already says when it ended. */
export function time(area: Area, text: string, facts?: Facts): (more?: Facts) => void {
  const began = performance.now();
  let ended = false;
  return (more?: Facts) => {
    if (ended) return; // a done() called twice must not write the thing twice
    ended = true;
    const both = facts || more ? { ...facts, ...more } : undefined;
    put(area, 'note', text, both, Math.round(performance.now() - began));
  };
}

/** The same, for a hunt only: costs nothing when the volume is not verbose. */
export function timeLoud(area: Area, text: string, facts?: Facts): (more?: Facts) => void {
  if (!keeps('note', true)) return () => { /* not being kept, so not measured */ };
  const began = performance.now();
  let ended = false;
  return (more?: Facts) => {
    if (ended) return;
    ended = true;
    const both = facts || more ? { ...facts, ...more } : undefined;
    put(area, 'note', text, both, Math.round(performance.now() - began), true);
  };
}

/** Every line held, oldest first. */
export function lines(): Line[] {
  const out: Line[] = [];
  const first = held < KEEP ? 0 : next;
  for (let i = 0; i < held; i += 1) {
    const line = ring[(first + i) % KEEP];
    if (line) out.push(line);
  }
  return out;
}

/** How many fell off the end. */
export function dropped(): number { return lost; }

export function volume(): Volume { return level; }

export function setVolume(next_: Volume): void {
  level = next_;
  try { localStorage.setItem(VOLUME_KEY, next_); } catch { /* remembered for this run only */ }
}

/** The viewer watches; everything else writes. Returns the way to stop. */
export function onLine(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Start again. The viewer's "clear", and what a test uses between cases. */
export function forget(): void {
  ring.fill(undefined);
  next = 0;
  held = 0;
  lost = 0;
}

const pad = (text: string, width: number): string => (text.length >= width ? text : text + ' '.repeat(width - text.length));

function factsText(facts: Facts): string {
  const parts: string[] = [];
  for (const key of Object.keys(facts)) parts.push(`${key}=${facts[key]}`);
  return parts.join(' ');
}

/** One line as it reads. Only ever called on the way to a screen or a file. */
export function lineText(line: Line): string {
  const clock = `${(line.at / 1000).toFixed(2)}s`;
  const mark = line.kind === 'failure' ? '!' : line.kind === 'warning' ? '?' : ' ';
  const body = line.facts ? `${line.text}  ${factsText(line.facts)}` : line.text;
  const took = line.ms === undefined ? '' : `  took ${line.ms}ms`;
  return `${pad(clock, 8)}${mark} ${pad(line.area, 8)} ${body}${took}`;
}

/** The whole log, as text to read or as one json object a line to parse. */
export function format(as: 'text' | 'ndjson' = 'text', some: Line[] = lines()): string {
  if (as === 'ndjson') return some.map((line) => JSON.stringify(line)).join('\n');
  const head = [
    `satr log — ${new Date(startedAt).toISOString()}`,
    `${some.length} lines${lost ? `, ${lost} older ones dropped` : ''}, volume ${level}`,
    '',
  ];
  return head.concat(some.map(lineText)).join('\n');
}
