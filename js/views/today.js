// views/today.js — Daily Learning Module.
// One lesson per day, resumable if you leave mid-flow, never regenerated
// once you've started (so refreshing the page doesn't cost you new items).

import { DB } from '../db.js';
import { AI } from '../ai.js';
import { activityForStage, pickItemsForLesson, advanceItem, markWeak } from '../srs.js';
import { escapeHtml, toast, showError, notifyStreakChange } from '../util.js';

const STEP_LABELS = ['Read', 'Infer', 'Understand', 'Produce', 'Correct', 'Done'];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightItems(text, items) {
  let html = escapeHtml(text);
  for (const item of items) {
    const safe = escapeHtml(item.text);
    if (!safe.trim()) continue;
    const re = new RegExp(escapeRegex(safe), 'gi');
    html = html.replace(re, (m) => `<mark data-id="${item.id}">${m}</mark>`);
  }
  return html.replace(/\n/g, '<br>');
}

async function buildSystemContext() {
  const mistakes = await DB.topMistakes(3);
  const mistakeNote = mistakes.length
    ? `Recurring mistakes this learner makes (weave a gentle, natural opportunity to address one if it fits, don't force it): ${mistakes
        .map((m) => m.pattern)
        .join('; ')}.`
    : '';
  return `You are a British English coach. British English is the standard throughout: British spelling, vocabulary, and examples. Be educational, warm, and precise. ${mistakeNote}`;
}

async function generateLessonText() {
  const { newItems, reviewItems } = await pickItemsForLesson({ newCount: 2, reviewCount: 3 });
  const system = await buildSystemContext();

  const describeItem = (i, isNew) => {
    const activity = activityForStage(i.reviewStage || 0);
    return `${isNew ? 'NEW' : 'REVIEW'} — "${i.text}" (${i.type}${isNew ? '' : `, due for: ${activity.label}`})`;
  };

  const prompt = `Write one short contextual text for a daily English lesson.

Requirements:
- 3 to 5 lines, natural conversational British English, realistic and useful in everyday situations.
- Not academic, not IELTS-style, not rare vocabulary. Everyday topics: routines, small talk, work, weather, food, plans, family, etc.
- Naturally include these language items already known to the learner's memory:
${[...newItems.map((i) => describeItem(i, true)), ...reviewItems.map((i) => describeItem(i, false))].join('\n') || '(none yet — invent 1-2 fresh ones yourself)'}
- If fewer than 2 NEW items were given above, invent 1-2 brand new natural British vocabulary items, expressions, chunks, or collocations yourself and include them too, marked as new.
- Total target items in the text: roughly 1-2 new + 2-3 expressions/chunks/collocations, occasionally a sentence pattern.

Respond with ONLY valid JSON in this exact shape, no prose, no markdown fences:
{
  "text": "the lesson text",
  "items": [
    {"text": "exact phrase as it appears in the text", "type": "vocabulary|expression|chunk|collocation|pattern", "isNew": true}
  ]
}`;

  const reply = await AI.chat([
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ], { json: true });

  const parsed = AI.parseLooseJSON(reply);
  if (!parsed || !parsed.text || !Array.isArray(parsed.items)) {
    throw new Error('The AI reply could not be read as a lesson. Try again in a moment.');
  }

  const allItems = await DB.allItems();
  const resolved = [];
  for (const raw of parsed.items) {
    const existing = allItems.find((i) => i.text.toLowerCase() === raw.text.toLowerCase());
    if (existing) {
      await DB.updateItem(existing.id, { inboxPending: false });
      resolved.push(existing);
    } else {
      const created = await DB.addItem({
        text: raw.text,
        type: raw.type || 'vocabulary',
        origin: 'lesson',
      });
      await DB.updateItem(created.id, { inboxPending: false, state: 'learning' });
      resolved.push(created);
    }
  }

  return { text: parsed.text, items: resolved };
}

