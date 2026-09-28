// The Android app's own pieces (nothing here runs in a browser):
// - File access: notes are plain files in the phone's folders, which needs
//   "All files access" on Android 11+ (the classic storage permission
//   before). Until it's granted, a full-screen page explains and asks;
//   coming back from the system's settings page re-checks.
// - Edge to edge, as Obsidian: the page runs behind the transparent status
//   and navigation bars (SystemBarsPlugin.java). Their sizes arrive as
//   --safe-area-inset-* CSS variables, the bar icons follow the theme, and
//   the status bar hides with the other bars on scroll (src/main.ts).
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface StorageState { granted: boolean; sdk: number }
interface SatrStoragePlugin {
  status(): Promise<StorageState>;
  request(): Promise<StorageState>;
}
const SatrStorage = registerPlugin<SatrStoragePlugin>('SatrStorage');

interface Insets { top?: number; right?: number; bottom?: number; left?: number; keyboard?: number; fontScale?: number }
interface SystemBarsPlugin {
  get(): Promise<Insets>;
  setStyle(options: { dark: boolean }): Promise<void>;
  hide(): Promise<void>;
  show(): Promise<void>;
  addListener(event: 'insets', listener: (insets: Insets) => void): Promise<{ remove(): Promise<void> }>;
}
const SystemBars = registerPlugin<SystemBarsPlugin>('SatrSystemBars');

export const isNative = (): boolean => Capacitor.isNativePlatform();

/** The system bars, in the app only (the status bar hides on scroll). */
export function systemBars(): Pick<SystemBarsPlugin, 'hide' | 'show'> | undefined {
  return isNative() ? SystemBars : undefined;
}

/** Android's current system font scale, used only to normalize PDF pagination. */
export async function getSystemFontScale(): Promise<number> {
  if (!isNative()) return 1;
  try {
    const scale = (await SystemBars.get()).fontScale;
    return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
  } catch {
    return 1;
  }
}

let lastSystemFontScale = 1;
function applyInsets(insets: Insets): void {
  const root = document.documentElement.style;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const value = insets[side];
    if (typeof value === 'number') root.setProperty(`--safe-area-inset-${side}`, `${Math.round(value * 10) / 10}px`);
  }
  if (typeof insets.fontScale === 'number' && Number.isFinite(insets.fontScale) && insets.fontScale > 0
    && Math.abs(insets.fontScale - lastSystemFontScale) > 0.001) {
    const previous = lastSystemFontScale;
    lastSystemFontScale = insets.fontScale;
    window.dispatchEvent(new CustomEvent('satr:font-scale-change', { detail: { scale: insets.fontScale, previous } }));
  }
}

/**
 * Edge to edge: the bars' real sizes as CSS variables (now and whenever they
 * change: rotation, keyboard, gesture / button navigation), and bar icons
 * that follow the theme.
 */
export function setupSystemBars(): void {
  if (!isNative()) return;
  void SystemBars.addListener('insets', applyInsets).catch(() => undefined);
  void SystemBars.get().then(applyInsets).catch(() => undefined);
  const style = (): void => {
    const dark = document.documentElement.classList.contains('theme-dark');
    void SystemBars.setStyle({ dark }).catch(() => undefined);
  };
  style();
  new MutationObserver(style).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>'; // lucide folder

/**
 * Resolves once Satr may read and write the phone's files: at once when
 * access is already there (or in a browser), otherwise after the user grants
 * it from the page this shows.
 */
export async function ensureFileAccess(): Promise<void> {
  if (!isNative()) return;
  let state: StorageState;
  try { state = await SatrStorage.status(); } catch { return; } // an older APK without the plugin
  if (state.granted) return;

  await new Promise<void>((resolve) => {
    const page = document.createElement('div');
    page.className = 'file-access-screen';
    page.dataset.ignoreSwipe = '';
    const settingName = state.sdk >= 30 ? '“Allow access to manage all files”' : 'storage access';
    page.innerHTML = `
      <div class="file-access-container">
        <div class="file-access-icon">${ICON}</div>
        <div class="file-access-title">Your notes, your folders</div>
        <p class="file-access-text">Satr keeps every note as a plain Markdown file in your phone's folders, where other apps and sync tools can reach it too. For that, Android asks you to turn on ${settingName} for Satr.</p>
        <p class="file-access-text mod-muted">Satr only touches the notes and folders you work with. It never adds files of its own to your folders.</p>
        <button type="button" class="mod-cta file-access-button">Allow access</button>
        <div class="file-access-hint" role="status"></div>
      </div>`;
    const hint = page.querySelector<HTMLElement>('.file-access-hint')!;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      void listener.then((handle) => handle.remove());
      page.remove();
      resolve();
    };
    const check = async (): Promise<void> => {
      try { if ((await SatrStorage.status()).granted) finish(); } catch { /* keep asking */ }
    };
    page.querySelector('.file-access-button')!.addEventListener('click', async () => {
      hint.textContent = '';
      try {
        const result = await SatrStorage.request();
        if (result.granted) { finish(); return; }
        hint.textContent = 'Satr still can’t reach your files. Turn the switch on for Satr, then come back.';
      } catch (error) {
        hint.textContent = error instanceof Error ? error.message : String(error);
      }
    });
    // Granted from the settings app directly, or the result got lost: check on return.
    const listener = CapacitorApp.addListener('resume', () => { void check(); });
    document.body.appendChild(page);
  });
}
