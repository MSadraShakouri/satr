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
// Everything is written down. Nothing is refused at the door.
//
// It used to be: a dial called Recording decided how much was kept, so a line
// nobody had turned on was gone for good -- and the run you want the detail
// of is always the one that already happened. The dial is now a reading
// glass: DETAIL (quiet, normal, verbose) decides what is *shown* and what an
// export carries, and every line is recorded whatever it says. KIND is note,
// warning or failure; AREA tags where a line came from, and is the filter
// that actually gets used ("pdf only").
//
// What bounds it is size, not permission: a megabyte in memory and ten on
// disk (src/logStore.ts), oldest first out. A bound in bytes is the honest
// one -- it is what a phone and a share sheet actually care about -- and it
// does not have to guess in advance which lines will turn out to matter.
//
// It must not become the slowness it was built to find, so: nothing is turned
// into text when it is written -- a line is kept as its pieces and formatted
// only when it is read -- the clock is performance.now() rather than a Date
// object per line, and a line's size is estimated from the lengths it already
// knows rather than by building the string to measure it.

/** Where a line came from. The filter the viewer offers as chips. */
export type Area = 'launch' | 'app' | 'file' | 'pdf' | 'tabs' | 'search' | 'storage' | 'native';

/** How loud a line is. A failure is always shown. */
export type Kind = 'note' | 'warning' | 'failure';

/** How much is **shown**, not how much is kept: all of it is kept.
 *  quiet: failures and warnings only. normal: everything but the verbose
 *  extras. verbose: all of it, which is also all there is. */
export type Detail = 'quiet' | 'normal' | 'verbose';

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
  /** A verbose extra: recorded always, shown only on verbose. */
  loud?: boolean;
}

/** Bytes of log held in memory, as the exported text would measure. Which
 *  of these two bounds bites depends on the lines: ordinary ones run about
 *  eighty bytes, so five thousand of them is nearer four hundred kilobytes
 *  and the count is what stops it; a run that writes fat lines hits the
 *  megabyte first. Either way the ring is small enough that it can never be
 *  the reason a phone runs out of room -- which, on a phone that is being
 *  killed for memory, is not a hypothetical. */
export const KEEP_BYTES = 1_000_000;
/** A hard ceiling on the count as well, so a flood of tiny lines cannot make
 *  the ring itself the expensive thing. */
export const KEEP_LINES = 5000;

/** When this run began, in wall-clock terms, so an exported log can say what
 *  time of day it was without every line carrying a date. */
export const startedAt = Date.now();

const DETAIL_KEY = 'satr:log:detail';
/** What the dial was called when it decided how much was recorded. Read once,
 *  so a reader who had set it to quiet does not find the screen empty. */
const OLD_VOLUME_KEY = 'satr:log:volume';

/** A ring rather than an array that shifts: once it is full, every single
 *  line would otherwise move five thousand pointers to make room. `first`
 *  moves as well as `next`, because lines leave by size as well as by count. */
const ring: (Line | undefined)[] = new Array<Line | undefined>(KEEP_LINES);
let first = 0;
let next = 0;
let held = 0;
let bytes = 0;
/** Lines dropped off the end, so the viewer can say so rather than quietly
 *  showing a log with a hole at the top. */
let lost = 0;

let shownAt: Detail = 'normal';
try {
  const saved = localStorage.getItem(DETAIL_KEY) ?? localStorage.getItem(OLD_VOLUME_KEY);
  if (saved === 'quiet' || saved === 'normal' || saved === 'verbose') shownAt = saved;
} catch { /* a browser with no storage still logs, it just forgets the choice */ }

type Listener = (line: Line) => void;
const listeners = new Set<Listener>();