async function getOrCreateTodayLesson() {
  const date = DB.todayStr();
  const all = await DB.getAll('lessons');
  let lesson = all.find((l) => l.date === date);
  if (lesson) return lesson;

  const { text, items } = await generateLessonText();
  lesson = {
    id: DB.uid(),
    date,
    text,
    itemIds: items.map((i) => i.id),
    step: 1,
    userInferences: '',
    evaluation: null,
    explanations: null,
    userSentences: {},
    corrections: null,
    decisions: {},
    completed: false,
  };
  await DB.put('lessons', lesson);
  return lesson;
}

function stepIndicatorHtml(stepIndex) {
  return `<div class="step-indicator">${STEP_LABELS.map((_, i) => {
    const cls = i < stepIndex ? 'done' : i === stepIndex ? 'current' : '';
    return `<span class="${cls}"></span>`;
  }).join('')}</div>`;
}

export async function render(container) {
  let lesson;
  container.innerHTML = '<div class="empty">Preparing today\u2019s lesson\u2026</div>';
  try {
    lesson = await getOrCreateTodayLesson();
  } catch (err) {
    container.innerHTML = `<div class="empty"><span class="glyph">⚠</span>${escapeHtml(err.message)}<br><br><button class="primary" id="retryBtn">Try again</button></div>`;
    document.getElementById('retryBtn')?.addEventListener('click', () => render(container));
    return;
  }

  const items = await Promise.all(lesson.itemIds.map((id) => DB.get('items', id)));
  const validItems = items.filter(Boolean);

  if (lesson.completed) {
    renderDone(container, lesson, validItems);
    return;
  }

  switch (lesson.step) {
    case 1: return renderStep1(container, lesson, validItems);
    case 2: return renderStep2(container, lesson, validItems);
    case 3: return renderStep3(container, lesson, validItems);
    case 4: return renderStep4(container, lesson, validItems);
    default: return renderStep1(container, lesson, validItems);
  }
}

// Step 1 — read --------------------------------------------------------------

function renderStep1(container, lesson, items) {
  container.innerHTML = `
    ${stepIndicatorHtml(0)}
    <h2>Today's text</h2>
    <p class="muted">Read it through. The highlighted phrases are today's items — try to guess what they mean before moving on.</p>
    <div class="card">
      <div class="marginalia has-notes">
        <div class="lesson-text">${highlightItems(lesson.text, items)}</div>
      </div>
    </div>
    <div class="row wrap" style="margin-top:10px;">
      ${items.map((i) => `<span class="chip type">${i.type}</span>`).join('')}
    </div>
    <button class="primary" id="nextBtn" style="width:100%; margin-top:10px;">I've read it — guess the meanings</button>
  `;
  document.getElementById('nextBtn').addEventListener('click', async () => {
    lesson.step = 2;
    await DB.put('lessons', lesson);
    render(container);
  });
}

// Step 2 — infer --------------------------------------------------------------

function renderStep2(container, lesson, items) {
  container.innerHTML = `
    ${stepIndicatorHtml(1)}
    <h2>What do you think they mean?</h2>
    <div class="card tight">
      <div class="marginalia"><div class="lesson-text" style="font-size:1rem;">${highlightItems(lesson.text, items)}</div></div>
    </div>
    <label>Write your best guess for each highlighted item — rough is fine.</label>
    <textarea id="inferBox" placeholder="e.g. 'pop round' = to visit casually...">${escapeHtml(lesson.userInferences || '')}</textarea>
    <button class="primary" id="checkBtn" style="width:100%; margin-top:14px;">Check my understanding</button>
  `;
  document.getElementById('checkBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const text = document.getElementById('inferBox').value.trim();
    btn.disabled = true;
    btn.textContent = 'Thinking…';
    try {
      const system = await buildSystemContext();
      const prompt = `Lesson text:\n${lesson.text}\n\nTarget items: ${items.map((i) => i.text).join(', ')}\n\nThe learner's guesses about what these mean:\n${text || '(left blank)'}\n\nFor each item: judge the guess as "correct", "partial", or "incorrect" with a one-line reason, then give an educational explanation covering meaning, typical usage/context, and any British nuance (mention a British vs American contrast only if genuinely relevant). Also write a 1-2 sentence overall evaluation.\n\nRespond with ONLY valid JSON:\n{"evaluation": "...", "items": [{"itemText": "...", "verdict": "correct|partial|incorrect", "reason": "...", "explanation": "...", "britishNote": "..."}]}`;
      const reply = await AI.chat([{ role: 'system', content: system }, { role: 'user', content: prompt }], { json: true });
      const parsed = AI.parseLooseJSON(reply);
      if (!parsed) throw new Error('Could not read the AI\u2019s evaluation. Try again.');
      lesson.userInferences = text;
      lesson.evaluation = parsed.evaluation;
      lesson.explanations = parsed.items;
      lesson.step = 3;
      await DB.put('lessons', lesson);
      render(container);
    } catch (err) {
      showError(err);
      btn.disabled = false;
      btn.textContent = 'Check my understanding';
    }
  });
}

