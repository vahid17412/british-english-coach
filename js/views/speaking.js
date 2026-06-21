// views/speaking.js — independent streak, independent stats.
// Transcription happens for free in the browser via the Web Speech API
// (Android Chrome supports this natively); the AI only ever sees text,
// which keeps this working even on providers with no audio support.

import { DB } from '../db.js';
import { AI } from '../ai.js';
import { escapeHtml, showError, toast, notifyStreakChange } from '../util.js';

let session = null; // { prompt, transcript, feedback }
let recognizer = null;
let recording = false;

const FALLBACK_PROMPTS = [
  'Describe what you did this morning, in a few sentences.',
  "Tell me about your weekend plans — what are you looking forward to?",
  'Describe your usual commute or daily routine.',
  'Talk about a meal you enjoyed recently.',
  'Describe the weather today and how it affects your mood.',
];

function speechSupported() {
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

function makeRecognizer(onResult) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new Ctor();
  r.lang = 'en-GB';
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (e) => {
    let text = '';
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    onResult(text);
  };
  return r;
}

async function requestPrompt() {
  try {
    const reply = await AI.chat([
      { role: 'system', content: 'You set everyday spoken-English practice prompts. Conversational, realistic, never academic.' },
      { role: 'user', content: 'Give one speaking prompt, a single short sentence, no preamble.' },
    ]);
    return reply.trim();
  } catch {
    return FALLBACK_PROMPTS[Math.floor(Math.random() * FALLBACK_PROMPTS.length)];
  }
}

async function getFeedback(prompt, transcript) {
  const system = 'You are a British English speaking coach. Analyse a transcript of spoken practice. Identify mistakes, unnatural wording, and suggest improvements. Be descriptive — strengths, weaknesses, suggestions — and avoid numeric scores entirely.';
  const userPrompt = `Prompt: ${prompt}\nTranscript of what the learner said:\n${transcript}\n\nRespond with ONLY valid JSON:\n{"strengths": "...", "weaknesses": "...", "suggestions": "...", "unnaturalPhrases": [{"said": "...", "moreNatural": "..."}]}`;
  const reply = await AI.chat([{ role: 'system', content: system }, { role: 'user', content: userPrompt }], { json: true });
  const parsed = AI.parseLooseJSON(reply);
  if (!parsed) throw new Error('Could not read the AI\u2019s feedback. Try again.');
  return parsed;
}

export async function render(container) {
  const streak = await DB.streakDisplay('speaking');
  const total = (await DB.getAll('speaking')).length;

  container.innerHTML = `
    <div class="stat-grid" style="margin-bottom:14px;">
      <div class="stat"><span class="num text">${streak.label}</span><span class="label">Speaking streak</span></div>
      <div class="stat"><span class="num">${total}</span><span class="label">Sessions completed</span></div>
    </div>
    ${session ? sessionHtml() : starterHtml()}
  `;
  wireUp(container);
}

function starterHtml() {
  return `
    <div class="card">
      <h3 style="margin-top:0;">Get a prompt</h3>
      <p class="muted">You'll answer out loud — your phone's microphone turns it into text, then the coach reads it back to you.</p>
      <button class="primary" id="s-getprompt" style="width:100%;">New prompt</button>
    </div>`;
}

function sessionHtml() {
  return `
    <div class="card">
      <div class="row between"><h3 style="margin:0;">Prompt</h3><button class="ghost small" id="s-restart">Cancel</button></div>
      <p>${escapeHtml(session.prompt)}</p>
      ${
        session.feedback
          ? feedbackHtml()
          : speechSupported()
          ? recordHtml()
          : typeFallbackHtml()
      }
    </div>`;
}

function recordHtml() {
  return `
    <div class="row" style="margin:14px 0;">
      <button class="${recording ? 'danger' : 'primary'}" id="s-rec" style="flex:1;">
        ${recording ? '<span class="rec-dot"></span>Stop recording' : '● Start recording'}
      </button>
    </div>
    <textarea id="s-transcript" placeholder="Your transcript will appear here as you speak — feel free to fix anything it mis-heard.">${escapeHtml(session.transcript || '')}</textarea>
    <button class="primary" id="s-submit" style="width:100%; margin-top:10px;">Get feedback</button>`;
}

function typeFallbackHtml() {
  return `
    <p class="muted">Your browser doesn't support voice input. Type what you would have said instead.</p>
    <textarea id="s-transcript" placeholder="Type your spoken answer…">${escapeHtml(session.transcript || '')}</textarea>
    <button class="primary" id="s-submit" style="width:100%; margin-top:10px;">Get feedback</button>`;
}

function feedbackHtml() {
  const f = session.feedback;
  return `
    <p class="muted" style="margin-bottom:4px;">What you said:</p>
    <p>${escapeHtml(session.transcript)}</p>
    <div class="card tight" style="margin-top:10px;"><strong style="color:var(--sage);">Strengths</strong><p>${escapeHtml(f.strengths || '')}</p></div>
    <div class="card tight"><strong style="color:var(--rust);">Weaknesses</strong><p>${escapeHtml(f.weaknesses || '')}</p></div>
    <div class="card tight"><strong style="color:var(--brass);">Suggestions</strong><p>${escapeHtml(f.suggestions || '')}</p></div>
    ${(f.unnaturalPhrases || [])
      .map((p) => `<div class="item-row"><div><div class="text">${escapeHtml(p.said)}</div><div class="meta">→ ${escapeHtml(p.moreNatural)}</div></div></div>`)
      .join('')}
    <button class="primary" id="s-finish" style="width:100%; margin-top:10px;">Save & finish</button>`;
}

function wireUp(container) {
  container.querySelector('#s-getprompt')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Finding a prompt…';
    const prompt = await requestPrompt();
    session = { prompt, transcript: '', feedback: null };
    render(container);
  });

  container.querySelector('#s-restart')?.addEventListener('click', () => {
    if (recognizer) { try { recognizer.stop(); } catch {} }
    recording = false;
    session = null;
    render(container);
  });

  const recBtn = container.querySelector('#s-rec');
  recBtn?.addEventListener('click', () => {
    const ta = container.querySelector('#s-transcript');
    if (!recording) {
      recognizer = makeRecognizer((text) => {
        session.transcript = text;
        ta.value = text;
      });
      recognizer.onerror = () => { recording = false; render(container); };
      recognizer.onend = () => { if (recording) { recording = false; render(container); } };
      recognizer.start();
      recording = true;
    } else {
      recognizer.stop();
      recording = false;
    }
    render(container);
  });

  container.querySelector('#s-submit')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const transcript = container.querySelector('#s-transcript').value.trim();
    if (!transcript) return showError(new Error('Record or type something first.'));
    btn.disabled = true;
    btn.textContent = 'Listening back…';
    try {
      session.transcript = transcript;
      session.feedback = await getFeedback(session.prompt, transcript);
      render(container);
    } catch (err) {
      showError(err);
      btn.disabled = false;
      btn.textContent = 'Get feedback';
    }
  });

  container.querySelector('#s-finish')?.addEventListener('click', async () => {
    await DB.put('speaking', {
      id: DB.uid(),
      date: DB.todayStr(),
      prompt: session.prompt,
      transcript: session.transcript,
      feedback: session.feedback,
    });
    await DB.markStreakActive('speaking');
    notifyStreakChange();
    toast('Saved.');
    session = null;
    render(container);
  });
}
