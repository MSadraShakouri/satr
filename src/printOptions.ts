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

/** Stored separately from global settings so existing per-file choices remain. */
export function savePrintOptions(path: string, options: PrintOptions): void {
  localStorage.setItem(printOptionsKey(path), JSON.stringify(validPrintOptions(options)));
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
