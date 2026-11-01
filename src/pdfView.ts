// A PDF, opened where it was left.
//
// pdf.js draws it, which is what both readers this was measured against do:
// Obsidian embeds pdf.js's own viewer, and Gander (MIT, mokshablr/gander)
// vendors the library into a WebView with a few hundred lines of its own
// around it. The library is fetched only when a PDF is actually opened, so a
// session that never opens one never pays for it.
//
// Three things, and deliberately no more for now: the pages, a zoom that
// redraws instead of blurring, and the place. Selecting text inside a page,
// searching it, and anything that writes to the file are not here.
//
// What is drawn is never a whole page at full zoom. A page at eight times
// the width of the pane would be a canvas of some thirty million pixels,
// most of it off screen; what is rasterised is the band the reader is
// looking at, one screen either side of it, exactly as Gander redraws "the
// part of it being looked at at whatever zoom the reader has actually
// reached". Scrolling past the band redraws it; the old picture stays up
// meanwhile, so there is never a blank page.
import { PdfErrorCode, type PdfBookmarkObject, type PdfDocumentObject, type PdfPageObject, type PdfTask, type PdfTextRun, type PdfFontInfo } from '@embedpdf/models';
import type { ImageDataLike, Rect as PageRect } from '@embedpdf/models';
import { imagesOnPage, pdfium, type PageRect as PictureRect } from './pdfiumEngine';
import { asFileWroteIt, inReadingOrder, joinersIn, withJoiners, type Joiners } from './pdfText';
import { keepSketches, recallSketches } from './pdfSketchCache';

/** Where the reader was. The page and how far into it, rather than a scroll
 *  offset, so the place survives a different zoom, a rotation, or a wider
 *  screen — the offset would mean a different line of a different page. */
export interface PdfPlace {
  /** 1-based, the page at the top of the screen. */
  page: number;
  /** How far into that page the top of the screen is, 0 to 1. */
  into: number;
  /** Multiples of the width that fits the pane: 1 is a page edge to edge. */
  zoom: number;
  /** How far across the sheet the middle of the screen is, 0 to 1: the left
   *  margin is 0, the right one 1. A fraction of the sheet rather than a
   *  scroll offset for the same reason as `into` -- a zoomed-in reader who
   *  is looking at the right-hand column is looking at it at any zoom and
   *  on any screen. Missing on a place written down before this was kept,
   *  which reads as the middle, where a document opens anyway. */
  across?: number;
}

export interface PdfOptions {
  /** The pane that scrolls, which the pages are laid out inside. */
  scroller: HTMLElement;
  /** What this document is, by its own bytes (pdfKey) rather than by its
   *  name. The place it was left is remembered against it, and so are the
   *  few pages kept for the next time it is opened. */
  key?: string;
  place?: PdfPlace | null;
  /** Called as the reader moves, already settled — the caller writes it down. */
  onPlace?: (place: PdfPlace) => void;
  /** About to scroll the pane itself, rather than the reader doing it: the
   *  app's own chrome reads scrolling as a hand and hides the bars for it. */
  ownScroll?: () => void;
  /** The app's floating layer — where the navbar pill lives. The page
   *  counter belongs there rather than in the document: it is chrome, not
   *  part of the page. */
  overlay?: HTMLElement | null;
}

/** The two stops Obsidian offers in its display options' zoom section. */
export type PdfFit = 'width' | 'height';
/** A line of the document's own table of contents. Obsidian shows this as a
 *  tree in the second of its two sidebar views; PDFium reads it out of the
 *  file's bookmarks, where pdf.js reads the same thing from its outline. */
export interface PdfOutlineItem {
  title: string;
  /** Null for a bookmark that runs an action rather than naming a page. */
  page: number | null;
  /** How far down that page the heading sits, in the page's own units, so
   *  a search result can be filed under the heading it is actually under
   *  rather than under whichever heading on that page happens to be last.
   *  A bookmark names a page and not a place on it: those start at 0. */
  top: number;
  children: PdfOutlineItem[];
}
/** One match: the page it is on, and the boxes to draw over it. */
export interface PdfHit {
  page: number;
  /** How far down the page it is, for filing it under a heading. */
  top?: number;
  rects: PageRect[];
  /** The words either side of the match, read off the page in reading
   *  order, so a result can be shown as the line it was found in rather
   *  than as a page number on its own. */
  context?: { before: string; match: string; after: string };
}
export interface PdfHandle {
  pages: number;
  place(): PdfPlace;
  /** Where the reader is on the page's own scale: the page, and how far
   *  down it in the units an outline row's `top` is given in. */
  reading(): { page: number; top: number };
  goTo(page: number): void;
  fitTo(mode: PdfFit): void;
  /** Which stop the page is sitting at, if either — for the checkmark. */
  fitNow(): PdfFit | null;
  /** The toolbar's − and +: a step in or out, about the middle of the screen. */
  zoomBy(step: number): void;
  zoomNow(): number;
  /** A page as a small picture, for the sidebar. */
  thumbnail(page: number, width: number): Promise<string | null>;
  outline(): Promise<PdfOutlineItem[]>;
  /** The contents of a document that carries none, read back off the type.
   *  Scanned once, on demand, because it reads every page. */
  derivedOutline(): Promise<PdfOutlineItem[]>;
  /** Told whenever the page at the top of the screen changes, so the
   *  toolbar's number and the sidebar's highlight follow the reader. */
  onPage(listen: (page: number) => void): () => void;
  /** Every hit for a word, in reading order. PDFium searches the text
   *  itself, where pdf.js makes a viewer assemble the text first. */
  find(keyword: string): Promise<PdfHit[]>;
  /** Mark them all, and put the one being looked at on the screen. */
  showHits(hits: PdfHit[], current: number): void;
  destroy(): void;
}

// ---- a table of contents read off the type --------------------------------
//
// No browser's print-to-PDF writes bookmarks, so every PDF the app exports —
// and every one Markor exports, through the same WebView printer — arrives
// with nothing for the contents panel to show (ROADMAP). The headings did
// not go anywhere, though: they are the lines set larger than the body, and
// PDFium gives back the font size of every run. So the outline is read back
// off the type. It is an approximation and says so by what it is: whatever
// the document's own bookmarks say wins whenever there are any.
//
// The numbers below are the ones that read his own 52-page handout: body
// 15.2pt, sessions 30.4, sections 22.8, subsections 17.8.

/** Bigger than the body by this much, and it is a heading. The app's own
 *  print stylesheet sets h1 to h4 at 1.6, 1.4, 1.25 and 1.1 times the
 *  body, so the line has to sit under 1.1 or a whole level of headings is
 *  invisible; what it has to clear is the half-point wobble between runs
 *  of ordinary text. (h5 and h6 are set at 1em — the same size as the
 *  body — and nothing can recover those from the type alone.) */
const BODY_RATIO = 1.05;
/** How thick a size has to be before it is read as text rather than as a
 *  heading: more than three lines a page, and at least seven of them. */
const BODY_PER_PAGE = 3;
const BODY_FLOOR = 6;
/** A paragraph is not a heading, however large it is set. */
const MAX_TITLE = 120;
/** More characters than a page can hold: the engine clamps it to the page's
 *  own count, which saves counting the glyphs first (measured: identical). */
const ALL_OF_A_PAGE = 1_000_000;
/** Only a line that filled its own measure can be the top half of a wrapped
 *  heading; a short line that happens to sit above another is two headings. */
const WRAP_MIN = 45;
/** Obsidian's contents tree indents by level; three is as deep as it reads
 *  on a phone, and he did not mind which number it was. */
const MAX_DEPTH = 3;
/** A ceiling, so that opening the panel on something enormous cannot run
 *  away with the thread. */
const SCAN_PAGES = 500;
/** Less of a page than this is ordinary text, and the page is not a page
 *  of the document: it is a cover, or a divider. Measured on his own
 *  cover, where a line of small print under the title still leaves three
 *  characters in four set large; a page of prose is the other way round
 *  by a mile. */
const BODILESS = 0.5;
/** A line that ends on one of these ended on purpose, so the line under it
 *  is the next heading rather than the rest of this one. */
const SENTENCE_END = /[.?!:;\u061b\u061f\u06d4\u2026]$/;
/** PDFium hands the lam-alef ligature back as its two letters in the wrong
 *  order: the single glyph decodes to alef + lam, which turns انقلاب into
 *  انقالب. In these files every other letter arrives in a run of its own,
 *  so a two-character run ending in lam is that ligature and nothing else. */
const LAM = '\u0644';
const ALEFS = '\u0627\u0623\u0625\u0622';
const unligature = (text: string): string =>
  (text.length === 2 && text[1] === LAM && ALEFS.includes(text[0]) ? LAM + text[0] : text);
/** Enough letters to be a heading rather than a stray mark left by a
 *  decoder, a page number, or what is left of a formula once its symbols
 *  are taken away. Digits do not count: a heading is words. */
const wordy = (text: string): boolean => (text.match(/\p{L}/gu) ?? []).length >= 2;
/** The fonts a formula is set in. Satr prints maths with KaTeX, whose
 *  faces keep their names into the PDF (KaTeX_Main, KaTeX_Math,
 *  KaTeX_Size1…, KaTeX_AMS) and whose Persian runs inside \text{} are set
 *  in XB Zar, embedded only when a note has maths in it (embedFonts.ts).
 *  The rest are what other writers use: TeX's Computer Modern, MathJax,
 *  and the OpenType maths faces. */
const MATH_FONT = /katex|xbzar|xb ?zar|mathjax|stix|xits|asana|\bcm(mi|sy|ex|r)\b|math/i;
const mathFont = (font: PdfFontInfo | undefined): boolean =>
  MATH_FONT.test(font?.name ?? '') || MATH_FONT.test(font?.familyName ?? '');

/** The pairs bidi mirrors when it draws them in a right-to-left run. A PDF
 *  stores the glyph that was drawn, so a parenthesis typed before a Persian
 *  word comes back out of the file as the one that closes it: "(افراز)" is
 *  read as ")افراز(". Which way a bracket faces is decided by the text it
 *  belongs to, and that is the nearest letter with a direction of its own
 *  before it — "TNB (کنج" keeps its bracket, "فرنه)" turns its round. */
const MIRRORED: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<',
  '«': '»', '»': '«', '‹': '›', '›': '‹',
};
const RTL_LETTER = /[\u0590-\u05ff\u0600-\u06ff\u0700-\u074f\u0750-\u077f\u08a0-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;
const LTR_LETTER = /[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u1e00-\u1eff]/;

/** Put the brackets of a right-to-left line back the way they were typed.
 *  Whether a bracket was drawn mirrored is decided by the text it was
 *  printed among, so this is settled before a formula is put back into the
 *  line: "انحنا (Curvature)" keeps its brackets, because a bracket beside
 *  Latin words belongs to them, while "یکه ( )" turns its round. */
function unmirrorPieces(pieces: Piece[]): void {
  const chars: string[] = [];
  const owner: Piece[] = [];
  for (const piece of pieces) for (const char of piece.text) { chars.push(char); owner.push(piece); }
  if (!chars.some((char) => RTL_LETTER.test(char))) return;
  const strongAt = (i: number): 'rtl' | 'ltr' | null =>
    (RTL_LETTER.test(chars[i]) ? 'rtl' : LTR_LETTER.test(chars[i]) ? 'ltr' : null);
  let changed = false;
  const out = chars.map((char, i) => {
    const flipped = MIRRORED[char];
    if (!flipped) return char;
    let side: 'rtl' | 'ltr' | null = null;
    for (let j = i - 1; j >= 0 && !side; j -= 1) side = strongAt(j);
    for (let j = i + 1; j < chars.length && !side; j += 1) side = strongAt(j);
    if (side !== 'rtl') return char;
    changed = true;
    return flipped;
  });
  if (!changed) return;
  const texts = new Map<Piece, string>();
  out.forEach((char, i) => texts.set(owner[i], (texts.get(owner[i]) ?? '') + char));
  for (const piece of pieces) piece.text = texts.get(piece) ?? piece.text;
}

/** Glyphs a file gives no reading for: control codes, the private-use area
 *  a maths font parks its pieces in, and the replacement character. A
 *  formula whose letters cannot be read is still a formula, and the
 *  contents say so rather than leaving the gap it stood in empty. */
const UNREADABLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ue000-\uf8ff\ufffd]+/gu;
export const readableMath = (text: string): string => text.replace(UNREADABLE, '…');

/** A bracket in a right-to-left line is printed away from the words it
 *  holds — "TNB( کنج فرنه)", "یکه ( N )" — because the space beside it was
 *  written on the other side. The space belongs outside the bracket. */
