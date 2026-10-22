// Line layout for math split into units by renderMath() (src/math.ts).
//
// Display math: measure every unit (and its "continued" form that starts with
// the repeated relation), then choose breaks by dynamic programming — first
// the fewest lines that fit the width, then, among those, preferring to break
// at the writer's own line ends, then commas, then relations (the order in
// data-break, from src/math.ts), and only then the split whose widest line is
// narrowest, so lines come out balanced.
//
// Inline math: the paragraph decides where lines end; units simply wrap, and
// any unit that lands at the start of a line switches to its continued form.
//
// A single unit wider than the whole line is allowed to break internally as a
// last resort (KaTeX's own breaks), rather than overflowing the screen.
//
// Height. KaTeX sizes a formula from font struts, then the screen preview
// clips that box (overflow-y: hidden, so a wide formula can scroll sideways
// without a vertical scrollbar). On Android the glyphs paint past the strut —
// a large fraction most of all — so the box is too short and the formula is
// cut off or sits on the lines around it. The site and the PDF don't do this.
// fitDisplayMath() grows the box to the content, and only in the app preview.
import { isNative } from './native';

function width(el: Element | null): number {
  return el ? el.getBoundingClientRect().width : 0;
}

function contentWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

function reset(flow: HTMLElement, units: HTMLElement[]): void {
  flow.querySelectorAll(':scope > br.math-br').forEach((br) => br.remove());
  flow.classList.remove('is-wrapped');
  for (const unit of units) unit.classList.remove('is-line-start', 'is-overwide');
}

function breakBefore(flow: HTMLElement, unit: HTMLElement): void {
  unit.classList.add('is-line-start');
  flow.classList.add('is-wrapped'); // extra room between the lines (style.css)
  const br = document.createElement('br');
  br.className = 'math-br';
  flow.insertBefore(br, unit);
}

interface Flow {
  flow: HTMLElement;
  units: HTMLElement[];
  display: boolean;
  available: number;
  plain: number[];
  cont: number[];
}

/** Where a display formula's lines begin, from widths already measured: the
 *  first unit of every line after the first. Empty when it fits on one line.
 *  No DOM access — the caller has taken the measurements once, for every
 *  formula on the page. */
function displayStarts(units: HTMLElement[], available: number, plain: number[], cont: number[]): number[] {
  const n = units.length;
  const prefix = [0];
  for (const w of plain) prefix.push(prefix[prefix.length - 1] + w);
  // Width of a line holding units i..j (inclusive).
  const lineWidth = (i: number, j: number): number => (i === 0 ? plain[0] : cont[i]) + prefix[j + 1] - prefix[i + 1];
  const fits = (i: number, j: number): boolean => i === j || lineWidth(i, j) <= available;
  if (fits(0, n - 1)) return []; // one line: nothing to do

  // Break points, preferred in this order (data-break from src/math.ts):
  // the writer's own line ends (0), then commas (1), then relations (2),
  // then the spaces typed between words (3).
  const prio = units.map((unit, index) => (index > 0 ? Number(unit.dataset.break ?? 3) : 3));
  // best[l][j]: among splits of units 0..j-1 into l fitting lines, the one
  // with the fewest-preferred break points (sum of priorities), then the
  // narrowest possible widest line.
  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = [new Array(n + 1).fill(INF)];
  const best: number[][] = [new Array(n + 1).fill(INF)];
  const from: number[][] = [new Array(n + 1).fill(-1)];
  cost[0][0] = 0;
  best[0][0] = 0;
  let lines = 0;
  for (let l = 1; l <= n && lines === 0; l += 1) {
    cost[l] = new Array(n + 1).fill(INF);
    best[l] = new Array(n + 1).fill(INF);
    from[l] = new Array(n + 1).fill(-1);
    for (let j = 1; j <= n; j += 1) {
      for (let i = 0; i < j; i += 1) {
        if (cost[l - 1][i] === INF || !fits(i, j - 1)) continue;
        const penalty = cost[l - 1][i] + prio[i];
        const worst = Math.max(best[l - 1][i], lineWidth(i, j - 1));
        if (penalty < cost[l][j] - 0.5 || (penalty <= cost[l][j] + 0.5 && worst < best[l][j] - 0.5)) {
          cost[l][j] = penalty;
          best[l][j] = worst;
          from[l][j] = i;
        }
      }
    }
    if (cost[l][n] < INF) lines = l;
  }
  if (!lines) return [];
  const starts: number[] = [];
  for (let l = lines, j = n; l > 0; l -= 1) {
    const i = from[l][j];
    starts.push(i);
    j = i;
  }
  return starts;
}

