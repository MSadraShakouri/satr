import { scanMath, type MathSpan } from './mathScan';
import { applyReadingDirections } from './direction';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { renderMath } from './math';
import { TIMESTAMP_START, timestampTag, type TimestampFormat } from './timestamps';
import type { Token, TokensList } from 'marked';
import hljs from 'highlight.js/lib/common';
import { formatDigits, formatMarker, letterItem, lineIsLettered, MARKER, orderOf, parseMarker, type Alphabet } from './listMarkers';

marked.setOptions({ gfm: true, breaks: false });
// Obsidian mobile shows a copy button on every code block (top end corner).
const COPY_BUTTON = '<button class="copy-code-button" type="button" aria-label="Copy code"></button>';
marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      if (lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(text, { language: lang }).value;
        return `<pre><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code>${COPY_BUTTON}</pre>`;
      }
      return `<pre><code>${escapeHtml(text)}</code>${COPY_BUTTON}</pre>`;
    },
  },
});

// Footnotes, rendered like Obsidian's reading view: references become
// <sup class="footnote-ref"><a class="footnote-link">[1]</a></sup>, numbered
// in order of first reference; definitions are collected into a
// <section class="footnotes"> (rule + ordered list) at the end, each with a
// ↩︎ back-link per reference. Inline footnotes ^[like this] are supported;
// references without a definition stay as plain text.
interface FootnoteState {
  defs: Map<string, string>;
  order: string[];
  uses: Map<string, number>;
  inline: number;
}
let footnotes: FootnoteState = { defs: new Map(), order: [], uses: new Map(), inline: 0 };
const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]?([^\n]*)((?:\n(?:[ ]{2,}|\t)[^\n]*)*)/;

function collectFootnotes(text: string): Map<string, string> {
  const defs = new Map<string, string>();
  let fence: string | null = null;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(lines[index]);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    if (!lines[index].startsWith('[^')) continue;
    const match = FOOTNOTE_DEF.exec(lines.slice(index, index + 64).join('\n'));
    if (!match) continue;
    const id = match[1].toLowerCase();
    const more = match[3] ? match[3].split('\n').slice(1).map((line) => line.trim()) : [];
    if (!defs.has(id)) defs.set(id, [match[2], ...more].join('\n'));
    index += more.length;
  }
  return defs;
}

function footnoteRefHtml(id: string): string {
  let index = footnotes.order.indexOf(id);
  if (index < 0) index = footnotes.order.push(id) - 1;
  const uses = footnotes.uses.get(id) ?? 0;
  footnotes.uses.set(id, uses + 1);
  const number = String(index + 1);
  const refId = uses > 0 ? `${number}-${uses}` : number;
  return `<sup class="footnote-ref" data-footnote-id="fnref-${refId}"><a class="footnote-link" href="#fn-${number}">[${number}]</a></sup>`;
}

function footnotesSectionHtml(): string {
  if (!footnotes.order.length) return '';
  const items = footnotes.order.map((id, index) => {
    const number = String(index + 1);
    const uses = footnotes.uses.get(id) ?? 1;
    const backrefs = Array.from({ length: uses }, (_, use) =>
      `<a class="footnote-backref footnote-link" href="#fnref-${use > 0 ? `${number}-${use}` : number}">↩︎</a>`).join('');
    const body = marked.parseInline(footnotes.defs.get(id) ?? '', { async: false }) as string;
    return `<li data-footnote-id="fn-${number}"><p>${body.replace(/\n/g, '<br>')}${backrefs}</p></li>`;
  }).join('');
  return `<section class="footnotes"><hr><ol>${items}</ol></section>`;
}

marked.use({
  extensions: [
    {
      name: 'footnoteDef',
      level: 'block',
      start: (src: string) => src.match(/^\[\^[^\]\s]+\]:/m)?.index,
      tokenizer(src: string) {
        const match = FOOTNOTE_DEF.exec(src);
        if (!match) return undefined;
        const raw = match[0] + (src.charAt(match[0].length) === '\n' ? '\n' : '');
        return { type: 'footnoteDef', raw };
      },
      renderer: () => '',
    },
    {
      name: 'footnoteRef',
      level: 'inline',
      start: (src: string) => { const at = src.search(/\[\^|\^\[/); return at < 0 ? undefined : at; },
      tokenizer(src: string) {
        const ref = /^\[\^([^\]\s]+)\]/.exec(src);
        if (ref && footnotes.defs.has(ref[1].toLowerCase())) return { type: 'footnoteRef', raw: ref[0], id: ref[1].toLowerCase() };
        const inline = /^\^\[([^\]]+)\]/.exec(src);
        if (inline) {
          const id = `\u0000inline-${footnotes.inline += 1}`;
          footnotes.defs.set(id, inline[1]);
          return { type: 'footnoteRef', raw: inline[0], id };
        }
        return undefined;
      },
      renderer: (token) => footnoteRefHtml((token as unknown as { id: string }).id),
    },
  ],
});

