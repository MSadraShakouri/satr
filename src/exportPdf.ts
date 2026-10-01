// Export to PDF (≡ menu → Export to PDF).
//
// The note is rendered as in the reading view, into a hidden same-origin
// iframe, styled by src/print.css (plus the page-number setting and the
// user's custom CSS, last). Long formulas are wrapped at the page's width as
// on screen, then Paged.js lays the pages out: A4, 1in margins, footnotes at
// the foot of their page. Its footnote counter can't restart per page, so the
// numbers are written afterwards: 1, 2, 3… on every page, in Persian digits
// in Persian text and Latin in English.
//
// On the web the iframe is printed (the browser's dialog saves the PDF). In
// the Android app the laid-out pages, with every font embedded, go to a
// small native plugin (SatrPrint) that hands them to Android's print dialog,
// as Markor does. That WebView is sized like the phone's screen, so the copy
// it gets is pinned to the real A4 geometry (see printDocumentHtml).
import { Capacitor, registerPlugin } from '@capacitor/core';
import katexCss from 'katex/dist/katex.min.css?raw';
import printCss from './print.css?raw';
import { loadImages } from './images';
import { renderMarkdown } from './markdown';
import { layoutMath } from './mathLayout';
import { loadSettings } from './settings';
import { keepHeadingWithContent } from './printHeadings';
import { loadPrintOptions, printDirection, validPrintOptions, type PrintOptions } from './printOptions';
import { assembleColumns, columnPageCss, COLUMN_WIDTH_PX, PAGE_HEIGHT_MM, PAGE_WIDTH_MM, PAGE_WIDTH_PX } from './printColumns';

interface SatrPrintPlugin {
  print(options: { html: string; name: string }): Promise<void>;
}
const SatrPrint = registerPlugin<SatrPrintPlugin>('SatrPrint');

/** A4 width less two 1in margins, in CSS px (96/in): 210mm = 793.7px. */
const CONTENT_WIDTH = 210 / 25.4 * 96 - 2 * 96;

