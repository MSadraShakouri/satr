/**
 * Taking a file from the device's own storage into the vault, in the browser.
 *
 * The app in the APK has no need of this: Android hands it files through the
 * open-with intent (src/openWith.ts), and the vault it browses is shared
 * storage itself. In a browser there is no such thing — a page cannot see the
 * disk, and the only way in is the one the person opens themselves, which is
 * what a file input is. So this exists on the web and nowhere else.
 */
import { Capacitor } from '@capacitor/core';

/** The browser only, by design: never offered in the app. */
export const canImportFiles = (): boolean => !Capacitor.isNativePlatform();

/** The device's own file chooser. Resolves with nothing if it is dismissed. */
export function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    // Off-screen rather than hidden: a display:none input is not allowed to
    // be opened by script in every browser.
    input.style.position = 'fixed';
    input.style.insetInlineStart = '-9999px';
    input.style.opacity = '0';
    let settled = false;
    const done = (files: File[]): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(input.files ? [...input.files] : []));
    // Dismissing the chooser: newer browsers say so, and the rest never
    // resolve, which is harmless — nothing is waiting on it but the caller.
    input.addEventListener('cancel', () => done([]));
    document.body.append(input);
    input.click();
  });
}

/** The name a picked file should be written under, split so a clash can be
 *  numbered the way a second "Untitled" is: "notes.tar.gz" keeps ".gz" as its
 *  extension, which is what the vault's own naming does with a dotted name. */
export function nameParts(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}
