// Settings: a full-screen page in Obsidian's mobile style (grouped rows on
// the secondary background, a back arrow and the title at the top), opened
// from the gear in the left drawer. Saved under satr:settings; the theme is
// kept by src/theme.ts as before.
import { loadPrintOptions, savePrintOptions, type PrintOptions } from './printOptions';
import { setTheme, themeChoice, type ThemeChoice } from './theme';

export interface Settings {
  fontSize: number;
  lineHeight: number;
  lineNumbers: boolean;
  highlightAll: boolean;
  /** Keyboard toolbar buttons turned off, by command name. */
  hiddenTools: string[];
  /** The ≡ button's quick action: a tap runs it, a long press opens the menu. '' = none. */
  quickAction: QuickAction;
  /** A space after a sign, when the next word starts (src/autoSpace.ts). */
  spaceAfterPunctuation: boolean;
  /** Digits shown inside formulas (preview + PDF only; the note keeps what was typed). */
  mathDigits: 'auto' | 'english' | 'persian';
  /** PDF page numbers, bottom centre. */
  pdfPageNumbers: 'persian' | 'latin' | 'none';
  /** Custom CSS for the PDF, applied after Satr's own. */
  pdfCss: string;
  /** Settings format; 3 = roomier default line spacing. */
  version?: number;
}
export type QuickAction = '' | 'fold' | 'view' | 'pdf' | 'rename' | 'delete' | 'settings';
export const QUICK_ACTIONS: Record<Exclude<QuickAction, ''>, string> = {
  fold: 'Collapse / expand all headings',
  view: 'Reading / editing view',
  pdf: 'Export to PDF',
  rename: 'Rename',
  delete: 'Delete note',
  settings: 'Settings',
};
const KEY = 'satr:settings';
const SETTINGS_VERSION = 3;
const DEFAULTS: Settings = { version: SETTINGS_VERSION, fontSize: 16, lineHeight: 1.85, lineNumbers: true, highlightAll: true, hiddenTools: [], quickAction: '', mathDigits: 'auto', pdfPageNumbers: 'persian', pdfCss: '', spaceAfterPunctuation: true };

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    const s = { ...DEFAULTS, ...saved };
    // Version 2 moved the text to Obsidian's sizes (line height 1.5 instead
    // of 1.85); earlier text settings are reset to the new defaults once.
    if ((Number(saved.version) || 1) < 2) { s.fontSize = DEFAULTS.fontSize; s.lineHeight = DEFAULTS.lineHeight; }
    // Migrate only the old default; keep deliberately chosen spacing.
    if ((Number(saved.version) || 1) < 3 && s.lineHeight === 1.5) s.lineHeight = DEFAULTS.lineHeight;
    s.version = SETTINGS_VERSION;
    s.fontSize = Math.min(24, Math.max(12, Number(s.fontSize) || DEFAULTS.fontSize));
    s.lineHeight = Math.min(2.4, Math.max(1.2, Number(s.lineHeight) || DEFAULTS.lineHeight));
    if (!(s.quickAction in QUICK_ACTIONS)) s.quickAction = '';
    if (!['persian', 'latin', 'none'].includes(s.pdfPageNumbers)) s.pdfPageNumbers = 'persian';
    if (typeof s.pdfCss !== 'string') s.pdfCss = '';
    s.hiddenTools = Array.isArray(s.hiddenTools) ? s.hiddenTools.filter((t) => typeof t === 'string') : [];
    return s;
  } catch { return { ...DEFAULTS }; }
}
function save(settings: Settings): void { localStorage.setItem(KEY, JSON.stringify(settings)); }

