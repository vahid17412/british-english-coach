// views/writing.js — independent streak, independent stats. Mistakes feed
// back into the daily lesson generator via DB.recordMistake.

import { DB } from '../db.js';
import { AI } from '../ai.js';
import { escapeHtml, showError, toast, notifyStreakChange } from '../util.js';

let session = null; // { type, topic, userText, feedback }

const TYPE_LABELS = {
  sentence: 'Single sentence',
  paragraph: 'Short paragraph',
  free: 'Free writing',
};

async function requestTopic(type) {
  const reply = await AI.chat([
    { role: 'system', content: 'You are a British English writing coach. Suggest one everyday, conversational writing topic — nothing academic or abstract.' },
    { role: 'user', content: `Suggest one topic for a ${type === 'sentence' ? 'single sentence' : type === 'paragraph' ? 'short paragraph (3-5 sentences)' : 'free writing piece'}. Reply with just the topic, one line, no preamble.` },
  ]);
  return reply.trim();
}

async function getFeedback(type, topic, text) {
  const system = 'You are a British English writing coach. Correct grammar, improve wording, suggest more natural British alternatives, and explain mistakes kindly and specifically.';
  const prompt = `Writing type: ${TYPE_LABELS[type]}\nTopic: ${topic || '(none — free writing)'}\nLearner's text:\n${text}\n\nRespond with ONLY valid JSON:\n{"corrected": "...", "naturalAlternative": "...", "mistakes": [{"original": "snippet", "fix": "...", "explanation": "...", "pattern": "short label like 'article omission', or empty"}], "encouragement": "one warm, specific sentence"}`;
  const reply = await AI.chat([{ role: 'system', content: system }, { role: 'user', content: prompt }], { json: true });
  const parsed = AI.parseLooseJSON(reply);
  if (!parsed) throw new Error('Could not read the AI\u2019s feedback. Try again.');
  return parsed;
}

async function recentEntries() {
  const all = await DB.getAll('writing');
  return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
}

export async function render(container) {
  const streak = await DB.streakDisplay('writing');
  const total = (await DB.getAll('writing')).length;
  const entries = await recentEntries();

  container.innerHTML = `
    <div class="stat-grid" style="margin-bottom:14px;">
      <div class="stat"><span class="num text">${streak.label}</span><span class="label">Writing streak</span></div>
      <div class="stat"><span class="num">${total}</span><span class="label">Sessions completed</span></div>
    </div>
    ${session ? sessionHtml() : starterHtml()}
    ${
      entries.length
        ? `<h3 style="margin-top:22px;">Recent</h3>${entries
            .map(
              (e) => `<div class="item-row"><div><div class="text">${escapeHtml(e.topic || TYPE_LABELS[e.type])}</div><div class="meta">${e.date}</div></div></div>`
            )
            .join('')}`
        : ''
    }
  `;
  wireUp(container);
}

function starterHtml() {
  return `
    <div class="card">
      <h3 style="margin-top:0;">Start a new piece</h3>
      <label>Type</label>
      <select id="w-type">
        <option value="sentence">Single sentence</option>
        <option value="paragraph">Short paragraph</option>
        <option value="free">Free writing</option>
      </select>
      <label>Topic</label>
      <input id="w-topic" placeholder="Your own topic, or leave blank" />
      <div class="row" style="margin-top:10px;">
        <button class="ghost" id="w-surprise" style="flex:1;">Suggest a topic</button>
        <button class="primary" id="w-start" style="flex:1;">Start writing</button>
      </div>
    </div>`;
}

function sessionHtml() {
  return `
    <div class="card">
      <div class="row between"><h3 style="margin:0;">${TYPE_LABELS[session.type]}</h3><button class="ghost small" id="w-restart">Cancel</button></div>
      ${session.topic ? `<p class="muted">Topic: ${escapeHtml(session.topic)}</p>` : ''}
      ${
        session.feedback
          ? feedbackHtml()
          : `<textarea id="w-text" placeholder="Write here…">${escapeHtml(session.userText || '')}</textarea>
             <button class="primary" id="w-submit" style="width:100%; margin-top:10px;">Get feedback</button>`
      }
    </div>`;
}

function feedbackHtml() {
  const f = session.feedback;
  return `
    <p class="muted" style="margin-bottom:4px;">You wrote:</p>
    <p>${escapeHtml(session.userText)}</p>
    <p class="muted" style="margin-bottom:4px;">Corrected:</p>
    <p style="color:var(--sage);">${escapeHtml(f.corrected || '')}</p>
    ${f.naturalAlternative ? `<p class="muted" style="margin-bottom:4px;">More natural British way:</p><p style="color:var(--brass);">${escapeHtml(f.naturalAlternative)}</p>` : ''}
    ${(f.mistakes || [])
      .map(
        (m) => `<div class="card tight" style="margin-top:8px;"><strong>${escapeHtml(m.original)}</strong> → ${escapeHtml(m.fix)}<p class="muted" style="margin-top:4px;">${escapeHtml(m.explanation)}</p></div>`
      )
      .join('')}
    <p style="margin-top:10px;">${escapeHtml(f.encouragement || '')}</p>
    <button class="primary" id="w-finish" style="width:100%; margin-top:10px;">Save & finish</button>`;
}

function wireUp(container) {
  container.querySelector('#w-start')?.addEventListener('click', () => {
    const type = container.querySelector('#w-type').value;
    const topic = container.querySelector('#w-topic').value.trim();
    session = { type, topic, userText: '', feedback: null };
    render(container);
  });

  container.querySelector('#w-surprise')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const type = container.querySelector('#w-type').value;
    btn.disabled = true;
    btn.textContent = 'Thinking…';
    try {
      const topic = await requestTopic(type);
      container.querySelector('#w-topic').value = topic;
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Suggest a topic';
    }
  });

  container.querySelector('#w-restart')?.addEventListener('click', () => {
    session = null;
    render(container);
  });

  container.querySelector('#w-submit')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const text = container.querySelector('#w-text').value.trim();
    if (!text) return showError(new Error('Write something first.'));
    btn.disabled = true;
    btn.textContent = 'Reading…';
    try {
      session.userText = text;
      session.feedback = await getFeedback(session.type, session.topic, text);
      render(container);
    } catch (err) {
      showError(err);
      btn.disabled = false;
      btn.textContent = 'Get feedback';
    }
  });

  container.querySelector('#w-finish')?.addEventListener('click', async () => {
    await DB.put('writing', {
      id: DB.uid(),
      date: DB.todayStr(),
      type: session.type,
      topic: session.topic,
      userText: session.userText,
      feedback: session.feedback,
    });
    for (const m of session.feedback.mistakes || []) {
      if (m.pattern) await DB.recordMistake(m.pattern, m.original || '');
    }
    await DB.markStreakActive('writing');
    notifyStreakChange();
    toast('Saved.');
    session = null;
    render(container);
  });
}
