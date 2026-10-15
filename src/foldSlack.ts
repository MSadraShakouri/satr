// A fold takes height out of the page. Anywhere but the foot of the note the
// reader does not feel it: what is under the heading leaves, what is above
// stays. At the foot it is the reader's own place that pays — the scroll has
// nothing left below it to give up, so the browser clamps it back and every
// line on screen slides down by the height the section took. Folding the last
// title of a note therefore walked the reader to the page's foot, and opening
// it again left them there (the height came back below them, not under their
// finger), which is the report this answers.
//
// The reading view has a tail by design (50vh under the note, .preview-pane
// article) and so does the editor (50vh + 96px, .cm-content in src/editor.ts),
// but a tail only helps while there is room left in it; at the bottom, a fold
// can ask for more than a screen's worth. So a fold that did move the reader
// gives the page back exactly the room it took — `--fold-slack`, added to the
// same padding — and puts the reader's place back, silently, in the same
// frame: no paint happens between the two writes. The room is never more than
// one screenful, and it is given away again the moment the reader scrolls
// clear of it, so it is not blank space to be wandered into.
const SLACK = '--fold-slack';

/** The room currently lent to the page, in px. */
export function foldSlackOf(holder: HTMLElement): number {
  return parseFloat(holder.style.getPropertyValue(SLACK)) || 0;
}

function setFoldSlack(holder: HTMLElement, px: number): void {
  if (px > 0) holder.style.setProperty(SLACK, `${Math.round(px)}px`);
  else holder.style.removeProperty(SLACK);
}

/** Run a fold (or an unfold) over a scroller and keep the reader's place: if
 *  the change ran the page out from under them — the browser clamped the
 *  scroll — the height that was taken is lent back and the scroll returned to
 *  where it was. `holder` is the element that carries the page's bottom
 *  padding (the scroller's own content, or the article it holds). */
export function keepingPlace<T>(scroller: HTMLElement, holder: HTMLElement, fold: () => T): T {
  const before = scroller.scrollTop;
  const result = fold();
  const lost = before - scroller.scrollTop; // the page ran out under the reader
  if (lost > 0) {
    setFoldSlack(holder, Math.min(foldSlackOf(holder) + lost, scroller.clientHeight));
    scroller.scrollTop = Math.min(before, scroller.scrollHeight - scroller.clientHeight);
  }
  // A section given back fills the room its own fold borrowed: an unfold needs
  // no room at all, and the room is never taken away while the reader stands
  // on it (releaseFoldSlack declines to), so this only ever clears a leftover.
  releaseFoldSlack(scroller, holder);
  return result;
}

/** Give the lent room back once the reader is clear of it — the scroll no
 *  longer needs it, and the padding sits below their viewport, so taking it
 *  away moves nothing. Safe to call whenever: it does nothing while the room
 *  is still in use. */
export function releaseFoldSlack(scroller: HTMLElement, holder: HTMLElement): void {
  const slack = foldSlackOf(holder);
  if (!slack) return;
  const withoutRoom = scroller.scrollHeight - scroller.clientHeight - slack;
  if (scroller.scrollTop <= withoutRoom) setFoldSlack(holder, 0);
}
