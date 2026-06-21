// views/settings.js — provider keys live only in this browser's IndexedDB.
// Nothing is sent anywhere except directly to the provider you choose.

import { DB } from '../db.js';
import { AI } from '../ai.js';
import { escapeHtml, toast, showError } from '../util.js';

async function listEnglishVoices() {
  return new Promise((resolve) => {
    const existing = speechSynthesis.getVoices();
    if (existing.length) return resolve(existing.filter((v) => v.lang?.startsWith('en')));
    speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices().filter((v) => v.lang?.startsWith('en')));
    setTimeout(() => resolve(speechSynthesis.getVoices().filter((v) => v.lang?.startsWith('en'))), 1200);
  });
}

export async function render(container) {
  const settings = await AI.getSettings();
  const preferredVoice = await DB.kvGet('preferredVoiceName', '');
  const voices = await listEnglishVoices();

  container.innerHTML = `
    <h2>Settings</h2>

    <h3>AI provider</h3>
    <p class="muted">Pick one provider and add your own API key. Calls go straight from this browser to the provider — nothing passes through any other server. Use <strong>Test connection</strong> to confirm it works from your device, since some providers (especially Gemini) are inconsistent about allowing direct browser calls.</p>
    <div id="providerList">
      ${Object.entries(AI.DEFAULTS)
        .map(([key, d]) => providerCardHtml(key, d, settings))
        .join('')}
    </div>

    <h3 style="margin-top:22px;">Pronunciation voice</h3>
    <p class="muted">Used for shadowing playback. Choose a UK English voice if more than one is installed on your device.</p>
    <select id="voiceSelect">
      <option value="">Default British voice</option>
      ${voices
        .map((v) => `<option value="${escapeHtml(v.name)}" ${v.name === preferredVoice ? 'selected' : ''}>${escapeHtml(v.name)} (${v.lang})</option>`)
        .join('')}
    </select>

    <h3 style="margin-top:22px;">Data</h3>
    <p class="muted">Everything lives only on this device. Export a backup before clearing browser data, or to move to another phone.</p>
    <div class="row">
      <button class="ghost" id="exportBtn" style="flex:1;">Export backup</button>
      <button class="danger" id="eraseBtn" style="flex:1;">Erase all data</button>
    </div>
  `;

  wireUp(container, settings);
}

function providerCardHtml(key, d, settings) {
  const active = settings.provider === key;
  const apiKey = settings.keys?.[key] || '';
  const model = settings.models?.[key] || '';
  return `
    <div class="provider-card ${active ? 'active' : ''}" data-provider="${key}">
      <div class="row between">
        <strong>${d.label}</strong>
        ${active ? '<span class="chip state-mastered">in use</span>' : `<button class="small ghost" data-use="${key}">Use this</button>`}
      </div>
      <label>API key</label>
      <input type="password" data-key="${key}" value="${escapeHtml(apiKey)}" placeholder="Paste your API key" />
      <label>Model (optional override)</label>
      <input data-model="${key}" value="${escapeHtml(model)}" placeholder="${d.model}" />
      <div class="row" style="margin-top:10px;">
        <button class="ghost small" data-save="${key}">Save</button>
        <button class="ghost small" data-test="${key}">Test connection</button>
      </div>
      <div class="muted" id="status-${key}" style="margin-top:8px; font-size:0.82rem;"></div>
    </div>`;
}

function wireUp(container, settings) {
  container.querySelectorAll('[data-use]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      settings.provider = btn.dataset.use;
      await AI.saveSettings(settings);
      toast(`Now using ${AI.DEFAULTS[settings.provider].label}.`);
      render(container);
    })
  );

  container.querySelectorAll('[data-save]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const key = btn.dataset.save;
      const apiKey = container.querySelector(`[data-key="${key}"]`).value.trim();
      const model = container.querySelector(`[data-model="${key}"]`).value.trim();
      settings.keys = settings.keys || {};
      settings.models = settings.models || {};
      settings.keys[key] = apiKey;
      if (model) settings.models[key] = model;
      else delete settings.models[key];
      await AI.saveSettings(settings);
      toast('Saved.');
    })
  );

  container.querySelectorAll('[data-test]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const key = btn.dataset.test;
      const apiKey = container.querySelector(`[data-key="${key}"]`).value.trim();
      const model = container.querySelector(`[data-model="${key}"]`).value.trim();
      const statusEl = document.getElementById(`status-${key}`);
      if (!apiKey) return showError(new Error('Add an API key first.'));
      btn.disabled = true;
      statusEl.textContent = 'Testing…';
      const result = await AI.testConnection(key, apiKey, model);
      statusEl.textContent = result.message;
      statusEl.style.color = result.ok ? 'var(--sage)' : 'var(--rust)';
      btn.disabled = false;
    })
  );

  container.querySelector('#voiceSelect').addEventListener('change', async (e) => {
    await DB.kvSet('preferredVoiceName', e.target.value);
    toast('Voice saved.');
  });

  container.querySelector('#exportBtn').addEventListener('click', async () => {
    const stores = ['items', 'lessons', 'writing', 'speaking', 'pronunciation', 'mistakes', 'coach', 'kv'];
    const dump = {};
    for (const s of stores) dump[s] = await DB.getAll(s);
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `british-english-coach-backup-${DB.todayStr()}.json`;
    a.click();
  });

  container.querySelector('#eraseBtn').addEventListener('click', async () => {
    if (!confirm('This permanently deletes every lesson, item, and history entry on this device. Continue?')) return;
    indexedDB.deleteDatabase('becDB');
    toast('Cleared. Reloading…');
    setTimeout(() => location.reload(), 800);
  });
}
