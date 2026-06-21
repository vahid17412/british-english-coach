// views/progress.js — minimalist dashboard. Streaks pause, they don't reset;
// nothing here is scored or gamified.

import { DB } from '../db.js';
import { escapeHtml } from '../util.js';

export async function render(container) {
  const [learning, writing, speaking, pronunciation] = await Promise.all(
    DB.STREAK_KEYS.map((k) => DB.streakDisplay(k))
  );
  const items = await DB.allItems();
  const active = items.filter((i) => i.state === 'learning' || i.state === 'new').length;
  const weak = items.filter((i) => i.state === 'weak').length;
  const mastered = items.filter((i) => i.state === 'mastered').length;

  const lessons = await DB.getAll('lessons');
  const completedLessons = lessons.filter((l) => l.completed).length;
  const writingSessions = (await DB.getAll('writing')).length;
  const speakingSessions = (await DB.getAll('speaking')).length;
  const pronunciationSessions = (await DB.getAll('pronunciation')).length;
  const mistakes = await DB.topMistakes(5);

  container.innerHTML = `
    <h2>Progress</h2>

    <h3>Streaks</h3>
    <div class="stat-grid" style="margin-bottom:18px;">
      <div class="stat"><span class="num text">${learning.label}</span><span class="label">Learning</span></div>
      <div class="stat"><span class="num text">${writing.label}</span><span class="label">Writing</span></div>
      <div class="stat"><span class="num text">${speaking.label}</span><span class="label">Speaking</span></div>
      <div class="stat"><span class="num text">${pronunciation.label}</span><span class="label">Pronunciation</span></div>
    </div>

    <h3>Language items</h3>
    <div class="stat-grid" style="margin-bottom:18px;">
      <div class="stat"><span class="num">${active}</span><span class="label">Active items</span></div>
      <div class="stat"><span class="num">${weak}</span><span class="label">Weak items</span></div>
      <div class="stat"><span class="num">${mastered}</span><span class="label">Mastered items</span></div>
      <div class="stat"><span class="num">${items.length}</span><span class="label">Total in memory</span></div>
    </div>

    <h3>Sessions</h3>
    <div class="stat-grid" style="margin-bottom:18px;">
      <div class="stat"><span class="num">${completedLessons}</span><span class="label">Lessons completed</span></div>
      <div class="stat"><span class="num">${writingSessions}</span><span class="label">Writing sessions</span></div>
      <div class="stat"><span class="num">${speakingSessions}</span><span class="label">Speaking sessions</span></div>
      <div class="stat"><span class="num">${pronunciationSessions}</span><span class="label">Pronunciation sessions</span></div>
    </div>

    ${
      mistakes.length
        ? `<h3>Recurring mistakes</h3><div class="card tight">${mistakes
            .map((m) => `<div class="item-row"><div><div class="text">${escapeHtml(m.pattern)}</div><div class="meta">Seen ${m.count} time${m.count === 1 ? '' : 's'}</div></div></div>`)
            .join('')}</div><p class="muted" style="margin-top:8px;">The daily lesson occasionally writes around these.</p>`
        : ''
    }
  `;
}
