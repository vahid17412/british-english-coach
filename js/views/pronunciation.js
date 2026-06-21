// views/pronunciation.js — independent streak, independent stats.
// Audio uses the browser's built-in speechSynthesis with an en-GB voice
// (free, offline, no provider needed). IPA and shadowing feedback go
// through the configured AI provider, cached per chunk once fetched.

import { DB } from '../db.js';
import { AI } from '../ai.js';
import { escapeHtml, showError, toast, notifyStreakChange } from '../util.js';

let session = null; // { lessonId, sourceText, chunks: [{id, text, ipa, attemptTranscript, feedback}] }
let recognizer = null;
let recordingChunkId = null;
let voicesReady = null;

function loadVoices() {
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    const existing = speechSynthesis.getVoices();
    if (existing.length) return resolve(existing);
    speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices());
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1200);
  });
  return voicesReady;
}

async function getBritishVoice() {
  const voices = await loadVoices();
  const preferred = await DB.kvGet('preferredVoiceName', '');
  if (preferred) {
    const match = voices.find((v) => v.name === preferred);
    if (match) return match;
  }
  return voices.find((v) => v.lang === 'en-GB') || voices.find((v) => v.lang?.startsWith('en-GB')) || voices.find((v) => v.lang?.startsWith('en')) || null;
}

async function speak(text) {
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const voice = await getBritishVoice();
  if (voice) utter.voice = voice;
  utter.lang = 'en-GB';
  utter.rate = 0.92;
  if (!voice) toast('No British English voice found on this device — install a UK English voice pack in your phone\u2019s TTS settings for best results.');
  speechSynthesis.speak(utter);
}

// Break a lesson's text into short shadowing chunks — clause-sized where
// possible, falling back to fixed word groups for long stretches.
function segmentText(text) {
  const sentences = text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks = [];
  for (const sentence of sentences) {
    const clauses = sentence.split(/,\s*|\s+(?=\b(?:but|and|so|because|although|while)\b)/i).filter(Boolean);
    for (const clause of clauses) {
      const words = clause.trim().split(/\s+/);
      if (words.length <= 7) {
        chunks.push(clause.trim());
      } else {
        for (let i = 0; i < words.length; i += 5) {
          chunks.push(words.slice(i, i + 5).join(' '));
        }
      }
    }
  }
  return chunks.filter((c) => c.length > 0).map((text) => ({ id: DB.uid(), text, ipa: null, attemptTranscript: '', feedback: null }));
}

async function fetchIPA(text) {
  const reply = await AI.chat([
    { role: 'system', content: 'You produce IPA transcriptions for Modern British Received Pronunciation (RP). Respond with ONLY the IPA transcription between forward slashes, nothing else.' },
    { role: 'user', content: text },
  ]);
  return reply.trim();
}

async function fetchShadowingFeedback(target, attempt) {
  const system = 'You are a British RP pronunciation coach. You only see text (the target phrase and a speech-to-text transcript of the learner\u2019s attempt), not audio, so reason from likely word substitutions, omissions, and typical British stress/rhythm/intonation/linking patterns for this phrase. Identify specific likely problems. Never give a numeric score.';
  const prompt = `Target phrase: "${target}"\nTranscript of the learner's spoken attempt: "${attempt}"\n\nRespond with ONLY valid JSON:\n{"likelyIssues": "specific, concrete observations about stress, rhythm, linking, or intonation likely to need work, based on the transcript differences", "tip": "one short, actionable tip"}`;
  const reply = await AI.chat([{ role: 'system', content: system }, { role: 'user', content: prompt }], { json: true });
  const parsed = AI.parseLooseJSON(reply);
  if (!parsed) throw new Error('Could not read the AI\u2019s feedback. Try again.');
  return parsed;
}

