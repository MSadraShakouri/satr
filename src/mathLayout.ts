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
// A single unit wider than the whole line is set smaller until it fits, as
// far as a floor and no further; what is still too wide at the floor is
// allowed to break internally as a last resort (KaTeX's own breaks), rather
// than overflowing the screen.
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
  // Measure at the written size: a formula set smaller last time would
  // otherwise be measured small and shrink again on every pass.
  flow.style.fontSize = '';
  flow.style.removeProperty('display');
  flow.style.removeProperty('white-space');
  flow.classList.remove('is-fitted');
  flow.querySelectorAll(':scope > br.math-br').forEach((br) => br.remove());
  flow.classList.remove('is-wrapped');
  for (const unit of units) {
    unit.classList.remove('is-line-start', 'is-overwide');
    for (const base of unit.querySelectorAll<HTMLElement>('.katex-html > .base.is-inline-scroll')) {
      base.classList.remove('is-inline-scroll');
      base.style.removeProperty('max-width');
    }
  }
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

/** Choose display-line starts from measured widths and cut metadata. The DOM
 *  metadata is read once up front; the dynamic program itself uses arrays. */
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
  const kind = units.map(unit => unit.dataset.cutKind ?? 'other');
  const relation = units.map(unit => unit.dataset.cutRelation ?? 'other');
  const isAdjacent = units.map(unit => unit.dataset.cutAdjacent === '1');
  const tex = units.map(unit => unit.querySelector('annotation')?.textContent ?? '');
  // best[l][j]: among splits of units 0..j-1 into l fitting lines, the one
  // with the fewest-preferred break points (sum of priorities), then the
  // narrowest possible widest line.
  const choose = (balanced: boolean, allowAdjacent = false, avoidInner = false): number[] => {
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
          if (!allowAdjacent && i > 0 && isAdjacent[i]) continue;
          if (avoidInner && i > 0 && (prio[i] >= 5 || kind[i] === 'product')) continue;
          // Never introduce a cut within a group or through a product merely
          // to balance lines. Existing breaks of these kinds may be retained.
          if (balanced && i > 0 && !initial.includes(i) &&
              (prio[i] >= 5 || kind[i] === 'product' || relation[i] === 'membership')) continue;
          const penalty = cost[l - 1][i] + prio[i];
          const worst = Math.max(best[l - 1][i], lineWidth(i, j - 1));
          if (balanced ? (worst < best[l][j] - 0.5 || (worst <= best[l][j] + 0.5 && penalty < cost[l][j] - 0.5)) : (penalty < cost[l][j] - 0.5 || (penalty <= cost[l][j] + 0.5 && worst < best[l][j] - 0.5))) {
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
  };
  let initial = choose(false);
  if (initial.some((i) => i > 0 && prio[i] >= 5)) {
    const adjacent = choose(false, true);
    const inner = (s: number[]) => s.filter((i) => i > 0 && prio[i] >= 5).length;
    if (adjacent.length === initial.length && inner(adjacent) < inner(initial) &&
        initial.every((i) => i === 0 || prio[i] !== 0 || adjacent.includes(i))) initial = adjacent;
  }
  const ordered = (starts: number[]) => [...starts].sort((a, b) => a - b);
  const widths = (starts: number[]) => {
    const order = ordered(starts);
    return order.map((x, i) => lineWidth(x, (order[i + 1] ?? n) - 1));
  };
  // If the fewest-line plan cuts an ordinary group,
  // see whether one additional line avoids all such cuts without overflow.
  // This consciously trades height for structure; compare the entire corpus.
  // A tall indivisible matrix, fraction or binomial already consumes vertical
  // space; adding another whole line there needs separate visual judgment.
  const tallStructure = tex.some(u => /\\(?:begin|frac|binom)\b/.test(u));
  // A quantified condition and its conclusion are separate thoughts. Prefer
  // the gap the author wrote after the colon when it avoids a cut inside a
  // domain or product, without adding a line or opening another group. Use
  // the existing gap: inventing a colon cut can change KaTeX spacing and
  // the fallback for an indivisible overwide fraction.
  const colonGaps = tex.map((_, i) => i > 0 && /:\s*\\(?:quad|qquad)\s*\{\}\s*$/.test(tex[i - 1]) &&
    tex.slice(0, i).some(part => /\\(?:forall|exists|nexists)\b|[∀∃∄]/.test(part)));
  const awkward = (plan: number[]) => plan.filter(i => i > 0 && (kind[i] === 'product' || relation[i] === 'membership')).length;
  if (!tallStructure && awkward(initial) && colonGaps.some(Boolean)) {
    const saved = [...prio];
    for (let i = 0; i < n; i += 1) if (colonGaps[i]) prio[i] = 1;
    const option = choose(false);
    for (let i = 0; i < n; i += 1) prio[i] = saved[i];
    if (option.length === initial.length && option.some(i => colonGaps[i]) && awkward(option) < awkward(initial) &&
        widths(option).every(w => w <= available) &&
        option.filter(i => prio[i] >= 5).length <= initial.filter(i => prio[i] >= 5).length &&
        initial.every(i => i === 0 || prio[i] !== 0 || option.includes(i))) initial = option;
  }
  // A short product may stay together even at the cost of one line. Do not
  // buy that line by isolating a prose label or splitting a quantified
  // premise. The pre-existing group-preservation rule keeps its own budget.
  const beginsLabelOrContinuation = /^(?:\\displaystyle\s*)?(?:\\text\b|=)/.test(tex[0].trim());
  const quantified = tex.some(part => /\\(?:forall|exists|nexists)\b|[∀∃∄]/.test(part));
  const hasInnerCut = initial.some(i => i > 0 && prio[i] >= 5);
  const hasProductCut = initial.some(i => i > 0 && kind[i] === 'product');
  if (!tallStructure && (hasInnerCut || (hasProductCut && !beginsLabelOrContinuation))) {
    const ungrouped = choose(false, true, true);
    const ungroupedWidths = widths(ungrouped);
    if (ungrouped.length > 0 && ungrouped.length <= initial.length + (!hasInnerCut && (beginsLabelOrContinuation || quantified) ? 0 : 1) &&
        ungroupedWidths.every(w => w <= available) &&
        // Do not introduce an isolated left-hand side as the price of a line.
        ungroupedWidths[0] >= available * 0.3 &&
        !(ordered(ungrouped)[1] === 1 && relation[1] === 'assignment' && !initial.includes(1)) &&
        initial.every(i => i === 0 || prio[i] !== 0 || ungrouped.includes(i))) initial = ungrouped;
  }
  // A written quad separates complete statements. If a relation break
  // separates a very short label from its value, try the adjacent written
  // gap before or after the whole statement instead.
  for (const at of [...initial]) {
    if (at < 2 || relation[at] !== 'assignment' ||
        /\\(?:begin|frac|binom)\b/.test(tex[at]) ||
        kind[at - 1] !== 'separator') continue;
    const alternatives = [at - 1, at + 1].filter(i => i > 0 && i < n &&
      kind[i] === 'separator' && !initial.includes(i));
    const valid = alternatives.map(i => initial.map(j => j === at ? i : j))
      .filter(plan => widths(plan).every(w => w <= available));
    if (valid.length) initial = valid.sort((a, b) => Math.max(...widths(a)) - Math.max(...widths(b)))[0];
  }
  // A short text-only segment between two authored gaps is a connector or
  // label for the following expression. When it would be stranded at the end
  // of a line, try moving the break to the preceding gap instead. Never split
  // or reverse the prose, and never add a line to make this move.
  for (const at of [...initial]) {
    if (at < 2 || kind[at] !== 'separator' ||
        kind[at - 1] !== 'separator' || initial.includes(at - 1)) continue;
    const connector = tex[at - 1];
    if (!/^\\displaystyle\s*\\text\{[^{}]+\}\s*\\(?:quad|qquad)\s*\{\}\s*$/.test(connector)) continue;
    const moved = initial.map(i => i === at ? at - 1 : i);
    if (widths(moved).every(w => w <= available)) initial = moved;
  }
  const first = widths(initial);
  // Only reconsider an unusually empty opening; don't disturb an authored
  // break or force a split inside a mathematical group merely to balance.
  if (initial.length < 2 || first[0] >= available * 0.34) return initial;
  const firstBreak = ordered(initial)[1];
  if (prio[firstBreak] === 1) {
    const opening = tex.slice(0, firstBreak).join(' ');
    const quantifiers = [...opening.matchAll(/(?:\\(?:forall|exists|nexists)\b|[∀∃∄])/g)];
    const lastQuantifier = quantifiers.at(-1);
    const tail = lastQuantifier ? opening.slice(lastQuantifier.index! + lastQuantifier[0].length) : '';
    const typedDomain = /^(?:(?!:)[\s\S])*?(?:\\(?:in|notin|ni)\b|[∈∉∋∌])/.test(tail);
    // A single bound variable followed by a comparison is also complete:
    // “for all x, 0 < ...”. This is different from “for all a,b, c in R”,
    // where the comma after b is in the middle of the variable list.
    const singleVariable = /^\s*(?:[A-Za-z]|\\[A-Za-z]+)(?:_\{[^{}]+\}|_[A-Za-z0-9])?\s*,\s*$/.test(tail);
    const next = tex[firstBreak];
    const startsComparison = /^(?:\\displaystyle\s*)?(?:[0-9]+|[A-Za-z](?:_\{[^{}]+\}|_[A-Za-z0-9])?)\s*(?:[<>=]|\\(?:le|leq|ge|geq)\b)/.test(next.trim());
    if (/(?:\\(?:forall|exists|nexists)\b|[∀∃∄])/.test(next) || typedDomain || (singleVariable && startsComparison)) return initial;
  }
  const alternative = choose(true);
  if (alternative.length !== initial.length) return initial;
  const next = widths(alternative);
  const count = (plan: number[], test: (p: number) => boolean) => plan.filter((i) => i > 0 && test(prio[i])).length;
  if (initial.some((i) => i > 0 && prio[i] === 0 && !alternative.includes(i)) ||
      count(alternative, p => p >= 5) > count(initial, p => p >= 5) ||
      next[0] < first[0] * 1.5 || Math.max(...next) > Math.max(...first) + 1) return initial;
  const at = ordered(initial)[1];
  const canTradePriority = prio[at] === 1 || relation[at] === 'assignment';
  if (!canTradePriority && Math.max(...next) > Math.max(...first) * 0.88) return initial;
  return alternative;
}

