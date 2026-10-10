// A split table keeps small company on both sides of a page break.
//
// Paged.js splits tables freely at row boundaries (`tr { break-inside: avoid }`
// keeps one row whole), which keeps pages full — but it happily strands one
// row at the foot of a page or carries a single row to the next, and with no
// repeated header a lone continuation row hangs there without a caption. This
// hook (chunker.hooks.onOverflow, alongside keepHeadingWithContent, which it
// chains after) moves the break so that at least MIN_TABLE_ROWS body rows sit
// at the foot of a page and at least MIN_TABLE_ROWS carry over — and when
// that cannot be, the whole table moves to the next page instead, wasting at
// most MIN_TABLE_ROWS − 1 rows of paper. The blanket `table { break-inside: avoid }`
// was the unbounded version of the same idea and is deliberately not in the
// CSS: it emptied the foot of a page because a single row didn't fit.
//
// The header row is the table's shell, not one of the counted rows: a fragment
// of header alone counts as nothing.

export const MIN_TABLE_ROWS = 3;

function hasContent(fragment: DocumentFragment): boolean {
  return Boolean(fragment.textContent?.trim() || fragment.querySelector('img,svg,math,hr,input'));
}

/** The body rows (everything but the thead's shell) under `root`. */
function bodyRows(root: Element | DocumentFragment): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('tr')].filter((tr) => !tr.closest('thead'));
}

export function keepTableRows(overflow: Range | undefined, rendered: HTMLElement): Range | undefined {
  if (!overflow) return;
  const doc = rendered.ownerDocument;
  const cut = overflow.cloneRange();
  cut.collapse(true);
  // The table the break falls inside — if none, this break isn't a table's.
  // (nodeType, not instanceof: the range's nodes belong to the print frame's
  // own realm, where the app's Element constructor answers nothing.)
  const at = cut.startContainer;
  let table: Element | null = null;
  for (let node: Element | null = at.nodeType === 1 ? (at as Element) : at.parentElement; node; node = node.parentElement) {
    if (node.tagName === 'TABLE') { table = node; break; }
  }
  if (!table) return;
  const fragment = bodyRows(table);
  const before = doc.createRange();
  before.selectNodeContents(table);
  before.setEnd(cut.startContainer, cut.startOffset);
  const placedRows = bodyRows(before.cloneContents());
  const placed = placedRows.length;

  // Orphan: fewer than the minimum would sit at the foot of this page. The
  // whole table goes over — but never into a loop: a table already at the top
  // of a page that still doesn't fit is taller than a page, and must split.
  if (placed < MIN_TABLE_ROWS) {
    const prefix = doc.createRange();
    prefix.selectNodeContents(rendered);
    prefix.setEndBefore(table);
    if (!hasContent(prefix.cloneContents())) return;
    overflow.setStartBefore(table);
    return overflow;
  }

  // Widow: the break would carry fewer than the minimum to the next page.
  // What carries is exactly what was rendered past the cut — the placed rows
  // fit, the rest of the rendered fragment is the carry — so the whole
  // decision is local to this page. The break moves back just far enough
  // that the carry meets the minimum; if that leaves the page's own foot
  // under the minimum, the whole table goes over instead (same loop guard
  // as the orphan above).
  const carry = fragment.length - placed;
  if (carry >= MIN_TABLE_ROWS) return;
  const staying = placed - (MIN_TABLE_ROWS - carry);
  if (staying < MIN_TABLE_ROWS) {
    const prefix = doc.createRange();
    prefix.selectNodeContents(rendered);
    prefix.setEndBefore(table);
    if (!hasContent(prefix.cloneContents())) return;
    overflow.setStartBefore(table);
    return overflow;
  }
  const anchor = fragment[staying];
  if (!anchor) return;
  overflow.setStartBefore(anchor);
  return overflow;
}