// Step 3 — understand (AI evaluation + explanation) ---------------------------

function verdictChip(v) {
  const map = { correct: 'mastered', partial: 'learning', incorrect: 'weak' };
  return `<span class="chip state-${map[v] || 'new'}">${v || 'noted'}</span>`;
}

function renderStep3(container, lesson, items) {
  const explanations = lesson.explanations || [];
  container.innerHTML = `
    ${stepIndicatorHtml(2)}
    <h2>How you did</h2>
    <div class="card"><p>${escapeHtml(lesson.evaluation || '')}</p></div>
    ${explanations
      .map(
        (ex) => `
      <div class="card tight">
        <div class="row between"><h3 style="margin:0;">${escapeHtml(ex.itemText)}</h3>${verdictChip(ex.verdict)}</div>
        <p style="margin-top:8px;">${escapeHtml(ex.explanation || '')}</p>
        ${ex.britishNote ? `<p class="muted"><strong>British note:</strong> ${escapeHtml(ex.britishNote)}</p>` : ''}
      </div>`
      )
      .join('')}
    <button class="primary" id="nextBtn" style="width:100%; margin-top:6px;">Now use them in your own sentences</button>
  `;
  document.getElementById('nextBtn').addEventListener('click', async () => {
    lesson.step = 4;
    await DB.put('lessons', lesson);
    render(container);
  });
}

// Step 4 — produce + correct (combined screen, two AI-feedback states) -------

function renderStep4(container, lesson, items) {
  if (lesson.corrections) {
    return renderCorrections(container, lesson, items);
  }
  container.innerHTML = `
    ${stepIndicatorHtml(3)}
    <h2>Make it yours</h2>
    <p class="muted">Write one original sentence using each item below.</p>
    ${items
      .map(
        (i) => `
      <div class="card tight">
        <label style="margin-top:0;">Using <strong>${escapeHtml(i.text)}</strong></label>
        <textarea data-item="${i.id}" placeholder="Your sentence…">${escapeHtml(lesson.userSentences?.[i.id] || '')}</textarea>
      </div>`
      )
      .join('')}
    <button class="primary" id="correctBtn" style="width:100%;">Get feedback</button>
  `;
  document.getElementById('correctBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const sentences = {};
    container.querySelectorAll('textarea[data-item]').forEach((ta) => {
      sentences[ta.dataset.item] = ta.value.trim();
    });
    btn.disabled = true;
    btn.textContent = 'Correcting…';
    try {
      const system = await buildSystemContext();
      const list = items
        .map((i) => `- "${i.text}" → learner wrote: ${sentences[i.id] || '(left blank)'}`)
        .join('\n');
      const prompt = `Correct these learner sentences, each using a target item:\n${list}\n\nFor each: fix grammar, give a more natural British alternative phrasing, and explain the mistake briefly and kindly. If there's a recurring grammar pattern behind the mistake (e.g. "article omission", "present perfect vs past simple"), name it shortly in mistakePattern, else leave it empty.\n\nRespond with ONLY valid JSON:\n{"corrections": [{"itemText": "...", "original": "...", "corrected": "...", "naturalAlternative": "...", "explanation": "...", "mistakePattern": "..."}]}`;
      const reply = await AI.chat([{ role: 'system', content: system }, { role: 'user', content: prompt }], { json: true });
      const parsed = AI.parseLooseJSON(reply);
      if (!parsed) throw new Error('Could not read the AI\u2019s corrections. Try again.');
      lesson.userSentences = sentences;
      lesson.corrections = parsed.corrections;
      for (const c of parsed.corrections) {
        if (c.mistakePattern) await DB.recordMistake(c.mistakePattern, c.original || '');
      }
      await DB.put('lessons', lesson);
      render(container);
    } catch (err) {
      showError(err);
      btn.disabled = false;
      btn.textContent = 'Get feedback';
    }
  });
}