function applyDisplay(flow: HTMLElement, units: HTMLElement[], available: number, plain: number[], cont: number[], starts: number[]): void {
  const n = units.length;
  for (const i of starts) {
    if (i > 0) breakBefore(flow, units[i]);
    const end = starts.find((s) => s > i) ?? n;
    if (end - 1 === i && (i === 0 ? plain[0] : cont[i]) > available) units[i].classList.add('is-overwide');
  }
}

/** Mark the units that begin a visual line. Each mark widens that unit (it
 *  gains the repeated relation), which can push the units after it onto a new
 *  line, so this repeats until a pass changes nothing. Every formula on the
 *  page advances together: one layout per pass, instead of one per unit. */
function markLineStarts(flows: Flow[]): void {
  let most = 0;
  for (const f of flows) most = Math.max(most, f.units.length);
  for (let pass = 0; pass <= most; pass += 1) {
    const marks: Array<[Flow, HTMLElement]> = [];
    for (const f of flows) {
      for (let i = 1; i < f.units.length; i += 1) {
        const unit = f.units[i];
        if (unit.classList.contains('is-line-start')) continue;
        const previous = f.units[i - 1].getClientRects();
        const current = unit.getClientRects();
        if (!previous.length || !current.length) continue;
        const last = previous[previous.length - 1];
        if (current[0].top >= last.top + last.height / 2) {
          marks.push([f, unit]);
          break; // one per formula per pass, as before
        }
      }
    }
    if (!marks.length) return;
    for (const [f, unit] of marks) {
      unit.classList.add('is-line-start');
      f.flow.classList.add('is-wrapped');
    }
  }
}

// KaTeX's drawn signs — the \vec arrow, stretchy brackets, roots, \overline —
// are SVG, and KaTeX gives each one a size in em as a presentation
// *attribute* (width="0.471em"). A length that lives only in an SVG
// presentation attribute did not always follow the text on Android: with the
// WebView's own text zoom (it follows Configuration.fontScale) the letters
// grew, the signs stayed put, and \vec{u} ended up with its arrow touching the
// letter. Both WebViews are now pinned at 100% text zoom and the phone's scale
// is applied in CSS instead (src/style.css, --system-font-scale), so the em
// above resolves to the size of the letter beside it — but the web, the print
// WebView and any browser that still mis-resolves the attribute are why the
// checks below stay.
//
// The sign is therefore sized in three steps, and only the last two are here
// at all on a browser where the first one already works:
//
//  1. Carry the same numbers into CSS, in em — the units are kept, so a sign
//     always grows with the text it belongs to, whatever scales it (system
//     font scale, 200% zoom, print at a fixed size). Nothing is frozen in px:
//     a value computed at one font size goes stale the moment the text around
//     it changes size, which is what made the app worse.
//
//  2. *Check* it, against the formula's own text. KaTeX's strut is an
//     inline-block whose height KaTeX wrote in em and the engine draws with
//     the same letters beside it, so its painted height is one em, measured.
//     If the sign is not that big, its box is not following the text: give it
//     the size in px, written as an inline !important so it beats whatever
//     the WebView insists on. It is measured again on the next pass (re-render,
//     font load, resize, system font scale change), never left to go stale.
//
//  3. If even that is ignored — some WebViews lay a sign out from the
//     attribute whatever the style says — scale the drawing itself, so the
//     arrow is the size of the letter it belongs to. A transform on an
//     absolutely positioned SVG cannot disturb the layout around it.
//
// Nothing else about KaTeX's geometry changes: an SVG is absolutely
// positioned inside its box, so none of this moves anything else, and for the
// 400em-wide slice drawings (roots, stretchy arrows) the parent is
// overflow-hidden — 400em/400000 and 1.08em/1080 are the same scale, so the
// visible slice is pixel-for-pixel what it was. That is also why only the
// height is measured: a 400em box is clipped to whatever the formula wanted,
// and its size was never the thing on screen.

/** A size KaTeX wrote in em, as a number; null for anything else. */
export function emSize(value: string | null): number | null {
  if (!value) return null;
  const match = /^\s*(\d*\.?\d+)em\s*$/.exec(value);
  return match ? Number(match[1]) : null;
}

/** How far a sign may be from the size its own em asks for before it counts
 * as "the text is not being followed" (subpixel rounding, and the fractions
 * of a px that font sizes carry, are well inside this). */
