# Plan: free, research-backed language app (PWA)

Status: **approved 2026-11-20.** Stage 3 (engine + Arabic pack) built. Stage 4: Latin pack built 2026-11-21.

Decisions so far:
- Arabic: Levantine for speaking and listening, MSA for reading.
- Tamil: spoken first, literary later as a bridge.
- Mandarin: Simplified.
- Latin: Classical pronunciation.
- Hebrew: Modern first.
- Greek: reconstructed Attic.

Defaults I picked (tell me to flip any of them):
- **Levantine = urban Shami (Damascus/Beirut).** It has the most learner material. Palestinian/Jordanian is the alternative.
- **Spoken Tamil = Standard Spoken Tamil (Chennai-centred).**

Labels used below:
- ✓ = observed this session, from a web source or a command I ran.
- (mem) = from my own knowledge, not re-checked yet.

---

## 1. Architecture

| Piece | Choice | Why |
|---|---|---|
| Language | TypeScript | Your requirement. |
| UI | Preact + Vite | ~4 KB runtime with React-style components. Easy for you and Claude to edit later. |
| Scheduling | `ts-fsrs` 6.0.0, MIT ✓ | Maintained FSRS implementation. |
| Storage | IndexedDB through the tiny `idb` wrapper | Holds cards, review logs, recordings, settings. Calls `navigator.storage.persist()` on launch. |
| Content | Static JSON **language packs** in `public/packs/<lang>/` | New content needs no code change. Pack format goes in `docs/PACK_FORMAT.md`, validated by a schema test. |
| Hosting | GitHub Pages, deployed by a GitHub Actions workflow | Free. The repo must be **public** for free Pages. Your *progress* never leaves the phone; only the app and content are public. |
| Offline | A small cache-first service worker, added last | Nice-to-have, kept out of the core design. |
| Tests | Vitest | Covers the scheduler, session builder, pack loader/validator, coverage calculator, backup round-trip, and mistake-summary parser. |
| Backup | Export: a JSON file through the iOS share sheet (Save to Files / iCloud Drive). Import: file picker. | One tap each way. Recordings are included optionally because they make the file big. |

Rough module map:
- `engine/`: scheduler, session builder, coverage, metrics, backup.
- `packs/`: loader and validator.
- `ui/`: screens.
- `shared/`: grammar concept pages, cross-language links.

## 2. iOS home-screen web app limits

| Feature | Finding | Plan / free workaround |
|---|---|---|
| **IndexedDB persistence** | Safari *tabs* lose storage after 7 days without use. Home-screen apps are exempt and keep their own counter, which resets whenever you use the app ✓. `persist()` exists since iOS 15.2 and is auto-granted to home-screen apps on iOS 17+ by heuristic. One secondary source contradicts this ✓. **The Safari tab and the home-screen app have separate storage** ✓. Deleting the home-screen icon deletes the data. | Install first, then use only the home-screen icon. The app warns if it's opened in a tab. A backup reminder appears every 7 days. A Diagnostics screen shows whether `persist()` was granted. |
| **Microphone** (`getUserMedia`) | Works in home-screen apps since iOS 13.4 ✓. | Used for record-and-compare. |
| **Recording** (`MediaRecorder`) | Available since iOS 14.3 ✓. One 2026 report says it fails after an app relaunch (single source, unverified) ✓. | Use MediaRecorder, with a Web Audio → WAV fallback if it errors. |
| **Speech synthesis** | Works. Voice lists are known to be incomplete: since iOS 18 only the lower-quality voices are exposed, and in home-screen apps the list can load late ✓. Must be triggered by a tap ✓. | Detect voices per language at runtime and show the result on the Diagnostics screen. |
| **Speech recognition** (`webkitSpeechRecognition`) | **Unreliable in home-screen apps.** WebKit bug 225298 says it's unavailable there. One later bug reports it working on iOS 26.6 but hanging after audio plays ✓. | **Not used for grading.** Typed production answers can use the iOS keyboard's dictation mic, which is free and works everywhere. Pronunciation is self-assessed through record-and-compare. There is no free automatic pronunciation scoring; I'm telling you rather than faking it. |
| **Audio playback** | Works. Must start from a tap. | All playback starts from a button. |
| **Notifications** | Web Push works for home-screen apps since iOS 16.4 ✓, but it **needs a push server**. That would break the "no backend, $0" rule. | **Workaround:** one tap generates a daily-reminder `.ics` calendar event, or a guide to an iOS Shortcuts automation that opens the app at a set time. Both are free and stay on your phone. Neither makes you feel guilty. |
| **EU** | Standalone mode was removed in the EU only (iOS 17.4) ✓. | Doesn't apply in the US. |