const PERSIAN_TEXT = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const STRONG = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]|[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const isRtlText = (text: string): boolean => {
  const strong = STRONG.exec(text);
  return Boolean(strong && /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(strong[0]));
};
const toPersianDigits = (value: string): string => value.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

let busy = false;

export async function exportPdf(name: string, markdown: string, notePath = '', options: PrintOptions = loadPrintOptions(notePath)): Promise<void> {
  if (busy) return;
  busy = true;
  const frame = document.createElement('iframe');
  try {
    const settings = loadSettings();
    options = validPrintOptions(options);
    const hasMath = /\$/.test(markdown);
    const [fonts, pagedJs] = await Promise.all([
      embeddedFonts(hasMath),
      import('../node_modules/pagedjs/dist/paged.polyfill.min.js?raw').then((m) => m.default),
    ]);
    const body = printableBody(renderMarkdown(markdown));
    await loadImages(body, notePath); // embedded as data: URLs before paging
    const dir = printDirection(body, options.direction);
    const mathAlign = options.mathAlign === 'center' ? 'center' : dir === 'rtl' ? 'right' : 'left';
    const pageNumber = settings.pdfPageNumbers === 'none' ? ''
      : `@page { @bottom-center { content: counter(page${settings.pdfPageNumbers === 'persian' ? ', persian' : ''}); font-family: Vazirmatn, sans-serif; font-size: 12pt; color: #222; vertical-align: middle; } }`;
    const styles = [
      fonts,
      hasMath ? katexCss.replace(/@font-face\{[^}]*\}/g, '') : '',
      printCss,
      pageNumber,
      settings.pdfCss,
      `.math-display, .math-display .katex-display > .katex { text-align: ${mathAlign}; }
       .math-display .katex-display > .katex { white-space: normal; }`,
      options.columns === 2 ? columnPageCss : '',
      // A one-line reserve at the foot of every paginated column, for both
      // paths.
      //
      // It is back because the old overflow came back with it gone: v0.7.3
      // dropped it on the strength of a measurement that said it only made the
      // app's pages sparser — but that measurement applied the rule to a
      // document Paged.js had already paginated, where it can no longer change
      // where a break falls. Measured properly, with the rule in the document
      // Paged.js reads, the same note pages the same either way; what the rule
      // really does is leave the last line of room free. Without it every page
      // is filled to the last pixel — text within 1px of the margin line, the
      // content box overfull by up to 28px — and the print WebView, a second
      // layout engine instance that lays text a hair taller than the frame
      // which measured it (Android's A4 is never Paged.js's to the last
      // fraction of a pixel), then has nowhere to put the first line that
      // comes out taller: it spills past the page's own foot, which is exactly
      // the pre-v0.4.1 overflow. That is the slack bought here. (v0.4.2's flow
      // layout, in printDocumentHtml, is what keeps such a line on the paper
      // instead of losing it sideways; this is what keeps a page from needing
      // that help.)
      //
      // Shared with the browser path on purpose. The app carried it alone
      // once, so the same note exported on the phone and in the site came out
      // of two different geometries — and dropping it from the app alone was
      // the same mistake from the other side. The reserve belongs to the page,
      // not to the engine printing it: both paths hand Paged.js the same
      // document and get the same pages (tests/printParity.spec.ts holds them
      // to it).
      `.pagedjs_pagebox > .pagedjs_area > .pagedjs_page_content { height: calc(100% - var(--pagedjs-footnotes-height, 0px) - 32px) !important; }`,
    ].map((css) => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`).join('\n');

    // Hidden but laid out (display: none would stop both layout and print).
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '900px', height: '1200px', border: '0', opacity: '0', pointerEvents: 'none' });
    // The page itself stays left to right, as the reading view's article does
    // (each paragraph takes its own direction): Paged.js finds overflow by
    // looking to the right, and in an RTL page its columns grow to the left,
    // so text past the end of a page would silently vanish. The class only
    // puts the footnote rule on the right.
    frame.srcdoc = `<!doctype html><html lang="${dir === 'rtl' ? 'fa' : 'en'}" dir="ltr" class="doc-${dir}"><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>${styles}</head><body>${body.innerHTML}</body></html>`;
    const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
    document.body.appendChild(frame);
    await loaded;
    const win = frame.contentWindow as (Window & { PagedConfig?: unknown; PagedPolyfill?: { preview(): Promise<unknown>; chunker: { hooks: { onOverflow: { register(fn: typeof keepHeadingWithContent): void } } } } }) | null;
    const doc = frame.contentDocument;
    if (!win || !doc) throw new Error('No print frame');
    await doc.fonts.ready;

    // Both WebViews are pinned at 100% text zoom now (SystemBarsPlugin.java,
    // PrintPlugin.java): the phone's font scale lives in the app's own CSS
    // (--system-font-scale, src/style.css) and never reaches this measuring
    // frame or the pages handed to the print WebView, so there is nothing to
    // cancel here.

    // Wrap long formulas at the page's width, as on screen.
    if (hasMath) {
      doc.body.style.width = `${options.columns === 2 ? COLUMN_WIDTH_PX : CONTENT_WIDTH}px`;
      layoutMath(doc.body);
      doc.body.style.width = '';
    }

    // Lay the pages out.
    win.PagedConfig = { auto: false };
    const script = doc.createElement('script');
    script.textContent = pagedJs;
    doc.head.appendChild(script);
    if (!win.PagedPolyfill) throw new Error('Paged.js did not load');
    win.PagedPolyfill.chunker.hooks.onOverflow.register(keepHeadingWithContent);
    await win.PagedPolyfill.preview();
    if (options.columns === 2) assembleColumns(doc, dir, settings.pdfPageNumbers);
    numberFootnotes(doc);
    script.remove();

    if (Capacitor.isNativePlatform()) {
      doc.querySelectorAll('script').forEach((el) => el.remove());
      await SatrPrint.print({ html: printDocumentHtml(doc), name });
    } else {
      // The saved file takes its name from the frame's title.
      const title = document.title;
      document.title = name;
      win.focus();
      win.print();
      document.title = title;
    }
  } finally {
    busy = false;
    // print() blocks until the dialog closes on the web; the native plugin
    // copies the HTML, so the frame can go either way.
    setTimeout(() => frame.remove(), 1000);
  }
}

// The static document handed to the app's print WebView: Paged.js's pages,
// every font embedded, laid out for paper and independent of the viewport
// that WebView happens to have.
//
// Paged.js assumes the document is printed where the paper is the viewport,
// which is true of the browser (it prints this same document inside the
// export iframe) but not of the app:
//
//  - Its @media print rules tie html, body, .pagedjs_pages, .pagedjs_page and
//    .pagedjs_sheet to 100% of the print viewport. The print WebView is sized
//    like the phone's screen, so every sheet was clipped to the screen's
//    height (.pagedjs_sheet is overflow: hidden) and the body was capped at
//    its width: the bottom of each page, and anything past the screen's edge,
//    never reached the paper. Pin the geometry Paged.js measured at instead.
//  - Its page content is a fixed-height multi-column container, and the print
//    WebView's text metrics are not the measuring WebView's. A line that no
//    longer fits its column drops into the next one, which lies past the
//    sheet's right edge and past the paper: the line that went missing from
//    Android's PDF at a page boundary. Hand it plain, unclipped flow instead.
//  - Paged.js leaves the note's original HTML in a <template>; the pages hold
//    the laid-out copy, so the template is dead weight in the string.
//
// The viewport meta asks that WebView to view the document at the paper's
// width (PrintPlugin.java sets useWideViewPort), so nothing is scaled to fit
// the paper either: one CSS pixel of layout is one CSS pixel of paper.
function printDocumentHtml(doc: Document): string {
  doc.querySelectorAll('template').forEach((el) => el.remove());
  const geometry = doc.createElement('style');
  geometry.textContent = `
    /* A4, no margins: the pages carry their own 1in ones. Last word in the
       cascade, so Paged.js's letter-sized @page cannot shrink the paper. */
    @page { size: ${PAGE_WIDTH_MM}mm ${PAGE_HEIGHT_MM}mm; margin: 0; }
    html, body {
      width: auto !important; min-width: ${PAGE_WIDTH_PX}px !important; max-width: none !important;
      height: auto !important; min-height: 0 !important; max-height: none !important;
    }
    .pagedjs_pages { height: auto !important; min-height: 0 !important; max-height: none !important; }
    .pagedjs_page, .pagedjs_sheet {
      height: ${PAGE_HEIGHT_MM}mm !important; min-height: 0 !important; max-height: none !important;
    }
    /* The print WebView lays these pages out itself: its text metrics, and
       Android's A4 page box (PrintPlugin.java), are never Paged.js's to the
       last fraction of a pixel. A page must therefore be able to give an
       overfull line a little more room instead of slicing it off.

       The line this used to lose was the page content's multi-column
       container: a line that no longer fitted its column did not move down,
       it moved into the next column, which begins past the sheet's right
       edge — where the sheet's overflow: hidden and the paper both end. A
       plain block formatting context keeps the box block-like (a child's top
       margin still cannot collapse out of it, so the footnotes keep the
       place Paged.js gave them) with no second column to escape into, and
       an overfull sheet is no longer clipped. */
    .pagedjs_sheet { overflow: visible !important; }
    .pagedjs_pagebox > .pagedjs_area > .pagedjs_page_content {
      display: flow-root !important;
      column-width: auto !important;
      column-count: auto !important;
    }
  `;
  doc.head.append(geometry);
  const viewport = doc.createElement('meta');
  viewport.setAttribute('name', 'viewport');
  viewport.setAttribute('content', `width=${PAGE_WIDTH_PX}, initial-scale=1`);
  doc.head.prepend(viewport);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

// The reading view's HTML, readied for paper: no copy buttons, wiki links as
// plain text, section wrappers unwrapped, and each footnote moved to where
// it's referenced (Paged.js floats it to the foot of that page).
function printableBody(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  root.querySelectorAll('.copy-code-button, .heading-collapse-indicator, .footnote-backref').forEach((el) => el.remove());
  root.querySelectorAll('a.internal-link').forEach((link) => {
    const span = document.createElement('span');
    span.textContent = link.textContent ?? '';
    link.replaceWith(span);
  });
  root.querySelectorAll('[data-line], [data-lines]').forEach((el) => { el.removeAttribute('data-line'); el.removeAttribute('data-lines'); });
  root.querySelectorAll<HTMLElement>('.md-section').forEach((section) => section.replaceWith(...section.childNodes));
  // Display math inside prose (e.g. "sketch $$u+v$$, $$u-v$$") closes
  // the paragraph during HTML parsing, leaving punctuation / trailing prose
  // as bare text. Once sections are unwrapped, that text is at the page root.
  // Paged.js 0.4 cannot map a break in root text back to its source element
  // and throws "getAttribute is not a function". Give it an inline element
  // to track without adding paragraph margins or changing the math layout.
  for (const node of [...root.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
    const span = document.createElement('span');
    node.replaceWith(span);
    span.appendChild(node);
  }
  root.querySelectorAll('input[type="checkbox"]').forEach((box) => box.setAttribute('disabled', ''));

  const notes = new Map<string, { html: string; dir: string }>();
  root.querySelectorAll<HTMLElement>('section.footnotes li[data-footnote-id]').forEach((item) => {
    const content = item.querySelector(':scope > p') ?? item;
    notes.set(item.dataset.footnoteId!, { html: content.innerHTML.trim(), dir: content.getAttribute('dir') ?? item.dir });
  });
  root.querySelectorAll('section.footnotes').forEach((el) => el.remove());
  root.querySelectorAll<HTMLElement>('sup.footnote-ref').forEach((ref) => {
    const id = ref.querySelector('a')?.getAttribute('href')?.slice(1) ?? '';
    const note = document.createElement('span');
    note.className = 'footnote';
    const saved = notes.get(id);
    note.innerHTML = saved?.html ?? '';
    note.setAttribute('dir', saved?.dir || 'ltr');
    ref.replaceWith(note);
  });
  return root;
}

// Per page: calls numbered 1, 2, 3… in reading order; each note takes its
// call's number. A call's digits follow its paragraph, a note's its own text.
function numberFootnotes(doc: Document): void {
  const view = doc.defaultView!;
  doc.querySelectorAll(doc.querySelector('.satr-print-sheet') ? '.satr-print-sheet' : '.pagedjs_page').forEach((page) => {
    let count = 0;
    const numbers = new Map<string, number>();
    page.querySelectorAll<HTMLElement>('.pagedjs_page_content [data-footnote-call]').forEach((call) => {
      count += 1;
      numbers.set(call.dataset.footnoteCall ?? '', count);
      const block = call.parentElement ?? call;
      const rtl = view.getComputedStyle(block).direction === 'rtl' || isRtlText(block.textContent ?? '');
      call.dataset.number = rtl && PERSIAN_TEXT.test(block.textContent ?? '') ? toPersianDigits(String(count)) : String(count);
    });
    page.querySelectorAll<HTMLElement>('.pagedjs_footnote_area [data-footnote-marker]').forEach((note) => {
      if (note.hasAttribute('data-split-from')) return; // continued from the last page
      const number = numbers.get(note.dataset.ref ?? '') ?? (count += 1);
      const label = doc.createElement('span');
      label.className = 'footnote-number';
      label.textContent = isRtlText(note.textContent ?? '') ? `${toPersianDigits(String(number))}.` : `${number}.`;
      note.prepend(label);
    });
  });
}

// Satr's fonts, embedded as data URIs so the PDF looks the same anywhere
// (the native print WebView loads the HTML without the app's files). Read
// from the app's own @font-face rules, so it works in dev and in builds.
async function embeddedFonts(withMath: boolean): Promise<string> {
  const rules: CSSFontFaceRule[] = [];
  const bases = new Map<CSSFontFaceRule, string>();
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; }
    for (const rule of [...list]) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      if (family === 'Vazirmatn' || family === 'VazirCode' || (withMath && family.startsWith('KaTeX'))) {
        rules.push(rule);
        bases.set(rule, sheet.href ?? document.baseURI);
      }
    }
  }
  const faces = await Promise.all(rules.map(async (rule) => {
    const src = rule.style.getPropertyValue('src');
    const match = /url\((["']?)([^"')]+\.woff2[^"')]*)\1\)\s*(format\([^)]*\))?/.exec(src);
    if (!match) return '';
    try {
      const response = await fetch(new URL(match[2], bases.get(rule)).href);
      if (!response.ok) return '';
      const data = await blobToDataUrl(await response.blob(), 'font/woff2');
      const keep = ['font-family', 'font-weight', 'font-style', 'font-stretch', 'unicode-range']
        .map((prop) => [prop, rule.style.getPropertyValue(prop)] as const)
        .filter(([, value]) => value)
        .map(([prop, value]) => `${prop}: ${value};`).join(' ');
      return `@font-face { ${keep} src: url("${data}") ${match[3] ?? ''}; }`;
    } catch { return ''; }
  }));
  return faces.join('\n');
}

function blobToDataUrl(blob: Blob, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;,]*/, `data:${type}`));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
