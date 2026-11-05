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

/** Ask the screen for this, once per change. Nothing happens on the web. */
export function applyRotation(setting: Rotation, documentOpen: boolean): Rotation {
  const want = wantedRotation(setting, documentOpen);
  // Written down whether or not there is a phone to hear it: it is how the
  // rule is read back in a test, and in the inspector.
  document.body.dataset.rotation = want;
  if (want === applied) return want;
  applied = want;
  if (Capacitor.isNativePlatform()) void SystemBars.setOrientation({ mode: want }).catch(() => undefined);
  return want;
}