/** How small a display formula may be set before it is left to pan instead.
 *  Asked for: "math sometimes doesn't fit in screen no matter what, maybe
 *  make the font smaller in those specific cases? (Have a limit to how
 *  smaller it gets)" — and then: 85 on screen, "in print ... have it at 90 or
 *  something". The screen can pan sideways, so it may go further; paper
 *  cannot pan at all, but a page is wider than a phone, so it needs less. */
const FLOOR_SCREEN = 0.85;
const FLOOR_PRINT = 0.9;

/** A piece of a formula is as wide as it is written: there is no break point
 *  inside a fraction or a root, and cutting one in half would change what it
 *  says. What is left, once the breaking has done all it can, is one piece
 *  wider than the column — measured over the whole corpus, five formulas in
 *  5 296. Those are set smaller, by exactly as much as they are over and no
 *  more, down to the floor. Nothing that fits is ever touched, so a page of
 *  formulas keeps one size. */
function fitToWidth(flow: HTMLElement, units: HTMLElement[], available: number, widths: number[], starts: number[], floor: number): number {
  let worst = 0;
  const n = units.length;
  for (const i of starts) {
    const end = starts.find((s) => s > i) ?? n;
    if (end - 1 === i) worst = Math.max(worst, widths[i]); // a piece alone on its line
  }
  if (worst <= available || !(available > 0)) return 1;
  const scale = Math.max(floor, available / worst);
  // A tenth of a percent is not a size, and setting one costs a reflow.
  if (scale > 0.999) return 1;
  flow.style.fontSize = `${(scale * 100).toFixed(1)}%`;
  flow.classList.add('is-fitted');
  return scale;
}