**Testing gap:** this Mac has no Xcode, so no iOS Simulator (`simctl` missing ✓). I can test in **Playwright WebKit with iPhone emulation**. That's the same engine as iOS Safari, but it isn't iOS. The real home-screen checks (install, mic, voices, persistence) need either:
- **(a)** you install Xcode. It's free from the Mac App Store and a large download. I then test Add to Home Screen in the iOS Simulator myself.
- **(b)** you run a 5-minute checklist on your iPhone using the Diagnostics screen.

I recommend (a) plus a final (b), because the Simulator can't test the real mic or real voices.

## 3. Audio coverage (where it's weak)

Voices observed on this Mac with `say -v '?'` (macOS 26.6) ✓. iOS ships the same voice families (inferred). The app checks your phone at runtime.

| Language | Built-in voice | Coverage |
|---|---|---|
| Mandarin | Tingting + ~10 others (zh_CN) | **Good.** Multiple talkers, which enables real high-variability training for tones. |
| Hebrew | Carmit | **Good** for Modern Hebrew. One talker only. |
| Arabic | Majed (ar_001 = MSA) | **Moderate for MSA. Weak for Levantine:** Majed reads dialect text with MSA sounds. Levantine audio comes from free recordings (Lingua Libre/Commons, CC BY-SA 4.0 ✓; Tatoeba audio, CC BY/BY-SA only). That supply is sparse. |
| Tamil | Vani | **Weak to moderate.** It likely reads in a literary style. Spoken-Tamil audio is sparse. |
| Sanskrit | None (only Hindi Lekha, with wrong schwa deletion) | **Weak.** Recordings only. |
| Latin | None | **Weak.** LibriVox classical-pronunciation readings, checked one by one. |
| Ancient Greek | None (Modern Greek Melina has the wrong phonology for Attic) | **Weak.** Recordings only. |

**Free workaround for the weak languages:** a "Add a speaker" recorder. A friend who speaks the language (JHU has Arabic, Hebrew, Tamil, and Mandarin speakers) records a pack's minimal pairs and sentences into the app on your phone. That adds genuine talker variability, which TTS can't provide, and stays on-device.

## 4. Learning science → features

Evidence labels:
- **Strong:** multiple meta-analyses or a robust replicated literature.
- **Moderate:** consistent studies, but limited or with caveats.
- **Debated:** mixed findings, or the claim goes beyond the data.

Citations are from my knowledge (mem) unless marked ✓.

