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

interface SatrDiagnosticsPlugin {
  lastExits(options: { limit: number }): Promise<{ supported: boolean; lowMemoryReported?: boolean; exits: Exit[] }>;
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
