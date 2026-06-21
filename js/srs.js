// srs.js — the spaced repetition engine. Per the brief: never flashcards.
// Each item climbs through six different activity types, and review spacing
// widens as it climbs. Missing a review never resets stage to zero; it just
// sits there waiting, exactly like the streak system.

import { DB } from './db.js';

export const ACTIVITIES = [
  { stage: 0, key: 'recognition', label: 'Recognition', hint: 'Show the item and ask what it means.' },
  { stage: 1, key: 'fill_blank', label: 'Fill in the blank', hint: 'A sentence with the item missing.' },
  { stage: 2, key: 'multiple_choice', label: 'Multiple-choice context', hint: 'Pick the right item for the context.' },
  { stage: 3, key: 'sentence_creation', label: 'Sentence creation', hint: 'User writes a sentence using it.' },
  { stage: 4, key: 'speaking_usage', label: 'Speaking usage', hint: 'User says a sentence using it aloud.' },
  { stage: 5, key: 'new_text', label: 'Appearance in new text', hint: 'It resurfaces inside a fresh generated text.' },
];

// Days until next review, indexed by stage reached (0-based, after success).
const INTERVAL_DAYS = [1, 2, 4, 8, 16, 30];

export function activityForStage(stage) {
  return ACTIVITIES[Math.min(stage, ACTIVITIES.length - 1)];
}

/** Call after the user succeeds at the activity for an item's current stage. */
export async function advanceItem(itemId) {
  const item = await DB.get('items', itemId);
  if (!item) return null;
  const nextStage = Math.min(item.reviewStage + 1, ACTIVITIES.length);
  const days = INTERVAL_DAYS[Math.min(item.reviewStage, INTERVAL_DAYS.length - 1)];
  const patch = {
    reviewStage: nextStage,
    lastReviewedAt: Date.now(),
    nextReviewAt: Date.now() + days * 86400000,
    state: nextStage >= ACTIVITIES.length ? 'mastered' : 'learning',
  };
  return DB.updateItem(itemId, patch);
}

/** Call when the user struggles with the activity — item becomes 'weak' and resurfaces sooner. */
export async function markWeak(itemId) {
  const item = await DB.get('items', itemId);
  if (!item) return null;
  return DB.updateItem(itemId, {
    state: 'weak',
    lastReviewedAt: Date.now(),
    nextReviewAt: Date.now() + 1 * 86400000, // tomorrow, regardless of stage
  });
}

/** Mastered items still surface, just rarely — used by the daily lesson generator. */
export async function pickItemsForLesson({ newCount = 2, reviewCount = 3 } = {}) {
  const inbox = (await DB.inboxItems(true)).slice(0, newCount);
  const due = (await DB.dueItems(8));
  const weak = due.filter((i) => i.state === 'weak');
  const learning = due.filter((i) => i.state === 'learning');
  const mastered = (await DB.itemsByState('mastered'))
    .filter((i) => Math.random() < 0.15) // mastered items appear less often, never vanish
    .slice(0, 1);

  const review = [...weak, ...learning, ...mastered].slice(0, reviewCount);
  return { newItems: inbox, reviewItems: review };
}