// Wiki links, as Obsidian's: [[Note]], [[Note|shown text]], [[Note#Heading]]
// and embeds ![[Note]] (shown as a link). Rendered as <a class="internal-link"
// data-href="Note" data-heading="Heading">; src/main.ts resolves them against
// the space's notes, dims the broken ones and opens the rest on tap.
// Images: ![alt](src) and ![[name.png]] become centred pictures, loaded by
// src/images.ts; "|300" or "|300x200" after the alt text or name sets the size.
// A table's own direction: `<!-- table: rtl -->`, `<!-- table: ltr -->` or
// `<!-- table: auto -->` on the line just above the table.
export const TABLE_DIRECTIVE = /^\s*<!--\s*table:\s*(rtl|ltr|auto)\s*-->\s*$/i;

// Measured big and reported small: a marker's width is kept as a multiple of
// the text size, so one measurement holds at every size the note is read at
// and at the 15px the page prints at.
const MARKER_MEASURE_PX = 1000;
let markerPaint: CanvasRenderingContext2D | null | undefined;

/**
 * How much room each drawn list keeps for its marker: the widest marker the
 * list holds, written on the list itself as --list-marker-width (em).
 *
 * A marker is drawn from its own end — every `۱.` and `الف.` in a list ends
 * on the same line, a hair before the text — so the room a list needs is the
 * widest marker in it, and nothing else. Without this the strip was a fixed
 * 3ch (reading view) or 1.4em (paper), and anything wider was painted outside
 * it: `الف.` and `۱۲۳۴۵.` were cut off by the section's own box in the reading
 * view (content-visibility, src/style.css) and ran out to the paper's margin
 * in the PDF. src/style.css and src/print.css read this and widen the strip to
 * it; a list whose markers fit the old strip keeps the old strip, to the pixel.
 *
 * The canvas answers with the same advance the browser lays the marker out
 * with, in the font the note is read in. A note rendered before the font has
 * loaded is measured in the fallback, so src/main.ts measures again when the
 * font arrives.
 */
export function sizeListMarkers(root: ParentNode): void {
  const host = globalThis.document as Document | undefined;
  const lists = root.querySelectorAll<HTMLElement>('ol.persian-ordered');
  if (!host || !lists.length) return;
  if (markerPaint === undefined) markerPaint = host.createElement('canvas').getContext('2d');
  if (!markerPaint) return;
  const face = getComputedStyle(host.body ?? host.documentElement).fontFamily || 'sans-serif';
  markerPaint.font = `${MARKER_MEASURE_PX}px ${face}`;
  lists.forEach((list) => {
    let widest = 0;
    for (const item of list.children) {
      const marker = item.getAttribute('data-persian-number');
      if (marker === null) continue;
      const text = marker + (item.getAttribute('data-persian-delimiter') ?? '');
      widest = Math.max(widest, markerPaint!.measureText(text).width / MARKER_MEASURE_PX);
    }
    if (widest > 0) list.style.setProperty('--list-marker-width', `${widest.toFixed(3)}em`);
  });
}

