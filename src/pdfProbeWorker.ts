/** Probe the actual synchronous worker transport without risking the PDFium worker. */
self.onmessage = (event: MessageEvent<{ url: string; length: number }>) => {
  try {
    const target = new URL(event.data.url);
    target.searchParams.set('offset', '0');
    target.searchParams.set('length', String(event.data.length));
    const xhr = new XMLHttpRequest();
    xhr.open('GET', target.href, false);
    xhr.responseType = 'arraybuffer';
    xhr.send();
    if (xhr.status !== 200 || !(xhr.response instanceof ArrayBuffer) || xhr.response.byteLength !== event.data.length) throw new Error('range refused');
    self.postMessage({ ok: true, bytes: Array.from(new Uint8Array(xhr.response)) });
  } catch { self.postMessage({ ok: false }); }
};
