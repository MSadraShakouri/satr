// Paged.js 0.4 paginates a single flow, not nested CSS multicolumn content.
// Paginate at the real column width, then impose two consecutive columns on
// each A4 sheet. Do not shrink an already laid-out full-width page: that made
// earlier PDFs tiny. Font sizes are identical to the one-column export.
import type { Settings } from './settings';

const WIDTH_MM = 210;
const HEIGHT_MM = 297;
const MARGIN_MM = 25.4;
const GAP_MM = 8;
export const COLUMN_WIDTH_MM = (WIDTH_MM - 2 * MARGIN_MM - GAP_MM) / 2;
export const COLUMN_WIDTH_PX = COLUMN_WIDTH_MM / 25.4 * 96;

// Last in the paginated CSS: only physical geometry is fixed in this mode.
export const columnPageCss = `@page {
  size: ${COLUMN_WIDTH_MM}mm ${HEIGHT_MM}mm;
  margin: ${MARGIN_MM}mm 0;
  @bottom-center { content: none; }
}`;

export function assembleColumns(doc: Document, direction: 'ltr' | 'rtl', numbering: Settings['pdfPageNumbers']): void {
  const container = doc.querySelector<HTMLElement>('.pagedjs_pages')!;
  const columns = [...container.querySelectorAll<HTMLElement>('.pagedjs_page')];
  let sheet: HTMLElement | null = null;
  let previous: HTMLElement | null = null;
  let count = 0;
  for (const column of columns) {
    // A deliberate page break means a new SHEET, not just the next column.
    const hardBreak = [column.dataset.breakBefore, column.dataset.previousBreakAfter, previous?.dataset.breakAfter]
      .some((value) => value && ['page', 'always', 'left', 'right', 'recto', 'verso'].includes(value));
    if (!sheet || sheet.querySelectorAll(':scope > .pagedjs_page').length === 2 || hardBreak) {
      sheet = doc.createElement('section');
      sheet.className = 'satr-print-sheet';
      sheet.dataset.direction = direction;
      count += 1;
      if (numbering !== 'none') {
        const number = doc.createElement('div');
        number.className = 'satr-sheet-number';
        number.textContent = numbering === 'persian' ? String(count).replace(/\d/g, (n) => '۰۱۲۳۴۵۶۷۸۹'[Number(n)]) : String(count);
        sheet.appendChild(number);
      }
      container.appendChild(sheet);
    }
    sheet.appendChild(column);
    previous = column;
  }
  // This sheet is added AFTER pagination, so Paged.js cannot rewrite it.
  const style = doc.createElement('style');
  style.textContent = `
    @page { size: ${WIDTH_MM}mm ${HEIGHT_MM}mm; margin: 0; }
    .satr-print-sheet {
      position: relative; display: flex; gap: ${GAP_MM}mm;
      width: ${WIDTH_MM}mm; height: ${HEIGHT_MM}mm; box-sizing: border-box;
      padding: 0 ${MARGIN_MM}mm; margin: 0; direction: ltr;
      break-inside: avoid; break-after: page; page-break-after: always;
    }
    .satr-print-sheet:last-child { break-after: auto; page-break-after: auto; }
    .satr-print-sheet[data-direction="rtl"] { flex-direction: row-reverse; }
    .satr-print-sheet > .pagedjs_page {
      flex: 0 0 ${COLUMN_WIDTH_MM}mm; width: ${COLUMN_WIDTH_MM}mm;
      margin: 0 !important; height: ${HEIGHT_MM}mm !important;
      min-height: 0 !important; max-height: none !important;
      break-after: auto !important; page-break-after: auto !important;
    }
    .satr-sheet-number {
      position: absolute; bottom: 0; left: 0; width: 100%; height: ${MARGIN_MM}mm;
      display: flex; align-items: center; justify-content: center;
      font: 12pt Vazirmatn, sans-serif; color: #222;
    }
  `;
  doc.head.appendChild(style);
}
