// What Android says about the way the app stopped last time.
//
// The rung above the heartbeat. The heartbeat tells every version *that* a
// run ended without a goodbye and *when*; this tells *why*, on the phones
// that can say (Android 11 and up). It is asked once at launch, after the
// heartbeat has already had its say, so the log reads as a fact followed by
// a reason -- and when the reason is not available the fact still stands.
//
// Nothing here throws into the launch. A plugin that is not there, a phone
// that refuses, a browser: all of them mean one line fewer in the log.
import { Capacitor, registerPlugin } from '@capacitor/core';
import * as log from './log';
import type { Facts } from './log';
import { memoryFacts } from './vitals';

export interface Exit {
  reason: string;
  code: number;
  /** Wall clock, milliseconds. */
  at: number;
  status: number;
  importance: number;
  rss: number;
  pss: number;
  said?: string;
}

export interface LastResume {
  happened: boolean;
  /** Wall clock, milliseconds. */
  at?: number;
  /** How long the page took to answer a question put to it directly, or -1. */
  answerMs?: number;
  /** What it said its visibilityState was, when it answered. */
  said?: string;
  laterMs?: number;
  laterSaid?: string;
  /** Animation frames run in the second and a half after, or -1. */
  frames?: number;
  /** How many times that run was resumed at all. */
  resumes?: number;
}

interface SatrDiagnosticsPlugin {
  lastExits(options: { limit: number }): Promise<{ supported: boolean; lowMemoryReported?: boolean; exits: Exit[] }>;
  lastResume(): Promise<LastResume>;
}

const SatrDiagnostics = registerPlugin<SatrDiagnosticsPlugin>('SatrDiagnostics');

/** Exits older than this are history, not an explanation of this launch. */
const RECENT_MS = 6 * 60 * 60 * 1000;

/** The newest exit already reported, so the same death is not announced at
 *  every launch for the next six hours. In his log the same five lines came
 *  back run after run, which made a log of twenty launches read as if the
 *  phone had killed the app a hundred times. */
const TOLD_KEY = 'satr:exitsToldAt';

function told(): number {
  try { return Number(localStorage.getItem(TOLD_KEY)) || 0; } catch { return 0; }
}

function remember(at: number): void {
  try { localStorage.setItem(TOLD_KEY, String(at)); } catch { /* a log line is not worth an exception */ }
}

const ago = (at: number): number => Math.round((Date.now() - at) / 1000);

/** Ask, and say what comes back. Resolves either way. */
export async function tellWhyItDied(limit = 5): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const answer = await SatrDiagnostics.lastExits({ limit });
    if (!answer?.supported) {
      // Said quietly and once: on an older phone this is the normal state of
      // affairs, not a fault, and the heartbeat has already done the work.
      log.loud('native', 'this Android cannot say why a run ended');
      return;
    }
    const exits = (answer.exits ?? [])
      .filter((exit) => Date.now() - exit.at < RECENT_MS)
      // An isolated process ending is not the app ending. Android reports
      // the WebView's own sandboxed renderer alongside the real exits, and
      // on the author's phone two of the five lines were that -- noise that
      // reads exactly like a death notice for the app.
      .filter((exit) => !(exit.said ?? '').includes('ISOLATED NOT NEEDED'))
      // And an exit this app has already announced is not news. Android
      // keeps its list for days; without this the same death is reported at
      // every launch until it ages out, which is what filled a third of his
      // log with lines about a run that ended yesterday.
      .filter((exit) => exit.at > told());
    if (!exits.length) {
      log.loud('native', 'nothing new in why the last runs ended');
      return;
    }
    remember(Math.max(...exits.map((exit) => exit.at)));

    // Several exits that say the same thing are one line with a count. Five
    // identical "closed by you" lines are not five pieces of information,
    // and the one line that is different -- a low-memory kill among them --
    // is what a reader is scanning for.
    const groups = new Map<string, Exit[]>();
    for (const exit of exits) {
      const key = `${exit.reason}\u0000${exit.said ?? ''}`;
      const group = groups.get(key);
      if (group) group.push(exit);
      else groups.set(key, [exit]);
    }
    for (const group of groups.values()) {
      const exit = group[0]; // the newest: Android hands them back newest first
      const facts: Facts = { secondsAgo: ago(exit.at), status: exit.status };
      if (group.length > 1) facts.times = group.length;
      if (exit.rss) facts.rssMb = Math.round(exit.rss / 1024);
      if (exit.said) facts.said = exit.said;
      // A phone that cannot tell a low-memory kill from a plain signal says
      // so, rather than having the guess made for it.
      if (exit.code === 9 /* SIGNALED */ && answer.lowMemoryReported === false) facts.lowMemoryUnreported = true;
      const bad = ['crash', 'native crash', 'not responding', 'low memory', 'could not start'].includes(exit.reason);
      (bad ? log.warn : log.note)('native', `the system says the last run ended: ${exit.reason}`, facts);
    }
  } catch (error) {
    log.loud('native', 'could not ask why the last run ended', { why: String(error) });
  }
}

/**
 * What the page said the last time the app was handed back, in the run
 * before this one.
 *
 * The app's own log cannot report a frozen resume: the reader ends it by
 * throwing the app out of recents, and the lines die unsaved. So the
 * question is put from Java, through the WebView rather than through any
 * listener the page has to be well enough to run, and the answer is written
 * down as it arrives. This reads it out one launch later.
 *
 * Three answers matter, and they are three different bugs:
 *   - answered, said visible      -- that resume was fine
 *   - answered, said hidden       -- the page was handed back still hidden,
 *                                    and never corrected: it cannot draw
 *   - never answered              -- JavaScript itself was not running
 */
