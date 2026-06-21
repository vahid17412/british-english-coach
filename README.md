# British English Coach

A private, single-user British English coach: daily contextual lessons, a
spaced-repetition memory for vocabulary/expressions/chunks/collocations/
patterns, an always-on AI Coach, and independent Writing, Speaking, and
Pronunciation labs.

No build step. No backend. Everything lives in this browser's IndexedDB.
The only network calls this app makes are straight from your phone's
browser to whichever AI provider you configure in Settings.

## Put it on GitHub Pages

1. Create a new repository on GitHub (public or private — Pages works on
   both, private repos need GitHub Pro/Team/Enterprise for Pages).
2. Upload everything in this folder to the repo (keep the folder structure
   exactly as it is — `index.html` at the root).
3. In the repo: **Settings → Pages → Build and deployment → Source** = "Deploy
   from a branch", branch = `main`, folder = `/ (root)`. Save.
4. Wait a minute, then open the URL GitHub shows you
   (`https://yourusername.github.io/your-repo-name/`).
5. On your Android phone, open that URL in Chrome, then use Chrome's menu →
   **Add to Home screen** to install it like an app. Each phone/browser
   profile keeps its own separate data — nothing syncs between devices.

## Set up an AI provider

Open the gear icon → Settings. Pick one provider, paste in your own API key,
and tap **Test connection** before relying on it. Calls go directly from
your browser to the provider, so your key is stored only in this browser's
IndexedDB — never sent anywhere else, but also visible to anyone with access
to this browser's dev tools. That's an acceptable trade for a personal,
single-user tool; it would not be for a shared or public deployment.

A few things worth knowing about each provider, since this is a static site
with no server in the middle:

- **OpenAI** and **DeepSeek** reliably accept direct calls from a browser.
  DeepSeek's pricing is low enough that casual daily use costs a small
  fraction of a cent per lesson.
- **Google Gemini** has the most generous genuine free tier (no card
  required), but community reports on whether Google allows direct
  browser calls to its API have been inconsistent. Test it — it may just
  work for you.
- **Claude** supports direct browser calls via a dedicated header, which
  this app already sends. If it ever stops working, Anthropic's docs
  (docs.claude.com) will have the current guidance.

If a provider ever changes its model names, edit the "Model" field on its
card in Settings — no code changes needed.

## What's genuinely free vs. what's "free-ish"

- **Daily lesson, Inbox, Coach, Writing, Pronunciation IPA/feedback**: each
  needs one or two short AI calls. With Gemini's free tier or DeepSeek's
  pricing, a normal 30-minute session costs nothing or close to it.
- **Pronunciation playback (TTS)**: uses your phone's built-in
  text-to-speech, not an AI provider — completely free, fully offline.
  Pick a UK English voice in Settings if your phone has more than one
  installed (Android usually ships at least one via Google's TTS engine;
  if none sound British, check your phone's Settings → Languages → Text-
  to-speech → install a UK English voice).
- **Speaking and Speaking-shadowing transcription**: uses your browser's
  built-in speech recognition (Web Speech API on Chrome), not an AI
  provider — also free. The AI only ever sees the resulting text.

## Honest limitations

- **Pronunciation feedback is text-based, not acoustic.** Nothing running
  in a static browser page can analyse real stress, rhythm, or intonation
  from audio. This app's pronunciation feedback works from a speech-to-text
  transcript of your attempt compared with the target phrase, and reasons
  about likely problems from that. It's a genuinely useful nudge, not a
  substitute for a human ear or a dedicated pronunciation-scoring service.
- **IPA and IPA-on-demand are AI-generated**, not from a verified
  dictionary, so treat them as a strong guide rather than gospel.
- **Six SRS "activities" are real, but mostly expressed through how the
  daily lesson's AI prompt treats an item** (recognition vs. fill-in vs.
  multiple-choice vs. sentence creation vs. speaking vs. fresh-text
  reappearance) rather than six separate quiz screens. This keeps the app
  to one coherent flow instead of six different mini-games, at the cost of
  the activity type being a prompt-level instruction rather than something
  you'll always consciously notice.

## Project layout

```
index.html              entry point
manifest.webmanifest     PWA metadata
service-worker.js        offline app-shell caching
css/styles.css           the whole design system
js/db.js                 IndexedDB — items, lessons, history, streaks
js/ai.js                 OpenAI / Claude / Gemini / DeepSeek, one interface
js/srs.js                spaced repetition scheduling
js/util.js               shared UI helpers
js/app.js                router + shell
js/views/*.js            one file per screen (Today, Inbox, Labs, Coach, Progress, Settings)
```

Everything is plain HTML/CSS/JS with ES modules — no framework, no bundler,
no `node_modules`. Open `index.html` through any static file server (or
GitHub Pages) and it runs.
