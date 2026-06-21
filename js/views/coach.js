// views/coach.js — the AI Coach. One continuous conversation, available
// everywhere, biased towards explaining thoroughly rather than briefly.

import { DB } from '../db.js';
import { AI } from '../ai.js';
import { escapeHtml, toast, openModal, closeModals, showError } from '../util.js';

const SYSTEM = `You are an AI English coach, available any time the learner has a question — about words, phrases, grammar, pronunciation, usage, or British vs American English. Always teach: explain meaning, context, and nuance rather than giving a one-line answer. British English is the standard. Keep answers focused but genuinely educational, with an example or two where useful.`;

async function loadLog() {
  const all = await DB.getAll('coach');
  return all.sort((a, b) => a.ts - b.ts);
}

function bubble(msg) {
  return `<div class="bubble ${msg.role}">${escapeHtml(msg.content)}</div>`;
}

function addModalHtml(prefillText = '') {
  return `
    <h2>Save to Inbox</h2>
    <label>Word or phrase</label>
    <input id="m-text" value="${escapeHtml(prefillText)}" placeholder="e.g. chuffed to bits" />
    <label>Type</label>
    <select id="m-type">
      <option value="vocabulary">Vocabulary</option>
      <option value="expression">Expression</option>
      <option value="chunk">Chunk</option>
      <option value="collocation">Collocation</option>
      <option value="pattern">Sentence pattern</option>
    </select>
    <div class="row" style="margin-top:16px;">
      <button class="ghost" id="m-cancel" style="flex:1;">Cancel</button>
      <button class="primary" id="m-save" style="flex:1;">Save</button>
    </div>`;
}

export async function render(container) {
  const log = await loadLog();
  const prefill = sessionStorage.getItem('coachPrefill') || '';
  sessionStorage.removeItem('coachPrefill');

  container.innerHTML = `
    <div class="row between">
      <h2 style="margin:0;">Coach</h2>
      <button class="ghost small" id="saveBtn">+ Save phrase</button>
    </div>
    <div class="chat-log" id="log">
      ${
        log.length
          ? log.map(bubble).join('')
          : `<div class="empty"><span class="glyph">💬</span>Ask about a word, an expression, a grammar point, or whether something sounds natural in British English.</div>`
      }
    </div>
    <div class="chat-input-row">
      <textarea id="chatInput" placeholder="Ask the coach…">${escapeHtml(prefill)}</textarea>
      <button class="primary" id="sendBtn">Send</button>
    </div>
  `;

  const logEl = document.getElementById('log');
  logEl.scrollTop = logEl.scrollHeight;

  document.getElementById('saveBtn').addEventListener('click', () => openAddModal());

  document.getElementById('sendBtn').addEventListener('click', async () => {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    const sendBtn = document.getElementById('sendBtn');
    sendBtn.disabled = true;
    input.disabled = true;

    const userMsg = { id: DB.uid(), role: 'user', content: text, ts: Date.now() };
    await DB.put('coach', userMsg);
    logEl.insertAdjacentHTML('beforeend', bubble(userMsg));
    input.value = '';
    logEl.scrollTop = logEl.scrollHeight;

    try {
      const history = (await loadLog()).slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const reply = await AI.chat([{ role: 'system', content: SYSTEM }, ...history]);
      const assistantMsg = { id: DB.uid(), role: 'assistant', content: reply, ts: Date.now() };
      await DB.put('coach', assistantMsg);
      logEl.insertAdjacentHTML('beforeend', bubble(assistantMsg));
      logEl.scrollTop = logEl.scrollHeight;
    } catch (err) {
      showError(err);
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  });

  if (prefill) document.getElementById('chatInput').focus();
}

function openAddModal() {
  const modal = openModal(addModalHtml());
  modal.querySelector('#m-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#m-save').addEventListener('click', async () => {
    const text = modal.querySelector('#m-text').value.trim();
    if (!text) return showError(new Error('Type a word or phrase first.'));
    const type = modal.querySelector('#m-type').value;
    try {
      await DB.addItem({ text, type, origin: 'coach' });
      toast('Added to Inbox.');
      closeModals();
    } catch (err) {
      showError(err);
    }
  });
}