| # | Method → feature | Evidence | Key sources |
|---|---|---|---|
| 1 | **Spaced retrieval** (FSRS scheduling, a target retention you can set, default 0.9) | **Strong** for the retrieval + spacing effect | Roediger & Karpicke 2006; Cepeda et al. 2006 (meta-analysis); Dunlosky et al. 2013 (mem). FSRS: Ye, Su & Cao 2022. The open srs-benchmark shows it beats SM-2 at *predicting recall*. That's moderate evidence, about the algorithm, not about learning outcomes. |
| 1a | **Production cards first** (see English, say it aloud, then type it; recognition cards are only a short first step) | **Moderate.** Productive retrieval builds productive knowledge best (transfer-appropriate processing). | Morris, Bransford & Franks 1977; Webb 2009, RELC (paper exists, findings not re-checked ✓); Nation 2013 (mem) |
| 1b | **Sentence cards** (every word is introduced and reviewed inside a sentence; cloze production) | **Debated.** Context helps grammar and collocation. Isolated pairs are learned faster at first. So: both, with sentences as the default. | Prince 1996; Webb 2007 (mem) |
| 2 | **Frequency-first vocabulary** (packs ordered by corpus frequency rank) | **Strong** (corpus coverage data) | Nation & Waring 1997; Nation 2006 (mem) |
| 3 | **Comprehensible input + coverage tracking** (every text shows % known tokens; extensive reading only at ≥95–98%) | **Strong** that coverage predicts comprehension. **Moderate** for extensive reading gains. **Debated:** Krashen's claim that input *alone* is enough. | Laufer 1989; Hu & Nation 2000; Laufer & Ravenhorst-Kalovski 2010; Schmitt, Jiang & Grabe 2011 (no sharp threshold); Jeon & Day 2016 ER meta-analysis ✓; Krashen 1982 (mem) |
| 4 | **Speaking every session** (shadowing record-and-compare from day 1; speaking prompts) | **Moderate** for output practice. **Moderate/limited** for shadowing: mostly helps bottom-up listening, especially at low levels. | Swain 1985/1995; DeKeyser 2007 skill acquisition (mem); Hamada 2016 ✓; Kadota 2019 ✓ |
| 5 | **HVPT** (2-choice listening ID tasks with feedback: many talkers × many words) | **Strong** for perception. **Moderate** for transfer to production. | Logan, Lively & Pisoni 1991; Bradlow et al. 1997; Wang et al. 1999, Mandarin tones (mem); Thomson 2018 (3 features: talker variability, context variability, feedback ✓); Sakai & Moorman 2018 meta-analysis ✓; Uchihara, Karas & Thomson 2024 ✓. **Caveat:** variability is only real where several voices exist (Mandarin, plus recordings or friends elsewhere). |
| 6 | **Explicit grammar, short, then drilled in context** (≤2-screen explanation, then sentence production) | **Strong** | Norris & Ortega 2000; Spada & Tomita 2010; Goo et al. 2015 (mem) |
| 7 | **4/3/2 fluency** (same topic told 3 times under a shrinking timer, recorded; unlocks after the basics) | **Moderate.** Gains in speed; accuracy gains are less consistent. Only works with *shrinking* time. | Maurice 1983; Nation 1989 (mem); Boers 2014 ✓ |
| 8 | **Interleaving** (mixed review across item types and grammar points; new words are *not* taught in semantic sets like "colors") | **Moderate** for grammar practice (Nakata & Suzuki 2019 ✓). **Debated** for vocabulary. Semantic-set interference is **moderate**. | Rohrer & Taylor 2007; Kornell & Bjork 2008; Tinkham 1993; Erten & Tekin 2008 (mem) |
| 9 | **Honest metrics:** words known (FSRS retrievability ≥0.9 at stability ≥21 days), coverage of real reference texts, minutes spoken (recorded audio length), minutes listened, true retention on mature cards. No streaks, no XP. | A design principle, not an empirical claim | — |
| + | **Root-and-pattern** (Arabic/Hebrew), **radicals/components** (Mandarin), **cognates** (Latin/Spanish/Greek) | **Moderate.** Morphological awareness and cognate facilitation are well supported. Root-system teaching for L2 Arabic specifically has a thin literature. | Taft & Chung 1999; Shen 2004; de Groot & Keijzer 2000 (mem) |
| + | **Pinyin/IAST fading**, **active Latin/Greek** | **Debated / thin.** Included because they're sensible, not because they're proven. Labelled that way in the app. | — |

Explicitly **not** included:
- Learning styles (Pashler et al. 2008).
- Streaks and guilt.
- Gamified points.
- Speed-tap matching games.

Each of these "why" notes lives in the app next to its feature.

## 5. Session builder

You pick 5 / 15 / 30 / 60 minutes. The budget is split across active languages:
- **5 min:** due reviews (max 3 min) + 1 shadowing item. You speak every session, even at 5 minutes.
- **15+ min:** reviews ≤40% → new items (frequency order, interleaved) → input text at the right coverage → speaking (shadowing + prompt; 4/3/2 once unlocked) → a HVPT block when a contrast is weak.
- **Paused languages (maintenance mode):** only overdue reviews, capped at ~2 min a day, with a low target retention (0.8) so the load stays small.

## 6. Conversation round trip (no paid API)

1. **"Conversation session"** copies a prompt to the clipboard. It contains your level, ~200 known words, target grammar, a role-play scenario, and the rule to stay in Levantine.
2. You paste it into Claude and chat.
3. The prompt tells Claude to end with a strict block, one line per mistake:
   ```
   MISTAKES
   said | correct | note
   ```
4. You paste the block back into the app. It becomes production cards. There's a test for the parser.

## 7. Suggested language sequence (you can override)

Rule: 1 living language + at most 1 classical reading language active at a time.

1. **Now: Arabic (Levantine/MSA) + Latin.** Arabic is your priority. Latin is cheap thanks to Spanish, and it's reading-based, so it doesn't compete for speaking time.
2. **Hebrew** once Arabic reaches ~A2/B1. The root system transfers. **Greek** replaces Latin after you can read Latin's basics. Cases and participles transfer.
3. **Mandarin.** The biggest time sink (FSI Category IV, the hardest group), so it gets a dedicated slot.
4. **Tamil**, then **Sanskrit.** Sanskrit comes after Latin/Greek because of shared Indo-European grammar, and it connects to Tamil loanwords.

