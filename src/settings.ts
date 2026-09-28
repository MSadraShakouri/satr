// Settings: a full-screen page in Obsidian's mobile style (grouped rows on
// the secondary background, a back arrow and the title at the top), opened
// from the gear in the left drawer. Saved under satr:settings; the theme is
// kept by src/theme.ts as before.
import { setTheme, themeChoice, type ThemeChoice } from './theme';

export interface Settings {
  fontSize: number;
  lineHeight: number;
  lineNumbers: boolean;
  highlightAll: boolean;
  /** Keyboard toolbar buttons turned off, by command name. */
  hiddenTools: string[];
}
const KEY = 'satr:settings';
const DEFAULTS: Settings = { fontSize: 16, lineHeight: 1.85, lineNumbers: true, highlightAll: true, hiddenTools: [] };

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    const s = { ...DEFAULTS, ...saved };
    s.fontSize = Math.min(24, Math.max(12, Number(s.fontSize) || DEFAULTS.fontSize));
    s.lineHeight = Math.min(2.4, Math.max(1.3, Number(s.lineHeight) || DEFAULTS.lineHeight));
    s.hiddenTools = Array.isArray(s.hiddenTools) ? s.hiddenTools.filter((t) => typeof t === 'string') : [];
    return s;
  } catch { return { ...DEFAULTS }; }
}
function save(settings: Settings): void { localStorage.setItem(KEY, JSON.stringify(settings)); }

export interface SettingsDeps {
  apply(settings: Settings): void;
  /** Keyboard toolbar buttons: command name, label and icon. */
  tools(): { command: string; label: string; icon: string }[];
}

const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const BACK = icon('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>');
const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

let page: HTMLElement | null = null;
export const isSettingsOpen = (): boolean => page !== null;
export function closeSettings(): void {
  const el = page;
  if (!el) return;
  page = null;
  el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], { duration: 200, easing: 'ease-in' }).onfinish = () => el.remove();
  el.style.transform = 'translateX(100%)';
}

export function openSettings(deps: SettingsDeps): void {
  if (page) return;
  const settings = loadSettings();
  const theme = themeChoice();
  const themes: ThemeChoice[] = ['auto', 'light', 'dark'];
  const toggle = (name: string, on: boolean): string =>
    `<div class="checkbox-container${on ? ' is-enabled' : ''}" role="switch" aria-checked="${on}" data-toggle="${name}"><input type="checkbox" tabindex="-1"${on ? ' checked' : ''}></div>`;
  const el = document.createElement('div');
  el.className = 'settings-screen';
  el.dataset.ignoreSwipe = '';
  el.innerHTML = `
    <div class="settings-header">
      <button type="button" class="clickable-icon settings-back" aria-label="Back">${BACK}</button>
      <div class="settings-title">Settings</div>
    </div>
    <div class="settings-scroll">
      <div class="setting-group-title">Appearance</div>
      <div class="setting-group">
        <div class="setting-item mod-column">
          <div class="setting-item-name">Theme</div>
          <div class="segmented-control" role="radiogroup" aria-label="Theme" style="--count: 3; --index: ${themes.indexOf(theme)}">
            <div class="segmented-control-thumb"></div>
            ${themes.map((t) => `<button type="button" class="segmented-control-option" role="radio" data-theme="${t}" aria-checked="${t === theme}">${t[0].toUpperCase()}${t.slice(1)}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="setting-group-title">Editor</div>
      <div class="setting-group">
        <div class="setting-item mod-column">
          <div class="setting-item-row"><div class="setting-item-name">Font size</div><div class="setting-item-value" data-value="fontSize"></div></div>
          <input type="range" class="slider" data-range="fontSize" min="12" max="24" step="1" value="${settings.fontSize}">
        </div>
        <div class="setting-item mod-column">
          <div class="setting-item-row"><div class="setting-item-name">Line spacing</div><div class="setting-item-value" data-value="lineHeight"></div></div>
          <input type="range" class="slider" data-range="lineHeight" min="1.3" max="2.4" step="0.05" value="${settings.lineHeight}">
        </div>
        <div class="setting-item-preview" dir="auto">The quick brown fox jumps over the lazy dog.<br>نوشتن، ساده و روان.</div>
        <div class="setting-item">
          <div class="setting-item-info"><div class="setting-item-name">Line numbers</div></div>
          ${toggle('lineNumbers', settings.lineNumbers)}
        </div>
        <div class="setting-item">
          <div class="setting-item-info"><div class="setting-item-name">Highlight every match</div><div class="setting-item-description">In find, not only the current one</div></div>
          ${toggle('highlightAll', settings.highlightAll)}
        </div>
      </div>
      <div class="setting-group-title">Keyboard toolbar</div>
      <div class="setting-group">
        ${deps.tools().map((t) => `
        <div class="setting-item">
          <div class="setting-item-icon">${t.icon}</div>
          <div class="setting-item-info"><div class="setting-item-name">${escapeHtml(t.label)}</div></div>
          ${toggle(`tool:${t.command}`, !settings.hiddenTools.includes(t.command))}
        </div>`).join('')}
      </div>
      <div class="setting-group-footer">Satr keeps its settings on this device; nothing is written into your folders.</div>
    </div>`;

  const renderValues = (): void => {
    el.querySelector('[data-value="fontSize"]')!.textContent = `${settings.fontSize}px`;
    el.querySelector('[data-value="lineHeight"]')!.textContent = settings.lineHeight.toFixed(2);
    const preview = el.querySelector<HTMLElement>('.setting-item-preview')!;
    preview.style.fontSize = `${settings.fontSize}px`;
    preview.style.lineHeight = String(settings.lineHeight);
  };
  const commit = (): void => { save(settings); deps.apply(settings); renderValues(); };
  renderValues();

  el.addEventListener('input', (event) => {
    const range = (event.target as HTMLElement).closest<HTMLInputElement>('[data-range]');
    if (!range) return;
    if (range.dataset.range === 'fontSize') settings.fontSize = Number(range.value);
    else settings.lineHeight = Math.round(Number(range.value) * 100) / 100;
    commit();
  });
  el.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.settings-back')) { closeSettings(); return; }
    const themeButton = target.closest<HTMLElement>('[data-theme]');
    if (themeButton) {
      const choice = themeButton.dataset.theme as ThemeChoice;
      setTheme(choice);
      const control = themeButton.parentElement!;
      control.style.setProperty('--index', String(themes.indexOf(choice)));
      control.querySelectorAll<HTMLElement>('[data-theme]').forEach((b) => b.setAttribute('aria-checked', String(b === themeButton)));
      return;
    }
    const sw = target.closest<HTMLElement>('[data-toggle]');
    if (!sw) return;
    event.preventDefault();
    const on = !sw.classList.contains('is-enabled');
    sw.classList.toggle('is-enabled', on);
    sw.setAttribute('aria-checked', String(on));
    sw.querySelector('input')!.checked = on;
    const name = sw.dataset.toggle!;
    if (name === 'lineNumbers') settings.lineNumbers = on;
    else if (name === 'highlightAll') settings.highlightAll = on;
    else if (name.startsWith('tool:')) {
      const command = name.slice(5);
      settings.hiddenTools = on ? settings.hiddenTools.filter((c) => c !== command) : [...settings.hiddenTools, command];
    }
    commit();
  });
  document.addEventListener('keydown', function onKey(event) {
    if (!page) { document.removeEventListener('keydown', onKey, true); return; }
    if (event.key === 'Escape') { event.preventDefault(); closeSettings(); }
  }, true);
  document.body.appendChild(el);
  page = el;
  el.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
}
