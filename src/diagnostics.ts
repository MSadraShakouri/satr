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
      .filter((exit) => !(exit.said ?? '').includes('ISOLATED NOT NEEDED'));
    if (!exits.length) {
      log.loud('native', 'the system remembers no recent exit');
      return;
    }
    for (const exit of exits) {
      const facts: Facts = { secondsAgo: ago(exit.at), status: exit.status };
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
