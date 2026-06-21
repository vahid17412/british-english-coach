// util.js — small shared helpers so every view doesn't reinvent these.

export function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toast(message, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function openModal(innerHtml) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal-sheet">${innerHtml}</div>`;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  document.body.appendChild(backdrop);
  return backdrop;
}

export function closeModals() {
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
}

export function fmtDate(ts) {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function withLoading(button, fn) {
  return async (...args) => {
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Working…';
    try {
      return await fn(...args);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  };
}

export function showError(err) {
  console.error(err);
  toast(`⚠ ${err.message || err}`, 4000);
}

/** Call after marking any streak active so the topbar updates immediately,
 * even when the current view re-renders itself without a hash change. */
export function notifyStreakChange() {
  window.dispatchEvent(new CustomEvent('streak-changed'));
}