export async function tellWhatTheLastResumeSaid(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const last = await SatrDiagnostics.lastResume();
    if (!last?.happened) return;
    const facts: Facts = {};
    if (last.at) facts.secondsAgo = ago(last.at);
    if (last.resumes) facts.resumes = last.resumes;
    const answered = (last.answerMs ?? -1) >= 0;
    if (answered) {
      facts.answeredMs = last.answerMs!;
      facts.said = last.said ?? '';
      if ((last.laterMs ?? -1) >= 0) {
        facts.andThen = last.laterSaid ?? '';
        facts.frames = last.frames ?? -1;
      } else {
        facts.andThen = 'no answer';
      }
    }
    // A page that never answered is the loud case: the one where nothing in
    // the app's own log could ever have said anything at all.
    (answered ? log.note : log.warn)(
      'native',
      answered ? 'the last time it came back, the page answered' : 'the last time it came back, the page never answered',
      facts,
    );
  } catch (error) {
    log.loud('native', 'could not ask what the last resume said', { why: String(error) });
  }
}


/**
 * Who is holding the main thread, and for how long.
 *
 * Everything in this log so far is something the app chose to time: an
 * open, a read, a resume. What it has never been able to say is "the
 * thread was busy for four hundred milliseconds here and nothing had
 * asked it to be" -- which is the shape of every complaint about
 * smoothness, because a frame that does not land is a frame somebody
 * else's work was standing on.
 *
 * The browser already measures this. A long task is any turn of the event
 * loop over 50 ms; at that threshold a scroll produces dozens and the log
 * becomes noise, so only the ones a person can feel are kept, and only so
 * many of them per run.
 *
 * The useful half is `whileTouching`: a busy thread between frames is a
 * stutter, and a busy thread under a finger is the app not answering.
 */
const FELT_MS = 120;
const MOST_LONG_TASKS = 60;

export function watchTheThread(): void {
  if (typeof PerformanceObserver !== 'function') return;
  const kinds = (PerformanceObserver as unknown as { supportedEntryTypes?: string[] }).supportedEntryTypes;
  if (kinds && !kinds.includes('longtask')) return;
  let touching = false;
  const down = (): void => { touching = true; };
  const up = (): void => { touching = false; };
  addEventListener('pointerdown', down, { passive: true, capture: true });
  addEventListener('pointerup', up, { passive: true, capture: true });
  addEventListener('pointercancel', up, { passive: true, capture: true });
  let said = 0;
  let worst = 0;
  let missed = 0;
  try {
    const watcher = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const ms = Math.round(entry.duration);
        if (ms < FELT_MS) continue;
        worst = Math.max(worst, ms);
        if (said >= MOST_LONG_TASKS) { missed += 1; continue; }
        said += 1;
        // The attribution names the frame the work was in, which for this
        // app is always the page itself; what it is worth keeping is the
        // container, which tells a script apart from work in an iframe.
        // Kept short: the line beside it in the log is the real answer to
        // what was running.
        const blame = (entry as PerformanceEntry & { attribution?: { name?: string; containerType?: string }[] })
          .attribution?.[0];
        log.note('app', 'the thread was busy', {
          ms,
          whileTouching: touching,
          what: blame?.containerType ?? blame?.name ?? 'script',
          // The observer runs after the task. These are current readings,
          // not a claim to have sampled memory inside the blocked thread.
          sampleAfterMs: Math.max(0, Math.round(performance.now() - (entry.startTime + entry.duration))),
          ...memoryFacts(),
          ...(said === MOST_LONG_TASKS ? { andNoMore: true } : {}),
        });
      }
    });
    watcher.observe({ entryTypes: ['longtask'] });
  } catch { /* an older WebView without the entry type: nothing to watch */ }
  // What the run looked like as a whole, said once on the way out: a run
  // with eighty long tasks and a worst of 900 ms is a different complaint
  // from a run with two.
  addEventListener('pagehide', () => {
    if (!said && !missed) return;
    log.note('app', 'long tasks this run', { felt: said + missed, worstMs: worst, kept: said });
  }, { capture: true });
}

/** Resource timings are network/cache time, not JavaScript parse or execution
 *  time. Keep only same-origin script files finished before DOMContentLoaded;
 *  URLs, query strings and vault paths do not belong in this diagnostic. */
export function reportLaunchScripts(entries: readonly PerformanceResourceTiming[], scriptsDone: number): void {
  const scripts = entries.filter((entry) => {
    if (entry.initiatorType !== 'script' && entry.initiatorType !== 'link') return false;
    if (!(entry.responseEnd > 0 && entry.responseEnd <= scriptsDone)) return false;
    try {
      const url = new URL(entry.name, location.href);
      return url.origin === location.origin && /\.m?js$/i.test(url.pathname);
    } catch { return false; }
  }).sort((a, b) => b.duration - a.duration).slice(0, 3);
  for (const entry of scripts) {
    const name = new URL(entry.name, location.href).pathname.split('/').pop() || 'script';
    log.note('launch', 'launch script resource', {
      name, resourceMs: Math.round(entry.duration),
      transferBytes: entry.transferSize, decodedBytes: entry.decodedBodySize,
    });
  }
}