function renderCorrections(container, lesson, items) {
  const decisions = lesson.decisions || {};
  container.innerHTML = `
    ${stepIndicatorHtml(4)}
    <h2>Feedback on your sentences</h2>
    ${lesson.corrections
      .map((c) => {
        const item = items.find((i) => i.text.toLowerCase() === (c.itemText || '').toLowerCase());
        const id = item?.id;
        const decision = id ? decisions[id] : null;
        return `
      <div class="card tight">
        <h3 style="margin:0 0 8px;">${escapeHtml(c.itemText)}</h3>
        <p class="muted" style="margin-bottom:4px;">You wrote:</p>
        <p>${escapeHtml(c.original || '')}</p>
        <p class="muted" style="margin-bottom:4px;">Corrected:</p>
        <p style="color:var(--sage);">${escapeHtml(c.corrected || '')}</p>
        ${c.naturalAlternative ? `<p class="muted" style="margin-bottom:4px;">More natural British way:</p><p style="color:var(--brass);">${escapeHtml(c.naturalAlternative)}</p>` : ''}
        <p class="muted">${escapeHtml(c.explanation || '')}</p>
        ${id ? `
        <div class="row" style="margin-top:10px;">
          <button class="small ${decision === 'got_it' ? 'primary' : 'ghost'}" data-decision="got_it" data-item="${id}">Got it</button>
          <button class="small ${decision === 'shaky' ? 'danger' : 'ghost'}" data-decision="shaky" data-item="${id}">Still shaky</button>
        </div>` : ''}
      </div>`;
      })
      .join('')}
    <button class="primary" id="finishBtn" style="width:100%; margin-top:6px;">Finish today's lesson</button>
  `;

  container.querySelectorAll('[data-decision]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      lesson.decisions = lesson.decisions || {};
      lesson.decisions[btn.dataset.item] = btn.dataset.decision;
      await DB.put('lessons', lesson);
      renderCorrections(container, lesson, items);
    });
  });

  document.getElementById('finishBtn').addEventListener('click', async () => {
    for (const item of items) {
      const decision = lesson.decisions?.[item.id] || 'got_it';
      if (decision === 'shaky') await markWeak(item.id);
      else await advanceItem(item.id);
    }
    lesson.completed = true;
    await DB.put('lessons', lesson);
    await DB.markStreakActive('learning');
    notifyStreakChange();
    toast('Lesson complete. See you tomorrow.');
    render(container);
  });
}

// Done -------------------------------------------------------------------------

function renderDone(container, lesson, items) {
  container.innerHTML = `
    ${stepIndicatorHtml(5)}
    <h2>Today's lesson is done ✓</h2>
    <div class="card">
      <div class="marginalia has-notes"><div class="lesson-text" style="font-size:1rem;">${highlightItems(lesson.text, items)}</div></div>
    </div>
    <div class="row wrap">${items.map((i) => `<span class="chip state-${i.state}">${escapeHtml(i.text)}</span>`).join('')}</div>
    <p class="muted" style="margin-top:14px;">Come back tomorrow for a new one — or head to the Labs to practise writing, speaking, or pronunciation in the meantime.</p>
    <button class="ghost" id="coachBtn" style="width:100%;">Ask the Coach about today's lesson</button>
  `;
  document.getElementById('coachBtn').addEventListener('click', () => {
    sessionStorage.setItem('coachPrefill', `About today's lesson: "${lesson.text}" — `);
    location.hash = '#/coach';
  });
}
