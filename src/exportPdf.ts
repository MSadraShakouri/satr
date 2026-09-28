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
// as Markor does.
import { Capacitor, registerPlugin } from '@capacitor/core';
import katexCss from 'katex/dist/katex.min.css?raw';
import printCss from './print.css?raw';
import { loadImages } from './images';
import { renderMarkdown } from './markdown';
import { layoutMath } from './mathLayout';
import { loadSettings } from './settings';
import { getSystemFontScale } from './native';

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

export async function exportPdf(name: string, markdown: string, notePath = ''): Promise<void> {
  if (busy) return;
  busy = true;
  const frame = document.createElement('iframe');
  let scaleCorrection: HTMLStyleElement | null = null;
  try {
    const settings = loadSettings();
    const hasMath = /\$/.test(markdown);
    const [fonts, pagedJs, systemScale] = await Promise.all([
      embeddedFonts(hasMath),
      import('../node_modules/pagedjs/dist/paged.polyfill.min.js?raw').then((m) => m.default),
      Capacitor.isNativePlatform() ? getSystemFontScale() : Promise.resolve(1),
    ]);
    const printScale = Math.min(3, Math.max(0.5, systemScale));
    const body = printableBody(renderMarkdown(markdown));
    await loadImages(body, notePath); // embedded as data: URLs before paging
    const dir = isRtlText(body.textContent ?? '') ? 'rtl' : 'ltr';
    const pageNumber = settings.pdfPageNumbers === 'none' ? ''
      : `@page { @bottom-center { content: counter(page${settings.pdfPageNumbers === 'persian' ? ', persian' : ''}); font-family: Vazirmatn, sans-serif; font-size: 12pt; color: #222; vertical-align: middle; } }`;
    const styles = [
      fonts,
      hasMath ? katexCss.replace(/@font-face\{[^}]*\}/g, '') : '',
      printCss,
      pageNumber,
      settings.pdfCss,
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
    const win = frame.contentWindow as (Window & { PagedConfig?: unknown; PagedPolyfill?: { preview(): Promise<unknown> } }) | null;
    const doc = frame.contentDocument;
    if (!win || !doc) throw new Error('No print frame');
    await doc.fonts.ready;

    // Paged.js measures in this app WebView before the fixed-scale native
    // print WebView receives the pages. Android's default text zoom follows
    // Configuration.fontScale, so temporarily divide every absolute font
    // size by that scale while measuring. Remove this override before
    // serializing: the final HTML then contains the original 100% CSS and
    // PrintPlugin renders it with setTextZoom(100).
    if (Capacitor.isNativePlatform() && Math.abs(printScale - 1) > 0.001) {
      scaleCorrection = doc.createElement('style');
      scaleCorrection.textContent = fontScaleCorrectionCss(printScale, settings.pdfCss);
      doc.head.appendChild(scaleCorrection);
      await doc.fonts.ready;
    }

    // Wrap long formulas at the page's width, as on screen.
    if (hasMath) {
      doc.body.style.width = `${CONTENT_WIDTH}px`;
      layoutMath(doc.body);
      doc.body.style.width = '';
    }

    // Lay the pages out.
    win.PagedConfig = { auto: false };
    const script = doc.createElement('script');
    script.textContent = pagedJs;
    doc.head.appendChild(script);
    if (!win.PagedPolyfill) throw new Error('Paged.js did not load');
    await win.PagedPolyfill.preview();
    numberFootnotes(doc);
    // The native print WebView is pinned at 100%; send it the unscaled source
    // CSS rather than the temporary, inverse-fontScale layout override.
    scaleCorrection?.remove();
    scaleCorrection = null;
    script.remove();

    if (Capacitor.isNativePlatform()) {
      doc.querySelectorAll('script').forEach((el) => el.remove());
      await SatrPrint.print({ html: `<!doctype html>\n${doc.documentElement.outerHTML}`, name });
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

/** Temporary CSS for layout in the text-scaled app WebView. The matching
 * unscaled CSS stays in the document and is restored before serialization. */
function fontScaleCorrectionCss(scale: number, customCss: string): string {
  const adjustedCustomCss = customCss.replace(/(font-size\s*:\s*)([^;{}]+)(;?)/gi, (_all, prefix: string, value: string, end: string) => {
    const adjusted = value.replace(/(-?(?:\d+(?:\.\d*)?|\.\d+))\s*(px|pt|pc|in|cm|mm|q)\b/gi,
      (_unit, amount: string, unit: string) => `${Number(amount) / scale}${unit}`);
    return `${prefix}${adjusted}${end}`;
  });
  return `
    html { font-size: ${15 / scale}px !important; }
    @page { @bottom-center { font-size: ${12 / scale}pt !important; } }
    .pagedjs_margin-bottom-center { font-size: ${12 / scale}pt !important; }
    ${adjustedCustomCss}
  `;
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
  root.querySelectorAll('input[type="checkbox"]').forEach((box) => box.setAttribute('disabled', ''));

  const notes = new Map<string, string>();
  root.querySelectorAll<HTMLElement>('section.footnotes li[data-footnote-id]').forEach((item) => {
    const content = item.querySelector(':scope > p') ?? item;
    notes.set(item.dataset.footnoteId!, content.innerHTML.trim());
  });
  root.querySelectorAll('section.footnotes').forEach((el) => el.remove());
  root.querySelectorAll<HTMLElement>('sup.footnote-ref').forEach((ref) => {
    const id = ref.querySelector('a')?.getAttribute('href')?.slice(1) ?? '';
    const note = document.createElement('span');
    note.className = 'footnote';
    note.innerHTML = notes.get(id) ?? '';
    note.setAttribute('dir', isRtlText(note.textContent ?? '') ? 'rtl' : 'ltr');
    ref.replaceWith(note);
  });
  return root;
}

// Per page: calls numbered 1, 2, 3… in reading order; each note takes its
// call's number. A call's digits follow its paragraph, a note's its own text.
function numberFootnotes(doc: Document): void {
  const view = doc.defaultView!;
  doc.querySelectorAll('.pagedjs_page').forEach((page) => {
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