function tidyBrackets(text: string): string {
  if (!RTL_LETTER.test(text)) return text;
  return text
    .replace(/(\S)([([{«‹]) +/gu, '$1 $2')
    .replace(/([([{«‹]) +/gu, '$1')
    .replace(/ +([)\]}»›])/gu, '$1');
}

/** One line of the document as the type describes it, and how much of it
 *  was set in a formula or in code. A line is held as the pieces it was
 *  written in, each with the place it was written at, because the order the
 *  pieces arrive in is the order the printer painted them, not the order
 *  they are read in. */
interface Piece { text: string; left: number; right: number; apart: number }
interface TypeLine { page: number; size: number; top: number; text: string; apart: number; pieces: Piece[] }

/** Does this line read right to left? Its letters decide. */
function rightToLeft(pieces: Piece[]): boolean {
  let rtl = 0;
  let ltr = 0;
  for (const piece of pieces) {
    for (const char of piece.text) {
      if (RTL_LETTER.test(char)) rtl += 1;
      else if (LTR_LETTER.test(char)) ltr += 1;
    }
  }
  return rtl > ltr;
}

/** The runs of a page, stitched back into lines. A browser's printer writes
 *  one text object per glyph for a complex script, so the runs arrive a
 *  letter at a time; what holds a line together is a shared font size and a
 *  shared baseline, and what ends one is the newline PDFium puts in the run
 *  that carries it. A formula is painted in a pass of its own — the words of
 *  a heading can arrive as run 310 and the formula standing between its
 *  brackets as run 498 — so once the lines are built, a line that is nothing
 *  but formula is put back into the line it shares a baseline with, at the
 *  place along that line it was printed at. */
function linesOfPage(runs: PdfTextRun[], page: number): TypeLine[] {
  const lines: TypeLine[] = [];
  let open: TypeLine | null = null;
  for (const run of runs) {
    const text = unligature(String(run.text ?? ''));
    const size = Math.round(run.fontSize * 10) / 10;
    const top = run.rect.origin.y;
    const left = run.rect.origin.x;
    const right = left + (run.rect.size?.width ?? 0);
    // Maths and code never vote and are never a heading, which is the rule
    // the note itself is read by (src/direction.ts). They are marked here,
    // one run at a time, because a formula and the sentence it sits in
    // share a line.
    const maths = mathFont(run.font);
    const apart = maths || run.font?.monospaced ? text.trim().length : 0;
    const piece: Piece = { text: maths ? readableMath(text) : text, left, right, apart };
    if (open && open.size === size && Math.abs(open.top - top) <= size * 0.6) {
      open.text += piece.text;
      open.apart += apart;
      open.pieces.push(piece);
    } else {
      if (open) lines.push(open);
      open = { page, size, top, text: piece.text, apart, pieces: [piece] };
    }
    if (/[\r\n]/.test(text)) { lines.push(open); open = null; }
  }
  if (open) lines.push(open);
  for (const line of lines) {
    unmirrorPieces(line.pieces);
    line.text = line.pieces.map((piece) => piece.text).join('').replace(/\s+/g, ' ').trim();
  }
  rejoinFormulas(lines);
  for (const line of lines) line.text = tidyBrackets(line.text);
  return lines.filter((line) => line.text);
}

/** A line of nothing but formula, standing on the baseline of a line of
 *  words and within its span, is part of that line: "بردار نرمال یکه (N)"
 *  reached the contents as "بردار نرمال یکه ( )" until the two were put back
 *  together. Where it belongs along the line is where it was printed: in a
 *  line read right to left, what is further right is read first. The span
 *  test is what keeps a formula in one column of a two-column page out of a
 *  heading in the other. */
function rejoinFormulas(lines: TypeLine[]): void {
  const whole = (line: TypeLine): number => line.text.replace(/\s+/gu, '').length;
  const formulas = lines.filter((line) => line.apart >= whole(line) && whole(line) > 0);
  for (const formula of formulas) {
    const host = lines.find((line) => line !== formula && !formulas.includes(line)
      && line.page === formula.page
      && Math.abs(line.top - formula.top) <= Math.max(line.size, formula.size) * 0.6
      && formula.pieces[0].left >= Math.min(...line.pieces.map((p) => p.left)) - 24
      && formula.pieces[0].right <= Math.max(...line.pieces.map((p) => p.right)) + 24);
    if (!host) continue;
    const backwards = rightToLeft(host.pieces);
    const after = host.pieces.findIndex((piece) => (backwards
      ? piece.right < formula.pieces[0].right
      : piece.left > formula.pieces[0].left));
    host.pieces.splice(after < 0 ? host.pieces.length : after, 0, ...formula.pieces);
    host.apart += formula.apart;
    host.text = host.pieces.map((piece) => piece.text).join('').replace(/\s+/g, ' ').trim();
    lines.splice(lines.indexOf(formula), 1);
  }
}

/** The lines of a whole document, as a contents tree. */
function outlineFromType(scanned: TypeLine[], pages: number): PdfOutlineItem[] {
  // A line that is mostly formula is a formula, whatever is wrapped around
  // it. Satr sets display maths at 1.21 times the body, so without this
  // every equation in a set of lecture notes is larger than the text and
  // arrives in the contents as a heading — and the real headings of a
  // maths-heavy page are outnumbered by them.
  // Measured without the spaces, or the gaps in "( x y + " vote for it
  // being prose. A heading that carries one symbol of its own stays a
  // heading: five of his are written that way.
  const lines = scanned.filter((line) => line.apart * 2 <= line.text.replace(/\s+/gu, '').length);
  // The body is the size the most of the document is set in — by character,
  // not by line, or a title page would outvote a chapter.
  const weight = new Map<number, number>();
  for (const line of lines) weight.set(line.size, (weight.get(line.size) ?? 0) + line.text.length);
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (body === undefined) return [];
  let big = lines.filter((line) => line.size > body * BODY_RATIO
    && line.text.length <= MAX_TITLE && wordy(line.text));
  // Headings are sparse, and that is the only thing that separates a
  // heading from a second body. Measured on his 52-page handout: the body
  // is 92.7% of the characters at 35 lines a page, and every size above it
  // is under 3.5% at about one line a page. A document whose text is set
  // in two sizes -- a long quotation, an imported section, a note written
  // half in one font -- has a second one of those bodies sitting just
  // above the first, and every paragraph of it used to arrive as a
  // heading. A size cannot be a level of the contents if it is used more
  // than three times a page; the floor of seven is there so that a short
  // note, where four headings on two pages is normal, keeps all of them.
  const often = new Map<number, number>();
  for (const line of big) often.set(line.size, (often.get(line.size) ?? 0) + 1);
  const flood = Math.max(BODY_FLOOR, pages * BODY_PER_PAGE);
  const prosy = new Set([...often.entries()].filter(([, n]) => n > flood).map(([size]) => size));
  if (prosy.size) big = big.filter((line) => !prosy.has(line.size));
  // A cover has no body text on it: the title, who wrote it, where, and
  // when are all set large, and all of it would otherwise arrive in the
  // contents as headings. A page with nothing ordinary on it gets one
  // line — its largest — which on a cover is the title and on a divider
  // is the part it divides.
  const plain = new Map<number, number>();
  const all = new Map<number, number>();
  const prose = new Set(lines);
  for (const line of scanned) {
    all.set(line.page, (all.get(line.page) ?? 0) + line.text.length);
    // A formula counts as text the page is about, not as display type: a
    // page of equations is a page of the document however little prose is
    // left standing between them. Reading it as a cover — which is what
    // counting only the prose did — threw away every heading on it but one.
    if (prose.has(line) && line.size > body * BODY_RATIO) continue;
    plain.set(line.page, (plain.get(line.page) ?? 0) + line.text.length);
  }
  const cover = (page: number): boolean =>
    (plain.get(page) ?? 0) < (all.get(page) ?? 0) * BODILESS;
  const alone = new Map<number, TypeLine>();
  for (const line of big) {
    if (!cover(line.page)) continue;
    const best = alone.get(line.page);
    if (!best || line.size > best.size) alone.set(line.page, line);
  }
  const kept = big.filter((line) => (alone.get(line.page) ?? line) === line);
  // A heading too long for one line wraps; the half above it ends mid-phrase.
  const joined: TypeLine[] = [];
  for (const line of kept) {
    const last = joined[joined.length - 1];
    if (last && last.page === line.page && last.size === line.size
      && Math.abs(last.top - line.top) < line.size * 2.2
      && last.text.length >= WRAP_MIN && !SENTENCE_END.test(last.text)) last.text += ` ${line.text}`;
    else joined.push({ ...line });
  }
  // A running head is not a heading: it is the same words on page after page.
  const times = new Map<string, number>();
  for (const line of joined) times.set(line.text, (times.get(line.text) ?? 0) + 1);
  const repeats = Math.max(3, pages * 0.25);
  const heads = joined.filter((line) => (times.get(line.text) ?? 0) <= repeats);
  // The ladder is built from the sizes that are used more than once: a size
  // only one line is set in — a cover, a date — has not earned a level of
  // its own, and joins the band it falls into.
  const used = new Map<number, number>();
  for (const line of heads) used.set(line.size, (used.get(line.size) ?? 0) + 1);
  const ladder = [...used.entries()].filter(([, n]) => n > 1)
    .map(([size]) => size).sort((a, b) => b - a);
  const root: PdfOutlineItem[] = [];
  const stack: PdfOutlineItem[] = [];
  for (const head of heads) {
    const rank = Math.min(ladder.filter((step) => step > head.size).length, MAX_DEPTH - 1);
    const depth = Math.min(rank, stack.length);
    const item: PdfOutlineItem = { title: head.text, page: head.page, top: head.top, children: [] };
    stack.length = depth;
    (depth ? stack[depth - 1].children : root).push(item);
    stack.push(item);
  }
  return root;
}

/** His floor, measured on a 52-page handout at 390px: about five pages of it
 *  on the screen at once. Below that a page is no longer recognisable even
 *  by its shape. The ceiling is as far in as the band-drawing stays cheap. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
/** Where a double tap lands, and the point below which it zooms in rather
 *  than back out (Gander's rule: the geometric middle of the two).
 *
 *  Twice, which is where Gander and Jetpack's PDF viewer put it, and the
 *  reason is typographic rather than round: it brings the body of an A4
 *  page to about the size the phone sets its own text in, and one column
 *  of a two-column page to the width of the screen. Two and a half, which
 *  this was, overshoots both and leaves a line needing a sideways scroll
 *  to finish. */
const DOUBLE_TAP_ZOOM = 2;
const DOUBLE_TAP_MS = 300;
/** Zoom is a float: a page sitting at its own width reads as 0.9999. */
const ZOOM_EPSILON = 0.005;
/** How far the second tap may land from the first. 24px was this app's own
 *  guess and it was too strict to rely on: measured here, a second tap 20px
 *  away still zoomed and one 30px away did nothing at all, which is well
 *  inside how much a thumb moves between two taps -- "single finger zoom, I
 *  think it didn't work once for me". Android's own double tap allows
 *  100dp (ViewConfiguration.DOUBLE_TAP_SLOP), which every gesture on that
 *  phone is measured against; 64 keeps a comfortable margin under it while
 *  still telling two deliberate taps in different places apart. The time is
 *  the platform's 300ms, and counted from the first tap's release rather
 *  than its press, so a slow first tap does not eat the window. */
const DOUBLE_TAP_SLOP = 64;
/**
 * A one-finger zoom: how far the finger may wander before it is a drag
 * rather than a tap, and how much of the zoom one pixel of drag is worth.
 *
 * `zoom * (1 + DRAG_SPEED) ** travelled`, which doubles the page every
 * 139 pixels and halves it every 139 the other way, for as long as the
 * finger keeps going. This is Chromium's number, not a tuned one:
 * `kDoubleTapDragZoomSpeed = 0.005f` in
 * ui/events/gesture_detection/gesture_provider.cc, which is the curve
 * every document opened in a WebView on this phone already answers to —
 * including Gander's PDF viewer, which hands the gesture straight to the
 * browser and never touches it.
 *
 * It replaces Android's own quick-scale law, `sqrt(|dy| / 8dp)`, which is
 * what a native view such as Drive gets from ScaleGestureDetector and
 * what this file shipped last round. The square root is more sensitive
 * over the first inch — twice the page in 32 pixels, where this needs
 * 147 — and that was the complaint it was written for. But its rate
 * falls as one over the distance already travelled: three hundred pixels
 * into a stroke, another hundred buys 15%, and the gesture stops
 * answering the thumb while the thumb is still moving. Chromium's rate is
 * the same ×1.65 per hundred pixels wherever you are in the stroke, which
 * is the whole of why theirs keeps feeling alive to the end of a sweep
 * and why Chrome adopted it: the comment beside that constant says the
 * scale delta is to stay constant while the touch velocity is constant.
 *
 * Out is the reciprocal rather than Chromium's `0.995 ** dy`. The two
 * differ by a part in forty thousand per pixel, and the reciprocal has
 * the property worth keeping: a drag that comes back to where it began
 * leaves the zoom exactly where it began.
 *
 * Against this file's range: fit to 8× is 425 pixels, fit to the 0.25
 * floor is 286, and both ends still give and ease back (GIVE_POWER).
 */
const DRAG_SLOP = 8;
const DRAG_SPEED = 0.005;
/**
 * The end of the range has to feel like an end, not like a fault.
 *
 * A gesture that asks for more than the range holds keeps moving the page
 * a little — GIVE_POWER of the drag past the stop, never more than
 * GIVE_MOST past it — and the column eases back to the stop when the hand
 * leaves. It is what every pannable surface on the phone does at its
 * edges, and it is the difference between "it stops here" and "it broke".
 */
const GIVE_POWER = 0.3;
const GIVE_MOST = 0.12;
const GIVE_BACK_MS = 180;
/** Below the page's own width a zoom out stops being about any point on
 *  the page and starts being about getting back to the whole of it: the
 *  point held still slides out from under the finger to the middle of the
 *  pane, and is all the way there by the time the page is this fraction of
 *  its fitted width. Continuous, so nothing steps as it crosses. */
const CENTRE_BY = 0.7;
/** How long a document will wait, on the way in, for the few pages kept
 *  from the last time it was open (src/pdfSketchCache.ts). */
const RECALL_WAIT_MS = 160;
/** A gesture that has paused for this long, with the finger still down, is
 *  drawn at the size the finger is holding rather than waiting for it to
 *  lift. Long enough that a sweep does not draw thirty times on its way
 *  past, short enough to land while the reader is still looking. */
const LIVE_DRAW_MS = 140;
/**
 * How much of itself the zoom may still be changing by, per frame, for a
 * picture asked for now to still be the right picture when it lands. A
 * hundredth is two pixels of thumb a frame: a hand that is arriving
 * rather than travelling. Waiting instead for the rate to reach nothing
 * is waiting for something a hand on glass does not do.
 */
const DRAG_CREEP = 0.01;
/** A frame, for reading a rate per millisecond as a rate per frame. */
const FRAME_MS = 16.7;
/**
 * What a tile drawn under a moving finger may cost, as a share of what one
 * drawn at rest may. A quarter of the budget is about two thirds of the
 * screen's own pixels on his phone -- softer than the sharp tile, still a
 * third sharper than the whole-page picture stretched underneath it, and
 * about a quarter of the time. The full one follows on the lift.
 */
const QUICK_SHARE = 4;
/**
 * How far a picture's resolution may sit from the one the reader is
 * looking at before it is worth the engine drawing it again.
 *
 * A quarter short is about where a shortfall starts to read as blur, and
 * a redraw is not free: it is a page of PDFium on the thread the scroll
 * runs on, ahead of the pages the reader is moving towards. Acting on any
 * shortfall at all — which is what `* 0.99` here used to mean — spends a
 * whole page to recover five per cent, every time a pinch settles a
 * fraction away from where it settled last. Gander's number, and their
 * reasoning, in pdf.mjs: TILE_GATE = 1.25.
 *
 * Short only, deliberately. Gander redraws a page a quarter *over* as
 * well, to hand back the memory while the reader is zoomed out, and this
 * file does not: a page already drawn is drawn, and throwing a good
 * picture away to draw a worse one is not an economy. (The test "under
 * fit width a page is drawn at the size it is shown" holds that line,
 * and a page far enough out of the band is released whole by bank().)
 */
const BASE_GATE = 1.25;
/**
 * How far the live zoom may drift from the zoom a tile was drawn at
 * before the tile stops standing for it.
 *
 * It was exact equality, which since a gesture draws while the finger is
 * still down (LIVE_DRAW_MS) means a tile painted at a pause is thrown
 * away by the next two pixels of drag and drawn again at a scale half a
 * per cent different. placeDetail already stretches a tile into whatever
 * the zoom has become, so a sixth either way is a picture the reader
 * cannot tell from a fresh one, and it is the difference between a
 * gesture that draws once and one that draws at every pause.
 */
const DETAIL_DRIFT = 0.15;
/**
 * How far past what is on the screen a tile reaches, as a share of what
 * is on the screen.
 *
 * Entirely about how often a pan costs a redraw. A fifth either way
 * absorbs the small correction that follows a pinch without the tile
 * costing half as much again, and a pan that outruns it is a deliberate
 * move to somewhere else on the page, which wants its own tile whatever
 * this number says. A fifth either way is 1.4 squared, about twice the
 * screen; Gander's note beside the same number points out that Okular,
 * the one viewer that keeps both a viewport rectangle and a tile grid and
 * chooses at runtime, turns its grid on at four times the screen -- so at
 * twice, one rectangle is still the right answer here.
 *
 * It was a quarter of the whole pane, measured against the pane rather
 * than against the part of the page actually showing, which is how a page
 * barely on screen could ask for a tile larger than the budget.
 */
const DETAIL_MARGIN = 0.2;
/** Between two pages, in CSS pixels at any zoom — a gap that grew with the
 *  zoom would push the pages apart as they were read. */
const GAP = 8;
/** How many device pixels one page's picture may cost. Obsidian's own pair,
 *  read out of its app.js: 16777216, and `isMobile && 5242880`. A page is
 *  drawn at the screen's own pixel ratio until that would cost more than
 *  this, and at whatever ratio fits when it would — which is what keeps a
 *  page sharp at a phone's 2.75 or 3 without a canvas the size of a room
 *  when it is zoomed all the way in. */
const maxCanvasPixels = (): number => (Math.min(window.innerWidth, window.innerHeight) < 600 ? 5_242_880 : 16_777_216);
/** Pages are drawn one screen either side of the one being read, and their
 *  pictures kept until they are this far off it, so turning back a page
 *  costs nothing. Gander draws 3 and keeps 5 — of pages, not screens. */
const DRAW_SCREENS = 1;
const KEEP_SCREENS = 2.5;
/** How far out the rough pictures go, and how wide one is. Eight screens
 *  either way is about as far as a fast flick carries before it settles,
 *  and a hundred pixels of a page is 40KB where a sharp one is megabytes. */
const ROUGH_SCREENS = 8;
const ROUGH_PX = 100;
/**
 * How much of the sketch book is worth holding.
 *
 * A hundred-pixel picture of an A4 page is 100 by 141, four bytes a
 * pixel: 56KB. This is about four hundred of them -- the whole of his
 * 528-page book is 30MB, so a long book is held from wherever he is
 * reading outwards and the far end of it is let go of first.
 */
const SKETCH_BYTES = 24 * 1024 * 1024;
/**
 * How long one go at the engine may hold the thread for.
 *
 * The engine draws on this thread and cannot be interrupted, so whatever
 * it is in the middle of when a finger lands is a frame the reader does
 * not get. A page of his book at the screen's own pixels was measured at
 * 116ms -- seven frames, and the stutter he reported on a slow scroll,
 * which was there long before any of the background drawing was. The
 * same page in three pieces is three blocks of forty.
 *
 * It is a budget and not a size because the two documents in front of me
 * differ by a factor of eight: his scanned book costs 65ms a million
 * pixels, his typeset handout 8ms for the same pixels, and a phone is
 * slower than both. So the reader times what it draws and cuts the next
 * page into however many pieces that rate says it needs -- nothing on a
 * page that is already inside the budget.
 */
const SLICE_MS = 40;
/** A picture this big is worth cutting whatever it costs: the copy out of
 *  the engine and into a canvas is a frame's work on its own. */
const SLICE_PIXELS = 1_200_000;
/** Past this the fixed cost of asking again is most of what is left. */
const MOST_SLICES = 6;
/** How far out pages that have already been drawn are put back up. The
 *  engine is not asked for anything out here -- this is the sketch book
 *  going back into its boxes, which costs a line of code and no drawing,
 *  so it reaches twice as far as the band that can ask for a picture. A
 *  flick that outruns the planning, or a thread held up by something
 *  else, then lands on pages that are already in place. */
const BANK_SCREENS = 16;
/** How long nothing at all has to happen before the rest of the document
 *  is sketched in the background, and how long a touch stops it for. */
const IDLE_MS = 500;
/** After the reader stops, before the band is drawn again. */
const SETTLE_MS = 120;
/** A step of zoom from the chrome — a button, a fit stop, a double tap —
 *  used to arrive as a jump: the pages were suddenly bigger and the view
 *  was suddenly somewhere else, with no way to see where it had gone. The
 *  layout still goes to its new size at once, so the sharp pictures are
 *  drawn for the size the pages are about to be rather than after they
 *  get there; what is animated is the view the reader already had,
 *  scaled and slid into the new one. A pinch needs none of this: it is
 *  already following a finger. 200ms read as a flinch rather than a move;
 *  300 is long enough to be followed by eye and still answers the tap. */
/** How many results get the line they were found in. Reading a page back
 *  in reading order costs a read of its glyph boxes (13ms on this machine,
 *  three or four times that on a phone); a reader reads the first handful
 *  of results and taps one, so that is what is paid for. The rest are
 *  still listed, by page. */
const CONTEXT_ROWS = 60;
/** How much of the line either side of the match. */
const CONTEXT_CHARS = 40;
/** How long the column keeps its compositing layer after the hand leaves. */
const LAYER_COOL_MS = 2000;
const GLIDE_MS = 300;
/** How far past the letters a highlight is drawn, as a fraction of the
 *  line's own height, top and bottom. Enough that a match is a band rather
 *  than a hug, little enough that two lines of a paragraph keep a gap. */
const MARK_GROWTH = 0.22;
const GLIDE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

interface Slab {
  page: number;
  box: HTMLElement;
  proxy: PdfPageObject | null;
  /** The scale at which *this* page fills the pane's width. One number per
   *  page rather than one for the document: see measureFit. */
  fit: number;
  /**
   * The whole page, drawn once at the width the pane gives it — not at the
   * zoom. The browser stretches it for free, so a zoom shows something
   * immediately and a page is never blank, and no amount of zooming asks
   * for it again.
   */
  base: HTMLCanvasElement | null;
  /** The scale the whole-page picture was drawn at. Below fit width that
   *  is less than fit: a page shown at a third of its width is drawn at a
   *  third of its width. */
  baseScale: number;
  baseTask: PdfTask<Pixels> | null;
  /**
   * A rough picture of the whole page, a hundred pixels wide, drawn for a
   * band far wider than the sharp one and kept when the sharp one is given
   * back. Scrolling fast outruns the sharp pictures -- they are a page of
   * the screen's own pixels each -- and what the reader saw was empty
   * boxes going past. This costs about a fiftieth of one of those and is
   * stretched over the whole page, so what goes past is a soft version of
   * the page, and the sharp one lands on top of it when it arrives.
   */
  rough: HTMLCanvasElement | null;
  /** The pictures drawn on this page, in the page's own units, asked of
   *  the engine once. Empty for a page with none. */
  pictures: PictureRect[] | null;
  /** The photographs put back over the page, un-inverted. One piece per
   *  picture per bitmap it has been found in: a sharp tile usually holds
   *  part of a picture and no more, and that part is worth putting back. */
  photos: Photo[];
  roughTask: PdfTask<Pixels> | null;
  /**
   * The part of the page actually on screen, drawn at the screen's own
   * pixels and laid over the stretched base. Zoomed in, this is the only
   * thing a zoom or a scroll costs: one screenful, whatever the zoom.
   */
  detail: HTMLCanvasElement | null;
  detailRect: Rect | null;
  detailZoom: number;
  /** Whether that tile is the cheap one drawn under a moving finger, and
   *  so owes a full-resolution replacement the moment the hand is off. */
  detailQuick: boolean;
  detailTask: PdfTask<Pixels> | null;
  width: number; // natural, at scale 1
  height: number;
  laid: number;
  /** Where the page's top edge is down the column, in laid-out pixels.
   *  Written by layout(), so anything may ask where a page is without
   *  walking the column to find out. */
  top: number;
}

/** A rectangle of a page, in the page's own units (scale 1). */
interface Rect { x: number; y: number; width: number; height: number }

/**
 * A drawn page as the engine hands it over: the pixels themselves.
 *
 * It can hand over a PNG instead, and did. That is an encode on the way
 * out and a decode on the way back in -- both of them on this thread, for
 * a picture that is going straight onto a canvas and is thrown away after
 * -- and on a page of his book the two of them together were 40% of what
 * drawing the page cost: 164ms to 101ms.
 */
type Pixels = ImageDataLike;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** Tells a draw already in flight that nobody wants its picture — a zoom
 *  that lands mid-render, or a page scrolled far enough away to be given
 *  back. Without this the engine would finish every page ever asked for. */
const stop = (task: PdfTask<Pixels> | null): void => {
  task?.abort({ code: PdfErrorCode.Cancelled, message: 'superseded' });
};

/** Is this page dark already? Adapting a PDF to a dark theme inverts the
 *  paper and the ink, which is wrong for a page that was authored dark —
 *  a slide deck, a dark-background poster — because inverting it hands
 *  back the white page the reader was trying to get away from. A 24x24
 *  grid is laid over the page and the ring of cells around its edge is
 *  read, where the background lives and the content usually does not, and
 *  their brightness is weighted the way an eye weighs it (BT.601: green
 *  58.7%, red 29.9%, blue 11.4%). The median of the ring resists one dark
 *  photo bleeding off one side. Ninety-two pixels of the picture the
 *  engine just handed over, read where they lie: this used to squeeze the
 *  whole page into a thumbnail and read that back off the canvas, which
 *  is a draw and a readback per page for the same answer. */
const PROBE = 24;
const darkRing = (picture: Pixels): number[] => {
  const ring: number[] = [];
  for (let y = 0; y < PROBE; y += 1) {
    for (let x = 0; x < PROBE; x += 1) {
      if (x !== 0 && y !== 0 && x !== PROBE - 1 && y !== PROBE - 1) continue;
      const column = Math.min(picture.width - 1, Math.floor(((x + 0.5) / PROBE) * picture.width));
      const row = Math.min(picture.height - 1, Math.floor(((y + 0.5) / PROBE) * picture.height));
      const at = (row * picture.width + column) * 4;
      ring.push(0.299 * picture.data[at] + 0.587 * picture.data[at + 1] + 0.114 * picture.data[at + 2]);
    }
  }
  return ring;
};
/** Half the edge of the page is darker than mid grey. Taken from the ring
 *  of samples above -- of the whole picture when it was drawn in one go,
 *  and of every slice of it when it was not, which is the same edge plus
 *  the lines the slices were cut along. */
const ringIsDark = (ring: number[]): boolean => {
  const sorted = [...ring].sort((a, b) => a - b);
  return sorted.length > 0 && sorted[sorted.length >> 1] < 110;
};

/** One picture, or the part of one, drawn again over the page without the
 *  dark theme's filter on it. */
interface Photo {
  canvas: HTMLCanvasElement;
  /** Which of the page's pictures this is a piece of. */
  index: number;
  /** The piece of that picture this canvas holds, in the page's own units. */
  part: Rect;
  /** Whether it is the whole of the picture: a whole one replaces the lot. */
  whole: boolean;
}

/**
 * Is this picture a piece of the paper, or a thing printed on it?
 *
 * The dark theme inverts the page and every picture on it is then put back
 * as it was -- which is right for a photograph, and quite wrong for a
 * figure. A chart or a diagram exported out of a note is a picture of a
 * white sheet with a few lines on it, and leaving it alone leaves a white
 * rectangle glaring out of a dark page. The page's own rule cannot tell
 * them apart, because both are pictures on a page full of type.
 *
 * Their pixels can. A figure made on a computer has a background that is
 * *flat* paper white -- the same 255 across most of it -- and a photograph
 * of anything at all, a whiteboard included, has not: its white is 230 to
 * 250 and it moves from pixel to pixel. So a picture that is two fifths
 * paper white is treated as part of the sheet and inverted with it; every
 * other picture is put back as it was printed.
 *
 * Measured on a 24 by 24 reduction rather than the picture, which costs
 * one drawImage and one read whatever the picture's size, and which helps:
 * shrinking blends a photograph's white specks away and leaves a figure's
 * flat field exactly where it was.
 */
const PAPER_PROBE = 24;
/** A pixel this bright in all three channels is paper rather than ink. */
const PAPER_WHITE = 250;
/** And this much of a picture being paper makes the picture one. */
const PAPER_SHARE = 0.4;
const looksLikePaper = (drawn: HTMLCanvasElement, from: Rect): boolean => {
  const probe = window.document.createElement('canvas');
  probe.width = PAPER_PROBE;
  probe.height = PAPER_PROBE;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  try {
    context.drawImage(drawn, from.x, from.y, from.width, from.height, 0, 0, PAPER_PROBE, PAPER_PROBE);
    const pixels = context.getImageData(0, 0, PAPER_PROBE, PAPER_PROBE).data;
    let paper = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      if (Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) >= PAPER_WHITE) paper += 1;
    }
    return paper / (PAPER_PROBE * PAPER_PROBE) >= PAPER_SHARE;
  } catch { return false; }
};

/** Each document opened in this session gets its own name, so two tabs on
 *  the same file never share the engine's copy of it. */
let opened = 0;

export async function showPdf(host: HTMLElement, source: string | ArrayBuffer, options: PdfOptions): Promise<PdfHandle> {
  // PDFium, not pdf.js: the engine draws on its own and hands back a
  // picture, so there is no worker to wire up and no cmap, font or decoder
  // directory to point at — the one wasm file carries all of it, which is
  // why a scanned page can no longer come out blank for a missing decoder.
  const engine = await pdfium();
  opened += 1;
  const id = `satr-${opened}`;
  const document_: PdfDocumentObject = await (typeof source === 'string'
    ? engine.openDocumentUrl({ id, url: source })
    : engine.openDocumentBuffer({ id, content: source })).toPromise();

  const { scroller } = options;
  const doc = window.document.createElement('div');
  doc.className = 'pdf-doc';
  // The pages own sideways drags, both ways, the moment there are pages
  // wider than the screen -- the same mark a pannable table carries
  // (src/markdown.ts) and for the same reason, written down there as "a
  // reader pulling the table back to its first column had the whole page
  // slide out from under the finger". A zoomed document meets its
  // horizontal edge every few centimetres, and at the edge the drawer took
  // the drag: pushing a page to see its margin opened the files instead.
  // Only a pane with something to pan claims it, so with the pages at
  // their own width a swipe still opens a drawer as everywhere else.
  scroller.setAttribute('data-pan-x', '');
  // A reading of where the reader is, and nothing else: it is not tapped and
  // not dragged. The way through a long document is the scrollbar.
  const counter = window.document.createElement('div');
  counter.className = 'pdf-counter';
  // Chrome, not content. It used to ride inside the scroller, which made it
  // part of the document in every way that shows: it sat under the floating
  // buttons rather than with them, it slid sideways with a zoomed column,
  // and a sticky thing is moved by the compositor as the scroll goes by, so
  // it shifted a little when a fast scroll hit an edge. In the app's own
  // floating layer it is fixed to the screen, in the same stack as the
  // navbar pill, and none of that can happen.
  const overlay = options.overlay ?? window.document.querySelector<HTMLElement>('.navbar-wrap') ?? scroller;
  // One page is its own counter: it says nothing a reader doesn't see.
  counter.hidden = document_.pageCount < 2;
  host.append(doc);
  overlay.prepend(counter); // above the navbar pill, which is the layer's own child

  let zoom = clamp(options.place?.zoom ?? 1, MIN_ZOOM, MAX_ZOOM);
  /** The document has been closed: a scan still running stops where it is. */
  let shut = false;
  /** The zoom the reader asked for, on its way in. */
  let gliding: Animation | null = null;
  /** Take the motion off the column, leaving it where the layout already
   *  is. Says whether there was one, so that it is wound up exactly once. */
  const stopGlide = (): boolean => {
    const running = gliding;
    if (!running) return false;
    gliding = null;
    doc.style.transformOrigin = '';
    running.cancel();
    return true;
  };
  /** However the motion ends — arriving, or a hand landing on the page —
   *  the pages are drawn for the size they are at by the time it has. */
  const endGlide = (): void => { if (stopGlide()) drawBand(); };
  let derived: PdfOutlineItem[] | null = null;
  let deriving: Promise<PdfOutlineItem[]> | null = null;
  const slabs: Slab[] = [];

  // Every page's natural size, which is what the column is laid out from.
  // The engine reports all of them when the document opens, so the column is
  // laid out whole from the first frame and never jumps as the reader
  // scrolls into a page of another size.
  const sizes = document_.pages.map((page) => ({ page, width: page.size.width, height: page.size.height }));
  sizes.forEach(({ page, width, height }, index) => {
    const box = window.document.createElement('div');
    box.className = 'pdf-page';
    box.dataset.page = String(index + 1);
    doc.append(box);
    slabs.push({ page: index + 1, box, proxy: page, fit: 1, base: null, baseScale: 0, baseTask: null,
      rough: null, roughTask: null,
      pictures: null, photos: [],
      detail: null, detailRect: null, detailZoom: 0, detailQuick: false, detailTask: null, width, height, laid: height, top: 0 });
  });

  /**
   * Every page is laid out at the same width -- the pane's -- whatever its
   * own sheet measures.
   *
   * A document is not always printed on one size of paper: a scan dropped
   * into a thesis, a cover a few points narrower than the body, a table
   * turned sideways. This column used to fit the *widest* page to the pane
   * and then lay every other page out at that one scale, so a page a
   * centimetre narrower than its neighbours was shown a centimetre
   * narrower, and reading down the document the type changed size from one
   * page to the next. Nothing in the file asked for that: it was the single
   * document-wide number.
   *
   * So the scale is the page's own, `room / this page's width`, and zoom 1
   * is fit width for every page rather than for the widest one. A page of
   * another shape keeps its aspect ratio and is therefore taller or shorter
   * than its neighbours, which is the honest answer -- what it must not be
   * is narrower. The width itself is rounded once, in layout, and handed to
   * every page: computing it per page would let floating point put one box
   * on 389px and the next on 390px, which is the thing being fixed.
   */
  let room = 1; // the pane's width, less the gap on either side
  /** The steepest page in the document: the one that stands tallest once
   *  every page has been made the same width. It decides the fit-the-whole-
   *  page stop, where the tallest page used to. */
  const steepest = sizes.reduce((most, size) => Math.max(most, size.height / Math.max(1, size.width)), 0.1);
  const measureFit = (): void => {
    room = Math.max(1, scroller.clientWidth - 2 * GAP);
    for (const slab of slabs) slab.fit = room / Math.max(1, slab.width);
  };
  /** The scale a page is drawn and laid out at: its own fit width, times
   *  the one zoom the whole column shares. */
  const scaleOf = (slab: Slab): number => slab.fit * zoom;
  /**
   * What a finger is doing to the column this instant, as a multiple of
   * the zoom the layout is laid out at: 1 whenever nothing is being held.
   *
   * A pinch or a one-finger zoom scales the whole column with a CSS
   * transform and only commits to a zoom when the finger lifts, which is
   * what keeps the gesture on the compositor. Nothing used to be drawn
   * until then — no scroll event fires during a gesture, so nothing ever
   * made a plan — and a reader who held a page at three times its size
   * was looking at a stretched picture until they let go. Drive draws
   * under the finger. This is the number that lets us: the pictures are
   * asked for at the size the gesture is holding, and land in a box that
   * is already being shown at that size.
   */
  let living = 1;
  const liveScaleOf = (slab: Slab): number => scaleOf(slab) * living;
  const heightOf = (slab: Slab): number => slab.laid;
  /** Where the first page's top edge sits in the scroller — the column's own
   *  padding, and anything the pane puts above it. Measured rather than
   *  assumed: a jump to page five that lands eight pixels into page four is
   *  not a jump to page five. */
  let columnTop = 0;
  const measureTop = (): void => {
    columnTop = doc.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      + scroller.scrollTop + (parseFloat(getComputedStyle(doc).paddingTop) || 0);
  };
  /** The matches on screen. They are boxes over the page rather than
   *  anything the renderer knows about, so a zoom just re-lays them. */
  let marks: PdfHit[] = [];
  let marked = -1;
  /** The boxes the engine gives for one match are per glyph run: five
   *  slivers a pixel or two wide for a single word, each only as tall as
   *  the letters inside it. Drawn as they come, a highlight is a ragged
   *  skyline of blocks at four different heights. They are merged into one
   *  box a line -- the word's whole run -- and the box is grown a little
   *  past the letters, so a match reads as one stroke of a highlighter at
   *  a steady height, the way the panel's own highlights do. The growth is
   *  a fraction of the line, so lines keep the space between them. */
  const strokes = (hit: PdfHit): { x: number; y: number; w: number; h: number }[] => {
    const boxes = hit.rects.map((rect) => ({
      left: rect.origin.x, top: rect.origin.y,
      right: rect.origin.x + rect.size.width, bottom: rect.origin.y + rect.size.height,
    })).sort((a, b) => a.top - b.top || a.left - b.left);
    const lines: typeof boxes = [];
    for (const box of boxes) {
      const line = lines[lines.length - 1];
      // the same line when they overlap down the page by more than half of
      // the shorter of the two -- a descender or a tall letter is still
      // that line, a line below is not
      const shorter = line ? Math.min(line.bottom - line.top, box.bottom - box.top) : 0;
      const over = line ? Math.min(line.bottom, box.bottom) - Math.max(line.top, box.top) : -1;
      if (line && over > shorter * 0.5) {
        line.left = Math.min(line.left, box.left);
        line.right = Math.max(line.right, box.right);
        line.top = Math.min(line.top, box.top);
        line.bottom = Math.max(line.bottom, box.bottom);
      } else lines.push({ ...box });
    }
    return lines.map((line) => {
      const grown = (line.bottom - line.top) * MARK_GROWTH;
      return { x: line.left, y: line.top - grown, w: line.right - line.left, h: (line.bottom - line.top) + grown * 2 };
    });
  };
  const drawMarks = (): void => {
    for (const slab of slabs) for (const old of slab.box.querySelectorAll('.pdf-find-hit')) old.remove();
    marks.forEach((hit, index) => {
      const slab = slabs[hit.page - 1];
      if (!slab) return;
      const scale = scaleOf(slab);
      for (const stroke of strokes(hit)) {
        const el = document.createElement('div');
        el.className = index === marked ? 'pdf-find-hit is-current' : 'pdf-find-hit';
        el.style.left = `${stroke.x * scale}px`;
        el.style.top = `${stroke.y * scale}px`;
        el.style.width = `${stroke.w * scale}px`;
        el.style.height = `${stroke.h * scale}px`;
        slab.box.append(el);
      }
    });
  };

  const layout = (): void => {
    unspace();
    // Rounded once and shared, so no two pages can land a pixel apart.
    const wide = Math.max(1, Math.round(room * zoom));
    let edge = 0;
    for (const slab of slabs) {
      slab.laid = Math.max(1, Math.round(wide * (slab.height / Math.max(1, slab.width))));
      slab.top = edge;
      edge += slab.laid + GAP;
      slab.box.style.width = `${wide}px`;
      slab.box.style.height = `${slab.laid}px`;
      // the sharp picture goes where the zoom put it, stretched for now and
      // redrawn when the reader stops moving
      placeDetail(slab);
    }
    if (marks.length) drawMarks();
    measureTop();
  };

  /** The strip the chrome keeps for itself at the top of the pane. A file
   *  that is shown rather than read never hides its header, so a place at
   *  "the top of the screen" belongs under the header and not behind it —
   *  otherwise opening a document scrolls its first page straight back
   *  under the bar and undoes the room the stylesheet just made.
   *  drawBand deliberately does NOT use this: the bar is frosted, so the
   *  page behind it is visible and still has to be drawn. */
  const chromeTop = (): number => parseFloat(getComputedStyle(host).paddingTop) || 0;
  /** Where the top of the screen is, as a page and a fraction into it. */
  const placeNow = (): PdfPlace => {
    const top = scroller.scrollTop + chromeTop() - columnTop;
    let edge = 0;
    for (const slab of slabs) {
      const height = heightOf(slab);
      // A pixel short of a page's top edge is that page, not the gap above
      // it: scroll offsets are not exact and a reader who asked for page
      // thirty is on page thirty.
      if (top < edge + height + GAP - 1 || slab.page === slabs.length) {
        return { page: slab.page, into: clamp((top - edge) / Math.max(1, height), 0, 1), zoom, across: acrossNow() };
      }
      edge += height + GAP;
    }
    return { page: 1, into: 0, zoom, across: acrossNow() };
  };
  /** The sheet's left edge in the pane's own scrolling coordinates, which
   *  is not zero: a sheet narrower than the pane is centred in it. */
  const sheetLeft = (): number =>
    doc.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
  /** Where the middle of the screen is across the sheet, 0 to 1. */
  const acrossNow = (): number => {
    const width = doc.getBoundingClientRect().width;
    if (width < 1) return 0.5;
    return clamp((scroller.scrollLeft + scroller.clientWidth / 2 - sheetLeft()) / width, 0, 1);
  };
  /** The scroll offset that puts a place's sideways fraction back under the
   *  middle of the screen. A sheet that fits has nowhere to go, and a place
   *  from before this was written down lands in the middle. */
  const leftFor = (place: { across?: number }): number => {
    const reach = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    if (!reach) return 0;
    if (place.across == null) return reach / 2;
    const width = doc.getBoundingClientRect().width;
    if (width < 1) return reach / 2;
    return clamp(sheetLeft() + place.across * width - scroller.clientWidth / 2, 0, reach);
  };
  /** The scroll offset that puts a place at the top of the screen. */
  const offsetOf = (place: { page: number; into: number }): number => {
    let edge = 0;
    for (const slab of slabs) {
      if (slab.page === place.page) return columnTop + edge + place.into * heightOf(slab);
      edge += heightOf(slab) + GAP;
    }
    return 0;
  };
  /** The same offset, as a scroll position: the place lands just below the
   *  header rather than under it. The pinch keeps the raw offsetOf, because
   *  there the anchor is the finger and not the top of the screen. */
  const topFor = (place: { page: number; into: number }): number =>
    Math.max(0, offsetOf(place) - chromeTop());

  // The place a document is opened at, held until the reader touches it.
  // Opening is not a quiet moment: the pane is measured, laid out, hidden
  // and shown again while the app settles, and a pane that is re-laid out
  // loses its scroll offset without anybody setting it — the browser simply
  // drops it. So the place is not applied once and trusted; it is kept and
  // put back after every one of those, and only a hand on the document
  // spends it. Until then nothing is written down either, or the stray
  // scroll to the top would become the place.
  let pending: PdfPlace | null = null;
  const applyPending = (): boolean => {
    if (!pending) return false;
    if (!scroller.clientWidth || !scroller.clientHeight) return true; // nowhere to put it yet
    options.ownScroll?.();
    scroller.scrollTop = topFor(pending);
    scroller.scrollLeft = leftFor(pending);
    return true;
  };
  const letGo = (): void => { pending = null; };

  let settleTimer = 0;
  /** When the pane last moved, so the dearest work can wait for a hand to
   *  come off the glass. */
  let movedAt = 0;
  let replanning = 0;
  /** Re-plan on the next frame, however many scroll events arrive. */
  const replan = (): void => {
    if (replanning) return;
    replanning = requestAnimationFrame(() => { replanning = 0; drawBand(); });
  };

  /** Everything this slab is holding, handed back. */
  const forget = (slab: Slab): void => {
    stop(slab.baseTask); stop(slab.detailTask);
    slab.baseTask = null; slab.detailTask = null;
    // The sharp picture goes, but not the page: what it knew is kept as the
    // rough one, shrunk out of the picture already drawn rather than asked
    // of the engine again, so coming back up a document shows the page
    // immediately.
    if (slab.base?.isConnected && !slab.rough) keepRough(slab, slab.base);
    slab.base?.remove(); slab.base = null; slab.baseScale = 0;
    slab.detail?.remove(); slab.detail = null; slab.detailRect = null; slab.detailZoom = 0; slab.detailQuick = false;
  };
  /** Forget a page: everything it is holding goes back, and the page box
   *  is empty again. Its hundred-pixel picture is not thrown away with
   *  the rest -- that goes to the sketch book, 56KB, and is what makes
   *  coming back past this page cost nothing. */
  const forgetWhole = (slab: Slab): void => {
    forget(slab);
    stop(slab.roughTask); slab.roughTask = null;
    slab.rough?.remove(); slab.rough = null;
    for (const photo of slab.photos) photo.canvas.remove();
    slab.photos = [];
  };
  /**
   * The photographs on a page, put back over the drawn page as they are.
   *
   * The dark theme is one filter over the whole page, and a photograph is
   * part of a page: a whiteboard came out black with white chalk on it,
   * and a page of slides came out with its pictures in negative. The page
   * keeps the filter -- that is what makes a document readable in the dark
   * -- and every picture on it is drawn again on top, unfiltered, out of
   * the same bitmap the page was drawn from. Nothing is inverted twice and
   * nothing is drawn twice by the engine.
   *
   * The boxes are placed in the page's own terms (a share of its width and
   * height), so a zoom moves them with the page and none of this runs
   * again. They are drawn in both themes and shown in the dark one, so
   * turning the theme over stays what it has always been: a class on the
   * body, nothing redrawn.
   *
   * `area` is the part of the page this bitmap holds, in page units: the
   * whole page for the base and rough pictures, a rectangle of it for a
   * sharp tile.
   */
  const drawPhotos = (slab: Slab, drawn: HTMLCanvasElement, area: Rect): void => {
    if (!slab.proxy) return;
    // The engine is on its own thread, so this answer is not here the
    // first time a page is drawn. It is asked for once and the page is
    // drawn again from whatever picture it is holding when it lands --
    // which is a line of work, against never blocking the finger.
    if (slab.pictures === null) { void askPictures(slab); return; }
    if (!slab.pictures.length) return;
    const unit = slab.width / Math.max(1, slab.proxy.size.width); // page units to ours
    const per = drawn.width / Math.max(1, area.width); // and ours to this canvas's pixels
    slab.pictures.forEach((picture_, index) => {
      const left = picture_.x * unit;
      const top = picture_.y * unit;
      const right = left + picture_.width * unit;
      const bottom = top + picture_.height * unit;
      // As much of it as this bitmap holds. A sharp tile of a zoomed page
      // usually holds a corner of a picture and no more; that corner used
      // to be dropped, so a zoomed photograph kept the soft copy taken off
      // the base. The piece is cut to the bitmap instead, and put back
      // over its own part of the page.
      const part = {
        x: Math.max(left, area.x),
        y: Math.max(top, area.y),
        width: Math.min(right, area.x + area.width) - Math.max(left, area.x),
        height: Math.min(bottom, area.y + area.height) - Math.max(top, area.y),
      };
      if (!(part.width > 0.5) || !(part.height > 0.5)) return;
      const whole = part.width >= (right - left) - 1 && part.height >= (bottom - top) - 1;
      const from = {
        x: (part.x - area.x) * per, y: (part.y - area.y) * per,
        width: part.width * per, height: part.height * per,
      };
      // A figure is part of the sheet and goes dark with it; a photograph
      // is a thing on the sheet and is put back as it was printed.
      if (looksLikePaper(drawn, from)) {
        if (whole) dropPhotos(slab, index, () => true);
        return;
      }
      const made = sheet(Math.max(1, Math.round(from.width)), Math.max(1, Math.round(from.height)), 1);
      if (!made) return;
      made.context.drawImage(drawn, from.x, from.y, from.width, from.height, 0, 0, made.canvas.width, made.canvas.height);
      made.canvas.className = 'pdf-photo';
      made.canvas.style.left = `${(part.x / slab.width) * 100}%`;
      made.canvas.style.top = `${(part.y / slab.height) * 100}%`;
      made.canvas.style.width = `${(part.width / slab.width) * 100}%`;
      made.canvas.style.height = `${(part.height / slab.height) * 100}%`;
      // The whole of a picture is the whole truth about it and replaces
      // every piece; a piece replaces the pieces it covers, and lies over
      // whatever is left because it is the sharper of the two.
      dropPhotos(slab, index, (photo) => whole || inside(photo.part, part));
      slab.photos.push({ canvas: made.canvas, index, part, whole });
      slab.box.append(made.canvas);
    });
  };
  /** Which pages have a question outstanding, so a page being drawn
   *  three times over does not ask three times. */
  const asking = new Set<number>();
  const askPictures = async (slab: Slab): Promise<void> => {
    if (!slab.proxy || asking.has(slab.page)) return;
    asking.add(slab.page);
    const found = await imagesOnPage(document_, slab.proxy).catch(() => [] as PictureRect[]);
    asking.delete(slab.page);
    if (shut || slab.pictures !== null) return;
    slab.pictures = found;
    if (!found.length) return;
    // Over the best picture of the page there is: the sharp one if it has
    // landed, the rough one otherwise, and the sharp one will put these
    // back itself when it arrives.
    const whole = slab.base ?? slab.rough;
    if (whole) drawPhotos(slab, whole, { x: 0, y: 0, width: slab.width, height: slab.height });
  };
  /** Take down the pieces of one picture that the test picks out. */
  const dropPhotos = (slab: Slab, index: number, pick: (photo: Photo) => boolean): void => {
    slab.photos = slab.photos.filter((photo) => {
      if (photo.index !== index || !pick(photo)) return true;
      photo.canvas.remove();
      return false;
    });
  };
  /** Is the first rectangle wholly within the second? */
  const inside = (box: Rect, other: Rect): boolean =>
    box.x >= other.x - 0.5 && box.y >= other.y - 0.5
    && box.x + box.width <= other.x + other.width + 0.5
    && box.y + box.height <= other.y + other.height + 0.5;

  /**
   * The sketch book: a hundred-pixel picture of every page that has been
   * drawn, kept by page number and not by slab, so it outlives the page
   * itself.
   *
   * Scrolling fast used to run off the end of what had been drawn -- the
   * rough pictures reach eight screens either way, and a hard flick
   * crosses that in a moment -- and what went past was empty boxes until
   * the engine caught up, a page at a time, twenty-odd milliseconds each.
   * He asked for them to be there already. A page's picture at this size
   * costs a fiftieth of what it costs to draw and a fiftieth of what a
   * sharp one costs to hold, so once the engine has drawn one there is no
   * reason to ever give it back: coming back past a page, jumping into
   * the middle of the book, flicking through fifty of them -- all of it
   * is a canvas going back into the page box, with nothing asked of the
   * engine at all.
   *
   * What is not already drawn gets drawn in the background, outwards from
   * where the reader is, while nothing else is happening (crawl).
   */
  const sketches = new Map<number, HTMLCanvasElement>();
  let sketchBytes = 0;
  /** A few of these pages, put down for the next time this document is
   *  opened. Written at the foot of this function, where the key and the
   *  page the reader is on are both to hand; called from rest(), so the
   *  shelf is up to date long before anything as unreliable as an unload
   *  has to be relied on. */
  let putDown = (always = false): void => { void always; };
  /** Keep a page's rough picture, and let go of the ones farthest from
   *  the reader if the book is now too heavy to carry. */
  const bank = (index: number, canvas: HTMLCanvasElement): void => {
    const already = sketches.get(index);
    if (already === canvas) return;
    if (already) sketchBytes -= already.width * already.height * 4;
    sketches.set(index, canvas);
    sketchBytes += canvas.width * canvas.height * 4;
    if (sketchBytes > SKETCH_BYTES) {
      const here = pageAt(scroller.scrollTop - columnTop + scroller.clientHeight / 2);
      const farthest = [...sketches.keys()].sort((first, second) => Math.abs(second - here) - Math.abs(first - here));
      for (const page of farthest) {
        if (sketchBytes <= SKETCH_BYTES) break;
        if (page === index || slabs[page]?.rough) continue; // not one that is up on the screen
        const old = sketches.get(page);
        if (!old) continue;
        sketchBytes -= old.width * old.height * 4;
        sketches.delete(page);
        old.width = 0; // hand the bitmap back now rather than at the collector's leisure
        old.height = 0;
      }
    }
    doc.dataset.sketched = String(sketches.size);
  };
  /** Put a page's kept picture back up, with its photographs over it if
   *  nothing better has drawn them. */
  const showSketch = (slab: Slab, canvas: HTMLCanvasElement): void => {
    if (!slab.photos.length) drawPhotos(slab, canvas, { x: 0, y: 0, width: slab.width, height: slab.height });
    showRough(slab, canvas);
  };

  /** Shrink a picture already drawn into the rough one. */
  const keepRough = (slab: Slab, from: HTMLCanvasElement): void => {
    const width = ROUGH_PX;
    const height = Math.max(1, Math.round(width * (slab.height / Math.max(1, slab.width))));
    const made = sheet(width, height, 1);
    if (!made) return;
    try { made.context.drawImage(from, 0, 0, width, height); } catch { return; }
    showRough(slab, made.canvas);
  };
  /** Put a rough picture up, underneath whatever sharp one there is --
   *  and into the sketch book, which is where it stays. */
  const showRough = (slab: Slab, canvas: HTMLCanvasElement): void => {
    canvas.className = 'pdf-rough';
    if (slab.rough && slab.rough !== canvas) slab.rough.remove();
    slab.box.prepend(canvas);
    slab.rough = canvas;
    bank(slab.page - 1, canvas);
  };
  /** The whole page at a hundred pixels, for the wide band -- out of the
   *  sketch book if it has been drawn before, and otherwise drawn. */
  async function paintRough(slab: Slab): Promise<void> {
    if (!slab.proxy || slab.rough || slab.roughTask) return;
    const kept = sketches.get(slab.page - 1);
    if (kept) { showSketch(slab, kept); return; }
    await sketchPage(slab);
  }

  /** One page at a hundred pixels, drawn and kept whether or not the page
   *  is anywhere near the screen: this is the only thing that ever asks
   *  the engine for a rough picture. */
  async function sketchPage(slab: Slab): Promise<void> {
    if (!slab.proxy || slab.roughTask) return;
    const scale = ROUGH_PX / Math.max(1, slab.width);
    const task = engine.renderPageRaw(document_, slab.proxy, { scaleFactor: scale, dpr: 1, withAnnotations: false });
    slab.roughTask = task;
    let picture: Pixels;
    try { picture = await task.toPromise(); }
    catch { if (slab.roughTask === task) slab.roughTask = null; return; }
    if (slab.roughTask === task) slab.roughTask = null;
    if (shut) return;
    const made = sheet(picture.width, picture.height, 1);
    if (!made) return;
    made.context.putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
    // Anywhere near the reader it goes up now -- as far out as the sketch
    // book reaches, which is twice as far as the engine is ever asked to
    // draw. Putting a picture that exists into a box that is empty costs
    // a line; leaving it in the book means the reader finds the box empty
    // until something else makes a plan.
    if (!slab.rough && standing(slab).bank) showSketch(slab, made.canvas);
    else bank(slab.page - 1, made.canvas);
  }

  /**
   * Two pictures per page, not one.
   *
   * The base is the whole page at the pane's width, and it never changes
   * when the reader zooms: the browser stretches it, which costs nothing
   * and means a zoom is instant and a page is never blank. Zoomed in, the
   * stretch is soft, so a second picture is drawn over it — but only of the
   * part on screen, at the screen's own pixels. That is the whole of what a
   * zoom costs now: one screenful, at 8x as at 2x.
   *
   * The page used to be redrawn whole at every zoom, which at 4x is sixteen
   * times the pixels of the screen it is shown on, nearly all of them off
   * the edges — and over the budget, so the engine was asked for fewer
   * pixels than the screen has and the text came back soft anyway. Slicing
   * was tried before this and abandoned, because with pdf.js a slice cost a
   * page: the engine can draw a rectangle on its own now.
   */

  /**
   * The space between pages is the same at every zoom.
   *
   * A pinch does not lay the column out again -- it scales the whole
   * column, which is one transform the compositor can do on its own while
   * the fingers move. But the eight pixels between two pages are inside
   * that column, so they were scaled too: pinching to two and a half
   * opened the pages twenty pixels apart, and lifting the fingers snapped
   * them back to eight.
   *
   * So while a gesture is scaling the column, every page near the screen
   * is moved back by the slack the scaled gaps add up to -- eight pixels
   * of it per page between that page and the one the fingers are on, which
   * is the page that must not move. The sums are per page and the writes
   * are transforms, so none of this lays anything out; it is the same
   * frame the pinch was already costing.
   */
  let spaced: Slab[] = [];
  const unspace = (): void => {
    for (const slab of spaced) slab.box.style.transform = '';
    spaced = [];
  };
  const spaceOut = (factor: number, about: number): void => {
    const slack = GAP * (1 / Math.max(0.01, factor) - 1);
    const was = spaced;
    spaced = [];
    // the narrow band here, not the sketch book's: this writes a transform
    // on every page it covers, on every frame of a pinch
    const band = bandNow(ROUGH_SCREENS);
    for (let index = band.first; index <= band.last; index += 1) {
      const slab = slabs[index];
      if (!standing(slab).rough) continue;
      slab.box.style.transform = `translateY(${((slab.page - 1 - about) * slack).toFixed(2)}px)`;
      spaced.push(slab);
    }
    for (const slab of was) if (!spaced.includes(slab)) slab.box.style.transform = '';
  };
  /** The page at an offset down the column, as an index from zero. The
   *  pages are laid out in order, so this is a search and not a walk: ten
   *  comparisons on his 528-page book where walking it was five hundred,
   *  and this is asked on every frame of a scroll. */
  const pageAt = (offset: number): number => {
    let low = 0;
    let high = slabs.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      const slab = slabs[middle];
      if (offset < slab.top + heightOf(slab) + GAP) high = middle; else low = middle + 1;
    }
    return Math.max(0, low);
  };
  /** The page under a point on the screen, as an index from zero. */
  const pageUnder = (clientY: number): number =>
    pageAt(scroller.scrollTop + (clientY - scroller.getBoundingClientRect().top) - columnTop);
  /** How far along its own curve the glide is at a fraction of its time,
   *  so the gaps can be laid out along the same curve the scale takes. */
  const glideAt = (part: number): number => {
    const [x1, x2] = [0.22, 0.36];
    let low = 0;
    let high = 1;
    let time = part;
    for (let step = 0; step < 24; step += 1) {
      time = (low + high) / 2;
      const rest = 1 - time;
      const at = 3 * rest * rest * time * x1 + 3 * rest * time * time * x2 + time * time * time;
      if (at < part) low = time; else high = time;
    }
    const rest = 1 - time;
    return 3 * rest * rest * time + 3 * rest * time * time + time * time * time;
  };

  /**
   * The stretch of the column worth looking at at all: the wide band and
   * no further, as a first and last page.
   *
   * The sweep used to walk every page of the document on every frame of a
   * scroll, asking each one where it stood and handing back whatever the
   * ones out of sight were holding. On his 528-page book that was 1.4ms a
   * frame while scrolling, and 100ms on the frame after a jump, when a
   * hundred pages at once were given back things they had already given
   * back. The pages are laid out in order, so the band is a range, and
   * the only pages outside it that can be holding anything are the ones
   * that were inside it last time.
   */
  let bandFrom = 0;
  let bandTo = -1;
  const bandNow = (screens = BANK_SCREENS): { first: number; last: number } => {
    if (!slabs.length) return { first: 0, last: -1 }; // nothing laid out yet
    const screen = scroller.clientHeight;
    const top = scroller.scrollTop - columnTop;
    return {
      first: pageAt(top - screens * screen),
      last: pageAt(top + (1 + screens) * screen),
    };
  };

  /** Where a page stands in relation to the screen: the three bands are
   *  what gets drawn, what is kept when it goes by, and what is worth a
   *  hundred pixels of itself. What order they are drawn in is a separate
   *  question, and the reader's own (stepsFrom). */
  const standing = (slab: Slab): { seen: boolean; near: boolean; keep: boolean; rough: boolean; bank: boolean } => {
    const screen = scroller.clientHeight;
    const top = scroller.scrollTop - columnTop;
    const from = slab.top;
    const to = slab.top + heightOf(slab);
    return {
      seen: to > top && from < top + screen,
      near: to > top - DRAW_SCREENS * screen && from < top + (1 + DRAW_SCREENS) * screen,
      keep: to > top - KEEP_SCREENS * screen && from < top + (1 + KEEP_SCREENS) * screen,
      rough: to > top - ROUGH_SCREENS * screen && from < top + (1 + ROUGH_SCREENS) * screen,
      bank: to > top - BANK_SCREENS * screen && from < top + (1 + BANK_SCREENS) * screen,
    };
  };

  /**
   * The scale a whole-page picture is worth drawing at.
   *
   * Zoomed in that is the pane's width and no more -- the sharp tile is
   * what carries a zoom, so zooming in asks nothing of the engine for the
   * page underneath it. Zoomed out it is the width the page is actually
   * shown at: a sheet a third of the pane wide was being drawn at the
   * full width of the pane and shrunk into a third of it, which on a page
   * of his book is 167ms of the thread for pixels nobody can see. Pages
   * already drawn keep the bigger picture they have -- throwing it away
   * to draw a worse one is not an economy -- so this only ever makes new
   * work cheaper.
   */
  const baseWanted = (slab: Slab): number => slab.fit * Math.min(1, zoom * living);

  /** Is this page still waiting for this, now? Asked again at the moment
   *  the work would start, because by then the reader has usually moved.
   *
   *  While the view is moving, a page is only worth the engine's whole
   *  attention while it is actually on the screen -- not a screen either
   *  side of it. A page of his book is a tenth of a second to draw, and
   *  a flick crosses a screen in less than that: what was being drawn
   *  was pages the reader had already gone past, with the thread they
   *  were drawn on being the same one the scroll runs on. */
  const stillWanted = (job: Job): boolean => {
    const where = standing(job.slab);
    if (!job.slab.proxy) return false;
    if (job.work === 'rough') return where.rough && !job.slab.rough && !job.slab.roughTask;
    const close = Date.now() - movedAt < SETTLE_MS ? where.seen : where.near;
    if (job.work === 'base') return close && !sharpEnough(job.slab.baseScale, baseWanted(job.slab));
    return close;
  };

  /**
   * One page at a time, nearest first, and a frame between each.
   *
   * Everything in the band used to be asked for at once, in page order.
   * The engine takes about a fortieth of a second just to take a page of
   * his book apart before it draws anything, so a band of twenty-two
   * pages blocked the thread for most of a second before the first
   * picture appeared -- and the pages above the screen were asked for
   * first, because they come first in the document. A flick landed, and
   * the reader waited while eleven pages they had already passed were
   * drawn behind them.
   *
   * Now the band is a list of jobs sorted by what the reader can see, and
   * it is worked one at a time with a frame to breathe in between: the
   * page in front of them is drawn first, every scroll re-sorts what is
   * left, and a page that has gone by is dropped before it costs
   * anything.
   */
  type Work = 'rough' | 'base' | 'detail';
  interface Job { slab: Slab; work: Work; rank: number }
  let queue: Job[] = [];
  let drawing = false;
  /**
   * The order the reader asked for: the page they are on, then outwards a
   * page at a time, and the page after the one they are on before the one
   * before it -- a document is read downwards.
   *
   * Distance is counted in pages and not in pixels, because that is how a
   * reader counts it: the next page is the next page whether it is a
   * screen away or a thumb's width.
   */
  const stepsFrom = (slab: Slab, here: number): number => {
    const steps = slab.page - 1 - here;
    return steps >= 0 ? steps * 2 : -steps * 2 + 1;
  };
  /**
   * And within one page: something rather than nothing, then sharp where
   * the reader is looking, then the whole page behind it.
   *
   * Sharpening the page under the reader outranks everything on every
   * other page, which is the other half of what he asked for -- a zoom is
   * the reader saying "this, closer", and preparing the page after it can
   * wait the fifth of a second that takes.
   */
  const KINDS = 3;
  const KIND: Record<Work, number> = { rough: 0, detail: 1, base: 2 };
  /**
   * While the reader is still moving, though, that turns over: every
   * page's rough picture comes before any page's sharp one.
   *
   * He asked for this in those words -- the low quality ones first when
   * scrolling. A sharp page is a fifth of a second of the thread and is
   * for a place the reader has already left; a rough one is a fiftieth,
   * and is the difference between a flick that runs over soft pages and
   * one that runs over empty boxes. The moment they stop, the order is
   * the reader's own again and the page in front of them is sharpened.
   */
  const rank = (work: Work, steps: number, moving: boolean): number => (moving
    ? KIND[work] * slabs.length * KINDS + steps
    : steps * KINDS + KIND[work]);

  /** A frame to itself between one page and the next, so what was just
   *  drawn is painted and a scroll meanwhile is heard. A pane nobody is
   *  looking at gets no frames, and falls back to the timer. */
  const breathe = (): Promise<void> => new Promise((done) => {
    requestAnimationFrame(() => { window.setTimeout(done, 0); });
    window.setTimeout(done, 80);
  });

  /** Something came out of the sketch book on this plan, and has not
   *  been on the screen yet. */
  let unpainted = false;
  const pump = async (): Promise<void> => {
    if (drawing) return;
    drawing = true;
    try {
      // A frame for the pages just put up out of the book, before the
      // engine is asked for anything. They are already drawn and already
      // in their boxes; without this they wait behind a whole page of
      // the engine's time -- a tenth of a second on his book -- and the
      // reader watches empty boxes for all of it. This is the whole of
      // what he asked for: the soft ones, now, and the sharp one after.
      if (unpainted) { unpainted = false; await breathe(); }
      while (queue.length) {
        // The move first, then the work: while a zoom is gliding, the
        // pages travel on the pictures they already have. Drawing one
        // during the motion is the stutter this animation was built to
        // get away from.
        if (gliding?.playState === 'running') { await breathe(); continue; }
        const job = queue.shift();
        if (!job || !stillWanted(job)) continue;
        if (job.work === 'rough') await paintRough(job.slab);
        else if (job.work === 'base') await paintBase(job.slab);
        else {
          const want = detailWanted(job.slab);
          if (!want) continue;
          // Against the live zoom, which is what the tile was drawn for
          // and what it is being looked at through: measured against the
          // laid-out zoom instead, every tile after the first in a
          // gesture looked near enough and the sweep went unrefreshed.
          if (nearEnough(job.slab.detailZoom, zoom * living, 1 + DETAIL_DRIFT) && job.slab.detailRect && covers(job.slab.detailRect, want)
            && (sweeping() || !job.slab.detailQuick)) continue;
          await paintDetail(job.slab, want);
        }
        await breathe();
      }
    } finally { drawing = false; rest(); }
  };

  /**
   * The rest of the document, sketched while nobody is looking.
   *
   * The band draws what the reader can see and a little either side of
   * it. This fills in everything else -- outwards from the page they are
   * on, one page at a time, a frame apart -- so that a flick, a jump or
   * a scrubbed scrollbar runs into pages that are already there instead
   * of empty boxes and a queue. It is the cheapest picture there is: a
   * hundred pixels across, a fiftieth of a page of his book to draw and
   * a fiftieth of one to hold.
   *
   * It yields to everything. A hand on the glass, a glide still running,
   * a band with work left in it, the sketch book full -- any of those and
   * it stops where it is; a quiet half second and it starts again from
   * wherever the reader has got to. The one cost it can impose is the
   * page it is in the middle of when a finger lands, which on his book is
   * twenty-odd milliseconds.
   */
  let crawling = false;
  let idleTimer = 0;
  const wanted = (): boolean => !shut && !drawing && !queue.length
    && gliding?.playState !== 'running' && Date.now() - movedAt >= IDLE_MS
    && sketchBytes < SKETCH_BYTES;
  const crawl = async (): Promise<void> => {
    if (crawling || !wanted()) return;
    crawling = true;
    try {
      const here = pageAt(scroller.scrollTop - columnTop + scroller.clientHeight / 2);
      for (let out = 0; out < slabs.length; out += 1) {
        for (const index of out ? [here + out, here - out] : [here]) {
          const slab = slabs[index];
          if (!slab || !slab.proxy || sketches.has(index) || slab.roughTask) continue;
          if (!wanted()) return; // the reader is back, or the book is full
          await sketchPage(slab);
          await breathe();
        }
      }
    } finally { crawling = false; }
  };
  /** Nothing for half a second: carry on with the sketch book. */
  const rest = (): void => {
    window.clearTimeout(idleTimer);
    // Before the walk and after it. Before, because the walk over a long
    // document runs for half a minute -- his book is four hundred pages
    // of sketching -- and a refresh in the middle of it would otherwise
    // find nothing written down at all. After, because by then there is
    // usually more worth keeping, and nothing else calls rest() again
    // once the queue has run dry.
    idleTimer = window.setTimeout(() => { putDown(); void crawl().finally(() => putDown()); }, IDLE_MS);
  };

  const drawBand = (): void => {
    const jobs: Job[] = [];
    /** Pages whose picture is already drawn and only has to be put back,
     *  nearest the reader first like everything else here. */
    const recalled: { slab: Slab; steps: number; kept: HTMLCanvasElement }[] = [];
    const moving = Date.now() - movedAt < SETTLE_MS;
    // The page in the middle of the screen is the one being read, and
    // everything is ranked by how far from it it is.
    const here = pageAt(scroller.scrollTop - columnTop + scroller.clientHeight / 2);
    const band = bandNow();
    // what has gone out of the band since the last pass, and nothing else:
    // every other page gave back what it was holding long ago
    for (let index = bandFrom; index <= bandTo; index += 1) {
      if (index < band.first || index > band.last) forgetWhole(slabs[index]);
    }
    bandFrom = band.first;
    bandTo = band.last;
    for (let index = band.first; index <= band.last; index += 1) {
      const slab = slabs[index];
      // A picture that is not in the document is not a picture this page
      // has: the box can be emptied from outside -- and what is held is
      // meant to be what is up.
      if (slab.rough && !slab.rough.isConnected) slab.rough = null;
      if (slab.base && !slab.base.isConnected) { slab.base = null; slab.baseScale = 0; }
      const where = standing(slab);
      if (!where.bank) { forgetWhole(slab); continue; } // right out of sight: all of it back
      if (!where.keep) forget(slab); // out of the sharp band: the rough picture stays
      if (!slab.proxy) continue;
      // A page anywhere in the wide band gets its rough picture, so a fast
      // scroll runs into soft pages rather than empty ones -- but a page
      // on the screen with nothing on it at all comes first.
      const steps = stepsFrom(slab, here);
      if (!slab.rough && !slab.base) {
        // Drawn before, at any point since the document was opened: it
        // goes back up now, on this frame, without the engine being
        // asked and without waiting in a queue behind anything.
        const kept = sketches.get(index);
        if (kept) recalled.push({ slab, steps, kept });
        else if (where.rough && !slab.roughTask) jobs.push({ slab, work: 'rough', rank: rank('rough', steps, moving) });
      }
      if (!where.near) continue;
      if (!sharpEnough(slab.baseScale, baseWanted(slab)) && (!moving || where.seen)) {
        jobs.push({ slab, work: 'base', rank: rank('base', steps, moving) });
      }
      const want = detailWanted(slab);
      if (!want) {
        if (slab.detail) { stop(slab.detailTask); slab.detailTask = null; slab.detail.remove(); slab.detail = null; slab.detailRect = null; }
        continue;
      }
      // A screenful at the screen's own pixels is the dearest thing here;
      // it waits until the scrolling stops rather than being drawn for a
      // place the reader is already leaving.
      if (moving) continue;
      // Under a hand there is a floor on what a tile is worth. At a tenth
      // over its own width the page's own picture, stretched, is within a
      // tenth of right, and the tile costs a slice of the gesture's own
      // frames to be no better. At rest the ordinary threshold stands.
      if (sweeping() && zoom * living < 1 + DETAIL_DRIFT) continue;
      // Near enough, covering enough, and not the cheap one left over
      // from a gesture that is now over.
      if (nearEnough(slab.detailZoom, zoom * living, 1 + DETAIL_DRIFT) && slab.detailRect && covers(slab.detailRect, want)
        && (sweeping() || !slab.detailQuick)) continue;
      jobs.push({ slab, work: 'detail', rank: rank('detail', steps, moving) });
    }
    for (const page of recalled.sort((first, second) => first.steps - second.steps)) {
      showSketch(page.slab, page.kept);
      unpainted = true;
    }
    queue = jobs.sort((first, second) => first.rank - second.rank);
    void pump();
  };

  /**
   * What the engine has been costing, per million pixels, on this
   * document and this machine. Learned from the pages it has already
   * drawn -- and only from the big ones, because a picture a hundred
   * pixels across is nearly all fixed cost and would price a sheet at
   * twenty times what it comes to.
   */
  let perMillion = 0;
  const costs = (pixels: number, ms: number): void => {
    if (pixels < 250_000) return;
    const rate = ms / (pixels / 1e6);
    // the last few pages, weighted towards the last: the reader is looking
    // for the order of magnitude, and a page with a photograph on it
    // should not make the next twenty pages of plain text timid
    perMillion = perMillion ? perMillion * 0.6 + rate * 0.4 : rate;
  };
  const slicesFor = (pixels: number): number => clamp(Math.max(
    Math.ceil(pixels / SLICE_PIXELS),
    perMillion ? Math.ceil((perMillion * (pixels / 1e6)) / SLICE_MS) : 1,
  ), 1, MOST_SLICES);

  /** The screen's own pixels, unless the picture asked for would cost more
   *  than the budget, and then as many as fit. */
  const rasterFor = (width: number, height: number, share = 1): number => {
    const fitted = Math.sqrt(maxCanvasPixels() / share / Math.max(1, width * height));
    return Math.max(1, Math.min(window.devicePixelRatio || 1, fitted));
  };

  /**
   * A canvas of a given size in the screen's pixels. It is given no size in
   * CSS: the base fills its page box by the stylesheet (inset: 0), so the
   * browser stretches it to whatever the zoom makes the box — which is the
   * whole point of drawing it once. A tile is placed by placeDetail.
   *
   * Pinning a CSS size here was a bug worth naming: zoomed out, a picture
   * drawn for the page's full width stayed that wide while its box shrank,
   * so pages overlapped the ones below them; zoomed in, the page was empty
   * wherever a tile had not landed yet, instead of soft.
   */
  const sheet = (width: number, height: number, raster: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null => {
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.round(width * raster);
    canvas.height = Math.round(height * raster);
    const context = canvas.getContext('2d');
    return context ? { canvas, context } : null;
  };

  /** The whole page at the width it is shown at, stretched thereafter. */
  async function paintBase(slab: Slab): Promise<void> {
    const drawnFor = baseWanted(slab);
    const width = Math.round(slab.width * drawnFor);
    const height = Math.round(slab.height * drawnFor);
    if (!slab.proxy || width <= 0 || height <= 0) return;
    slab.baseScale = drawnFor; // claimed, so the next pass does not ask again
    stop(slab.baseTask);
    const raster = rasterFor(width, height);
    const made = sheet(width, height, raster);
    if (!made) return;
    const tall = made.canvas.height;
    const slices = slicesFor(made.canvas.width * tall);
    const ring: number[] = [];
    // Down the page a slice at a time, with the thread given back between
    // them. The rows are worked out in the picture's own pixels and turned
    // back into the page's units, so the pieces tile exactly however the
    // division falls; each one after the first starts a row early, because
    // a row lost to rounding would be a hairline of the rough picture
    // showing through the sharp one.
    for (let slice = 0; slice < slices; slice += 1) {
      const from = Math.round((slice * tall) / slices);
      const to = Math.round(((slice + 1) * tall) / slices);
      const top = slice ? from - 1 : 0;
      // What this slice cost the reader, end to end: the ask, the engine's
      // own work on the other thread, and the pixels coming back. It is
      // not the engine's time alone -- a slice queued behind another
      // page's is counted waiting -- and that is the right number to size
      // the next page's slices by, because it is the one the reader waits.
      const began = performance.now();
      const task = engine.renderPageRectRaw(document_, slab.proxy,
        { origin: { x: 0, y: top / (drawnFor * raster) }, size: { width: slab.width, height: (to - top) / (drawnFor * raster) } },
        { scaleFactor: drawnFor, dpr: raster, withAnnotations: true });
      slab.baseTask = task;
      let picture: Pixels;
      try {
        picture = await task.toPromise();
      } catch {
        if (slab.baseScale === drawnFor) slab.baseScale = 0;
        return; // called off, or the document went away
      }
      costs(picture.width * picture.height, performance.now() - began);
      // The reader has moved while this was drawing and the page is gone
      // from the screen: it is not put up, and not kept. Between slices is
      // the whole point of the slicing -- a page being left behind stops
      // costing anything within one slice rather than at the end of a
      // whole sheet.
      if (slab.baseTask !== task || !standing(slab).near) {
        if (slab.baseTask === task) { slab.baseTask = null; slab.baseScale = 0; }
        return;
      }
      // The engine's rounding, not ours, decides how wide the picture is.
      if (slice === 0 && picture.width !== made.canvas.width) made.canvas.width = picture.width;
      made.context.putImageData(new ImageData(picture.data, picture.width, picture.height), 0, top);
      ring.push(...darkRing(picture));
      if (slice + 1 < slices) await breathe();
    }
    drawPhotos(slab, made.canvas, { x: 0, y: 0, width: slab.width, height: slab.height });
    made.canvas.className = 'pdf-raster';
    // A page that was authored dark must not be inverted into a white one.
    slab.box.classList.toggle('is-dark-page', ringIsDark(ring));
    // the picture it replaces stays up until this one is ready, so a resize
    // is never a column of empty boxes
    slab.base?.remove();
    slab.box.prepend(made.canvas);
    slab.base = made.canvas;
    slab.baseTask = null;
  }

  /** The part of a page the reader can see, with a quarter-screen of margin
   *  so a small scroll does not need a new one. Null when the page is not
   *  zoomed past its own width, where the base is already sharp. */
  const detailWanted = (slab: Slab): Rect | null => {
    if (zoom * living <= 1.01) return null;
    // The live scale, both because that is the sharpness wanted and
    // because the box this measures against is itself being scaled by
    // the gesture: the two cancel, and the rect comes out in the page's
    // own units either way.
    const scale = liveScaleOf(slab);
    const box = slab.box.getBoundingClientRect();
    const pane = scroller.getBoundingClientRect();
    // As much margin as the budget will carry, and no more. What is
    // actually on the screen is the tile's whole purpose, so when the two
    // together will not fit in one canvas it is the margin that gives way
    // -- the alternative, which this file did until now, was to keep the
    // margin and drop the resolution through rasterFor, which spends the
    // gesture's dearest render on a picture that is soft on purpose. On a
    // 390 by 700 pane at three device pixels to the CSS pixel a quarter
    // either way comes to 5.5 million against a 5.2 million cap, so this
    // was biting, quietly, on the phone it was written for.
    const seen = {
      width: Math.min(pane.right, box.right) - Math.max(pane.left, box.left),
      height: Math.min(pane.bottom, box.bottom) - Math.max(pane.top, box.top),
    };
    if (!(seen.width > 0) || !(seen.height > 0)) return null;
    const raster = Math.max(1, window.devicePixelRatio || 1);
    const room = Math.sqrt(maxCanvasPixels() / Math.max(1, seen.width * seen.height * raster * raster));
    // None at all while a finger is down. The margin buys a tile that
    // survives the small scroll afterwards, and nobody scrolls in the
    // middle of a zoom: under a hand it is pixels bought for a time
    // nobody is in, paid for out of the gesture's own frames.
    const share = sweeping() ? 0 : Math.max(0, Math.min(DETAIL_MARGIN, (room - 1) / 2));
    const margin = { x: seen.width * share, y: seen.height * share };
    const left = clamp((pane.left - margin.x - box.left) / scale, 0, slab.width);
    const right = clamp((pane.right + margin.x - box.left) / scale, 0, slab.width);
    const top = clamp((pane.top - margin.y - box.top) / scale, 0, slab.height);
    const bottom = clamp((pane.bottom + margin.y - box.top) / scale, 0, slab.height);
    if (right - left < 1 || bottom - top < 1) return null;
    // Snapped so the rectangle begins and ends on whole device pixels of
    // the picture about to be drawn, with the placement derived back from
    // the snapped figures rather than the other way about. Unsnapped, the
    // tile sits a fraction of a device pixel off the base underneath it
    // and is resampled on the way to the screen -- which is exactly the
    // detail it was drawn to recover.
    const step = Math.max(scale * raster, 0.0001);
    const snap = (at: number, how: 'floor' | 'ceil'): number => Math[how](at * step) / step;
    const x = Math.max(0, snap(left, 'floor'));
    const y = Math.max(0, snap(top, 'floor'));
    return {
      x,
      y,
      width: Math.min(slab.width, snap(right, 'ceil')) - x,
      height: Math.min(slab.height, snap(bottom, 'ceil')) - y,
    };
  };
  /** Whether a picture drawn at one resolution still stands for another:
   *  near enough either way for a tile (DETAIL_DRIFT), and merely not too
   *  short for a page's own picture (BASE_GATE). */
  const nearEnough = (have: number, want: number, by: number): boolean =>
    have >= want / by && have <= want * by;
  const sharpEnough = (have: number, want: number): boolean => have >= want / BASE_GATE;
  /** Whether a tile already drawn still covers what is wanted. */
  const covers = (have: Rect, want: Rect): boolean =>
    have.x <= want.x + 0.5 && have.y <= want.y + 0.5
    && have.x + have.width >= want.x + want.width - 0.5
    && have.y + have.height >= want.y + want.height - 0.5;

  async function paintDetail(slab: Slab, rect: Rect): Promise<void> {
    // Drawn at the size the reader is looking at, placed at the size the
    // page is laid out at: under a gesture those differ by exactly the
    // transform the column is wearing, so the tile lands with one device
    // pixel per screen pixel now and is still the right tile when the
    // finger lifts and the layout catches up.
    const scale = liveScaleOf(slab);
    const drawnAt = zoom * living;
    if (!slab.proxy) return;
    const width = Math.round(rect.width * scale);
    const height = Math.round(rect.height * scale);
    if (width <= 0 || height <= 0) return;
    slab.detailZoom = drawnAt;
    stop(slab.detailTask);
    const quick = sweeping();
    const raster = rasterFor(width, height, quick ? QUICK_SHARE : 1);
    const made = sheet(width, height, raster);
    if (!made) return;
    const tall = made.canvas.height;
    const slices = slicesFor(made.canvas.width * tall);
    // In strips, with the thread handed back between them, exactly as the
    // whole-page picture is drawn. A tile is the largest thing the engine
    // is ever asked for -- four million pixels of his book at a double
    // zoom -- and asking for it in one call held the thread for a sixth of
    // a second in the middle of the gesture that had asked for it.
    for (let slice = 0; slice < slices; slice += 1) {
      const from = Math.round((slice * tall) / slices);
      const to = Math.round(((slice + 1) * tall) / slices);
      const top = slice ? from - 1 : 0;
      const began = performance.now();
      const task = engine.renderPageRectRaw(document_, slab.proxy,
        { origin: { x: rect.x, y: rect.y + top / (scale * raster) },
          size: { width: rect.width, height: (to - top) / (scale * raster) } },
        { scaleFactor: scale, dpr: raster, withAnnotations: true });
      slab.detailTask = task;
      let picture: Pixels;
      try {
        picture = await task.toPromise();
      } catch {
        if (slab.detailZoom === drawnAt) slab.detailZoom = 0;
        return;
      }
      costs(picture.width * picture.height, performance.now() - began);
      // Left behind between strips, the same as a page is: the rest of
      // the tile is not drawn and what landed is not put up.
      if (slab.detailTask !== task || !standing(slab).near) {
        if (slab.detailTask === task && slab.detailZoom === drawnAt) { slab.detailTask = null; slab.detailZoom = 0; }
        return;
      }
      if (slice === 0 && picture.width !== made.canvas.width) made.canvas.width = picture.width;
      made.context.putImageData(new ImageData(picture.data, picture.width, picture.height), 0, top);
      if (slice + 1 < slices) await breathe();
    }
    drawPhotos(slab, made.canvas, rect);
    made.canvas.className = 'pdf-raster pdf-detail';
    slab.detail?.remove();
    slab.box.append(made.canvas);
    slab.detail = made.canvas;
    slab.detailRect = rect;
    slab.detailZoom = drawnAt;
    slab.detailQuick = quick;
    slab.detailTask = null;
    placeDetail(slab);
  }

  /** Where a tile sits on its page, in the layout's own pixels. Recomputed
   *  rather than redrawn when the zoom changes, so the sharp picture is
   *  stretched into its new place and stays until a fresh one lands. */
  const placeDetail = (slab: Slab): void => {
    if (!slab.detail || !slab.detailRect) return;
    const scale = scaleOf(slab);
    slab.detail.style.left = `${Math.round(slab.detailRect.x * scale)}px`;
    slab.detail.style.top = `${Math.round(slab.detailRect.y * scale)}px`;
    slab.detail.style.width = `${Math.round(slab.detailRect.width * scale)}px`;
    slab.detail.style.height = `${Math.round(slab.detailRect.height * scale)}px`;
  };

  /** Which page the counter names: the page under the middle of the screen.
   *  The page at the very top is the one the reader has just left -- a page
   *  turned one pixel past its edge was being called the next one -- and the
   *  page being read is the one in front of them. Two thirds down was tried
   *  first, to match the line the outline reads a heading from, and it
   *  changed the number too early: a page is one thing all the way down,
   *  where a heading is the start of one. At the end of a document
   *  the scroll can go no further and the last page can never reach that
   *  line, so there the reader is plainly on it. (The place written down
   *  stays the exact top-of-screen one, so reopening lands on the same
   *  pixels.) */
  const pageShown = (): number => {
    const scrollable = scroller.scrollHeight > scroller.clientHeight + 4;
    const atEnd = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 2;
    if (scrollable && atEnd) return slabs.length;
    // And at the top it is the first page, for the mirror of that reason.
    // A page shorter than half the screen is never under the middle of it
    // while it is the first thing showing: a landscape scan or a deck of
    // slides opened reading 2 and could not be made to read 1 without
    // scrolling up into nothing. (Gander names both ends the same way.)
    if (scroller.scrollTop <= 1) return 1;
    const screen = Math.max(0, scroller.clientHeight - chromeTop());
    const anchor = scroller.scrollTop + chromeTop() - columnTop + screen / 2;
    let edge = 0;
    for (const slab of slabs) {
      const height = heightOf(slab);
      if (anchor < edge + height + GAP - 1 || slab.page === slabs.length) return slab.page;
      edge += height + GAP;
    }
    return placeNow().page;
  };
  /** Everything that follows the reader down the document: the counter in
   *  the floating layer, and the toolbar's number and the sidebar's
   *  highlight, which are told only when the page actually changes. */
  const watchers = new Set<(page: number) => void>();
  let announced = 0;
  const showCounter = (): void => {
    const page = pageShown();
    counter.textContent = `${page} / ${document_.pageCount}`;
    if (page === announced) return;
    announced = page;
    for (const listen of watchers) listen(page);
  };

  let placeTimer = 0;
  const remember = (): void => {
    window.clearTimeout(placeTimer);
    placeTimer = window.setTimeout(() => options.onPlace?.(placeNow()), 400);
  };

  const settle = (): void => {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(drawBand, SETTLE_MS);
  };

  const onScroll = (): void => {
    // A scroll nobody asked for, while the document is still being put back
    // where it was: put it back again.
    if (pending && Math.abs(scroller.scrollTop - topFor(pending)) > 4) {
      applyPending();
      showCounter();
      return;
    }
    movedAt = Date.now();
    showCounter();
    // The band is re-planned while the hand is still moving, not only when
    // it stops: that is what calls off the pages being left behind, and
    // what puts the page coming up at the head of the queue. Planning is
    // arithmetic over the column -- the engine is not asked for anything
    // here -- so it is done once a frame and no oftener.
    replan();
    settle();
    if (!pending) remember();
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  // A hand on the document: it is the reader's now.
  scroller.addEventListener('pointerdown', endGlide, { passive: true });
  scroller.addEventListener('pointerdown', letGo, { passive: true });
  scroller.addEventListener('wheel', letGo, { passive: true });
  scroller.addEventListener('keydown', letGo);

  /** Zoom to `next`, keeping whatever is under `anchorY` (a client y) where
   *  it is — the pinch's middle, or the point a double tap landed on. */
  /**
   * Zoom about a point, which is the point the reader put their fingers on
   * — in both directions. Vertically that is a page and a fraction into it,
   * because the gaps between pages do not scale with the pages; across, it
   * is a fraction of the column's width, which is the whole of what used to
   * throw a zoomed-in page sideways: the column grew and the sideways
   * scroll stayed where it was.
   */
  /** Fit width is zoom 1 by construction, because every page is laid out at
   *  the pane's width. Fit height is the zoom at which the page that stands
   *  tallest at that width is on the screen whole, which is how a handout
   *  gets read a page at a time without a spread mode. */
  const heightStop = (): number => {
    const tall = scroller.clientHeight - chromeTop() - 2 * GAP;
    return tall > 0 ? tall / (room * steepest) : 1;
  };

  const zoomTo = (next: number, anchorY: number, anchorX?: number, smooth = false): void => {
    const limited = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (limited === zoom) return;
    stopGlide(); // a step on top of a step: this one's band covers both
    const was = zoom;
    const pane = scroller.getBoundingClientRect();
    const paneTop = pane.top;
    const acrossAt = anchorX ?? pane.left + pane.width / 2;
    const held = scroller.scrollTop + (anchorY - paneTop) - columnTop;
    let edge = 0;
    let found = { page: 1, into: 0 };
    for (const slab of slabs) {
      const height = heightOf(slab);
      if (held < edge + height + GAP) { found = { page: slab.page, into: clamp((held - edge) / Math.max(1, height), 0, 1) }; break; }
      edge += height + GAP;
    }
    // Across, the point is held on the *page* under the finger, not on the
    // column around it. The column carries padding and the page sits
    // centred in it, and neither of those grows with the zoom -- so a
    // fraction of the column is a different place on the page at every
    // size, and the page slid sideways under the fingers by about ten
    // pixels a step (measured at a quarter across a 390px screen).
    const anchored = slabs[found.page - 1] ?? slabs[0];
    const sheetWas = anchored.box.getBoundingClientRect();
    const across = clamp((acrossAt - sheetWas.left) / Math.max(1, sheetWas.width), 0, 1);
    zoom = limited;
    letGo();
    layout();
    options.ownScroll?.();
    scroller.scrollTop = Math.max(0, offsetOf(found) - (anchorY - paneTop));
    // the same slice of the page stays under the finger across as well as down
    const reach = scroller.scrollWidth - scroller.clientWidth;
    if (reach > 0) {
      // Where that same point on that same page has landed, read after the
      // layout rather than worked out from it, and put back under the finger.
      const sheetNow = anchored.box.getBoundingClientRect();
      const point = scroller.scrollLeft + (sheetNow.left - pane.left) + across * sheetNow.width;
      scroller.scrollLeft = clamp(point - (acrossAt - pane.left), 0, reach);
    }
    // Scaled about the point the zoom was asked for, which is the point
    // the scroll above just pinned: the view the reader had, landing on
    // the view they asked for. Measured after the scrolling, so the two
    // agree to the pixel.
    const motion = smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (motion) {
      const box = doc.getBoundingClientRect();
      // Where the point the zoom was asked about actually landed. The
      // scroll above cannot always be honoured: at the top of a document,
      // at its foot, and above all on the way back to fit -- where the
      // column stops overflowing and the page is centred whatever the
      // scroll says. The motion below scales the new layout back into the
      // old view, so if it scaled about the finger alone the reader would
      // see the page jump to the middle and only then zoom out of it.
      // The distance it could not scroll is carried by the first frame
      // instead, and given back over the same motion: the page leaves the
      // corner and leaves the zoom together.
      const sheetNow = anchored.box.getBoundingClientRect();
      const nowX = sheetNow.left + across * sheetNow.width;
      const nowY = sheetNow.top + found.into * sheetNow.height;
      doc.style.transformOrigin = `${nowX - box.left}px ${nowY - box.top}px`;
      // Sampled rather than handed two ends, so that the scale travels by
      // ratio: a page on its way from fit to twice it should grow at an
      // even rate, and a scale interpolated straight from 1 to 2 does
      // most of its growing in the first third of the motion however the
      // time is eased, because what the eye reads is the ratio and the
      // ratio moves fastest while the number is small. (Gander's double
      // tap does the same thing, in its words "by ratio, so the page
      // grows at an even rate rather than fastest at the start".) The
      // easing is baked into the samples by glideAt, so the steps between
      // them are linear, and the sideways carry is sampled along the very
      // same curve so the two stay one motion.
      const held = was / zoom;
      const paced = (part: number): number => held ** (1 - glideAt(part));
      const FRAMES = 12;
      gliding = doc.animate(Array.from({ length: FRAMES + 1 }, (ignored, step) => {
        const part = step / FRAMES;
        const rest = 1 - glideAt(part);
        return {
          offset: part,
          easing: 'linear',
          transform: `translate(${((acrossAt - nowX) * rest).toFixed(2)}px, ${((anchorY - nowY) * rest).toFixed(2)}px) scale(${paced(part).toFixed(5)})`,
        };
      }), { duration: GLIDE_MS });
      // The gaps travel too. The column is scaled over the motion, so the
      // space between two pages would be scaled with it and arrive at
      // eight pixels from somewhere else; each page is walked back along
      // the same curve instead, sampled, so the gap is eight pixels the
      // whole way across. Cleared when the motion ends, like the scale.
      const steps = 10;
      const slack = (part: number): number => GAP * (1 / Math.max(0.01, paced(part)) - 1);
      for (const slab of slabs) {
        if (!standing(slab).rough) continue;
        const paces = slab.page - 1 - (found.page - 1);
        if (!paces) continue;
        slab.box.animate(
          Array.from({ length: steps + 1 }, (ignored, step) => ({
            offset: step / steps,
            easing: 'linear',
            transform: `translateY(${(slack(step / steps) * paces).toFixed(2)}px)`,
          })),
          { duration: GLIDE_MS },
        );
      }
      // The move first, then the work. Drawing a band of pages at a new
      // size is the most expensive thing this view does -- it is PDFium,
      // on this thread -- and starting it on the same frame as the motion
      // is what made a zoom stutter and then arrive. The pages travel on
      // the pictures already drawn, stretched, and are redrawn the moment
      // they land. Nothing is waited for twice: the band is a fifth of a
      // second later than it was, and the motion it would have blocked is
      // the whole of what the reader is looking at.
      gliding.addEventListener('finish', endGlide);
    }
    showCounter();
    if (!motion) drawBand();
    remember();
  };

  // Pinch: the pages follow the fingers at once, scaled as they are, and are
  // drawn again at the zoom the fingers left them at. Drawing during the
  // gesture would be a page of work per frame for a picture that is about to
  // be wrong anyway.
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { span: number; middle: number; across: number; zoom: number; about: number } | null = null;
  /** A one-finger zoom in progress: where it started, and from what. */
  // `id` is the contact the gesture belongs to. Everything about a
  // one-finger zoom is that one finger's: no other pointer may move it,
  // and no other pointer may end it.
  let hold: { id: number; y: number; x: number; zoom: number; moved: boolean; about: number } | null = null;
  let lastTap = { time: 0, x: 0, y: 0 };
  const spanOf = (): { span: number; middle: number; across: number } => {
    const [a, b] = [...touches.values()];
    return { span: Math.hypot(a.x - b.x, a.y - b.y), middle: (a.y + b.y) / 2, across: (a.x + b.x) / 2 };
  };
  /** Tell the compositor a transform is coming while the finger is still
   *  down. The first zoom of a session has to rasterise the whole column
   *  into a layer of its own before it can be scaled, and that lands on the
   *  first frame of the motion — the stutter that is only ever on the first
   *  one, because the layer is warm from then on. A finger touching the
   *  pages is all the warning needed, and it is given back shortly after
   *  the hand leaves, since a layer that size is not free to keep. */
  let coolDown = 0;
  /** The pause after a gesture's last move that draws it (LIVE_DRAW_MS). */
  let liveTimer = 0;
  /** Whether a hand is on the glass and still working, either gesture.
   *  What is drawn for a hand that is still moving is worth less than
   *  what is drawn for one that has arrived -- it is about to be wrong
   *  again -- so it is drawn cheaper. A hand that has gone, and a hand
   *  that has come to rest without lifting, both get the full picture:
   *  the reader is looking at what they stopped on. */
  const sweeping = (): boolean => (hold !== null || pinch !== null)
    && performance.now() - liveMoved < LIVE_DRAW_MS;
  /** When the last live draw was started and the factor it drew for; and
   *  when the last move of the gesture came in, which is both how the
   *  rate is read and how a hand that has stopped is told from one that
   *  is still working. */
  let liveAt = 0;
  let liveFor = 1;
  let liveMoved = 0;
  /** How far a one-finger drag has zoomed, as a multiple of the zoom it
   *  started from: Chromium's curve, a constant share of the zoom per
   *  pixel travelled (see DRAG_SPEED). The slop the gesture waited out
   *  before it counted as a drag is not charged for. Down zooms in, up
   *  zooms out, and the two are reciprocals, so a drag that comes back
   *  where it started leaves the zoom where it started. */
  const dragFactor = (dy: number): number => {
    const far = Math.max(0, Math.abs(dy) - DRAG_SLOP);
    const factor = (1 + DRAG_SPEED) ** far;
    return dy < 0 ? 1 / factor : factor;
  };
  /** The zoom a gesture is asking for, with the ends of the range given a
   *  little to pull against rather than a wall (see GIVE_POWER). */
  const giveAt = (wanted: number): number => {
    if (wanted < MIN_ZOOM) return MIN_ZOOM * Math.max(1 - GIVE_MOST, (wanted / MIN_ZOOM) ** GIVE_POWER);
    if (wanted > MAX_ZOOM) return MAX_ZOOM * Math.min(1 + GIVE_MOST, (wanted / MAX_ZOOM) ** GIVE_POWER);
    return wanted;
  };
  /**
   * The stretch past the end of the range, handed back.
   *
   * Measured against the layout that has just landed rather than the one
   * the gesture started from, so it reads the same whether the lift
   * changed the zoom or found it already at the stop — in both cases the
   * column is exactly `stretch` away from where it belongs, about the
   * point the gesture was anchored to.
   */
  const giveBack = (stretch: number, at: { x: number; y: number }): void => {
    stopGlide();
    const box = doc.getBoundingClientRect();
    doc.style.transformOrigin = `${at.x - box.left}px ${at.y - box.top}px`;
    gliding = doc.animate(
      [{ transform: `scale(${stretch})` }, { transform: 'none' }],
      { duration: GIVE_BACK_MS, easing: GLIDE_EASE },
    );
    gliding.addEventListener('finish', endGlide);
  };
  /**
   * The point a one-finger zoom holds still.
   *
   * The finger, while the page is at its own width or bigger: the reader
   * is reaching for something on the page and it should stay under their
   * thumb. Below that there is nothing to hold — the column is narrower
   * than the pane, the page is centred in it whatever the scroll says,
   * and a zoom out anchored to a thumb at the edge of the screen walks
   * the page into the opposite corner on the way to the middle. So the
   * anchor slides from the finger to the middle of the pane as the zoom
   * falls from fitted to CENTRE_BY, and is the middle from there down.
   *
   * It is a fraction and not a switch on purpose: the same blend drives
   * the live transform and the zoom that lands when the finger lifts, so
   * the two agree to the pixel and nothing jumps at the lift.
   */
  const anchorFor = (next: number, y: number, x: number): { y: number; x: number; pull: number } => {
    const pane = scroller.getBoundingClientRect();
    const pull = clamp((1 - next) / (1 - CENTRE_BY), 0, 1);
    return {
      y: y + (pane.top + pane.height / 2 - y) * pull,
      x: x + (pane.left + pane.width / 2 - x) * pull,
      pull,
    };
  };
  /**
   * Hold the column at `factor` of its laid-out size about a point that
   * is `pull` of the way from the finger to the middle of the pane.
   *
   * With the origin already at the finger, a scale alone holds the
   * finger. Translating by `(1 - factor)` of the way to any other point
   * holds that point instead — the fixed point of `origin + T + f(p -
   * origin)` — so one multiplication slides the anchor anywhere along
   * that line without touching the origin the gesture set up.
   */
  const holdColumn = (factor: number, from: { x: number; y: number }, pull: number): void => {
    const pane = scroller.getBoundingClientRect();
    const shiftX = pull * (pane.left + pane.width / 2 - from.x) * (1 - factor);
    const shiftY = pull * (pane.top + pane.height / 2 - from.y) * (1 - factor);
    doc.style.transform = pull > 0
      ? `translate(${shiftX.toFixed(2)}px, ${shiftY.toFixed(2)}px) scale(${factor})`
      : `scale(${factor})`;
  };
  /**
   * Draw at the size the fingers are holding, without waiting for them to
   * lift (Drive does, and he asked for it).
   *
   * Only once the gesture pauses. A page of his book is twenty-six
   * milliseconds of this thread at its cheapest and the gesture runs on
   * it too, so drawing every frame of a sweep would buy sharpness with
   * the smoothness of the thing the sharpness is for. A finger that has
   * stopped for a seventh of a second has arrived somewhere, and that is
   * the picture worth having.
   */
  const liveDraw = (factor: number): void => {
    const now = performance.now();
    const since = Math.max(1, now - liveMoved);
    const was = living;
    liveMoved = now;
    living = factor;
    // The hand has stopped. Whatever is on the screen is where the reader
    // has arrived, and it is worth the whole picture: full resolution and
    // the margin back, through the ordinary path.
    window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => { if (!shut && living !== 1) drawBand(); }, LIVE_DRAW_MS);
    // And while it has not. Two things are worth drawing for mid-gesture,
    // and neither of them is a hand that has stopped dead:
    //
    //  - it has slowed to a creep, which is a reader arriving rather than
    //    travelling, and the picture asked for now will still be the one
    //    wanted when it lands;
    //  - it has carried the zoom a whole tile-gate away from what the
    //    last live draw was for, which on a long sweep is every third of
    //    a second or so: without this a deliberate two-second zoom shows
    //    nothing but a stretched picture until it ends.
    //
    // Either way no oftener than the settle, and what gets drawn under a
    // hand is the cheap tile -- a quarter of the pixels, in slices.
    if (now - liveAt < LIVE_DRAW_MS) return;
    const rate = Math.abs(Math.log(factor / was)) * (FRAME_MS / since);
    if (rate > DRAG_CREEP && nearEnough(liveFor, factor, 1 + DETAIL_DRIFT)) return;
    liveAt = now;
    liveFor = factor;
    drawBand();
  };
  /** Back to the laid-out size, with nothing owed. */
  const stopLiving = (): void => {
    window.clearTimeout(liveTimer);
    living = 1;
    liveAt = 0;
    liveFor = 1;
  };
  const warmLayer = (): void => {
    window.clearTimeout(coolDown);
    doc.style.willChange = 'transform';
  };
  const coolLayer = (): void => {
    window.clearTimeout(coolDown);
    coolDown = window.setTimeout(() => { doc.style.willChange = ''; }, LAYER_COOL_MS);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    warmLayer();
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // One finger: the second tap of a double tap, held rather than lifted,
    // zooms by dragging — down to zoom in, up to zoom out, which is the
    // gesture Google's own apps answer to and the one a reader's thumb
    // already knows. Armed here, on the way down, because by the time the
    // finger lifts the gesture is over.
    if (touches.size === 1 && Date.now() - lastTap.time < DOUBLE_TAP_MS
      && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_SLOP) {
      hold = { id: event.pointerId, y: event.clientY, x: event.clientX, zoom, moved: false, about: pageUnder(event.clientY) };
      // The origin is set when the drag starts, not here: a tap that turns
      // out to be an ordinary double tap must find the column exactly as
      // the tap handler left it.
      scroller.style.touchAction = 'none';
    }
    // Not while one finger already has the gesture. A second contact
    // during a one-finger zoom is a knuckle, the side of a thumb, or a
    // mark on the glass far oftener than it is somebody deciding to
    // pinch halfway through a drag -- and taking the gesture off the
    // finger doing it is the worse answer to either.
    if (touches.size === 2 && !hold) {
      const { span, middle, across } = spanOf();
      pinch = { span, middle, across, zoom, about: pageUnder(middle) };
      // The origin is the point between the fingers in the column's own
      // coordinates, both ways. Measured off the column's live box, so it
      // carries the scroll and the padding above the first page with it —
      // which the old one did not, and the pages slid at every pinch.
      const column = doc.getBoundingClientRect();
      doc.style.transformOrigin = `${across - column.left}px ${middle - column.top}px`;
    }
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!touches.has(event.pointerId)) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // By the pointer, not by the count: a stray contact elsewhere on the
    // glass must not stop the finger that is zooming from being heard.
    if (hold && event.pointerId === hold.id) {
      event.preventDefault();
      const dy = event.clientY - hold.y;
      if (!hold.moved && Math.abs(dy) > DRAG_SLOP) {
        hold.moved = true;
        const column = doc.getBoundingClientRect();
        doc.style.transformOrigin = `${hold.x - column.left}px ${hold.y - column.top}px`;
      }
      if (!hold.moved) return;
      const factor = giveAt(hold.zoom * dragFactor(dy)) / hold.zoom;
      holdColumn(factor, hold, anchorFor(hold.zoom * factor, hold.y, hold.x).pull);
      spaceOut(factor, hold.about);
      liveDraw(factor);
      return;
    }
    if (!pinch || touches.size !== 2) return;
    event.preventDefault();
    const { span } = spanOf();
    const factor = giveAt((span / pinch.span) * pinch.zoom) / pinch.zoom;
    doc.style.transform = `scale(${factor})`;
    spaceOut(factor, pinch.about);
    liveDraw(factor);
  };
  const endPinch = (event: PointerEvent): void => {
    touches.delete(event.pointerId);
    if (!touches.size) coolLayer();
    // A contact that is not the one holding the gesture, going away: it
    // was never part of this, and the zoom carries on under the finger
    // that is still down. This ran the whole ending -- transform cleared,
    // zoom committed from whatever the transform then said -- for any
    // pointer at all, which stopped a zoom dead mid-drag.
    if (hold && event.pointerId !== hold.id) return;
    if (hold) {
      const held = hold;
      hold = null;
      scroller.style.touchAction = '';
      // A finger that only tapped is a double tap, and that is the tap
      // handler's business -- which has already run, on the way up through
      // the pages, and has the column mid-animation about the point it was
      // tapped at. Touching the column's transform here would scale that
      // animation from somewhere else: leave it alone.
      if (!held.moved) return;
      const factor = parseFloat(/scale\(([\d.]+)\)/.exec(doc.style.transform)?.[1] ?? '1');
      // Read before the transform goes: anchorFor measures the pane, and
      // the pane is not moved by any of this.
      const about = anchorFor(held.zoom * factor, held.y, held.x);
      doc.style.transform = '';
      doc.style.transformOrigin = '';
      unspace();
      stopLiving();
      lastTap.time = 0;
      const shown = held.zoom * factor;
      zoomTo(shown, about.y, about.x);
      if (Math.abs(shown / zoom - 1) > ZOOM_EPSILON) giveBack(shown / zoom, about);
      return;
    }
    if (!pinch || touches.size >= 2) return;
    const factor = parseFloat(/scale\(([\d.]+)\)/.exec(doc.style.transform)?.[1] ?? '1');
    doc.style.transform = '';
    doc.style.transformOrigin = '';
    unspace();
    const { middle, across } = pinch;
    const from = pinch.zoom;
    pinch = null;
    stopLiving();
    const shown = from * factor;
    zoomTo(shown, middle, across);
    if (Math.abs(shown / zoom - 1) > ZOOM_EPSILON) giveBack(shown / zoom, { x: across, y: middle });
  };
  // Pointer events cannot call off a scroll -- touch-action is read when
  // the gesture begins, so setting it on the second tap is already too
  // late, and the pane scrolled away under the finger instead of zooming.
  // The touch event itself can, and this is the only thing it is for.
  scroller.addEventListener('touchmove', (event: TouchEvent) => {
    if (hold && event.touches.length === 1) event.preventDefault();
  }, { passive: false });
  scroller.addEventListener('pointerdown', onPointerDown, { passive: true });
  scroller.addEventListener('pointermove', onPointerMove, { passive: false });
  scroller.addEventListener('pointerup', endPinch, { passive: true });
  scroller.addEventListener('pointercancel', endPinch, { passive: true });

  // A double tap zooms in about the place tapped, and the next one takes it
  // back to the page's own width.
  const onTap = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const now = Date.now();
    const quick = now - lastTap.time < DOUBLE_TAP_MS;
    const near = Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_SLOP;
    lastTap = { time: now, x: event.clientX, y: event.clientY };
    // > 1, not > 0: the finger doing the tapping is itself in the set, and
    // asking for an empty one meant a double tap never zoomed on a phone at
    // all — this fires before the pointerup that clears it. Two fingers
    // down is a pinch, and a pinch is not a tap.
    if (!quick || !near || touches.size > 1) return;
    lastTap.time = 0;
    // Below the page's own width a double tap brings it back to it, rather
    // than past it into a zoom: a reader who has pushed the pages out to
    // see several at once wants the one they tapped, at its own size.
    // Above it, the pair is the page's width and DOUBLE_TAP_ZOOM, and the
    // geometric middle of the two decides which one a tap means.
    const next = zoom < 1 - ZOOM_EPSILON ? 1
      : zoom < Math.sqrt(DOUBLE_TAP_ZOOM) ? DOUBLE_TAP_ZOOM : 1;
    zoomTo(next, event.clientY, event.clientX, true);
  };
  doc.addEventListener('pointerup', onTap);

  const onResize = (): void => {
    const held = placeNow();
    measureFit();
    layout();
    if (!applyPending()) {
      scroller.scrollTop = topFor(held);
      scroller.scrollLeft = leftFor(held);
    }
    showCounter();
    drawBand();
  };
  const watcher = new ResizeObserver(onResize);
  watcher.observe(scroller);

  measureFit();
  layout();
  pending = options.place ? { ...options.place, zoom } : null;
  applyPending();
  showCounter();
  /**
   * The few pages kept from the last time this document was open, back
   * into the sketch book (src/pdfSketchCache.ts).
   *
   * Waited for, but not for long. If they land before the first plan is
   * made they are simply what the pages are drawn with, which is the
   * whole point: the reader comes back to the page they left instead of
   * to an empty box. Measured on his book, the engine's own first
   * picture of the page being read is eight hundred milliseconds after
   * the column appears -- a document that size is a wasm engine, a
   * thirty-megabyte read and five hundred pages of layout before
   * anything is drawn at all -- and a store this app has already opened
   * answers in a fraction of one frame. So it is given a sixth of a
   * second and no more: a page already drawn is worth waiting a moment
   * for, an open that hangs on a slow store is not. Anything later is
   * put up by the plan it makes when it arrives.
   */
  let planned = false;
  const putBack = (kept: { page: number; canvas: HTMLCanvasElement }[]): void => {
    if (shut || !kept.length) return;
    let any = 0;
    for (const { page, canvas } of kept) {
      if (page < 0 || page >= slabs.length || sketches.has(page)) continue;
      bank(page, canvas);
      any += 1;
    }
    doc.dataset.recalled = String(any);
    if (any && planned) drawBand();
  };
  if (options.key) {
    const recalling = recallSketches(options.key, slabs.length).catch(() => []);
    void recalling.then(putBack);
    await Promise.race([recalling, new Promise((go) => { window.setTimeout(go, RECALL_WAIT_MS); })]);
  }
  drawBand();
  planned = true;
  /**
   * And back down again when the app goes away.
   *
   * A tab change tears this view down and destroy() does it there. A
   * refresh does not: the page is simply gone, and on a phone it is
   * gone without a beforeunload worth relying on. Hidden is the last
   * moment anything is guaranteed to run, and it is the same moment the
   * reader has left — so what is written is what they were looking at.
   */
  let putDownAt = 0;
  let putDownWas = '';
  putDown = (always = false): void => {
    if (!options.key || !sketches.size) return;
    // Nothing new to say, and said recently enough: a reader sitting on
    // one page has the shelf they are going to get.
    const state = `${sketches.size}:${pageShown()}`;
    if (!always && state === putDownWas) return;
    if (!always && Date.now() - putDownAt < 4000) return;
    putDownAt = Date.now();
    putDownWas = state;
    void keepSketches(options.key, slabs.length, pageShown() - 1, sketches);
  };
  const onHidden = (): void => { if (document.visibilityState === 'hidden') putDown(); };
  document.addEventListener('visibilitychange', onHidden);
  // The animation machinery itself, started once on nothing: the first
  // doc.animate() of a page has a cost of its own, and paying it here
  // rather than on the reader's first double tap is free -- this animates
  // between two identical transforms for a single frame.
  try { doc.animate([{ transform: 'scale(1)' }, { transform: 'scale(1)' }], { duration: 1 }); } catch { /* no WAAPI */ }

  /** A page's text in reading order, kept once it has been read. The text
   *  PDFium gives back follows the order the glyphs were *painted* in, which
   *  on a Persian page written by Word puts every lam-alef back to front
   *  («انقالب» for «انقلاب»); the glyph boxes say which pairs those are. */
  const readBack = new Map<number, string>();
  const readable = async (index: number): Promise<string | null> => {
    const held = readBack.get(index);
    if (held !== undefined) return held;
    const proxy = slabs[index]?.proxy;
    if (!proxy) return null;
    try {
      const glyphs = await engine.getPageGlyphs(document_, proxy).toPromise();
      const [raw] = await engine.getTextSlices(document_, [{ pageIndex: index, charIndex: 0, charCount: glyphs.length }]).toPromise();
      const text = inReadingOrder(raw ?? '', glyphs);
      readBack.set(index, text);
      return text;
    } catch { return null; }
  };

  const handle: PdfHandle = {
    pages: document_.pageCount,
    place: placeNow,
    /** Where the reader is, finely: the page, and how far down it in the
     *  page's own units -- the same units an outline row's `top` is in, so
     *  the two can be compared. The page alone is too coarse to say which
     *  heading is being read when a page carries three of them. */
    reading: () => {
      const here = placeNow();
      const sheet = sizes[here.page - 1];
      return { page: here.page, top: here.into * (sheet ? sheet.height : 0) };
    },
    fitTo: (mode: PdfFit) => {
      const pane = scroller.getBoundingClientRect();
      // anchored at the top of the readable area, not the middle: a fit is
      // a request to see this page, from its top
      zoomTo(mode === 'height' ? heightStop() : 1, pane.top + chromeTop(), pane.left + pane.width / 2, true);
    },
    fitNow: () => {
      if (Math.abs(zoom - 1) < 0.01) return 'width';
      return Math.abs(zoom - heightStop()) < 0.01 ? 'height' : null;
    },
    zoomBy: (step: number) => {
      const pane = scroller.getBoundingClientRect();
      const top = pane.top + chromeTop();
      zoomTo(zoom * step, top + (pane.bottom - top) / 2, pane.left + pane.width / 2, true);
    },
    zoomNow: () => zoom,
    thumbnail: async (page: number, width: number) => {
      const slab = slabs[page - 1];
      if (!slab?.proxy) return null;
      const made = engine.renderPageRaw(document_, slab.proxy,
        { scaleFactor: width / Math.max(1, slab.width), dpr: 1, withAnnotations: true });
      try {
        const picture = await made.toPromise();
        const canvas = document.createElement('canvas');
        canvas.width = picture.width;
        canvas.height = picture.height;
        canvas.getContext('2d')?.putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
        return canvas.toDataURL('image/png');
      } catch { return null; }
    },
    derivedOutline: async () => {
      if (derived) return derived;
      if (!deriving) {
        deriving = (async (): Promise<PdfOutlineItem[]> => {
          const lines: TypeLine[] = [];
          const count = Math.min(slabs.length, SCAN_PAGES);
          for (let i = 0; i < count && !shut; i += 1) {
            const slab = slabs[i];
            if (!slab?.proxy) continue;
            try {
              const read = await engine.getPageTextRuns(document_, slab.proxy).toPromise();
              // The runs have the letters in reading order and not one
              // joiner; the text layer has every joiner (src/pdfText.ts).
              // A page is asked for all of it: the count is clamped to
              // what the page holds, so there is nothing to measure first.
              let joiners: Joiners | null = null;
              try {
                const [raw] = await engine.getTextSlices(document_,
                  [{ pageIndex: i, charIndex: 0, charCount: ALL_OF_A_PAGE }]).toPromise();
                joiners = joinersIn(raw ?? '');
              } catch { /* a page that will not give up its text layer keeps the runs' spelling */ }
              for (const line of linesOfPage(read.runs ?? [], i + 1)) {
                lines.push(joiners ? { ...line, text: withJoiners(line.text, joiners) } : line);
              }
            } catch { /* a page that will not give up its text is not the end of the scan */ }
            // The engine runs on this thread. Without a breath every few
            // pages a long document would hold on to the tap that opened
            // the panel until the whole of it had been read.
            if (i % 4 === 3) await new Promise<void>((done) => { setTimeout(done, 0); });
          }
          derived = shut ? [] : outlineFromType(lines, count);
          return derived;
        })();
      }
      return deriving;
    },
    outline: async () => {
      // A bookmark names its page in one of two ways, and both are ordinary:
      // a destination of its own, or a GoTo action carrying one — which is
      // what LaTeX's hyperref writes, so every paper off arXiv came back
      // with a contents list that could be read and not followed.
      const pageOf = (target: PdfBookmarkObject['target']): number | null => {
        if (!target) return null;
        if (target.type === 'destination') return target.destination.pageIndex + 1;
        if (target.type === 'action') {
          const action = target.action as { destination?: { pageIndex: number } } | undefined;
          if (action?.destination) return action.destination.pageIndex + 1;
        }
        return null;
      };
      const read = (items: PdfBookmarkObject[]): PdfOutlineItem[] => items.map((item) => ({
        title: item.title,
        page: pageOf(item.target),
        top: 0,
        children: read(item.children ?? []),
      }));
      try { return read((await engine.getBookmarks(document_).toPromise()).bookmarks ?? []); }
      catch { return []; }
    },
    find: async (keyword: string) => {
      if (!keyword.trim()) return [];
      try {
        // A Persian page is searched twice: once for the word as it is
        // written, once for the word as this kind of file writes it, with
        // every lam-alef turned round (see pdfText.ts). His handout found
        // nothing at all for «انقلاب» and 141 for the file's own spelling.
        const asked = [keyword];
        const alsoAs = asFileWroteIt(keyword);
        if (alsoAs !== keyword) asked.push(alsoAs);
        const runs = await Promise.all(asked.map((word) => engine.searchAllPages(document_, word).toPromise()));
        const results = runs.flatMap((run) => run.results);
        // Two spellings can land on the same words; and a reader reads a
        // document in order, so the list is in the document's order.
        const seen = new Set<string>();
        const hits = results.filter((result) => {
          const key = `${result.pageIndex}:${result.charIndex}:${result.charCount}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).sort((a, b) => a.pageIndex - b.pageIndex || a.charIndex - b.charIndex);
        const out: PdfHit[] = hits.map((result) => ({
          page: result.pageIndex + 1,
          top: result.rects[0]?.origin.y ?? 0,
          rects: result.rects,
          context: result.context
            ? { before: result.context.before ?? '', match: result.context.match ?? keyword, after: result.context.after ?? '' }
            : undefined,
        }));
        // The words around a match come off the page in the order the page
        // was *painted* in, which puts every lam-alef back to front. Putting
        // them right needs the boxes the glyphs sit in, which is a read of
        // the whole page (13ms here, so a second or two for a document-wide
        // search on a phone) -- so it is done for the results a reader will
        // actually read, and kept, rather than for all of them.
        const pages = [...new Set(hits.slice(0, CONTEXT_ROWS).map((hit) => hit.pageIndex))];
        await Promise.all(pages.map((index) => readable(index)));
        hits.slice(0, CONTEXT_ROWS).forEach((hit, i) => {
          const text = readBack.get(hit.pageIndex);
          if (text === undefined) return;
          const from = hit.charIndex;
          const to = hit.charIndex + hit.charCount;
          out[i].context = {
            before: text.slice(Math.max(0, from - CONTEXT_CHARS), from).replace(/\s+/gu, ' '),
            match: text.slice(from, to),
            after: text.slice(to, to + CONTEXT_CHARS).replace(/\s+/gu, ' '),
          };
        });
        return out;
      } catch { return []; }
    },
    showHits: (hits: PdfHit[], current: number) => {
      marks = hits;
      marked = current;
      drawMarks();
      const hit = hits[current];
      if (!hit) return;
      const slab = slabs[hit.page - 1];
      const box = hit.rects[0];
      if (!slab || !box) { handle.goTo(hit.page); return; }
      // A couple of lines of context above the match, but never so far up
      // that its own page is no longer the page at the top of the screen —
      // otherwise the counter and the page box would name the page before.
      const scale = scaleOf(slab);
      const edge = offsetOf({ page: hit.page, into: 0 });
      letGo();
      options.ownScroll?.();
      scroller.scrollTop = Math.max(0, Math.max(edge, edge + box.origin.y * scale - 48) - chromeTop());
      showCounter();
      drawBand();
    },
    onPage: (listen: (page: number) => void) => {
      watchers.add(listen);
      return () => { watchers.delete(listen); };
    },
    goTo: (page: number) => {
      letGo();
      options.ownScroll?.();
      scroller.scrollTop = topFor({ page: clamp(Math.round(page), 1, document_.pageCount), into: 0 });
      showCounter();
      drawBand();
      remember();
    },
    destroy: () => {
      // Before anything is handed back: the pictures are read as they
      // are encoded, not as they are asked for. Always, here -- a tab
      // change is the reader leaving, and where they left is the thing
      // worth keeping even if the shelf was written a moment ago.
      putDown(true);
      document.removeEventListener('visibilitychange', onHidden);
      watchers.clear();
      window.clearTimeout(settleTimer);
      window.clearTimeout(idleTimer);
      window.clearTimeout(placeTimer);
      stopLiving();
      shut = true;
      stopGlide();
      watcher.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('pointerdown', endGlide);
      scroller.removeEventListener('pointerdown', letGo);
      scroller.removeEventListener('wheel', letGo);
      scroller.removeEventListener('keydown', letGo);
      scroller.removeEventListener('pointerdown', onPointerDown);
      scroller.removeEventListener('pointermove', onPointerMove);
      scroller.removeEventListener('pointerup', endPinch);
      scroller.removeEventListener('pointercancel', endPinch);
      for (const slab of slabs) forget(slab);
      // The document's memory goes back to the engine; the engine itself is
      // the app's and stays up, because compiling the wasm again for the
      // next document would be felt.
      void engine.closeDocument(document_).toPromise().catch(() => undefined);
      scroller.removeAttribute('data-pan-x');
      doc.remove();
      counter.remove();
    },
  };
  return handle;
}

/** What a document is remembered by: its first bytes and its length, never
 *  its name or where it sits. Gander's key (Positions.kt), and for its
 *  reasons — one file reaches the reader down several routes, and a place
 *  should survive it being moved or renamed. Two copies of one document
 *  therefore share a place, and a document saved again with changes in it
 *  starts from the top. */
const HEAD_BYTES = 64 * 1024;

export async function pdfKey(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const all = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = all.subarray(0, HEAD_BYTES);
  const stamp = new TextEncoder().encode(String(all.byteLength));
  const both = new Uint8Array(head.byteLength + stamp.byteLength);
  both.set(head, 0);
  both.set(stamp, head.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', both);
  return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
