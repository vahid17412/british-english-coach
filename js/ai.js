// ai.js — one interface, four providers. Nothing here ever leaves the device
// except the actual prompt/response traffic to whichever provider you pick in
// Settings. Your API key is stored only in this browser's IndexedDB.

import { DB } from './db.js';

const DEFAULTS = {
  openai: { label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { label: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' },
  gemini: { label: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
  claude: { label: 'Claude', baseURL: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5-20251001' },
};

async function getSettings() {
  const s = await DB.kvGet('aiSettings', null);
  return s || { provider: 'openai', keys: {}, models: {} };
}

async function saveSettings(settings) {
  return DB.kvSet('aiSettings', settings);
}

function modelFor(settings, provider) {
  return (settings.models && settings.models[provider]) || DEFAULTS[provider].model;
}

// --- OpenAI-compatible (OpenAI, DeepSeek both speak this dialect) ---------

async function callOpenAICompatible({ baseURL, apiKey, model, messages, json }) {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `${res.status} ${res.statusText}`);
  return data.choices?.[0]?.message?.content ?? '';
}

// --- Anthropic / Claude ----------------------------------------------------

async function callClaude({ apiKey, model, messages }) {
  const system = messages.find((m) => m.role === 'system')?.content;
  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: turns,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `${res.status} ${res.statusText}`);
  return (data.content || []).map((b) => b.text || '').join('\n');
}

// --- Google Gemini ----------------------------------------------------------

async function callGemini({ baseURL, apiKey, model, messages }) {
  const system = messages.find((m) => m.role === 'system')?.content;
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const res = await fetch(`${baseURL}/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `${res.status} ${res.statusText}`);
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('\n');
}

// --- Public API --------------------------------------------------------------

async function chat(messages, { json = false } = {}) {
  const settings = await getSettings();
  const provider = settings.provider || 'openai';
  const apiKey = settings.keys?.[provider];
  if (!apiKey) {
    throw new Error(`No API key set for ${DEFAULTS[provider].label}. Add one in Settings.`);
  }
  const model = modelFor(settings, provider);

  if (provider === 'openai' || provider === 'deepseek') {
    return callOpenAICompatible({ baseURL: DEFAULTS[provider].baseURL, apiKey, model, messages, json });
  }
  if (provider === 'claude') {
    return callClaude({ apiKey, model, messages });
  }
  if (provider === 'gemini') {
    return callGemini({ baseURL: DEFAULTS.gemini.baseURL, apiKey, model, messages });
  }
  throw new Error(`Unknown provider: ${provider}`);
}

async function testConnection(provider, apiKey, model) {
  const m = model || DEFAULTS[provider].model;
  const messages = [
    { role: 'system', content: 'Reply with exactly one word: OK' },
    { role: 'user', content: 'ping' },
  ];
  try {
    let text;
    if (provider === 'openai' || provider === 'deepseek') {
      text = await callOpenAICompatible({ baseURL: DEFAULTS[provider].baseURL, apiKey, model: m, messages });
    } else if (provider === 'claude') {
      text = await callClaude({ apiKey, model: m, messages });
    } else if (provider === 'gemini') {
      text = await callGemini({ baseURL: DEFAULTS.gemini.baseURL, apiKey, model: m, messages });
    }
    return { ok: true, message: `Connected. Model replied: "${(text || '').trim().slice(0, 40)}"` };
  } catch (err) {
    const hint =
      provider === 'gemini'
        ? ' Gemini sometimes blocks direct browser calls (CORS) depending on Google\'s current policy — if this keeps failing, try OpenAI or DeepSeek instead.'
        : '';
    return { ok: false, message: `${err.message}${hint}` };
  }
}

/** Parse a model reply that should be JSON but may be wrapped in prose or code fences. */
function parseLooseJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  try {
    return JSON.parse(match ? match[0] : cleaned);
  } catch {
    return null;
  }
}

export const AI = {
  DEFAULTS,
  getSettings,
  saveSettings,
  chat,
  testConnection,
  parseLooseJSON,
};
