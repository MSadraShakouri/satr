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

function layoutDisplay(flow: HTMLElement, units: HTMLElement[]): void {
  const box = flow.parentElement as HTMLElement;
  const available = contentWidth(box) - 2;
  if (available <= 0) return;
  flow.classList.add('is-measuring');
  const plain = units.map((unit) => width(unit.querySelector(':scope > .math-plain')));
  const cont = units.map((unit, index) => (index === 0 ? plain[0] : width(unit.querySelector(':scope > .math-cont'))));
  flow.classList.remove('is-measuring');
  const n = units.length;
  const prefix = [0];
  for (const w of plain) prefix.push(prefix[prefix.length - 1] + w);
  // Width of a line holding units i..j (inclusive).
  const lineWidth = (i: number, j: number): number => (i === 0 ? plain[0] : cont[i]) + prefix[j + 1] - prefix[i + 1];
  const fits = (i: number, j: number): boolean => i === j || lineWidth(i, j) <= available;
  if (fits(0, n - 1)) return; // one line: nothing to do

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
  if (!lines) return;
  const starts: number[] = [];
  for (let l = lines, j = n; l > 0; l -= 1) {
    const i = from[l][j];
    starts.push(i);
    j = i;
  }
  for (const i of starts) {
    if (i > 0) breakBefore(flow, units[i]);
    const end = starts.find((s) => s > i) ?? n;
    if (end - 1 === i && lineWidth(i, i) > available) units[i].classList.add('is-overwide');
  }
}

function layoutInline(flow: HTMLElement, units: HTMLElement[]): void {
  const block = (flow.closest('p,li,td,th,blockquote,h1,h2,h3,h4,h5,h6,article') ?? flow.parentElement) as HTMLElement;
  const available = contentWidth(block);
  if (available <= 0) return;
  for (const unit of units) if (width(unit) > available) unit.classList.add('is-overwide');
  if (units.length < 2) return;
  // Mark units that begin a new visual line; each mark widens that unit (it
  // gains the repeated relation), so re-measure after every change.
  for (let guard = 0; guard <= units.length; guard += 1) {
    let changed = false;
    for (let i = 1; i < units.length; i += 1) {
      if (units[i].classList.contains('is-line-start')) continue;
      const previous = units[i - 1].getClientRects();
      const current = units[i].getClientRects();
      if (!previous.length || !current.length) continue;
      const last = previous[previous.length - 1];
      if (current[0].top >= last.top + last.height / 2) {
        units[i].classList.add('is-line-start');
        flow.classList.add('is-wrapped');
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
}

/** KaTeX sizes its SVG signs (the \vec arrow, stretchy brackets, roots) with
 * em values in width/height attributes. Android's WebView applies the system
 * font scale to CSS text sizes but not to SVG attribute lengths, so the signs
 * stopped scaling while the letters grew (the vec ended up touching its
 * letter). Mirroring the attributes into inline styles — CSS ems follow the
 * text scale — keeps every sign with its letters at any font scale. At scale
 * 1 this is geometrically a no-op; the attributes stay as fallbacks. */
export function normalizeKatexSvg(root: HTMLElement): void {
  for (const svg of root.querySelectorAll<SVGElement>('svg[width], svg[height]')) {
    for (const name of ['width', 'height']) {
      const value = svg.getAttribute(name);
      if (value && !svg.style.getPropertyValue(name)) svg.style.setProperty(name, value);
    }
  }
}

/** Grow a display formula's box to its content. No-op when the strut already fits. */
export function fitDisplayMath(root: HTMLElement): void {
  for (const box of root.querySelectorAll<HTMLElement>('.math-display')) {
    const frame = box.querySelector<HTMLElement>(':scope > .katex-display');
    const targets = frame ? [frame] : [...box.querySelectorAll<HTMLElement>(':scope > .math-flow > .math-unit')];
    for (const el of targets) {
      el.style.minHeight = '';
      // scrollHeight includes what overflow-y: hidden (and a short line box)
      // leave out of clientHeight. A pixel of subpixel noise is not a clip.
      const extra = el.scrollHeight - el.clientHeight;
      if (extra > 1) el.style.minHeight = `${Math.ceil(el.scrollHeight)}px`;
    }
  }
}

export function layoutMath(root: HTMLElement): void {
  normalizeKatexSvg(root); // even when hidden: the signs must be right once shown
  if (!root.getClientRects().length) return; // hidden (e.g. preview pane while editing)
  for (const flow of root.querySelectorAll<HTMLElement>('.math-flow')) {
    const units = [...flow.querySelectorAll<HTMLElement>(':scope > .math-unit')];
    reset(flow, units);
    if (flow.classList.contains('is-display')) layoutDisplay(flow, units);
    else layoutInline(flow, units);
  }
  // The print iframe is measured here too; leave it alone (the PDF is already
  // right, and its WebView does not clip the way the preview does).
  if (isNative() && root.ownerDocument === document) fitDisplayMath(root);
}

let pending = 0;
export function scheduleMathLayout(root: HTMLElement): void {
  if (pending) return;
  pending = window.requestAnimationFrame(() => {
    pending = 0;
    layoutMath(root);
  });
}
