// db.js — all local storage lives here. IndexedDB, no external libraries.
// Single user, single device per browser profile (matches how the rest of
// Vahid's PWAs work: data never leaves the device unless an AI call is made).

const DB_NAME = 'becDB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('items')) {
        const items = db.createObjectStore('items', { keyPath: 'id' });
        items.createIndex('state', 'state');
        items.createIndex('inboxPending', 'inboxPending');
        items.createIndex('type', 'type');
        items.createIndex('nextReviewAt', 'nextReviewAt');
      }
      if (!db.objectStoreNames.contains('lessons')) {
        const lessons = db.createObjectStore('lessons', { keyPath: 'id' });
        lessons.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('writing')) {
        const w = db.createObjectStore('writing', { keyPath: 'id' });
        w.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('speaking')) {
        const s = db.createObjectStore('speaking', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('pronunciation')) {
        const p = db.createObjectStore('pronunciation', { keyPath: 'id' });
        p.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('mistakes')) {
        db.createObjectStore('mistakes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('coach')) {
        const c = db.createObjectStore('coach', { keyPath: 'id' });
        c.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let _dbPromise = null;
function db() {
  if (!_dbPromise) _dbPromise = openDB();
  return _dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return db().then((d) => d.transaction(storeName, mode).objectStore(storeName));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// Generic helpers -----------------------------------------------------------

async function put(storeName, obj) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const r = store.put(obj);
    r.onsuccess = () => resolve(obj);
    r.onerror = () => reject(r.error);
  });
}

async function get(storeName, key) {
  const store = await tx(storeName);
  return new Promise((resolve, reject) => {
    const r = store.get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function getAll(storeName) {
  const store = await tx(storeName);
  return new Promise((resolve, reject) => {
    const r = store.getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

async function del(storeName, key) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const r = store.delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

async function kvGet(key, fallback = null) {
  const row = await get('kv', key);
  return row ? row.value : fallback;
}

async function kvSet(key, value) {
  return put('kv', { key, value });
}

// Language items --------------------------------------------------------

const ITEM_STATES = ['new', 'learning', 'weak', 'mastered', 'ignored'];
const ITEM_TYPES = ['vocabulary', 'expression', 'chunk', 'collocation', 'pattern'];

function newItem({ text, type, meaning = '', britishNote = '', origin = 'manual', sourceLessonId = null }) {
  return {
    id: uid(),
    text,
    type,
    meaning,
    britishNote,
    origin, // 'manual' | 'lesson' | 'coach'
    state: 'new',
    inboxPending: true, // hasn't appeared in an active lesson yet
    reviewStage: 0, // 0..6, drives the SRS activity progression
    createdAt: Date.now(),
    lastReviewedAt: null,
    nextReviewAt: Date.now(), // eligible immediately
    examples: [],
    sourceLessonId,
  };
}

async function addItem(fields) {
  const item = newItem(fields);
  await put('items', item);
  return item;
}

async function allItems() {
  return getAll('items');
}

async function itemsByState(state) {
  const all = await getAll('items');
  return all.filter((i) => i.state === state);
}

async function inboxItems(pending = true) {
  const all = await getAll('items');
  return all.filter((i) => !!i.inboxPending === pending && i.state !== 'ignored');
}

async function dueItems(limit = 12) {
  const all = await getAll('items');
  const now = Date.now();
  return all
    .filter((i) => !i.inboxPending && i.state !== 'ignored' && i.nextReviewAt <= now)
    .sort((a, b) => a.nextReviewAt - b.nextReviewAt)
    .slice(0, limit);
}

async function updateItem(id, patch) {
  const item = await get('items', id);
  if (!item) return null;
  Object.assign(item, patch);
  await put('items', item);
  return item;
}

// Streaks -----------------------------------------------------------------
// Missing a day pauses a streak; it never resets to zero on its own.

const STREAK_KEYS = ['learning', 'writing', 'speaking', 'pronunciation'];

async function getStreak(key) {
  return kvGet(`streak:${key}`, { current: 0, lastActiveDate: null, paused: false });
}

async function markStreakActive(key) {
  const s = await getStreak(key);
  const today = todayStr();
  if (s.lastActiveDate === today) return s; // already counted today
  if (s.lastActiveDate) {
    const last = new Date(s.lastActiveDate);
    const diffDays = Math.round((new Date(today) - last) / 86400000);
    s.current = diffDays === 1 ? s.current + 1 : 1;
  } else {
    s.current = 1;
  }
  s.lastActiveDate = today;
  s.paused = false;
  await kvSet(`streak:${key}`, s);
  return s;
}

async function streakDisplay(key) {
  const s = await getStreak(key);
  if (!s.lastActiveDate) return { label: 'Not started', current: 0 };
  const today = todayStr();
  const diffDays = Math.round((new Date(today) - new Date(s.lastActiveDate)) / 86400000);
  if (diffDays >= 2) return { label: `Paused at ${s.current}`, current: s.current, paused: true };
  return { label: `${s.current} day${s.current === 1 ? '' : 's'}`, current: s.current, paused: false };
}

// Mistake tracking (feeds Writing Lab + future lesson targeting) -----------

async function recordMistake(pattern, example) {
  const all = await getAll('mistakes');
  const existing = all.find((m) => m.pattern.toLowerCase() === pattern.toLowerCase());
  if (existing) {
    existing.count += 1;
    existing.examples.push(example);
    existing.examples = existing.examples.slice(-5);
    existing.lastSeen = Date.now();
    await put('mistakes', existing);
    return existing;
  }
  const fresh = { id: uid(), pattern, count: 1, examples: [example], lastSeen: Date.now() };
  await put('mistakes', fresh);
  return fresh;
}

async function topMistakes(limit = 5) {
  const all = await getAll('mistakes');
  return all.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen).slice(0, limit);
}

export const DB = {
  uid,
  todayStr,
  put,
  get,
  getAll,
  del,
  kvGet,
  kvSet,
  ITEM_STATES,
  ITEM_TYPES,
  addItem,
  allItems,
  itemsByState,
  inboxItems,
  dueItems,
  updateItem,
  STREAK_KEYS,
  getStreak,
  markStreakActive,
  streakDisplay,
  recordMistake,
  topMistakes,
};