const SIGN_TOLERANCE = 0.02;

export function signSizeCorrection(expected: number, painted: number): { px: number; scale: number } | null {
  if (!(expected > 0) || !(painted > 0)) return null;
  if (Math.abs(painted - expected) <= expected * SIGN_TOLERANCE) return null;
  return { px: expected, scale: expected / painted };
}

/** One em in CSS px, as this browser actually draws this formula's text. The
 * strut is the reference: KaTeX wrote its height in em, and the engine draws
 * it with the letters around it. Null when the formula isn't laid out (a
 * hidden preview pane), so nothing is measured in vain. */
function paintedEm(katex: HTMLElement): number | null {
  const strut = katex.querySelector<HTMLElement>('.strut');
  const em = strut ? emSize(strut.style.height) : null;
  const height = strut ? strut.getBoundingClientRect().height : 0;
  if (em !== null && height > 0.01) return height / em;
  const size = parseFloat(katex.ownerDocument.defaultView?.getComputedStyle(katex).fontSize ?? '');
  return size > 0 ? size : null;
}

export function normalizeKatexSvg(root: HTMLElement): void {
  for (const katex of root.querySelectorAll<HTMLElement>('.katex')) {
    const signs = [...katex.querySelectorAll<SVGElement>('svg')];
    if (!signs.length) continue;
    for (const side of ['width', 'height'] as const) {
      for (const svg of signs) {
        // The value goes over exactly as KaTeX wrote it, so the CSS says
        // what the attribute said (1.0800em stays 1.0800em).
        const value = svg.getAttribute(side);
        if (emSize(value) !== null) svg.style.setProperty(side, value!);
      }
    }
    // Steps 2 and 3 need the formula on screen to measure against; the sizes
    // above are already right everywhere else, and a hidden pane is laid out
    // the moment it is shown (main.ts re-runs the layout then).
    if (!katex.getClientRects().length) continue;
    const em = paintedEm(katex);
    if (em === null) continue;
    for (const svg of signs) {
      svg.style.removeProperty('transform');
      svg.style.removeProperty('transform-origin');
      let scale = 1;
      for (const side of ['width', 'height'] as const) {
        const value = emSize(svg.getAttribute(side));
        // A 400em slice (a root, a stretchy arrow) is clipped to what the
        // formula wanted: that box was never the thing on screen, so its
        // width is left alone — only the height that cuts the slice matters.
        if (value === null || (side === 'width' && value >= 100)) continue;
        const correction = signSizeCorrection(value * em, svg.getBoundingClientRect()[side]);
        if (!correction) continue;
        svg.style.setProperty(side, `${correction.px}px`, 'important');
        const after = signSizeCorrection(correction.px, svg.getBoundingClientRect()[side]);
        if (after) scale = after.scale;
      }
      if (scale !== 1) {
        svg.style.setProperty('transform', `scale(${scale.toFixed(4)})`, 'important');
        svg.style.setProperty('transform-origin', 'left top', 'important');
      }
    }
  }
}

/** Grow a display formula's box to its content. No-op when the strut already
 *  fits. Every box is cleared first, then every box is measured, then every
 *  box is grown: one layout for the page, not one per formula. */
export function fitDisplayMath(root: HTMLElement): void {
  const targets: HTMLElement[][] = [];
  for (const box of root.querySelectorAll<HTMLElement>('.math-display')) {
    const frame = box.querySelector<HTMLElement>(':scope > .katex-display');
    const els = frame ? [frame] : [...box.querySelectorAll<HTMLElement>(':scope > .math-flow > .math-unit')];
    for (const el of els) el.style.minHeight = '';
    targets.push(els);
  }
  const grow: Array<{ el: HTMLElement; height: number }> = [];
  for (const els of targets) {
    for (const el of els) {
      // scrollHeight includes what overflow-y: hidden (and a short line box)
      // leave out of clientHeight. A pixel of subpixel noise is not a clip.
      const extra = el.scrollHeight - el.clientHeight;
      if (extra > 1) grow.push({ el, height: Math.ceil(el.scrollHeight) });
    }
  }
  for (const { el, height } of grow) el.style.minHeight = `${height}px`;
}

/** The sections a layout pass may touch: the ones it was given, or the ones
 *  inside it. */
function sectionsOf(root: HTMLElement): HTMLElement[] {
  if (root.classList.contains('md-section')) return [root];
  const found = [...root.querySelectorAll<HTMLElement>('.md-section')];
  return found.length ? found : [root];
}