function speechSupported() {
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

async function completedLessons() {
  const all = await DB.getAll('lessons');
  return all.filter((l) => l.completed).sort((a, b) => b.date.localeCompare(a.date));
}

export async function render(container) {
  const streak = await DB.streakDisplay('pronunciation');
  const total = (await DB.getAll('pronunciation')).length;

  container.innerHTML = `
    <div class="stat-grid" style="margin-bottom:14px;">
      <div class="stat"><span class="num text">${streak.label}</span><span class="label">Pronunciation streak</span></div>
      <div class="stat"><span class="num">${total}</span><span class="label">Sessions completed</span></div>
    </div>
    <div id="labBody"></div>
  `;
  const body = document.getElementById('labBody');
  if (session) renderSession(body);
  else await renderPicker(body);
}

async function renderPicker(body) {
  const lessons = await completedLessons();
  body.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">Choose source text</h3>
      ${
        lessons.length
          ? lessons
              .slice(0, 10)
              .map(
                (l) => `<div class="item-row"><div><div class="text">${escapeHtml(l.text.slice(0, 60))}${l.text.length > 60 ? '…' : ''}</div><div class="meta">${l.date}</div></div><button class="small primary" data-lesson="${l.id}">Use this</button></div>`
              )
              .join('')
          : `<div class="empty">No completed lessons yet — finish a Daily Lesson first, then come back here to shadow it.</div>`
      }
    </div>`;
  body.querySelectorAll('[data-lesson]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const lesson = await DB.get('lessons', btn.dataset.lesson);
      session = { lessonId: lesson.id, sourceText: lesson.text, chunks: segmentText(lesson.text) };
      renderSession(body);
    })
  );
}

function renderSession(body) {
  body.innerHTML = `
    <div class="row between"><h3 style="margin:0;">Shadowing</h3><button class="ghost small" id="p-restart">Choose another</button></div>
    <p class="muted">Tap ▶ to hear each chunk in British RP, then try saying it back.</p>
    ${session.chunks
      .map(
        (c) => `
      <div class="card tight" data-chunk="${c.id}">
        <div class="chunk-line">
          <button class="play-btn" data-play="${c.id}">▶</button>
          <span class="chunk-text">${escapeHtml(c.text)}</span>
          <button class="ipa-toggle" data-ipa="${c.id}">IPA</button>
        </div>
        <div class="ipa-text ${c.ipa ? 'shown' : ''}" id="ipa-${c.id}">${c.ipa ? escapeHtml(c.ipa) : ''}</div>
        ${speechSupported() ? shadowControlsHtml(c) : ''}
      </div>`
      )
      .join('')}
    <button class="primary" id="p-finish" style="width:100%; margin-top:6px;">Finish session</button>
  `;
  wireSession(body);
}

function shadowControlsHtml(c) {
  const recording = recordingChunkId === c.id;
  return `
    <div class="row" style="margin-top:8px;">
      <button class="small ${recording ? 'danger' : 'ghost'}" data-rec="${c.id}">${recording ? '■ Stop' : '● Try it'}</button>
      ${c.attemptTranscript ? `<button class="small ghost" data-feedback="${c.id}">Get feedback</button>` : ''}
    </div>
    ${c.attemptTranscript ? `<p class="muted" style="margin-top:6px;">You said: "${escapeHtml(c.attemptTranscript)}"</p>` : ''}
    ${
      c.feedback
        ? `<div class="card tight" style="margin-top:6px;"><p>${escapeHtml(c.feedback.likelyIssues)}</p><p class="muted"><strong>Tip:</strong> ${escapeHtml(c.feedback.tip)}</p></div>`
        : ''
    }`;
}

function wireSession(body) {
  body.querySelector('#p-restart')?.addEventListener('click', () => {
    session = null;
    render(document.getElementById('view'));
  });

  body.querySelectorAll('[data-play]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const chunk = session.chunks.find((c) => c.id === btn.dataset.play);
      speak(chunk.text);
    })
  );

  body.querySelectorAll('[data-ipa]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const chunk = session.chunks.find((c) => c.id === btn.dataset.ipa);
      const display = document.getElementById(`ipa-${chunk.id}`);
      if (chunk.ipa) {
        display.classList.toggle('shown');
        return;
      }
      btn.textContent = '…';
      try {
        chunk.ipa = await fetchIPA(chunk.text);
        display.textContent = chunk.ipa;
        display.classList.add('shown');
      } catch (err) {
        showError(err);
      } finally {
        btn.textContent = 'IPA';
      }
    })
  );

  body.querySelectorAll('[data-rec]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const chunkId = btn.dataset.rec;
      const chunk = session.chunks.find((c) => c.id === chunkId);
      if (recordingChunkId === chunkId) {
        recognizer?.stop();
        recordingChunkId = null;
        renderSession(body);
        return;
      }
      const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognizer = new Ctor();
      recognizer.lang = 'en-GB';
      recognizer.interimResults = false;
      recognizer.onresult = (e) => {
        chunk.attemptTranscript = e.results[0][0].transcript;
      };
      recognizer.onend = () => {
        recordingChunkId = null;
        renderSession(body);
      };
      recognizer.start();
      recordingChunkId = chunkId;
      renderSession(body);
    })
  );

  body.querySelectorAll('[data-feedback]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const chunk = session.chunks.find((c) => c.id === btn.dataset.feedback);
      btn.disabled = true;
      btn.textContent = 'Listening…';
      try {
        chunk.feedback = await fetchShadowingFeedback(chunk.text, chunk.attemptTranscript);
        renderSession(body);
      } catch (err) {
        showError(err);
        btn.disabled = false;
        btn.textContent = 'Get feedback';
      }
    })
  );

  body.querySelector('#p-finish')?.addEventListener('click', async () => {
    await DB.put('pronunciation', {
      id: DB.uid(),
      date: DB.todayStr(),
      sourceLessonId: session.lessonId,
      chunks: session.chunks.map((c) => ({ text: c.text, attemptTranscript: c.attemptTranscript, feedback: c.feedback })),
    });
    await DB.markStreakActive('pronunciation');
    notifyStreakChange();
    toast('Saved.');
    session = null;
    render(document.getElementById('view'));
  });
}