/** What a line will cost, near enough, without building the text to find
 *  out: the characters it is made of, plus the clock, area and padding that
 *  every line carries.
 *
 *  A fact's value is charged by its length when it is a string and eight
 *  bytes otherwise. Charging every value a flat dozen was wrong in exactly
 *  the case the bound exists for -- a line carrying a five-kilobyte string
 *  weighed the same as one carrying a page name, so a run of fat lines
 *  sailed past the budget while the counter said it was fine. Reading a
 *  string's length is free; building the text is what we are avoiding. */
export function weigh(line: Line): number {
  let n = 48 + line.text.length + line.area.length;
  if (line.facts) {
    for (const key in line.facts) {
      const value = line.facts[key];
      n += key.length + 6 + (typeof value === 'string' ? value.length : 8);
    }
  }
  return n;
}

/** Everything is kept. This exists for the one caller that would have to do
 *  real work to build its facts: nothing is refused, so it is always true,
 *  and it stays as the honest answer to "will this be recorded?" */
export function keeps(): boolean { return true; }

/** Whether a line is shown at a given detail. The dial acts here, on the way
 *  out, and nowhere else. */
export function shows(line: Line, at: Detail = shownAt): boolean {
  if (line.kind === 'failure' || line.kind === 'warning') return true;
  if (at === 'quiet') return false;
  return !line.loud || at === 'verbose';
}

function put(area: Area, kind: Kind, text: string, facts?: Facts, ms?: number, loud?: boolean): void {
  const line: Line = { at: Math.round(performance.now()), area, kind, text };
  if (facts) line.facts = facts;
  if (ms !== undefined) line.ms = ms;
  if (loud) line.loud = true;
  if (ring[next]) { // the ring is full: the oldest line is the one being written over
    bytes -= weigh(ring[next]!);
    lost += 1;
    first = (first + 1) % KEEP_LINES;
  }
  ring[next] = line;
  next = (next + 1) % KEEP_LINES;
  bytes += weigh(line);
  if (held < KEEP_LINES) held += 1;
  // And by size, which is the bound that matters on a phone: the oldest go
  // until what is held fits in the budget again.
  while (bytes > KEEP_BYTES && held > 1) {
    const going = ring[first];
    if (going) bytes -= weigh(going);
    ring[first] = undefined;
    first = (first + 1) % KEEP_LINES;
    held -= 1;
    lost += 1;
  }
  for (const listener of listeners) listener(line);
}

/** Something happened. */
export function note(area: Area, text: string, facts?: Facts): void { put(area, 'note', text, facts); }
/** Something happened that should not have, but the app carried on. */
export function warn(area: Area, text: string, facts?: Facts): void { put(area, 'warning', text, facts); }
/** Something did not work. Kept whatever the volume. */
export function fail(area: Area, text: string, facts?: Facts): void { put(area, 'failure', text, facts); }
/** Detail that is only wanted during a hunt. Recorded like everything else,
 *  and shown when the dial is on verbose. */
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

/** The same, for a line that is only shown during a hunt. */
export function timeLoud(area: Area, text: string, facts?: Facts): (more?: Facts) => void {
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
  for (let i = 0; i < held; i += 1) {
    const line = ring[(first + i) % KEEP_LINES];
    if (line) out.push(line);
  }
  return out;
}

/** How many fell off the end. */
export function dropped(): number { return lost; }

/** What the lines held weigh, as the exported text would measure them. */
export function weight(): number { return bytes; }

export function detail(): Detail { return shownAt; }

export function setDetail(to: Detail): void {
  shownAt = to;
  try { localStorage.setItem(DETAIL_KEY, to); } catch { /* remembered for this run only */ }
}

/** The viewer watches; everything else writes. Returns the way to stop. */
export function onLine(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Start again. The viewer's "clear", and what a test uses between cases. */
export function forget(): void {
  ring.fill(undefined);
  first = 0;
  next = 0;
  held = 0;
  bytes = 0;
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
    `${some.length} lines${lost ? `, ${lost} older ones dropped` : ''}, showing ${shownAt} of everything recorded`,
    '',
  ];
  return head.concat(some.map(lineText)).join('\n');
}
