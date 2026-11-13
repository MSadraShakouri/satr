import type { PdfHandle, PdfOutlineItem, PdfPlace } from './pdfView';
import { readPlace, writePlace } from './viewMemory';
import { openDevicePdf, openIncomingPdf, closeDevicePdf, readDeviceHead, readDeviceAll, probeDeviceWorker, type DevicePdfSource } from './pdfDevice';

export type OverlaySource = Uint8Array | Blob | { kind: 'device-path'; path: string; incomingId?: string };
export interface PdfOverlay { destroy(): void; move(path: string): void; keepNow(): Promise<void>; expand(): void; closePopup(): boolean }
export interface OverlayOptions {
  source: OverlaySource;
  path: string;
  place: PdfPlace;
  hide(): void;
  openNormally(): void;
  failed(error: unknown): void;
}

/** A separate scroller, not a second note leaf. Its lifetime belongs to the
 * PDF tab, not to whichever note happens to be displayed underneath it. */
export function createPdfOverlay(options: OverlayOptions): PdfOverlay {
  const shell = document.querySelector<HTMLElement>('.app-shell')!;
  const root = document.createElement('section');
  root.className = 'pinned-pdf';
  root.setAttribute('aria-label', 'PDF over note');
  root.dataset.ignoreSwipe = '';
  root.innerHTML = `<div class="pinned-pdf-scroller"><div class="pinned-pdf-pages"></div></div><div class="pinned-pdf-loading" role="status">Opening PDF…</div>
    <div class="pinned-pdf-bar">
      <button class="pinned-page" aria-label="Go to page">–</button>
      <button class="pinned-browse" aria-label="Thumbnails and table of contents"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="7" rx="1"/><rect x="3" y="13" width="7" height="7" rx="1"/><path d="M14 6h7M14 10h7M14 15h7M14 19h7"/></svg></button>
      <button class="pinned-normal" aria-label="Open PDF normally"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg></button>
      <button class="pinned-grip" aria-label="Resize PDF overlay; tap to expand or restore"></button>
      <button class="pinned-hide" aria-label="Hide PDF overlay"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div><div class="pinned-pdf-popup" hidden></div>`;
  shell.append(root);
  document.body.classList.add('has-pinned-pdf');
  const scroller = root.querySelector<HTMLElement>('.pinned-pdf-scroller')!;
  const pages = root.querySelector<HTMLElement>('.pinned-pdf-pages')!;
  const bar = root.querySelector<HTMLElement>('.pinned-pdf-bar')!;
  const loading = root.querySelector<HTMLElement>('.pinned-pdf-loading')!;
  const pictureWatch = new MutationObserver(() => {
    if (pages.querySelector('.pdf-page canvas')) { loading.hidden = true; pictureWatch.disconnect(); }
  });
  pictureWatch.observe(pages, { childList: true, subtree: true });
  const grip = root.querySelector<HTMLButtonElement>('.pinned-grip')!;
  const pageButton = root.querySelector<HTMLButtonElement>('.pinned-page')!;
  const popup = root.querySelector<HTMLElement>('.pinned-pdf-popup')!;
  let handle: PdfHandle | null = null;
  let sourceDevice: DevicePdfSource | null = null;
  let key = '';
  let path = options.path;
  let alive = true;
  const abort = new AbortController();
  let height = Math.max(120, Math.round(shell.clientHeight * .34));
  const renderHeight = (): void => {
    root.style.height = `${Math.max(120, Math.min(Math.max(120, shell.clientHeight - 170), height))}px`;
  };
  const setHeight = (n: number): void => { height = Math.max(120, n); renderHeight(); };
  renderHeight();
  let expanded = false, previousHeight = height;
  const expand = (): void => { if (!expanded) { previousHeight = height; expanded = true; setHeight(shell.clientHeight * .75); } };
  const toggle = (): void => { if (expanded) { expanded = false; setHeight(previousHeight); } else expand(); };
  grip.onpointerdown = (event) => {
    if (document.body.classList.contains('keyboard-open')) return;
    event.preventDefault(); grip.setPointerCapture(event.pointerId);
    const y = event.clientY, start = root.getBoundingClientRect().height;
    let moved = false;
    const move = (e: PointerEvent): void => {
      if (Math.abs(e.clientY - y) > 6) moved = true;
      if (moved) { expanded = false; setHeight(start + e.clientY - y); }
    };
    const end = (e: PointerEvent): void => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
      if (!moved && e.type === 'pointerup') toggle();
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  };
  grip.onkeydown = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); expanded = false; setHeight(height + (e.key === 'ArrowUp' ? -16 : 16)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  };
  const resize = (): void => renderHeight();
  window.addEventListener('resize', resize);
  root.querySelector<HTMLButtonElement>('.pinned-hide')!.onclick = options.hide;
  root.querySelector<HTMLButtonElement>('.pinned-normal')!.onclick = options.openNormally;
  const closePopup = (): void => { popup.hidden = true; popup.replaceChildren(); };
  const heading = (title: string): void => {
    popup.hidden = false; popup.replaceChildren();
    const row = document.createElement('div'); row.className = 'pinned-popup-heading';
    const label = document.createElement('strong'); label.textContent = title;
    const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', 'Close PDF navigation'); close.onclick = closePopup;
    row.append(label, close); popup.append(row);
  };
  pageButton.onclick = () => {
    if (!handle) return;
    heading('Go to page');
    const form = document.createElement('form'); form.className = 'pinned-page-form';
    const input = document.createElement('input'); input.type = 'number'; input.inputMode = 'numeric'; input.min = '1'; input.max = String(handle.pages); input.value = String(handle.place().page); input.setAttribute('aria-label', 'Page number');
    const count = document.createElement('span'); count.textContent = `of ${handle.pages}`;
    const go = document.createElement('button'); go.type = 'submit'; go.textContent = 'Go';
    form.append(input, count, go); popup.append(form);
    form.onsubmit = (e) => { e.preventDefault(); const n = Number(input.value); if (Number.isFinite(n)) handle?.goTo(Math.max(1, Math.min(handle.pages, n))); closePopup(); };
  };
  root.querySelector<HTMLButtonElement>('.pinned-browse')!.onclick = () => {
    if (!handle) return;
    const viewer = handle;
    heading('Browse PDF');
    const controls = document.createElement('div'); controls.className = 'pinned-browse-tabs';
    const thumbsButton = document.createElement('button'); thumbsButton.textContent = 'Thumbnails';
    const contentsButton = document.createElement('button'); contentsButton.textContent = 'Contents';
    const list = document.createElement('div');
    controls.append(thumbsButton, contentsButton); popup.append(controls, list);
    let view = 0;
    const thumbnails = async (): Promise<void> => {
      const request = ++view; list.className = 'pinned-thumbnails'; list.replaceChildren();
      for (let n = 1; n <= viewer.pages; n++) {
        const button = document.createElement('button'); button.setAttribute('aria-label', `Page ${n}`); button.textContent = String(n); button.onclick = () => { viewer.goTo(n); closePopup(); };
        list.append(button);
      }
      for (let n = 1; n <= viewer.pages; n++) {
        if (!alive || popup.hidden || request !== view) return;
        const url = await viewer.thumbnail(n, 100);
        if (!alive || popup.hidden || request !== view) return;
        if (url) { const img = document.createElement('img'); img.src = url; img.alt = ''; list.children[n - 1]?.prepend(img); }
      }
    };
    const contents = async (): Promise<void> => {
      const request = ++view; list.className = 'pinned-contents'; list.textContent = 'Loading…';
      let items: PdfOutlineItem[] = await viewer.outline();
      if (!items.length) items = await viewer.derivedOutline();
      if (!alive || popup.hidden || request !== view) return;
      list.replaceChildren();
      const add = (entries: PdfOutlineItem[], level: number): void => {
        for (const item of entries) {
          const row = document.createElement('button'); row.textContent = item.title; row.style.paddingInlineStart = `${level * 12}px`;
          row.disabled = !item.page; row.onclick = () => { if (item.page) viewer.goTo(item.page); closePopup(); }; list.append(row); add(item.children ?? [], level + 1);
        }
      };
      add(items, 0); if (!items.length) list.textContent = 'No table of contents';
    };
    thumbsButton.onclick = () => { void thumbnails().catch(() => {}); }; contentsButton.onclick = () => { void contents().catch(() => {}); }; void thumbnails().catch(() => {});
  };
  let retrying = false;
  void (async () => {
    try {
      const { showPdf, pdfKey, pdfKeyHead } = await import('./pdfView');
      const { backend } = await import('./vault');
      let source: Uint8Array | Blob | DevicePdfSource;
      const input = options.source;
      const isDevice = !(input instanceof Uint8Array) && !(input instanceof Blob);
      if (isDevice) {
        try {
          const native = input.incomingId ? await openIncomingPdf(input.incomingId, abort.signal) : await openDevicePdf(input.path);
          sourceDevice = native;
          if (!alive) { await closeDevicePdf(native); sourceDevice = null; return; }
          const head = await readDeviceHead(native, abort.signal);
          key = await pdfKeyHead(head, native.size);
          if (native.size >= 16 * 1024 * 1024 && await probeDeviceWorker(native, head, abort.signal)) source = native;
          else {
            const all = await readDeviceAll(native, abort.signal);
            if (await pdfKey(all) !== key) throw new Error('PDF changed while opening');
            source = all;
            await closeDevicePdf(native); sourceDevice = null;
          }
        } catch (error) {
          if (sourceDevice) { await closeDevicePdf(sourceDevice); sourceDevice = null; }
          if (abort.signal.aborted || input.incomingId) throw error;
          const all = await backend.readBytes(path);
          if (!all?.byteLength) throw new Error('Cannot read PDF');
          source = all; key = await pdfKey(all);
        }
      } else { source = input; key = await pdfKey(source); }
      if (!alive) { if (sourceDevice) await closeDevicePdf(sourceDevice); sourceDevice = null; return; }

      // The usual reader retries a late random-range failure with a complete
      // read. The overlay must not leave a blank page where that reader would
      // have recovered. A generation also prevents a failed, late first mount
      // from replacing its retry or a reader the user already hid.
      let turn = 0;
      const complete = async (native?: DevicePdfSource): Promise<Uint8Array> => {
        let bytes: Uint8Array | null = null;
        if (input instanceof Blob) bytes = new Uint8Array(await input.arrayBuffer());
        else if (input instanceof Uint8Array) bytes = input;
        else {
          let opened = native;
          try {
            if (!opened) opened = input.incomingId ? await openIncomingPdf(input.incomingId, abort.signal) : await openDevicePdf(path);
            bytes = await readDeviceAll(opened, abort.signal);
          } catch (error) {
            if (abort.signal.aborted || input.incomingId) throw error;
            bytes = await backend.readBytes(path);
          } finally { if (opened && opened !== native) await closeDevicePdf(opened); }
        }
        if (!bytes?.byteLength || await pdfKey(bytes) !== key) throw new Error('PDF changed while opening');
        return bytes;
      };
      const mount = async (data: Uint8Array | Blob | DevicePdfSource, place: PdfPlace, generation: number): Promise<void> => {
        const opened = await showPdf(pages, data instanceof Uint8Array ? data.slice().buffer : data, {
          scroller, overlay: bar, key, cardFor: path, place,
          onPlace: (where) => { if (alive && generation === turn) writePlace(key, where); },
          readDeviceFallback: async (native) => (await complete(native)).slice().buffer,
          onSourceFailure: () => {
            if (!alive || retrying || generation !== turn) return;
            retrying = true;
            const where = handle?.place() ?? place;
            handle?.destroy(); handle = null;
            closePopup();
            loading.hidden = false;
            pictureWatch.observe(pages, { childList: true, subtree: true });
            const next = ++turn;
            void (async () => {
              try {
                const all = await complete();
                if (alive && next === turn) await mount(all, where, next);
              } catch (error) { if (alive && next === turn) options.failed(error); }
            })();
          },
        });
        if (data === sourceDevice) sourceDevice = null; // ownership passed to the viewer
        if (!alive || generation !== turn) { opened.destroy(); return; }
        handle = opened;
        opened.setCardPath(path);
        const update = (page: number): void => { pageButton.textContent = `${page} / ${opened.pages}`; };
        update(opened.place().page); opened.onPage(update);
      };
      await mount(source, options.place ?? readPlace(key)!, turn);
    } catch (error) { if (sourceDevice) { await closeDevicePdf(sourceDevice); sourceDevice = null; } if (alive && !retrying) options.failed(error); }
  })();
  return {
    destroy: () => {
      if (!alive) return; alive = false; abort.abort(); pictureWatch.disconnect(); window.removeEventListener('resize', resize);
      if (handle && key) writePlace(key, handle.place());
      handle?.destroy(); handle = null; root.remove(); document.body.classList.remove('has-pinned-pdf');
    },
    move: (next) => { path = next; handle?.setCardPath(next); },
    keepNow: () => handle?.keepNow() ?? Promise.resolve(),
    expand,
    closePopup: () => { if (popup.hidden) return false; closePopup(); return true; },
  };
}
