// A note that wants to run something says so, and gets a sealed frame to run
// it in. A fenced block marked `live` is rendered as an <iframe> with
// sandbox="allow-scripts" and nothing else, which gives it an opaque origin:
// its code can draw, animate, measure and compute, and it cannot read this
// origin's storage (every note you own lives there), cannot reach
// parent.document, cannot navigate the app, open a window, or submit a form.
// A Content-Security-Policy inside the frame takes the network away too, so a
// note cannot phone home: nothing loads but data: URLs, and fetch, XHR and
// WebSocket are refused.
//
//     ```live height=240
//     <canvas id="c" width="300" height="200"></canvas>
//     <script> /* draws into the canvas */ </script>
//     ```
//
// The height is the frame's own business: it measures itself and sends the
// number out, the only message this side listens for, clamped and matched to
// the frame that sent it. `height=` in the fence sets where it starts, which
// is also what the PDF uses, since an exported page has nobody listening.
// Everywhere else a `live` fence is just a fenced block: GitHub, Obsidian and
// Satr's own source mode all show it as the code it is.

/** Where a frame starts before it has measured itself. */
const DEFAULT_HEIGHT = 240;
const MIN_HEIGHT = 24;
const MAX_HEIGHT = 4000;

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

/** The frame's own sheet: a plain page, with the app's text size, that leaves
 *  every other decision to whoever wrote the block. */
const FRAME_CSS = 'html{color-scheme:light dark}body{margin:0;font-family:system-ui,-apple-system,sans-serif;font-size:1rem}';

/** The frame reports its content's height and nothing else. body, not
 *  documentElement: the document element is as tall as the frame, so it could
 *  never ask to be shorter than it already is. */
const REPORTER = `(function(){var last=-1;function send(){var b=document.body;if(!b)return;` +
  `var h=Math.max(b.scrollHeight,b.offsetHeight);if(h===last)return;last=h;parent.postMessage({satrLive:h},'*');}` +
  `addEventListener('load',send);if(window.ResizeObserver){new ResizeObserver(send).observe(document.documentElement);}send();})()`;

/** `live height=240` → 240. */
function heightOf(info: string): number {
  const written = /\bheight\s*=\s*(\d{1,4})/.exec(info);
  const asked = written ? Number(written[1]) : DEFAULT_HEIGHT;
  return Math.min(Math.max(asked, MIN_HEIGHT), MAX_HEIGHT);
}

function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** Is this fence a live block? */
export function isLive(info: string): boolean {
  return /^live\b/.test(info.trim());
}

/** The frame for one live block, source and all. */
export function liveFrame(source: string, info: string): string {
  const height = heightOf(info);
  const document = '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${attribute(POLICY)}">`
    + `<style>${FRAME_CSS}</style></head><body>${source}<script>${REPORTER}</script></body></html>`;
  return `<iframe class="md-live" sandbox="allow-scripts" referrerpolicy="no-referrer" title="Live block"`
    + ` style="height:${height}px" srcdoc="${attribute(document)}"></iframe>`;
}

/** Drop the frames from a piece of rendered markup: the switcher's preview
 *  cards are thumbnails of a note, and a thumbnail has no business booting a
 *  document of its own. */
export function stripLiveBlocks(html: string): string {
  return html.replace(/<iframe class="md-live"[\s\S]*?><\/iframe>/g, '');
}

let listening = false;

/** Listen for the frames' own heights. The message carries a number and
 *  nothing else, it is clamped, and it is only ever applied to the frame that
 *  sent it — a sandboxed frame is the one thing in the app with no other way
 *  to speak, and this is the whole of what it may say. */
export function installLiveBlocks(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (event: MessageEvent) => {
    const said = event.data as { satrLive?: unknown } | null;
    const asked = said && typeof said === 'object' ? said.satrLive : undefined;
    if (typeof asked !== 'number' || !Number.isFinite(asked)) return;
    const height = Math.min(Math.max(Math.round(asked), MIN_HEIGHT), MAX_HEIGHT);
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe.md-live')) {
      if (frame.contentWindow === event.source) {
        frame.style.height = `${height}px`;
        return;
      }
    }
  });
}
