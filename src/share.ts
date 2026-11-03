// The share sheet. One call, and the phone offers every app that can take a
// piece of text: a messenger, mail, Drive, Files.
//
// A browser has no such thing -- navigator.share exists but refuses a file on
// most desktops and needs a gesture it cannot always prove it had -- so on the
// web the caller falls back to a download. canShare() answers that question
// before a button is drawn, so the button can be labelled for what it will
// actually do.
import { Capacitor, registerPlugin } from '@capacitor/core';

interface SatrSharePlugin {
  shareText(options: { text: string; name?: string; title?: string; type?: string }): Promise<void>;
}

const SatrShare = registerPlugin<SatrSharePlugin>('SatrShare');

/** True where there is a share sheet to open: the app on a phone. */
export const canShare = (): boolean => Capacitor.isNativePlatform();

/** Hand `text` to the share sheet as a file named `name`. Rejects if the
 *  sheet could not be opened; the caller decides whether that is worth
 *  saying out loud. */
export async function shareText(text: string, name: string, title = 'Share'): Promise<void> {
  await SatrShare.shareText({ text, name, title, type: 'text/plain' });
}
