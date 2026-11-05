// Which way up a document is read.
//
// "Have a settings for pdf to auto rotate and stuff by user choice (override
// system rotation option too)." A scan of a wide page is unreadable in a
// portrait column, and the phone's own Auto-rotate is usually off — so the
// app has to be able to turn without it, and only while a document is open:
// a note is written with the keyboard up and has no business rotating
// because the phone was put down sideways.
//
// The Android constants, which is where the "override" lives (the attribute
// table in the activity docs):
//   unspecified      defer to the system; with Auto-rotate off that means
//                    whatever the phone is locked to.
//   sensor           follows the sensor "even if the user locked
//                    sensor-based rotation" — the override, in one word.
//                    Three orientations; upside-down portrait is not one of
//                    them, which is the conventional phone feel.
//   portrait         locked upright.
//   sensorLandscape  landscape either way round, also ignoring the lock, so
//                    a reader can turn the phone whichever way is
//                    comfortable.
// `fullUser` is the one that looks right and is not: with the rotation lock
// on it behaves exactly like `user`, which is to say it obeys the lock.
import { Capacitor, registerPlugin } from '@capacitor/core';

export type Rotation = 'system' | 'free' | 'portrait' | 'landscape';

export const ROTATIONS: [Rotation, string][] = [
  ['system', 'Follow the phone'],
  ['free', 'Turn freely, even if the phone is locked'],
  ['portrait', 'Stay upright'],
  ['landscape', 'Stay sideways'],
];

interface OrientationPlugin {
  setOrientation(options: { mode: Rotation }): Promise<void>;
}
const SystemBars = registerPlugin<OrientationPlugin>('SatrSystemBars');

/**
 * What the screen should be told, given the setting and what is open.
 *
 * The setting only has a say while a document is on screen; everything else
 * follows the phone. Kept apart from the call that applies it so the rule
 * can be read, and tested, without a phone in the room.
 */
export function wantedRotation(setting: Rotation, documentOpen: boolean): Rotation {
  return documentOpen ? setting : 'system';
}

let applied: Rotation | null = null;

/** Ask the screen for this, once per change. */
export function applyRotation(setting: Rotation, documentOpen: boolean): Rotation {
  const want = wantedRotation(setting, documentOpen);
  // Written down whether or not anything can act on it: it is how the rule
  // is read back in a test, and in the inspector.
  document.body.dataset.rotation = want;
  if (want === applied) return want;
  applied = want;
  if (Capacitor.isNativePlatform()) void SystemBars.setOrientation({ mode: want }).catch(() => undefined);
  else void applyOnWeb(want);
  return want;
}

// ---- The same setting, in a browser ----
//
// Reported: "the free doesn't work in web, neither does sideways work when
// my phone is vertical". Both were true, and only one of them is fixable
// here.
//
// A page can ask for an orientation, but Chrome on Android honours the ask
// only while the document is fullscreen or installed as an app -- in a
// plain tab the promise simply rejects, which is what he met. So the ask is
// made, and if it is refused the app goes fullscreen (the thing a video
// player does to turn sideways) and asks again. Fullscreen needs a tap
// behind it, so an ask made at launch is held until the next one.
//
// "Turn freely" is the one that cannot be done in a browser: `any` lets the
// page off its own lock, it does not get the page past the phone's. That
// needs the installed app and SCREEN_ORIENTATION_SENSOR.

interface Lockable { lock?(orientation: string): Promise<void>; unlock?(): void }

const screenOrientation = (): Lockable | undefined =>
  (window.screen as unknown as { orientation?: Lockable }).orientation;

let wentFullscreen = false;
let retryArmed = false;
// A browser that refused a lock in a plain tab will refuse the next one
// too; there is no sense asking again on every tap just to be told no.
let fullscreenFirst = false;

async function applyOnWeb(want: Rotation): Promise<void> {
  const orientation = screenOrientation();
  if (!orientation?.lock) return;
  if (want === 'system' || want === 'free') {
    try { orientation.unlock?.(); } catch { /* a browser that will not be told */ }
    await leaveFullscreen();
    return;
  }
  if (!fullscreenFirst) {
    if (await ask(orientation, want)) return;
    fullscreenFirst = true;
  }
  if (!(await enterFullscreen())) return armRetry(want);
  if (!(await ask(orientation, want))) armRetry(want);
}

async function ask(orientation: Lockable, want: Rotation): Promise<boolean> {
  try {
    await orientation.lock?.(want === 'landscape' ? 'landscape' : 'portrait');
    return true;
  } catch {
    return false;
  }
}

async function enterFullscreen(): Promise<boolean> {
  if (document.fullscreenElement) return true;
  // requestFullscreen resolves before the lock may be asked for, and it is
  // refused outright without a recent tap behind it.
  const activation = (navigator as unknown as { userActivation?: { isActive: boolean } }).userActivation;
  if (activation && !activation.isActive) return false;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    wentFullscreen = true;
    return true;
  } catch {
    return false;
  }
}

async function leaveFullscreen(): Promise<void> {
  if (!wentFullscreen) return; // it was his fullscreen, not ours
  wentFullscreen = false;
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
}

/** The next tap is the one that can go fullscreen; try again on it. */
function armRetry(want: Rotation): void {
  if (retryArmed) return;
  retryArmed = true;
  window.addEventListener('pointerup', () => {
    retryArmed = false;
    // Only if it is still wanted: the reader may have left the document.
    if (document.body.dataset.rotation === want) void applyOnWeb(want);
  }, { once: true });
}
