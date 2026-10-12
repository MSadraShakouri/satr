// In-app notice: on the note, a 44px rectangle behind the files and preview
// circles (centre to centre, so the circles are the ends), one centred line,
// no wrap. Same gray as the LaTeX bar, no outline. Fades in place. Slides
// with the drawers. On a full-screen page (settings, export, tab switcher)
// it is the old full-width banner. It hides by itself, and a tap dismisses it.

export interface NoticeHandle { hide(): void }

let container: HTMLElement | null = null;

export function showNotice(message: string, ms = 4000): NoticeHandle {
  if (!container?.isConnected) {
    container = document.querySelector('.notice-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'notice-container';
      container.setAttribute('role', 'status');
      document.body.appendChild(container);
    }
  }
  const el = document.createElement('div');
  el.className = 'notice';
  el.dir = 'auto';
  el.textContent = message;
  container.appendChild(el);
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'cubic-bezier(0, 0.55, 0.45, 1)' });
  let timer = 0;
  const hide = (): void => {
    window.clearTimeout(timer);
    if (!el.isConnected || el.classList.contains('is-hiding')) return;
    el.classList.add('is-hiding');
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-in' }).onfinish = () => el.remove();
  };
  if (ms > 0) timer = window.setTimeout(hide, ms);
  el.addEventListener('click', hide);
  return { hide };
}