## 8. Content sources and licenses

All of this gets recorded in `CREDITS.md`. My own content is marked `"verified": false` until it's checked. Every item has a **Flag error** button, which stores your note locally and includes it in exports.

| Source | License | Use | Status |
|---|---|---|---|
| ts-fsrs | MIT | scheduler | ✓ npm |
| hanzi-writer | MIT | stroke-order UI | ✓ npm |
| hanzi-writer-data / Make Me a Hanzi | Arphic Public License (1999, free; keep the license file) | stroke data | ✓ |
| Tatoeba sentences | CC BY 2.0 FR (some CC0) | example sentences (MSA, Hebrew, Mandarin, Latin, some Levantine `apc`/`ajp`) | ✓ |
| Tatoeba audio | **Per contributor.** I'll use only CC BY / CC BY-SA and exclude NC and unlicensed audio. | audio | ✓ license model; checked per file at import |
| FrequencyWords (OpenSubtitles) | CC BY-SA 4.0 | frequency ranks | ✓ |
| Lingua Libre / Wikimedia Commons | CC BY-SA 4.0 | word audio, minimal pairs | ✓ |
| Perseus canonical-greekLit | CC BY-SA 4.0 | authentic Greek | ✓ (Latin repo assumed the same; to verify) |
| CC-CEDICT | CC BY-SA 4.0 (mem) | Mandarin dictionary | verify |
| Wiktionary (kaikki.org extracts) | CC BY-SA (mem) | glosses, roots, etymologies | verify |
| LibriVox | Public domain (mem) | Latin/Greek audio | verify per recording |
| D'Ooge 1909; White 1896; Perry 1886; Arden 1891; Ritchie's *Fabulae Faciles* 1903; Rouse's *A Greek Boy at Home* 1909 | Public domain in the US by date (mem) | grammar order, graded readers (the last two are direct-method readers, the PD stand-in for Ørberg, whose books are copyrighted) | verify scans |
| Ben Yehuda Project; Project Madurai; Arabic Wikipedia/Wikisource; GRETIL | PD / CC BY-SA / varies (mem) | authentic texts later | verify each |
| Noto fonts | SIL OFL 1.1 (mem) | fallback for polytonic Greek / Devanagari if the iOS system fonts fail | verify |

Notes:
- **ShareAlike consequence:** pack content will be CC BY-SA 4.0 and the code MIT. That's fine for a personal app.
- **Levantine caveat:** I found no openly licensed Levantine frequency list. Order = MSA frequency (FrequencyWords `ar`) adjusted by a core-conversation list I write myself, marked unverified.

## 9. Stage 3 scope: engine + Arabic pack v1

**Engine:**
- Onboarding with install check.
- Scheduler, session builder, card types:
  - production (say + type)
  - cloze sentence
  - listening
  - shadowing record-and-compare
  - HVPT ID
  - speaking prompt
  - 4/3/2
- Reader with tap-to-gloss and live % coverage.
- Grammar pages, linked to shared concept pages.
- Metrics screen.
- Backup export/import.
- Conversation round trip.
- Flag error button.
- Diagnostics screen.
- RTL support.
- Harakat toggle.

**Arabic pack v1 (target A1, roughly):**
- Script course: 28 letters, joining forms, harakat, shadda, tanwin.
- ~400 frequency-ordered words, each in a Levantine sentence, with MSA equivalents where they differ.
- ~25 grammar points, root-and-pattern from week 1.
- ~20 graded micro-readers. Levantine dialogues; MSA readings from week 3.
- HVPT sets: ص/س, ح/ه, ع/ء, ق/ك, ط/ت.
- 15 speaking prompts, 10 role-play scenarios.

All Levantine text I write is marked unverified. **Honest scope:** v1 is a working A1 pack. B1+ needs later content passes.

**Done check for each stage:**
1. Vitest green.
2. Playwright WebKit iPhone-viewport run of the full session flow.
3. Screenshots of Arabic/Hebrew RTL and all six scripts, including polytonic Greek.
4. Home-screen install verified in the Simulator (if you install Xcode) and on your phone via Diagnostics.
5. `$0` audit: no paid service, no API key, no paid font.
