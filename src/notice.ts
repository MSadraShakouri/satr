// In-app notice, after Obsidian's on a phone (Notice in its app.js, .notice
// in app.css): a full-width banner at the top of the screen, below the safe
// area, on the secondary background with a 1px border and rounded corners,
// 12px medium text. It slides in, hides by itself, and a tap dismisses it.

export interface NoticeHandle { hide(): void }

let container: HTMLElement | null = null;

export function showNotice(message: string, ms = 4000): NoticeHandle {
  if (!container?.isConnected) {
    container = document.createElement('div');
    container.className = 'notice-container';
    container.setAttribute('role', 'status');
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = 'notice';
  el.dir = 'auto';
  el.textContent = message;
  container.appendChild(el);
  el.animate([{ opacity: 0, transform: 'translateY(-100%)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0, 0.55, 0.45, 1)' });
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
