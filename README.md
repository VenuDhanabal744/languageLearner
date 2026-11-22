# Polyglot: a free, research-backed language app for iPhone

A home-screen web app (PWA) for learning Arabic (Levantine + MSA), Hebrew (Modern → Biblical) and Latin (Classical) now,
with Mandarin, Tamil, Ancient Greek and Sanskrit to come. It costs $0 forever: no server, no accounts, no paid APIs. Your progress stays on your phone.

**Live app:** https://venudhanabal744.github.io/languageLearner/

What it does differently from tap-the-word apps:
- **Production first.** You see English and *say* (and optionally type) the Arabic, inside a sentence.
- **Speaking every session.** Even a 5-minute session includes shadowing with record-and-compare.
- **Input you can read.** Each text shows the share of words you already know; extensive reading is picked at ≥90–95%.
- **Sound training (HVPT)** for Arabic ص/س, ح/ه, ع/ء, ق/ك, ط/ت and Hebrew kh/h, r/kh, k/kh.
- **Arabic ↔ Hebrew root links** (k-t-b / k-t-v, s-l-m / sh-l-m…) and Latin ↔ Greek ↔ Sanskrit ↔ Spanish cognates.
- **FSRS spaced repetition**, frequency-ordered vocabulary, short explicit grammar followed by sentence drills, and 4/3/2 fluency once you know ~80 words.
- **Honest metrics:** words known, real-text coverage, minutes spoken and listened, true retention. No streaks or XP.
- **Conversation session:** copies a prompt for your own Claude chat; you paste the mistakes back and they become cards.

The research behind each feature, with evidence levels, is in the app under *Library → Why it works* (source:
`public/packs/shared/research.json`) and in [PLAN.md](PLAN.md).

## Turn languages on and off
Settings → Languages: set each language to *active*, *maintenance* (reviews only, ≤2 min/day) or *queued*. The app
recommends one living language plus at most one classical language active at a time.

## Install on your iPhone
1. Open the live app link in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. From now on, **open it from the home-screen icon only.** The home-screen app has its own storage, separate from
   the Safari tab. iOS can erase data in an ordinary Safari tab after 7 days without use; it doesn't do that to the
   home-screen app.
4. Optional: Settings → General → Keyboard → Keyboards → Add New Keyboard → **Arabic**, to type answers. The keyboard's
   dictation mic also works for speaking answers.
5. In the app: **Settings → Diagnostics** shows whether the mic works, which voices your phone has, whether storage is
   persistent, and how every script renders.

## Use it on iPhone, iPad and Mac (sync)
Install it the same way on each device (iPad: Safari → Share → Add to Home Screen; Mac: Safari → File → Add to Dock, or
just a browser tab). Then link the devices once through a **private GitHub repo you own**. It's free, and there's no server of ours in between:
1. Create a **private** repo named `polyglot-data` at <https://github.com/new>.
2. Create a fine-grained token at <https://github.com/settings/personal-access-tokens/new>: *Only select repositories →
   polyglot-data*, permission **Contents: Read and write**, long expiry.
3. In the app on each device: **Settings → Sync across devices**, paste the token, **Connect and sync**.

The app syncs when it opens, when you leave it, after each session, and on **Sync now**. Both sides are merged, never
overwritten: each card keeps its most recent review, review history and minutes are combined, the lessons you've done on any
device count as done, and the most recently changed settings win. The token stays on the device: it's never synced
and never in backup files. Voice recordings stay on the device that made them. The repo holds one compressed file,
`polyglot-sync.json.gz`. Every sync is a commit, so the repo's history is also a backup trail.

## Handwriting (iPad + Apple Pencil)
On iPad, handwriting is on by default (Settings → Study turns it on or off per device; a finger works too).
- **Letters are checked automatically.** In every script lesson, tap **✍︎ Practise writing**: trace the letter, then write
  it without the guide and tap **Check**. Every other letter review asks you to *write* the letter instead of reading it.
  The checker runs on the iPad, offline once its template fonts are cached. It compares your ink with every letter of
  the script, so it can say "that looks more like ب". After the first time you've used the Pencil, the pad ignores your palm.
- **Words and sentences are checked letter by letter** (Hebrew now; Greek and Tamil as their packs arrive). On word,
  drill and mistake cards a wide pad opens: write the answer on one line, without vowel points, then tap Show answer.
  The app splits your writing into letters, lines them up with the expected answer (it notices a missing letter,
  extra marks, a letter written in two pieces, or two letters touching), and checks each one: green = right,
  orange = readable but close to another letter (ו/ז, ד/ר), red = a different letter or missing. Every word page also has
  **✍︎ Write this from memory**.
