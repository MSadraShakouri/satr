// Paged.js removes break-after:avoid from CSS and emulates it with data
// attributes. It misses breaks in text/empty paragraph nodes following a
// heading. Move the break before a trailing chain of headings in that case.
const HEADINGS = 'h1,h2,h3,h4,h5,h6';

function hasContent(fragment: DocumentFragment): boolean {
  return Boolean(fragment.textContent?.trim() || fragment.querySelector('img,svg,math,hr,input'));
}

export function keepHeadingWithContent(overflow: Range | undefined, rendered: HTMLElement): Range | undefined {
  if (!overflow) return;
  const doc = rendered.ownerDocument;
  const cut = overflow.cloneRange();
  cut.collapse(true);
  let keep: Element | null = null;
  const headings = [...rendered.querySelectorAll(HEADINGS)];
  for (const heading of headings.reverse()) {
    const start = doc.createRange();
    start.setStartBefore(heading);
    start.collapse(true);
    if (start.compareBoundaryPoints(Range.START_TO_START, cut) >= 0) continue;
    // If the break is inside the heading, keep the entire heading too.
    if (heading.contains(cut.startContainer)) { keep = heading; continue; }
    const tail = doc.createRange();
    tail.setStartAfter(heading);
    tail.setEnd(cut.startContainer, cut.startOffset);
    const remaining = tail.cloneContents();
    remaining.querySelectorAll(HEADINGS).forEach((el) => el.remove());
    if (hasContent(remaining)) break;
    keep = heading;
  }
  if (!keep) return;
  const prefix = doc.createRange();
  prefix.selectNodeContents(rendered);
  prefix.setEndBefore(keep);
  // An oversized heading/body at the top cannot be moved forever. Let the
  // paginator make progress rather than looping or deleting any content.
  if (!hasContent(prefix.cloneContents())) return;
  overflow.setStartBefore(keep);
  return overflow;
}
