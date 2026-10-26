// An .html file in the vault is a page, not a note. Satr opens it, keeps its
// text editable, and shows it in the reading view as the page it is: its own
// stylesheet, its own layout, edge to edge, with none of Satr's typography
// over the top of it. The only thing Satr brings is what the file leaves
// unsaid — a font and a text size — and those are stated first, so any rule
// the file writes wins.
//
// The page is shown in the same kind of sealed frame a `live` block gets:
// sandbox="allow-scripts" and nothing else, which gives it an opaque origin.
// A page in the vault may run its own code — that is what a page is — but it
// reads no storage of this origin's (every note you own is there), reaches no
// parent document, navigates nothing, and a Content-Security-Policy inside
// the frame keeps it off the network. Pictures beside the file are the one
// thing fetched for it, resolved out of the vault and handed over as data.
import { dataUrl } from './images';
import { embeddedFonts } from './embedFonts';
import { loadSettings } from './settings';

/** Satr edits .html as text; the reading view shows it as a page. */
export const isHtmlFile = (path: string): boolean => /\.x?html?$/i.test(path);

const POLICY = [
  "default-src 'none'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** What the file did not say. Written before the file's own head, at the
 *  weakest specificity there is, so one line of its own stylesheet replaces
 *  any of it. */
function defaults(fonts: string, fontSize: number): string {
  return `${fonts}\nhtml { font-family: Vazirmatn, system-ui, sans-serif; font-size: ${fontSize}px; color-scheme: light dark; }`;
}

/** The pictures a page asks for, as data: URLs out of the vault. A page in a
 *  folder of notes points at the folder's pictures the way a note does, and
 *  an opaque origin can resolve nothing relative by itself. */
async function inlinePictures(doc: Document, path: string): Promise<void> {
  const images = [...doc.querySelectorAll('img[src]')]
    .filter((img) => !/^(data|blob|https?):/i.test(img.getAttribute('src') ?? ''));
  await Promise.all(images.map(async (img) => {
    const url = await dataUrl(img.getAttribute('src') ?? '', path, false);
    if (url) img.setAttribute('src', url);
    else img.removeAttribute('src');
  }));
}

/** The file, as a document the frame can hold: its own markup, with the
 *  policy and the fallbacks put in front of it. */
export async function htmlDocument(source: string, path: string): Promise<string> {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  await inlinePictures(doc, path);
  const [fonts] = await Promise.all([embeddedFonts(false)]);
  const head = doc.head ?? doc.documentElement.insertBefore(doc.createElement('head'), doc.documentElement.firstChild);
  const policy = doc.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', POLICY);
  const base = doc.createElement('style');
  base.textContent = defaults(fonts, loadSettings().fontSize);
  head.insertBefore(base, head.firstChild);
  head.insertBefore(policy, head.firstChild);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

/** The page already on screen, so that a render asked for by something other
 *  than an edit — a fold, a setting, a tab coming back — does not reload a
 *  page that has not changed, restarting its script and losing where it had
 *  scrolled to. */
const shown = { path: '', source: '' };

/** Show the page in `host`, replacing whatever was there. The frame is
 *  rebuilt rather than written into: a page's script runs once, on load, as
 *  it would anywhere else. */
export async function showHtmlFile(host: HTMLElement, source: string, path: string, stillWanted: () => boolean = () => true): Promise<void> {
  if (shown.path === path && shown.source === source && host.querySelector('iframe.html-file')) return;
  const srcdoc = await htmlDocument(source, path);
  if (!stillWanted()) return; // the reader moved on while the fonts were read
  const frame = document.createElement('iframe');
  frame.className = 'html-file';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', path.split('/').pop() ?? 'Page');
  frame.srcdoc = srcdoc;
  host.replaceChildren(frame);
  shown.path = path;
  shown.source = source;
}