function applyDisplay(flow: HTMLElement, units: HTMLElement[], available: number, plain: number[], cont: number[], starts: number[], floor: number, fitted: Fitted[]): void {
  const n = units.length;
  const widths = units.map((_, i) => (i === 0 ? plain[0] : cont[i]));
  const scale = fitToWidth(flow, units, available, widths, starts, floor);
  if (scale < 1) fitted.push({ flow, available, scale, floor });
  for (const i of starts) {
    if (i > 0) breakBefore(flow, units[i]);
    const end = starts.find((s) => s > i) ?? n;
    // Still over at the floor: the last resort stands, now on a smaller box.
    if (end - 1 === i && widths[i] * scale > available) units[i].classList.add('is-overwide');
  }
}

interface Fitted { flow: HTMLElement; available: number; scale: number; floor: number }

/** The second half of the fit, for the few formulas that were set smaller.
 *  A formula's width is not quite linear in its size — KaTeX picks a bracket
 *  or a root from a ladder of drawn sizes, and a smaller box can land on the
 *  same rung — so the size worked out from the measurement can come up a
 *  pixel or five short. Those pixels are taken off here, in one read and one
 *  write for the whole page, and never below the floor. */
function settleFitted(fitted: Fitted[]): void {
  // Two rounds at most, each one read for the whole page and then one write.
  // The first takes off what the measurement could not predict; the second is
  // for the formula whose brackets changed rung on the way down. A pixel is
  // left in hand so rounding cannot put it back over.
  let live = fitted.filter((f) => f.scale > f.floor);
  for (let round = 0; round < 2 && live.length; round += 1) {
    const over = live.map(({ flow }) => {
      const box = flow.parentElement;
      return box ? box.scrollWidth - box.clientWidth : 0;
    });
    const again: Fitted[] = [];
    live.forEach((f, i) => {
      if (over[i] <= 1) return;
      const next = Math.max(f.floor, f.scale * ((f.available - 1) / (f.available + over[i])));
      if (next >= f.scale) return;
      f.flow.style.fontSize = `${(next * 100).toFixed(1)}%`;
      f.scale = next;
      if (next > f.floor) again.push(f);
    });
    live = again;
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
  // The print iframe is laid out through here too (src/exportPdf.ts), and
  // paper has its own floor.
  const floor = root.ownerDocument === document ? FLOOR_SCREEN : FLOOR_PRINT;

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
  const inlineAll: Flow[] = [];
  const fitted: Fitted[] = [];
  for (const f of flows) {
    if (!(f.available > 0)) continue; // no width to lay out against: ask again later
    settled.add(f.flow);
    if (f.display) {
      applyDisplay(f.flow, f.units, f.available, f.plain, f.cont, displayStarts(f.units, f.available, f.plain, f.cont), floor, fitted);
    } else {
      f.units.forEach((unit, index) => { if (f.plain[index] > f.available) unit.classList.add('is-overwide'); });
      inlineAll.push(f);
      if (f.units.length > 1) inline.push(f);
    }
  }
  markLineStarts(inline);
  // Experiment: a short inline expression that actually split may be moved
  // intact. Moving it can split another expression in the paragraph, so
  // re-mark and try newly split neighbours too, in batched passes. Promotion
  // is monotone, so at most inline.length passes can do useful work.
  const promoted = new Set<Flow>();
  for (let pass = 0; pass < inline.length; pass += 1) {
    const promote = inline.filter((f) => !promoted.has(f) &&
      f.units.some((u) => u.classList.contains('is-line-start')) &&
      f.plain.reduce((a, b) => a + b, 0) <= f.available - 1);
    if (!promote.length) break;
    for (const f of promote) {
      promoted.add(f);
      f.flow.style.display = 'inline-block';
      f.flow.style.whiteSpace = 'nowrap';
    }
    for (const f of inline) {
      f.flow.classList.remove('is-wrapped');
      for (const u of f.units) u.classList.remove('is-line-start');
    }
    markLineStarts(inline);
  }
  // Let an overwide inline unit use KaTeX's own breaks first. A KaTeX
  // base that is still wider than the paragraph gets its own scroll box,
  // not the whole unit: relations and other breakable pieces keep wrapping.
  // A newly repeated relation can change the line starts, so re-mark after
  // adding boxes and repeat until no new box is needed. Print stays intact.
  if (root.ownerDocument === document && root.closest('.preview-pane')) {
    for (;;) {
      const widen: HTMLElement[] = [];
      for (const f of inlineAll) for (const unit of f.units) {
        if (unit.classList.contains('is-line-start') && !unit.classList.contains('is-overwide') &&
            unit.getBoundingClientRect().width > f.available + 0.5) widen.push(unit);
      }
      for (const unit of widen) unit.classList.add('is-overwide');
      const tooWide: Array<[HTMLElement, number]> = [];
      for (const f of inlineAll) for (const unit of f.units) {
        if (!(unit.classList.contains('is-overwide') || unit.classList.contains('is-line-start'))) continue;
        for (const base of unit.querySelectorAll<HTMLElement>('.katex-html > .base')) {
          if (!base.classList.contains('is-inline-scroll') && base.getBoundingClientRect().width > f.available + 0.5) {
            tooWide.push([base, f.available]);
          }
        }
      }
      if (!tooWide.length && !widen.length) break;
      for (const [base, available] of tooWide) {
        base.style.maxWidth = `${available}px`;
        base.classList.add('is-inline-scroll');
      }
      for (const f of inline) {
        f.flow.classList.remove('is-wrapped');
        for (const unit of f.units) unit.classList.remove('is-line-start');
      }
      markLineStarts(inline);
    }
  }
  settleFitted(fitted);

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
