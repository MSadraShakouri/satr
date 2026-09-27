// Light / dark theme. "Auto" (the default) follows the system setting live,
// and falls back to light when the system doesn't say. The user can pin
// Light or Dark from the drawer; the choice is kept in localStorage.
// style.css keys all colours off .theme-light / .theme-dark on <html>.

export type ThemeChoice = 'auto' | 'light' | 'dark';

const KEY = 'satr:theme';
const ORDER: ThemeChoice[] = ['auto', 'light', 'dark'];
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function stored(): ThemeChoice {
  const value = localStorage.getItem(KEY);
  return value === 'light' || value === 'dark' ? value : 'auto';
}

let choice: ThemeChoice = stored();
const listeners = new Set<(choice: ThemeChoice) => void>();

function apply(): void {
  const dark = choice === 'dark' || (choice === 'auto' && systemDark.matches);
  const root = document.documentElement;
  root.classList.toggle('theme-dark', dark);
  root.classList.toggle('theme-light', !dark);
  // Browser chrome (Android task switcher, address bar) follows the page.
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = dark ? '#000000' : '#ffffff';
}

export function themeChoice(): ThemeChoice {
  return choice;
}

export function setTheme(next: ThemeChoice): void {
  choice = next;
  if (next === 'auto') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, next);
  apply();
  for (const listener of listeners) listener(choice);
}

/** Auto → Light → Dark → Auto. */
export function cycleTheme(): ThemeChoice {
  setTheme(ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]);
  return choice;
}

export function onThemeChange(listener: (choice: ThemeChoice) => void): void {
  listeners.add(listener);
}

systemDark.addEventListener('change', () => {
  if (choice === 'auto') apply();
});
apply();
