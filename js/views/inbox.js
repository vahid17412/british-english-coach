// views/inbox.js — the holding pen for language items. Manual entries and
// anything saved from a lesson/coach conversation land in "Not yet learned"
// until the daily lesson works them in; after that they move to "Learned"
// and join the spaced-repetition rotation.

import { DB } from '../db.js';
import { escapeHtml, toast, openModal, closeModals, showError } from '../util.js';

let activeTab = 'pending';

function itemRow(item, actions) {
  return `
    <div class="item-row" data-id="${item.id}">
      <div>
        <div class="text">${escapeHtml(item.text)}</div>
        <div class="meta">
          <span class="chip type">${item.type}</span>
          <span class="chip state-${item.state}">${item.state}</span>
        </div>
      </div>
      <div class="row" style="flex-shrink:0;">${actions}</div>
    </div>`;
}

function addItemModalHtml() {
  return `
    <h2>Add to Inbox</h2>
    <label>Word or phrase</label>
    <input id="m-text" placeholder="e.g. chuffed to bits" />
    <label>Type</label>
    <select id="m-type">
      <option value="vocabulary">Vocabulary</option>
      <option value="expression">Expression</option>
      <option value="chunk">Chunk</option>
      <option value="collocation">Collocation</option>
      <option value="pattern">Sentence pattern</option>
    </select>
    <label>Meaning (optional — the Coach can fill this in later)</label>
    <textarea id="m-meaning" placeholder="What does it mean?"></textarea>
    <div class="row" style="margin-top:16px;">
      <button class="ghost" id="m-cancel" style="flex:1;">Cancel</button>
      <button class="primary" id="m-save" style="flex:1;">Save</button>
    </div>`;
}

async function render(container) {
  const pending = await DB.inboxItems(true);
  const learned = await DB.inboxItems(false);
  const list = activeTab === 'pending' ? pending : learned;

  container.innerHTML = `
    <div class="row between">
      <h2 style="margin:0;">Inbox</h2>
      <button class="primary small" id="addBtn">+ Add</button>
    </div>
    <div class="row" style="margin:14px 0;">
      <button class="${activeTab === 'pending' ? 'primary' : 'ghost'} small" data-tab="pending">Not yet learned (${pending.length})</button>
      <button class="${activeTab === 'learned' ? 'primary' : 'ghost'} small" data-tab="learned">Learned (${learned.length})</button>
    </div>
    <div class="card tight">
      ${
        list.length
          ? list
              .map((item) =>
                activeTab === 'pending'
                  ? itemRow(item, `<button class="small ghost" data-ignore="${item.id}">Ignore</button>`)
                  : itemRow(
                      item,
                      `<button class="small ghost" data-rotate="${item.id}">Re-queue</button>`
                    )
              )
              .join('')
          : `<div class="empty"><span class="glyph">✎</span>${
              activeTab === 'pending'
                ? "Nothing waiting. Add a word or phrase you've come across, and tomorrow's lesson will work it in."
                : "Nothing learned yet — finish today's lesson to start filling this in."
            }</div>`
      }
    </div>
  `;

  document.getElementById('addBtn').addEventListener('click', openAddModal);
  container.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      activeTab = b.dataset.tab;
      render(container);
    })
  );
  container.querySelectorAll('[data-ignore]').forEach((b) =>
    b.addEventListener('click', async () => {
      await DB.updateItem(b.dataset.ignore, { state: 'ignored' });
      toast('Moved out of rotation.');
      render(container);
    })
  );
  container.querySelectorAll('[data-rotate]').forEach((b) =>
    b.addEventListener('click', async () => {
      await DB.updateItem(b.dataset.rotate, { nextReviewAt: Date.now(), state: 'learning' });
      toast('Back in the review rotation.');
      render(container);
    })
  );
}

function openAddModal() {
  const modal = openModal(addItemModalHtml());
  modal.querySelector('#m-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#m-save').addEventListener('click', async () => {
    const text = modal.querySelector('#m-text').value.trim();
    if (!text) return showError(new Error('Type a word or phrase first.'));
    const type = modal.querySelector('#m-type').value;
    const meaning = modal.querySelector('#m-meaning').value.trim();
    try {
      await DB.addItem({ text, type, meaning, origin: 'manual' });
      toast('Added to Inbox.');
      closeModals();
      render(document.getElementById('view'));
    } catch (err) {
      showError(err);
    }
  });
}

export { render };