export interface SettingsDeps {
  /** PDF layout preferences belong to the file open when Settings is opened. */
  notePath?: string;
  noteName?: string;
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
  const notePath = deps.notePath;
  const printOptions = loadPrintOptions(notePath ?? '');
  const noteName = deps.noteName || notePath?.split('/').pop() || '';
  const pdfDisabled = notePath ? '' : ' disabled';
  const theme = themeChoice();
  const themes: ThemeChoice[] = ['auto', 'light', 'dark'];
  const pageNumbers: Settings['pdfPageNumbers'][] = ['persian', 'latin', 'none'];
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
          <input type="range" class="slider" data-range="lineHeight" min="1.2" max="2.4" step="0.05" value="${settings.lineHeight}">
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
        <div class="setting-item">
          <div class="setting-item-info"><div class="setting-item-name">Space after a sign</div><div class="setting-item-description">Typing , . ! ? : ; or ، ؟ ؛ and then the next word puts one space in between — what Android's keyboards call auto-space. The space never lands in a number (3.14), a web address (example.com, https://…) or code.</div></div>
          ${toggle('spaceAfterPunctuation', settings.spaceAfterPunctuation)}
        </div>
        <div class="setting-item">
          <div class="setting-item-info"><div class="setting-item-name">Math digits</div><div class="setting-item-description">Every digit in a formula, in the preview and the PDF. The note keeps the digits you typed.</div></div>
          <select class="dropdown" data-select="mathDigits">
            <option value="auto"${settings.mathDigits === 'auto' ? ' selected' : ''}>As typed</option>
            <option value="english"${settings.mathDigits === 'english' ? ' selected' : ''}>English</option>
            <option value="persian"${settings.mathDigits === 'persian' ? ' selected' : ''}>Persian</option>
          </select>
        </div>
      </div>
      <div class="setting-group-title">Navigation bar</div>
      <div class="setting-group">
        <div class="setting-item">
          <div class="setting-item-info"><div class="setting-item-name">Menu button</div><div class="setting-item-description">What tapping ≡ does. With a quick action, a long press still opens the menu.</div></div>
          <select class="dropdown" data-select="quickAction">
            <option value=""${settings.quickAction === '' ? ' selected' : ''}>Open the menu</option>
            ${(Object.keys(QUICK_ACTIONS) as Array<keyof typeof QUICK_ACTIONS>).map((key) => `<option value="${key}"${settings.quickAction === key ? ' selected' : ''}>${escapeHtml(QUICK_ACTIONS[key])}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="setting-group-title">PDF export</div>
      <div class="setting-group">
        <div class="setting-item mod-column">
          <div class="setting-item-info"><div class="setting-item-name">File layout${notePath ? ` — ${escapeHtml(noteName)}` : ''}</div><div class="setting-item-description">${notePath ? 'Layout, reading order and equation alignment are remembered for this file on this device. Page numbers and custom CSS below apply to all files.' : 'Open a file to change its PDF layout. Page numbers and custom CSS below apply to all files.'}</div></div>
        </div>
        <div class="setting-item mod-column">
          <div class="setting-item-info"><label class="setting-item-name" for="pdf-layout">Layout</label><div class="setting-item-description">Two columns use A4, 1-inch outer margins and an 8 mm gap, overriding custom page geometry.</div></div>
          <select id="pdf-layout" class="dropdown" data-pdf-option="columns"${pdfDisabled}>
            <option value="1"${printOptions.columns === 1 ? ' selected' : ''}>One column</option>
            <option value="2"${printOptions.columns === 2 ? ' selected' : ''}>Two columns (A4)</option>
          </select>
        </div>
        <div class="setting-item mod-column">
          <div class="setting-item-info"><label class="setting-item-name" for="pdf-direction">Reading order</label><div class="setting-item-description">Auto follows the majority of this file’s prose letters, ignoring math and code.</div></div>
          <select id="pdf-direction" class="dropdown" data-pdf-option="direction"${pdfDisabled}>
            <option value="auto"${printOptions.direction === 'auto' ? ' selected' : ''}>Auto — from the file’s prose</option>
            <option value="ltr"${printOptions.direction === 'ltr' ? ' selected' : ''}>Left to right</option>
            <option value="rtl"${printOptions.direction === 'rtl' ? ' selected' : ''}>Right to left</option>
          </select>
        </div>
        <div class="setting-item mod-column">
          <div class="setting-item-info"><label class="setting-item-name" for="pdf-math-align">Display equations</label><div class="setting-item-description">The reading edge is left for LTR files and right for RTL. Equations themselves always stay LTR.</div></div>
          <select id="pdf-math-align" class="dropdown" data-pdf-option="mathAlign"${pdfDisabled}>
            <option value="center"${printOptions.mathAlign === 'center' ? ' selected' : ''}>Centred</option>
            <option value="start"${printOptions.mathAlign === 'start' ? ' selected' : ''}>At the reading edge</option>
          </select>
        </div>
        <div class="setting-item mod-column">
          <div class="setting-item-name">Page numbers</div>
          <div class="segmented-control" role="radiogroup" aria-label="Page numbers" style="--count: 3; --index: ${pageNumbers.indexOf(settings.pdfPageNumbers)}">
            <div class="segmented-control-thumb"></div>
            ${pageNumbers.map((p) => `<button type="button" class="segmented-control-option" role="radio" data-page-numbers="${p}" aria-checked="${p === settings.pdfPageNumbers}">${{ persian: '۱ ۲ ۳', latin: '1 2 3', none: 'None' }[p]}</button>`).join('')}
          </div>
        </div>
        <div class="setting-item mod-column">
          <div class="setting-item-info"><div class="setting-item-name">Custom CSS</div><div class="setting-item-description">Applied after Satr's own PDF style; file layout and equation alignment take precedence. For example: <code>h1 { color: #1976d2; }</code></div></div>
          <textarea class="setting-textarea" data-text="pdfCss" dir="ltr" spellcheck="false" autocomplete="off" autocapitalize="off" rows="6" placeholder="p { text-align: justify; }">${escapeHtml(settings.pdfCss)}</textarea>
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
    // Honest: the note's size in the sheet's own unit, so the phone's font
    // scale (and the browser's default size) is in this sample too.
    preview.style.fontSize = `${settings.fontSize / 16}rem`;
    preview.style.lineHeight = String(settings.lineHeight);
  };
  const commit = (): void => { save(settings); deps.apply(settings); renderValues(); };
  renderValues();

  el.addEventListener('input', (event) => {
    const text = (event.target as HTMLElement).closest<HTMLTextAreaElement>('[data-text="pdfCss"]');
    if (text) { settings.pdfCss = text.value; save(settings); return; }
    const range = (event.target as HTMLElement).closest<HTMLInputElement>('[data-range]');
    if (!range) return;
    if (range.dataset.range === 'fontSize') settings.fontSize = Number(range.value);
    else settings.lineHeight = Math.round(Number(range.value) * 100) / 100;
    commit();
  });
  el.addEventListener('change', (event) => {
    const pdf = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-pdf-option]');
    if (pdf) {
      if (!notePath) return;
      if (pdf.dataset.pdfOption === 'columns') printOptions.columns = Number(pdf.value) as PrintOptions['columns'];
      else if (pdf.dataset.pdfOption === 'direction') printOptions.direction = pdf.value as PrintOptions['direction'];
      else if (pdf.dataset.pdfOption === 'mathAlign') printOptions.mathAlign = pdf.value as PrintOptions['mathAlign'];
      savePrintOptions(notePath, printOptions);
      return;
    }
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-select="quickAction"], [data-select="mathDigits"]');
    if (!select) return;
    if (select.dataset.select === 'quickAction') settings.quickAction = select.value as QuickAction;
    else settings.mathDigits = select.value as Settings['mathDigits'];
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
    const pageButton = target.closest<HTMLElement>('[data-page-numbers]');
    if (pageButton) {
      settings.pdfPageNumbers = pageButton.dataset.pageNumbers as Settings['pdfPageNumbers'];
      const control = pageButton.parentElement!;
      control.style.setProperty('--index', String(pageNumbers.indexOf(settings.pdfPageNumbers)));
      control.querySelectorAll<HTMLElement>('[data-page-numbers]').forEach((b) => b.setAttribute('aria-checked', String(b === pageButton)));
      save(settings);
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
    else if (name === 'spaceAfterPunctuation') settings.spaceAfterPunctuation = on;
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