- **Arabic and Latin** are joined-up or Latin-alphabet, so they use iPad's own handwriting recognition (Scribble): write
  straight into the answer box with the Pencil and the app checks the text. For Arabic, add the Arabic keyboard first.
- **It learns your handwriting.** Clean letters you write from memory are saved as templates, and when it misreads a
  letter you wrote correctly, tap **I wrote these letters right**. Up to 6 samples per letter, synced across devices.
- **How accurate is it?** It's tested on fonts, not yet on your handwriting. For single letters it picks the right one about
  81% of the time for Hebrew, and about 90% for Arabic in plain fonts. For 120 Hebrew words in 5 fonts it accepts 63% of correctly
  written words and catches 84% of one-letter mistakes. After learning one sample of each letter, that rises to 82% and 85%.
  Expect your first sessions to need a few "I wrote these right" taps. Sentences must fit on one line for now.

## Back up and restore
- **Back up:** Settings → **Export backup** opens the share sheet. Choose *Save to Files* (iCloud Drive is a good spot).
  The file contains all cards, review history, settings and flags, plus any speaker recordings for sound training.
  Shadowing attempts are included only if you tick the box. The app reminds you gently if it's been more than a week.
- **Restore:** Settings → **Import backup** and pick the file. This *replaces* everything on the device.
- Deleting the home-screen icon deletes the app's data, so export first.

## Deploy your own copy free (GitHub Pages)
1. Push this repo to GitHub (it must be **public** for free Pages).
2. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` runs the tests, builds, and publishes to `https://<user>.github.io/<repo>/` via
   `.github/workflows/deploy.yml`. Paths are relative, so any repo name works.

## Develop
```bash
npm install
npm run dev        # local dev server
npm test           # unit tests: scheduler, session builder, pack loader/validator, coverage, backup, conversation parser
npm run build
npx playwright install webkit && npm run e2e   # WebKit, iPhone 13 viewport, served under /languageLearner/; screenshots in e2e/shots/
```

## Add or fix content
All content lives in **language packs**: JSON files in `public/packs/<lang>/`. No code changes are needed.
See **[docs/PACK_FORMAT.md](docs/PACK_FORMAT.md)** for the format and a ready-to-paste prompt for doing it with Claude.
`npm test` validates every pack: dangling references, duplicate ids, missing examples, and texts you couldn't read
with the pack's own vocabulary.

Flags you leave in the app (*⚑ Flag error*) are listed in Settings → Flagged content; copy them into a chat together
with the pack file to get fixes.

## Known limits (iOS home-screen web apps)
| Feature | Status |
|---|---|
| Storage | Persistent in the home-screen app (iOS 17+ grants persistence automatically). Back up anyway. |
| Microphone + recording | Works (MediaRecorder, with a WAV fallback). iOS may ask for mic permission again after relaunching. |
| Text-to-speech | Uses your phone's voices. Arabic (Majed) speaks **MSA**, so Levantine lines are approximate. Latin borrows the Italian voice with respelling. Sanskrit and Ancient Greek have no suitable voice. |
| Speech recognition | Not used: unreliable in home-screen apps. Use keyboard dictation instead. There is no automatic pronunciation scoring. |
| Notifications | Web Push needs a server, so the reminder is a one-tap repeating **calendar event** (or an iOS Shortcuts automation). |
| Offline | A small service worker caches what you've opened; best-effort. |

## Audio coverage
| Language | Built-in voice | Coverage |
|---|---|---|
| Arabic | Majed (MSA) | moderate for MSA, **weak for Levantine** |
| Hebrew | Carmit | good |
| Mandarin | ~10 voices | good, with real multi-talker tone training |
| Tamil | Vani | weak to moderate |
| Latin | none; uses the Italian voice with Latin respelled toward Classical sounds | **weak**: rough guide only (vowel length and some stress are wrong) |
| Sanskrit, Ancient Greek | none | **weak**: recordings only |

Fix weak audio for free with **Library → Sounds → Add a speaker**: a native-speaker friend records the word lists once
on your phone.

## License
Code MIT; pack content CC BY-SA 4.0. Third-party sources are listed in [CREDITS.md](CREDITS.md).