/** The element the page scrolls in, for deciding what is near the window. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}

/** A section is worth laying out when it is on screen, or within a screen of
 *  it (so scrolling meets a formula that is already placed). Reads the
 *  section's own box only: measuring inside a section the browser has skipped
 *  would lay it out — which is the cost this whole pass exists to avoid. */
function worthLayingOut(section: HTMLElement, view: DOMRect | null): boolean {
  if (!view) return true; // the print iframe: everything is on the page
  const rect = section.getBoundingClientRect();
  return rect.bottom >= view.top - view.height && rect.top <= view.bottom + view.height;
}

// Sections already laid out at the current width (style.css gives them
// content-visibility: auto, so a section far down the note has no boxes yet).
// Scrolling it into view lays it out then, once.
let settled = new WeakSet<HTMLElement>();
let settledWidth = -1;

/** Forget what has been laid out: a resize, a font change, a new render. */
export function clearMathLayout(): void {
  settled = new WeakSet<HTMLElement>();
  settledWidth = -1;
}

export function layoutMath(root: HTMLElement): void {
  if (!root.getClientRects().length) return; // hidden (e.g. preview pane while editing)
  const paneWidth = root.clientWidth;
  if (paneWidth !== settledWidth) clearMathLayout();
  settledWidth = paneWidth;
  const scroller = scrollerOf(root);
  const view = scroller ? scroller.getBoundingClientRect() : null;
  const todo = sectionsOf(root).filter((section) => !settled.has(section) && worthLayingOut(section, view));
  if (!todo.length) return;

  const flows: Flow[] = [];
  for (const section of todo) {
    normalizeKatexSvg(section); // the signs must be right wherever they are shown
    for (const flow of section.querySelectorAll<HTMLElement>('.math-flow')) {
      const units = [...flow.querySelectorAll<HTMLElement>(':scope > .math-unit')];
      if (!units.length) continue;
      const display = flow.classList.contains('is-display');
      reset(flow, units);
      if (display) flow.classList.add('is-measuring');
      flows.push({ flow, units, display, available: 0, plain: [], cont: [] });
    }
  }

  // Read. This is the single forced layout of the pass: every width below is
  // then free, however many formulas the page holds.
  const boxes = new Map<HTMLElement, number>();
  const widthOfBox = (el: HTMLElement): number => {
    const known = boxes.get(el);
    if (known !== undefined) return known;
    const measured = contentWidth(el);
    boxes.set(el, measured);
    return measured;
  };
  for (const f of flows) {
    const box = (f.display
      ? f.flow.parentElement
      : f.flow.closest('p,li,td,th,blockquote,h1,h2,h3,h4,h5,h6,article') ?? f.flow.parentElement) as HTMLElement | null;
    f.available = box ? widthOfBox(box) - (f.display ? 2 : 0) : 0;
    if (f.display) {
      f.plain = f.units.map((unit) => width(unit.querySelector(':scope > .math-plain')));
      f.cont = f.units.map((unit, index) => (index === 0 ? f.plain[0] : width(unit.querySelector(':scope > .math-cont'))));
    } else {
      f.plain = f.units.map((unit) => width(unit));
    }
  }

  // Write.
  for (const f of flows) if (f.display) f.flow.classList.remove('is-measuring');
  const inline: Flow[] = [];
  for (const f of flows) {
    if (!(f.available > 0)) continue; // no width to lay out against: ask again later
    settled.add(f.flow);
    if (f.display) {
      applyDisplay(f.flow, f.units, f.available, f.plain, f.cont, displayStarts(f.units, f.available, f.plain, f.cont));
    } else {
      f.units.forEach((unit, index) => { if (f.plain[index] > f.available) unit.classList.add('is-overwide'); });
      if (f.units.length > 1) inline.push(f);
    }
  }
  markLineStarts(inline);

  // The print iframe is measured here too; leave it alone (the PDF is already
  // right, and its WebView does not clip the way the preview does).
  if (isNative() && root.ownerDocument === document) for (const section of todo) fitDisplayMath(section);
  for (const section of todo) settled.add(section);
}

const pending = new Set<HTMLElement>();
let pendingFrame = 0;
export function scheduleMathLayout(root: HTMLElement): void {
  pending.add(root);
  if (pendingFrame) return;
  pendingFrame = window.requestAnimationFrame(() => {
    pendingFrame = 0;
    const roots = [...pending];
    pending.clear();
    for (const root of roots) layoutMath(root);
  });
}
