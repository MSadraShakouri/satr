// Cold start: the last screen, painted before any JavaScript loads.
// When the app goes to the background, a copy of the page (its HTML, the
// theme and settings on <html>, and where each pane was scrolled) is kept in
// localStorage. On the next start the small inline script in index.html puts
// that copy on screen at once, over the real app, which then builds itself
// underneath. dropSnapshot() lifts the copy away as soon as the real note is
// showing. The copy is a picture: it can't be tapped (the real app gets
// every touch), and it's skipped if the screen size has changed.
// The inline script reads the same key and format; keep them in step.

const KEY = 'satr:snapshot';
const MAX = 600_000; // characters; a bigger page just isn't kept

// Body classes worth repainting: the ones the app sets again itself at
// start. Drawers, the keyboard and the hidden navbar belong to the moment.
const KEEP = new Set(['no-line-numbers', 'is-empty-tab']);

function save(): void {
  const app = document.querySelector<HTMLElement>('#app');
  if (!app || !app.firstElementChild) return;
  const scroll: [number, number][] = [];
  app.querySelectorAll<HTMLElement>('*').forEach((el, i) => {
    if (el.scrollTop > 0) scroll.push([i, Math.round(el.scrollTop)]);
  });
  // Pictures are data: URLs (src/images.ts), far too big to keep: the copy
  // has an empty box of the same size in their place.
  const images = [...app.querySelectorAll<HTMLImageElement>('img[src^="data:"]')];
  let html: string;
  if (images.length) {
    const copy = app.cloneNode(true) as HTMLElement;
    copy.querySelectorAll<HTMLImageElement>('img[src^="data:"]').forEach((img, i) => {
      const box = images[i].getBoundingClientRect();
      img.removeAttribute('src');
      img.style.width = `${Math.round(box.width)}px`;
      img.style.height = `${Math.round(box.height)}px`;
    });
    html = copy.innerHTML;
  } else {
    html = app.innerHTML;
  }
  // CodeMirror's own styles (the "ͼ" classes: layout of the scroller, the
  // syntax colours) are made by its JavaScript at run time; keep them too.
  const css: string[] = [];
  const sheets = [...document.adoptedStyleSheets, ...[...document.querySelectorAll('style')].map((el) => el.sheet)];
  for (const sheet of sheets) {
    if (!sheet) continue;
    try {
      for (const rule of sheet.cssRules) if (rule.cssText.includes('\u037c')) css.push(rule.cssText);
    } catch { /* not readable */ }
  }
  if (html.length + css.join('').length > MAX) { localStorage.removeItem(KEY); return; }
  const snapshot = {
    v: 1,
    w: window.innerWidth,
    h: window.innerHeight,
    root: document.documentElement.className,
    style: document.documentElement.getAttribute('style') ?? '',
    body: [...document.body.classList].filter((c) => KEEP.has(c)).join(' '),
    html,
    css: css.join('\n'),
    scroll,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    localStorage.removeItem(KEY); // storage full: better no copy than a stale one
  }
}

/** Keep a copy of the screen whenever the app leaves the foreground. */
export function keepSnapshots(): void {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
  window.addEventListener('pagehide', save);
}

/** Lift the start-up copy off once the real app has painted. */
export function dropSnapshot(): void {
  const cover = document.getElementById('boot-snapshot');
  if (!cover) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    cover.style.transition = 'opacity 120ms ease-out';
    cover.style.opacity = '0';
    window.setTimeout(() => { cover.remove(); document.getElementById('boot-snapshot-css')?.remove(); }, 140);
  }));
}