const WIKI = /^(!?)\[\[([^\[\]|#\n]*)(?:#([^\[\]|\n]*))?(?:\|([^\[\]\n]*))?\]\]/;
// <img> for src/images.ts to fill in. "alt|300" / "alt|300x200" (or just
// "300") sets the width (and height), as in Obsidian.
function imageTag(src: string, label: string, wiki: boolean): string {
  const size = /^(?:(.*)\|)?\s*(\d+)(?:x(\d+))?\s*$/.exec(label);
  const alt = size ? (size[1] ?? '').trim() : label;
  const width = size ? ` width="${size[2]}"` : '';
  const height = size?.[3] ? ` height="${size[3]}"` : '';
  let name = src.split(/[?#]/)[0].split('/').pop() || src;
  try { name = decodeURIComponent(name); } catch { /* as written */ }
  return `<img class="md-image" data-src="${escapeHtml(src)}"${wiki ? ' data-wiki="1"' : ''} alt="${escapeHtml(alt || name)}"${width}${height}>`;
}
const isImagePath = (path: string): boolean => /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/i.test(path);
marked.use({
  extensions: [{
    name: 'wikiLink',
    level: 'inline',
    start: (src: string) => { const at = src.search(/!?\[\[/); return at < 0 ? undefined : at; },
    tokenizer(src: string) {
      const match = WIKI.exec(src);
      if (!match || !(match[2] || match[3])) return undefined;
      return { type: 'wikiLink', raw: match[0], embed: match[1] === '!', target: match[2].trim(), heading: (match[3] ?? '').trim(), alias: match[4]?.trim() ?? '' };
    },
    renderer(token) {
      const { embed, target, heading, alias } = token as unknown as { embed: boolean; target: string; heading: string; alias: string };
      if (embed && isImagePath(target)) return imageTag(target, alias, true);
      const shown = alias || (heading ? (target ? `${target} › ${heading}` : heading) : target);
      return `<a class="internal-link${embed ? ' mod-embed' : ''}" data-href="${escapeHtml(target)}" data-heading="${escapeHtml(heading)}">${escapeHtml(shown)}</a>`;
    },
  }],
  renderer: {
    image({ href, text }: { href: string; text: string }): string {
      return imageTag(href, text, false);
    },
  },
});

// ==Highlight==, as Obsidian: a <mark>. The text right inside the marks
// can't be a space, and "===" isn't one.
marked.use({
  extensions: [{
    name: 'highlight',
    level: 'inline',
    start: (src: string) => { const at = src.indexOf('=='); return at < 0 ? undefined : at; },
    tokenizer(src: string) {
      const match = /^==(?!=)(?=\S)([\s\S]*?\S)==(?!=)/.exec(src);
      if (!match) return undefined;
      return { type: 'highlight', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
    },
    renderer(token) {
      return `<mark>${this.parser.parseInline((token as unknown as { tokens: Token[] }).tokens)}</mark>`;
    },
  }],
});

// <t:UNIX> and <t:UNIX:F>: Discord-style timestamps (src/timestamps.ts). An
// extension, so a code span or a formula that holds one stays as written.
marked.use({
  extensions: [{
    name: 'discordTimestamp',
    level: 'inline',
    start: (src: string) => { const at = src.indexOf('<t:'); return at < 0 ? undefined : at; },
    tokenizer(src: string) {
      const match = TIMESTAMP_START.exec(src);
      if (!match) return undefined;
      return { type: 'discordTimestamp', raw: match[0], seconds: Number(match[1]), format: (match[2] ?? 'f') as TimestampFormat };
    },
    renderer(token) {
      const { seconds, format } = token as unknown as { seconds: number; format: TimestampFormat };
      return timestampTag(seconds, format);
    },
  }],
});

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));

const newlines = (text: string): number => text.split('\n').length - 1;

// Math, from the same spans the editor styles (src/mathScan.ts): each formula
// becomes a placeholder that marked() passes through untouched — its tex is
// never read as markdown — and the rendered KaTeX goes back in after the
// sanitizer, so nothing in a formula is bold, struck or linked. A display
// formula keeps the lines it spanned, so the source line of everything below
// it holds. Text math never turned out to be (a lone `$$`, a pair a heading
// broke) is left alone and reads as the ordinary markdown it is.
function splitMath(source: string, spans: readonly MathSpan[]): string {
  if (!spans.length) return source;
  let out = '';
  let cursor = 0;
  spans.forEach((span, id) => {
    out += source.slice(cursor, span.from);
    out += span.display
      // Keep the lines the formula spanned, so everything below it keeps its number.
      // `pre` rather than `div` on purpose: the parser ends an HTML block at the
      // closing tag of a `pre` on the same line, while a `div` keeps the block
      // open until the next blank line — which used to swallow the lines under
      // a formula, a list under it arriving as plain text.
      ? `<pre data-satr-math="${id}"></pre>${'\n'.repeat(newlines(source.slice(span.from, span.to)))}`
      : `<span data-satr-math="${id}"></span>`;
    cursor = span.to;
  });
  return out + source.slice(cursor);
}

// The preview is rendered in sections, one per top-level markdown block, each
// tagged with the source lines it came from (data-line / data-lines) — the
// same model as Obsidian's reading view. Lists are tagged per item. Editor and
// preview scroll positions are exchanged as a fractional source line (see
// src/scrollSync.ts). Every transform before lexing keeps line numbers,
// except table-separator insertion, which reports where its lines came from.
// A fenced code block (to its closing fence, or the end of the note), a
// code span (backtick runs of the same length, within one paragraph), or
// math: $$display$$ or $inline$.
export function renderMarkdown(source: string): string {
  const normalized = source.replace(/\r\n?/g, '\n');
  // Front matter becomes blank lines, so line numbers don't shift.
  const withoutFrontMatter = normalized.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, (block) => block.replace(/[^\n]/g, ''));
  // Math first: the placeholders hold no markdown, and the transforms below
  // (page breaks, list markers, table separators) only ever look at the
  // lines' text, so the reading view and the editor agree on every formula.
  const spans = scanMath(withoutFrontMatter);
  const math = spans.map((span) => renderMath(withoutFrontMatter.slice(span.from + span.delim, span.to - span.delim), span.display));
  const withMathPlaceholders = splitMath(withoutFrontMatter, spans);
  // A list marker the writer typed keeps its own number — `۲.` becomes `2.`
  // for the parser's sake (the digits are only transliterated), never `1.`:
  // a single `2.` is the writer's 2, in the preview and in the PDF alike.
  //
  // An English letter is a list marker only where it reads as one: `a.` and
  // `b.` on neighbouring lines are a list, while `A. Smith` on its own, or two
  // lines opening `A.`, are sentences. (Persian letters and the three digit
  // sets never look like prose, and are always read as markers.)
  const listLines = markPageBreaks(withMathPlaceholders).split('\n');
  const lettered = listLines.map((_line, index) => lineIsLettered((at) => listLines[at], index));
  // The quote marks travel with the indent, both here and in markerOn below:
  // a marker is at the start of what it marks, and inside a blockquote that is
  // after the `>`. Without this a quoted `۱.` was never rewritten for the
  // parser, so it came out as a line of prose rather than a list — English
  // markers worked only because the parser can read those itself.
  const grow = new RegExp(`^([ \\t]*(?:>[ \\t]*)*)(${MARKER})([.)])[ \\t]+`);
  const normalizedLists = listLines.map((line, index) => line.replace(grow, (whole, indent: string, marker: string, punctuation: string) => {
    if (letterItem(line) && !lettered[index]) return whole;
    const parsed = parseMarker(marker);
    // A letter marker becomes its place in the run for the parser's sake, and
    // is drawn back as the letter: `الف.` is `1.` to marked and `الف` to the
    // reader. `۲.` goes the same road and stops at its own digits.
    const latin = parsed ? formatDigits(parsed.number, 'latin') : marker;
    return `${indent}${latinDigits(latin)}${punctuation} `;
  })).join('\n');
  const { text: normalizedTables, origin } = ensureTableSeparators(normalizedLists);
  const tableAlignments = extractTableAlignments(normalizedTables);

  footnotes = { defs: collectFootnotes(normalizedTables), order: [], uses: new Map(), inline: 0 };
  const tokens = marked.lexer(normalizedTables);
  const sections: Array<{ html: string; token: Token; start: number; end: number }> = [];
  let line = 0;
  for (const token of tokens) {
    const start = line;
    line += newlines(token.raw);
    if (token.type === 'space') continue;
    const single = Object.assign([token], { links: tokens.links }) as TokensList;
    sections.push({ html: marked.parser(single), token, start, end: line });
  }
  const sourceLine = (transformed: number): number => origin[Math.min(transformed, origin.length - 1)] ?? transformed;
  // A `<!-- table: rtl -->` (or ltr / auto) comment on the line just above a
  // table sets that whole table's direction — the entire table, column order
  // included, not the per-cell `:---` alignment. The comment renders as
  // nothing (on GitHub too), and without one the table follows the note like
  // any other block (src/direction.ts). Only the last comment before the
  // table counts; one that isn't followed by a table stays an invisible
  // comment. The direction is written onto the table's own HTML here, so it
  // travels with that very table: a table nested in a list (which is no
  // section of its own) can never take another table's comment, and no
  // counting of directives against DOM tables is needed.
  const consumed: Array<(typeof sections)[number]> = [];
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const directive = section.token.type === 'html' ? TABLE_DIRECTIVE.exec(section.token.raw ?? '') : null;
    if (!directive) continue;
    const next = sections[index + 1];
    if (next?.token.type !== 'table') continue;
    const word = directive[1].toLowerCase();
    if (word === 'rtl' || word === 'ltr') next.html = next.html.replace('<table', `<table data-table-dir="${word}"`);
    consumed.push(section);
  }
  for (const spent of consumed) sections.splice(sections.indexOf(spent), 1);
  const html = sections.map((section, index) => `<div class="md-section" data-sec="${index}">${section.html}</div>`).join('')
    + footnotesSectionHtml();

  let safe = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true }, ADD_ATTR: ['data-satr-math', 'data-sec', 'data-href', 'data-heading', 'data-src', 'data-table-dir'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'svg', 'math'],
    FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload'],
  });
  // One sweep for every formula. A replace per formula rescans the whole
  // note each time, so a note with a thousand formulas did a thousand passes
  // over a megabyte of HTML — quadratic, and the biggest single cost of
  // opening such a note. A function replacement also keeps the formula
  // literal: a string replacement would read $& and $1 inside KaTeX's output.
  safe = safe.replace(/<(span|div|pre) data-satr-math="(\d+)"><\/\1>/g, (whole, _tag, index: string) => math[Number(index)] ?? whole);
  const document = new DOMParser().parseFromString(safe, 'text/html');
  // A checkbox hangs in the strip before the text and takes no room of its
  // own (style.css), so the space the parser writes after it would push a
  // task's first line past every other item's. The space is dropped here, in
  // the markup, rather than guessed at in em: a task's text then starts
  // exactly where a bullet's does, in the reading view and in source mode
  // alike (src/livePreview.ts; tests/viewParity.spec.ts).
  document.querySelectorAll('li > input[type="checkbox"], li > p > input[type="checkbox"]').forEach((box) => {
    const next = box.nextSibling;
    if (next?.nodeType === 3 && next.textContent?.startsWith(' ')) next.textContent = next.textContent.slice(1);
  });
  document.querySelectorAll<HTMLElement>('.md-section[data-sec]').forEach((element) => {
    const section = sections[Number(element.dataset.sec)];
    element.removeAttribute('data-sec');
    if (!section) return;
    const tag = (target: HTMLElement, from: number, to: number): void => {
      target.dataset.line = String(sourceLine(from));
      target.dataset.lines = String(Math.max(1, sourceLine(to) - sourceLine(from)));
    };
    // Each `<li>` is tagged with the line its own marker was written on, and a
    // nested list is walked too: an item of it is an item of the note, with a
    // line of its own (what the reading view reads its marker from, and what
    // the scroll passes through).
    type ListToken = Token & { items: Array<{ raw: string; tokens?: Token[] }> };
    const tagList = (token: ListToken, list: Element, start: number, end: number): boolean => {
      const items = [...list.children].filter((child) => child.tagName === 'LI') as HTMLElement[];
      if (items.length !== token.items.length) return false;
      let itemLine = start;
      items.forEach((item, index) => {
        const raw = token.items[index].raw ?? '';
        const next = itemLine + newlines(raw);
        tag(item, itemLine, index === items.length - 1 ? end : next);
        const parts = token.items[index].tokens ?? [];
        const nested = parts.find((one) => one.type === 'list') as ListToken | undefined;
        const nestedList = nested ? item.querySelector(':scope > ul, :scope > ol') : null;
        if (nested && nestedList) {
          // Where the nested list begins: the lines of everything the item
          // wrote before it.
          const before = parts.slice(0, parts.indexOf(nested)).reduce((total, one) => total + newlines(one.raw ?? ''), 0);
          tagList(nested, nestedList, itemLine + before, next);
        }
        itemLine = next;
      });
      return true;
    };
    // A quote holds blocks of its own, and a list inside one is a list of the
    // note: its items each need the line their marker was written on, or the
    // marker cannot be read back off the source and the list is drawn in the
    // browser's own digits. The quote keeps its own tag as well — it is still
    // one block as far as the scroll is concerned, and these sit inside it.
    const walkQuote = (token: Token, quote: Element, start: number): void => {
      const parts = ((token as Token & { tokens?: Token[] }).tokens ?? []).filter((one) => one.type !== 'space');
      const kids = [...quote.children];
      if (parts.length !== kids.length) return; // shapes disagree: leave it alone
      let line = start;
      parts.forEach((part, index) => {
        const kid = kids[index];
        const next = line + newlines(part.raw ?? '');
        if (part.type === 'list' && (kid.tagName === 'OL' || kid.tagName === 'UL')) tagList(part as ListToken, kid, line, next);
        else if (part.type === 'blockquote' && kid.tagName === 'BLOCKQUOTE') walkQuote(part, kid, line);
        line = next;
      });
    };
    const list = section.token.type === 'list' ? element.querySelector(':scope > ul, :scope > ol') : null;
    if (!list || !tagList(section.token as ListToken, list, section.start, section.end)) {
      tag(element, section.start, section.end);
      const quote = section.token.type === 'blockquote' ? element.querySelector(':scope > blockquote') : null;
      if (quote) walkQuote(section.token, quote, section.start);
    }
    // A first height for the reading view before it has been laid out, in
    // source lines of its own — not in what was tagged onto it. A list tags
    // its items, never the section, so reading data-lines back off the
    // element left every list in the note with no estimate at all and the
    // blanket one in style.css instead: 40em of reserved room for three
    // items that come to 96px. A note of headings, a line of text and a
    // short list each time measured three times its real length that way,
    // and a reading position landed in a note that then collapsed under it.
    // style.css takes over from here (content-visibility: auto) and
    // remembers the real height the first time the section is seen; --md-line
    // is what the app has learned a source line costs (src/main.ts).
    const span = Math.max(1, sourceLine(section.end) - sourceLine(section.start));
    element.dataset.span = String(span);
    element.style.setProperty('contain-intrinsic-block-size', `auto calc(var(--md-line, 1.85em) * ${span})`);
  });
  // A list is drawn from its own markers, read back from the lines they were
  // written on: every item shows the marker the writer typed — `الف` stays
  // `الف`, `٣` stays `٣` — and the head's marker decides whether the list is
  // drawn at all (an English list is the platform's own). Matching lists to
  // lines by position, as this used to, went wrong the moment a note held
  // another list, a nested one, or two lists a blank line was all that
  // separated: the styles landed on the wrong <ol> and the list came out in
  // English numbers.
  const sourceLines = withoutFrontMatter.split('\n');
  // The marker a line was written with, and the punctuation after it: `۱.`
  // and `۱)` are two different markers to the reader, so both halves travel.
  const markerOn = (line: number): { token: string; delimiter: string } | null => {
    const match = new RegExp(`^[ \\t]*(?:>[ \\t]*)*(${MARKER})([.)])[ \\t]+`).exec(sourceLines[line] ?? '');
    return match ? { token: match[1], delimiter: match[2] } : null;
  };
  // Two lists that follow one another are two lists, not one. The parser cannot
  // see that: every marker was written over in Latin digits above for its sake,
  // so `۱.` under `1.`, or `الف.` under `۲.`, or `1.` under `b.`, all read to it
  // as more of the same list. The markers themselves came back right — they are
  // read off the source line here — so what the reader got was one list wearing
  // two alphabets, with no gap between the halves, one direction over both and
  // one marker strip sized for the widest marker in either. The alphabet each
  // item was really written in is known at this point, so a list is cut wherever
  // it changes, exactly as the parser already cuts one where `1.` turns into
  // `1)`. A list written in one alphabet is untouched, and so is an item that
  // carries no marker of its own: it stays with the run it was in.
  /** A `- [ ]` is not a `-`. CommonMark has no opinion — a task is a bullet
   *  with a box drawn in it — so a run of each read as one list, the boxes
   *  simply starting partway down: "- and - [ ] lists merge if there's
   *  nothing between them (even empty lines)". Source mode has always drawn
   *  them apart. The two are cut from one another here, the way a list is
   *  cut where its alphabet changes. */
  const taskAt = (line: number): boolean =>
    /^[ \t]*(?:>[ \t]*)*[-*+][ \t]+\[[ xX]\][ \t]/.test(sourceLines[line] ?? '');
  const kindOf = (line: number): string | null => {
    const mark = markerOn(line);
    const parsed = mark ? parseMarker(mark.token) : null;
    if (!mark || !parsed) return null;
    // The two Persian orders are one kind: a `ب` is the second letter of both,
    // so no single marker can say which order it is in — orderOf settles that
    // per list, from all the letters the list holds. Upper and lower case are
    // two kinds; `a.` and `A.` are not the same list.
    const letters = parsed.alphabet === 'abjad' || parsed.alphabet === 'abpats';
    return `${letters ? 'persian-letters' : parsed.alphabet}${mark.delimiter}`;
  };
  /** A line with nothing on it — inside a quote, the quote marks are nothing:
   *  `>` and `> ` are the blank line of a quoted list. */
  const blankAt = (line: number): boolean => {
    const text = sourceLines[line];
    return text !== undefined && !text.replace(/^[ \t]*(?:>[ \t]*)*/, '').trim();
  };
  /** The blank line a writer leaves between two items is worth one line of
   *  air, where they left it — which is what source mode shows them, and all
   *  it shows them. Marking the list loose instead, the way CommonMark reads
   *  it, spread every item of the list apart: two items written one under the
   *  next moved away from each other because a third, further down, had a
   *  blank line above it. The gap belongs to the pair it was typed between.
   *  Only between two items: the room above a list's first item is the list's
   *  own margin, and a blank line there is the ordinary end of a paragraph. */
  const markGaps = (): void => {
    document.querySelectorAll('li[data-line]').forEach((item) => {
      const line = Number((item as HTMLElement).dataset.line);
      const after = item.previousElementSibling?.tagName === 'LI';
      item.classList.toggle('gap-above', after && Number.isFinite(line) && line > 0 && blankAt(line - 1));
    });
  };
  // A list that was cut keeps the shape it was written in: halves that were
  // written one line under the next are tight again, rather than keeping the
  // paragraph spacing the blank line between the two lists put on every item.
  const tighten = (items: HTMLElement[]): void => {
    // Asked of the source lines themselves, not of the room an item takes up:
    // the last item of a half spans the blank line that ended it, so measuring
    // the gap between two items would call every cut list loose.
    const loose = items.some((item, index) => index > 0 && sourceLines
      .slice(Number(items[index - 1].dataset.line), Number(item.dataset.line)).some((line) => !line.trim()));
    const wrapped = items.every((item) => item.children.length === 1 && item.firstElementChild?.tagName === 'P');
    if (loose || !wrapped) return;
    for (const item of items) item.firstElementChild?.replaceWith(...item.firstElementChild.childNodes);
  };
  // Before anything is cut: an item that follows a gap is marked while the
  // item above it is still its sibling, and it keeps that mark into whatever
  // list it ends up in.
  markGaps();
  document.querySelectorAll('ol, ul').forEach((list) => {
    const items = [...list.children].filter((child) => child.tagName === 'LI') as HTMLElement[];
    if (items.length < 2) return;
    const bullets = list.tagName === 'UL';
    const runs: HTMLElement[][] = [[]];
    let kind: string | null = null;
    for (const item of items) {
      // A bullet list is cut by what its items are — a task or a bullet —
      // and an ordered list by the alphabet and punctuation of its markers.
      const own = bullets ? (taskAt(Number(item.dataset.line)) ? 'task' : 'bullet') : kindOf(Number(item.dataset.line));
      if (own && kind && own !== kind) runs.push([]);
      if (own) kind = own;
      runs[runs.length - 1].push(item);
    }
    if (runs.length < 2) return;
    let previous: Element = list;
    for (const run of runs.slice(1)) {
      // The attributes only: the items are moved over, and the new list counts
      // from the number its own first marker says.
      const next = list.cloneNode(false) as HTMLElement;
      const number = parseMarker(markerOn(Number(run[0].dataset.line))?.token ?? '')?.number;
      if (number) next.setAttribute('start', String(number));
      next.append(...run);
      previous.after(next);
      previous = next;
    }
    for (const run of runs) tighten(run);
  });
  document.querySelectorAll('ol').forEach((list) => {
    const items = [...list.children].filter((child) => child.tagName === 'LI') as HTMLElement[];
    const marks = items.map((item) => markerOn(Number(item.dataset.line)));
    const tokens = marks.map((one) => one?.token ?? null);
    // The first marker that is not English decides what the list is drawn
    // with; a list of English numbers is the platform's own and is left alone
    // — but for its punctuation: a list whose every marker was written `1)`
    // is drawn `1)`, by the browser's own counter (src/style.css).
    const parsed = tokens.map((token) => (token ? parseMarker(token) : null)).find((one) => one && one.alphabet !== 'latin') ?? null;
    if (!parsed) {
      if (marks.length && marks.every((one) => one?.delimiter === ')')) list.setAttribute('data-delimiter', ')');
      return;
    }
    // Which of the two Persian orders: whatever the letters typed in the list
    // say, exactly as the editor reads them.
    const order = parsed.alphabet === 'abjad' || parsed.alphabet === 'abpats'
      ? orderOf(tokens.flatMap((token, index) => (token ? [{ index, token }] : [])))
      : null;
    const alphabet: Alphabet = order ?? parsed.alphabet;
    list.classList.add('persian-ordered');
    if (alphabet !== 'persian' && alphabet !== 'arabic') list.classList.add('lettered-ordered');
    // A list counts: its head is the writer's own, exactly as they wrote it —
    // `الف` spelled out stays `الف` — and every item under it follows from
    // there: ۱ ۲ ۳ ۴, الف ب ج د, ٣ ٤ ٥, whatever numbers were typed on the
    // lines between. This is what the browser's own counter does for an
    // English list, and it is the rule the editor already renumbers a run by
    // (normalizeRun in src/editor.ts), so the source, the reading view and
    // the paper all say the same thing in both scripts.
    const start = Number(list.getAttribute('start') ?? '1') || 1;
    // An item that wrote no marker of its own takes the list's punctuation.
    const fallback = marks.find((one) => one)?.delimiter ?? '.';
    items.forEach((item, index) => {
      item.setAttribute('data-persian-number', index === 0 ? tokens[0] ?? formatMarker(start, alphabet) : formatMarker(start + index, alphabet));
      item.setAttribute('data-persian-delimiter', marks[index]?.delimiter ?? fallback);
    });
  });
  // Every drawn list now says how wide its widest marker is, so the strip the
  // marker hangs in is cut to that list and no marker is painted outside it.
  sizeListMarkers(document);
  document.querySelectorAll('table').forEach((table, tableIndex) => {
    const firstRow = table.querySelector<HTMLTableRowElement>('thead tr');
    if (firstRow && [...firstRow.cells].every((cell) => !cell.textContent?.trim())) firstRow.remove();
    // A whole-table direction set by hand: `<!-- table: rtl -->` (or ltr)
    // above the table travelled here on the table itself (data-table-dir,
    // written above). `applyReadingDirections` gives the table its own dir
    // from its first cell; an explicit one wins.
    const manual = table.dataset.tableDir;
    if (manual === 'ltr' || manual === 'rtl') table.setAttribute('dir', manual);
    const alignments = tableAlignments[tableIndex] ?? [];
    table.querySelectorAll('tr').forEach((row) => row.querySelectorAll('th,td').forEach((cell, cellIndex) => {
      if (alignments[cellIndex]) cell.setAttribute('data-table-align', alignments[cellIndex]);
    }));
    // Wide tables pan inside a wrapper; the table itself is never clipped and
    // keeps its own width (src/style.css: .table-wrapper). data-pan-x tells
    // the drawer gesture (src/drawers.ts) that this element owns horizontal
    // drags in both directions.
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    wrapper.setAttribute('data-pan-x', '');
    table.replaceWith(wrapper);
    wrapper.appendChild(table);
  });
  // Marked can leave bare prose beside a display formula. Give these
  // fragments their own direction just like an ordinary paragraph.
  document.querySelectorAll('.md-section').forEach((section) => {
    for (const child of [...section.childNodes]) {
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue;
      const span = document.createElement('span');
      span.className = 'md-prose-fragment';
      child.replaceWith(span); span.append(child);
    }
  });
  // A formula that opens an item — `الف. $$x$$` — belongs on the marker's own
  // line. Left to its own margin it would open a blank line above itself while
  // the marker stayed at the top of the item; the item says where its formula
  // begins, and style.css drops that one margin.
  document.querySelectorAll('li').forEach((item) => {
    for (const child of item.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) continue;
      if (child instanceof HTMLElement && child.classList.contains('math-display')) item.setAttribute('data-math-head', '');
      break;
    }
  });
  applyReadingDirections(document.body);
  // A table that reads right to left mirrors its markers along with its
  // columns. `---:` means the *end* of the row, which in Persian is the
  // physical left, and `:---` its start, the physical right — so the same
  // separator line draws a Persian table as the mirror image of the English
  // one, which is what a right-to-left reader is writing down. Only tables
  // are mirrored: a paragraph has no column to belong to.
  //
  // The attribute itself stays physical (`right` is always the right-hand
  // side), so the screen stylesheet and the print one read it the same way
  // and the PDF needs no rule of its own — exportPdf renders through here.
  const MIRROR: Record<string, string> = { right: 'left', left: 'right' };
  document.querySelectorAll<HTMLElement>('table[dir="rtl"] [data-table-align]')
    .forEach((cell) => {
      const mirrored = MIRROR[cell.getAttribute('data-table-align') ?? ''];
      if (mirrored) cell.setAttribute('data-table-align', mirrored);
    });
  return document.body.innerHTML;
}

// Page breaks, for the PDF (hidden on screen). Any of these, on its own line
// outside code: \pagebreak, \newpage, \clearpage, <!-- pagebreak -->,
// <!-- newpage -->, or HTML whose style asks for one (page-break-before /
// -after: always, break-before / -after: page), e.g.
// <div style="page-break-before: always"></div>. Each becomes an empty
// <div class="page-break">; HTML with content keeps its content, the break
// going before or after it. One line in, one line out (line numbers hold).
const PAGE_BREAK_LINE = /^\s{0,3}(?:\\(?:pagebreak|newpage|clearpage)|<!--\s*(?:page-?break|new-?page)\s*-->)\s*$/i;
const PAGE_BREAK_STYLE = /(page-break-|break-)(before|after)\s*:\s*(always|page|left|right)/i;
const PAGE_BREAK_DIV = '<div class="page-break"></div>';
function markPageBreaks(source: string): string {
  let fence: string | null = null;
  return source.split('\n').map((line) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      return line;
    }
    if (fence) return line;
    if (PAGE_BREAK_LINE.test(line)) return PAGE_BREAK_DIV;
    const style = /^\s{0,3}<[a-z][^>]*\bstyle\s*=\s*["']([^"']*)["'][^>]*>/i.exec(line);
    const wants = style ? PAGE_BREAK_STYLE.exec(style[1]) : null;
    if (!wants) return line;
    // An empty element is just the break; one with content keeps it.
    if (/^\s*<([a-z0-9]+)[^>]*>\s*(<\/\1>)?\s*$/i.test(line)) return PAGE_BREAK_DIV;
    return wants[2].toLowerCase() === 'before' ? `${PAGE_BREAK_DIV}${line.trimStart()}` : `${line}${PAGE_BREAK_DIV}`;
  }).join('\n');
}

function latinDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const persian = '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit);
    return String(persian >= 0 ? persian : '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
  });
}

function extractTableAlignments(source: string): Array<Array<'left' | 'center' | 'right'>> {
  return source.split(/\r?\n/).filter((line) => {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    return cells.length >= 2 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
  }).map((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => {
    const value = cell.trim();
    if (value.startsWith(':') && value.endsWith(':')) return 'center';
    if (value.endsWith(':')) return 'right';
    if (value.startsWith(':')) return 'left';
    return 'center';
  }));
}

function ensureTableSeparators(source: string): { text: string; origin: number[] } {
  const lines = source.split(/\r?\n/);
  const output: string[] = [];
  // origin[k]: source line of output line k (inserted lines borrow a neighbour's).
  const origin: number[] = [];
  const emit = (text: string, from: number): void => { output.push(text); origin.push(from); };
  let inTableBody = false;
  const isSeparatorRow = (line: string): boolean => {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    return cells.length >= 2 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
  };
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    const currentCells = current.split('|').filter((cell) => cell.trim()).length;
    const nextCells = next?.split('|').filter((cell) => cell.trim()).length ?? 0;
    if (inTableBody) {
      if (current.includes('|') && currentCells >= 2) {
        emit(current, index);
        continue;
      }
      inTableBody = false;
    }
    const currentIsSeparator = isSeparatorRow(current);
    if (currentIsSeparator && next?.includes('|') && nextCells >= 2) {
      if (index === 0 || !lines[index - 1].includes('|')) {
        emit(`| ${Array.from({ length: currentCells }, () => ' ').join(' | ')} |`, index);
      }
      emit(current, index);
      inTableBody = true;
      continue;
    }
    const looksLikeTable = current.includes('|') && next?.includes('|') && currentCells >= 2 && nextCells >= 2;
    if (looksLikeTable && !isSeparatorRow(next!)) {
      emit(current, index);
      emit(`| ${Array.from({ length: currentCells }, () => '---').join(' | ')} |`, index);
      inTableBody = true;
      continue;
    }
    emit(current, index);
  }
  return { text: output.join('\n'), origin };
}
