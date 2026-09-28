export interface PrintOptions {
  columns: 1 | 2;
  direction: 'auto' | 'ltr' | 'rtl';
  mathAlign: 'center' | 'start';
}

export const defaultPrintOptions: PrintOptions = { columns: 1, direction: 'auto', mathAlign: 'center' };
export const printOptionsKey = (path: string): string => `satr:pdf:${path}`;
export function validPrintOptions(value: Partial<PrintOptions> | null): PrintOptions {
  return {
    columns: value?.columns === 2 ? 2 : 1,
    direction: value?.direction === 'ltr' || value?.direction === 'rtl' ? value.direction : 'auto',
    mathAlign: value?.mathAlign === 'start' ? 'start' : 'center',
  };
}
export function loadPrintOptions(path: string): PrintOptions {
  try { return validPrintOptions(JSON.parse(localStorage.getItem(printOptionsKey(path)) ?? 'null')); }
  catch { return { ...defaultPrintOptions }; }
}

/** Count prose, not TeX variables, source code, URLs or metadata. An English
 * title must not flip a mostly Persian/Arabic note's column order. */
export function printDirection(body: HTMLElement, choice: PrintOptions['direction']): 'ltr' | 'rtl' {
  if (choice !== 'auto') return choice;
  const prose = body.cloneNode(true) as HTMLElement;
  prose.querySelectorAll('.math-display,.math-flow,.katex,pre,code').forEach((el) => el.remove());
  const letters = (prose.textContent ?? '').replace(/https?:\/\/\S+/g, '').match(/\p{L}/gu) ?? [];
  const rtl = letters.filter((letter) => /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(letter)).length;
  return rtl > letters.length - rtl ? 'rtl' : 'ltr';
}

let active: HTMLDialogElement | null = null;
export function closePrintOptions(): boolean {
  if (!active) return false;
  active.close('cancel');
  return true;
}

/** Options are local to this file, not global PDF/reading-view settings. */
export function choosePrintOptions(path: string): Promise<PrintOptions | null> {
  if (active) return Promise.resolve(null);
  const options = loadPrintOptions(path);
  const dialog = document.createElement('dialog');
  active = dialog;
  dialog.className = 'pdf-options';
  dialog.setAttribute('aria-labelledby', 'pdf-options-title');
  dialog.dataset.ignoreSwipe = '';
  dialog.innerHTML = `<form method="dialog">
    <h2 id="pdf-options-title">Export to PDF</h2>
    <p>Remembered for this file on this device. The note and reading view stay unchanged.</p>
    <label>Layout<select name="columns" class="dropdown">
      <option value="1">One column</option><option value="2">Two columns (A4)</option>
    </select></label>
    <label>Reading order<select name="direction" class="dropdown">
      <option value="auto">Auto — from the file’s prose</option>
      <option value="ltr">Left to right</option><option value="rtl">Right to left</option>
    </select></label>
    <label>Display equations<select name="mathAlign" class="dropdown">
      <option value="center">Centred</option><option value="start">At the reading edge</option>
    </select></label>
    <p>Auto uses the majority of prose letters, ignoring math and code. Equations always read left to right. Two columns use A4, 1-inch outer margins and an 8 mm gap, overriding custom page geometry.</p>
    <div class="pdf-options-actions"><button type="button" value="cancel">Cancel</button><button value="export" class="mod-cta">Export</button></div>
  </form>`;
  for (const [key, value] of Object.entries(options)) dialog.querySelector<HTMLSelectElement>(`[name="${key}"]`)!.value = String(value);
  dialog.querySelector<HTMLButtonElement>('[value="cancel"]')!.onclick = () => dialog.close('cancel');
  document.body.appendChild(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      let result: PrintOptions | null = null;
      if (dialog.returnValue === 'export') {
        const values = new FormData(dialog.querySelector('form')!);
        result = validPrintOptions({ columns: Number(values.get('columns')) as 1 | 2, direction: values.get('direction') as PrintOptions['direction'], mathAlign: values.get('mathAlign') as PrintOptions['mathAlign'] });
        try { localStorage.setItem(printOptionsKey(path), JSON.stringify(result)); } catch { /* export still works if storage is full */ }
      }
      dialog.remove();
      active = null;
      resolve(result);
    }, { once: true });
    dialog.showModal();
  });
}
