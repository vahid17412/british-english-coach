// app.js — the shell. Hash-based routing keeps this installable as a PWA
// with no build step: open index.html (or its GitHub Pages URL) and go.

import { DB } from './db.js';

const ROUTES = {
  today: { label: 'Today', load: () => import('./views/today.js') },
  inbox: { label: 'Inbox', load: () => import('./views/inbox.js') },
  labs: { label: 'Labs', load: () => import('./views/labs.js') },
  coach: { label: 'Coach', load: () => import('./views/coach.js') },
  progress: { label: 'Progress', load: () => import('./views/progress.js') },
  settings: { label: 'Settings', load: () => import('./views/settings.js') },
};

const TABS = ['today', 'inbox', 'labs', 'coach', 'progress'];

function currentRoute() {
  const hash = (location.hash || '#/today').replace('#/', '');
  return ROUTES[hash] ? hash : 'today';
}

async function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <header class="topbar">
      <div>
        <h1 style="margin-bottom:2px;">British English Coach</h1>
        <div class="streakline" id="streakline">…</div>
      </div>
      <button class="ghost small" id="settingsBtn" aria-label="Settings">⚙</button>
    </header>
    <main id="view"></main>
    <nav class="tabbar" id="tabbar">
      ${TABS.map((t) => `<button data-route="${t}" class="tab-btn">${ROUTES[t].label}</button>`).join('')}
    </nav>
  `;
  document.getElementById('settingsBtn').addEventListener('click', () => {
    location.hash = '#/settings';
  });
  document.getElementById('tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn) location.hash = `#/${btn.dataset.route}`;
  });
  await refreshStreakline();
}

async function refreshStreakline() {
  const s = await DB.streakDisplay('learning');
  const el = document.getElementById('streakline');
  if (el) el.textContent = `Learning streak: ${s.label}`;
}

async function renderRoute() {
  const route = currentRoute();
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.route === route);
  });
  const view = document.getElementById('view');
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const mod = await ROUTES[route].load();
    await mod.render(view);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="empty"><span class="glyph">⚠</span>${err.message || 'Something went wrong loading this screen.'}</div>`;
  }
  await refreshStreakline();
}

window.addEventListener('hashchange', renderRoute);
window.addEventListener('streak-changed', refreshStreakline);
window.addEventListener('DOMContentLoaded', async () => {
  await renderShell();
  await renderRoute();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
});
