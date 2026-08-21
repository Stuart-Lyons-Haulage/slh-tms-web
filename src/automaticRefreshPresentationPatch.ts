declare global {
  interface Window { __slhAutomaticRefreshPresentationPatch?: boolean; }
}

function removeRoutineRefreshControls() {
  document.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    const text = (button.textContent || '').trim().replace(/\s+/g, ' ');
    if (/^force\s/i.test(text)) return;
    if (/^refresh(?:\s|$)/i.test(text) || /^sync tachomaster$/i.test(text) || /^update tacho(?:master)?$/i.test(text)) {
      button.hidden = true;
      button.setAttribute('aria-hidden', 'true');
      button.tabIndex = -1;
    }
  });
}

if (typeof window !== 'undefined' && !window.__slhAutomaticRefreshPresentationPatch) {
  window.__slhAutomaticRefreshPresentationPatch = true;
  let frame: number | undefined;
  const queue = () => {
    if (frame != null) return;
    frame = window.requestAnimationFrame(() => {
      frame = undefined;
      removeRoutineRefreshControls();
    });
  };
  const observer = new MutationObserver(queue);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('focus', queue);
  queue();
}

export {};
