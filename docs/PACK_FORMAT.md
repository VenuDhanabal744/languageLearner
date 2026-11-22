# Language pack format

A pack is a folder `public/packs/<id>/` with a `pack.json` and any number of include files. It is registered in
`public/packs/index.json`. The app validates packs on load and `npm test` validates them in CI, so mistakes show up as
readable errors. The TypeScript source of truth is `src/packs/types.ts`.

## Register a pack
`public/packs/index.json`:
```json
{ "id": "he", "name": "Hebrew (Modern → Biblical)", "native": "עברית", "kind": "living", "status": "available", "path": "packs/he" }
```
`status: "planned"` shows the language in the Languages screen without loading anything.

## pack.json (header + anything else)
```jsonc
{
  "id": "he", "name": "Hebrew", "version": "0.1.0",
  "dir": "rtl",                       // "rtl" or "ltr"
  "tts": "he",                        // BCP-47 prefix for picking an iPhone voice
  "ttsNote": "Built-in voice: Carmit (Modern Hebrew).",
  "defaultVariety": "modern", "varieties": { "modern": "Modern Hebrew", "biblical": "Biblical Hebrew" },
  "vowelToggle": { "label": "Niqqud", "strip": "\u0591-\u05C7" },  // character class hidden when vowels are off; add "nfd": true for precomposed marks like Latin ā
  "normalize": { "strip": "\u0591-\u05C7", "map": { "ך": "כ" } },  // for matching typed answers and coverage ("nfd": true as above)
  "clitics": { "prefixes": ["ו", "ה", "ב", "ל", "מ", "ש"], "suffixes": [] },
  // inflecting languages: "enclitics": ["que"], "stems": true indexes word stems so endings are recognised (see la/pack.json)
  "translit": { "name": "Simplified romanisation" },
  "chat": { "name": "Modern Hebrew", "translit": true },          // how the conversation prompt names the language
  "wordCards": ["produce", "listen"],    // cards per word: produce (EN → say/type), listen (audio → meaning), read (text → meaning)
  "ttsRespell": [["ae", "ai"]],          // optional: regex → replacement before speaking, for packs borrowing another language's voice
  "writingFonts": ["Noto Sans Hebrew"],  // optional: Google Fonts used as extra templates by the handwriting checker
  "wordWriting": "segment",              // handwritten words: "segment" = split into letters and check each (printed
                                         // scripts), "scribble" = iPad turns Pencil writing into text (Arabic, Latin, Chinese)
  "frequency": { "file": "frequency.txt", "source": "…", "note": "…" },  // optional "form count" per line
  "includes": ["units/u01-04.json"],  // merged in: arrays are concatenated
  "notes": [{ "title": "…", "body": ["paragraph", "**bold** allowed"] }],
  "units": [], "words": [], "grammar": [], "texts": [], "scriptLessons": [], "contrasts": [], "speaking": [], "scenarios": []
}
```
Include files may contain only these arrays: `units, words, grammar, texts, scriptLessons, contrasts, speaking, scenarios, notes`.

## Units: the teaching order
```json
{ "id": "u01", "title": "1 · Hello", "goal": "Greet people.", "items": ["script:s1", "word:marhaba", "grammar:pronouns", "text:d01"] }
```
The session builder teaches unit items in order. Put words in **frequency order** and don't cluster near-synonyms (all
the colours at once). Each item is a typed reference: `word:`, `grammar:`, `script:` or `text:`.

## Words
```json
{ "id": "kitab", "text": "كِتاب", "tr": "kitāb", "en": "book", "pos": "noun",
  "root": "k-t-b", "pattern": "CiCāC", "forms": ["الكتاب", "كتب"],
  "msa": { "text": "…", "tr": "…", "note": "…" }, "cognates": { "es": "noche", "en": "nocturnal" },
  "ex": { "text": "هادا كْتاب.", "tr": "hāda ktāb.", "en": "This is a book." },
  "note": "optional", "verified": false }
```
- `text` is the fully vowelled form; vowels are stripped automatically when the toggle is off.
- `ex` is required: every word is taught and reviewed inside a sentence, and the test checks the sentence contains the word.
- `forms` lists other surface forms (conjugations, plurals) so text coverage recognises them.
- `verified` is `false` until a fluent speaker or reference has checked it.
- Each word creates the cards listed in the pack's `wordCards` (default: **produce** and **listen**; Latin uses **read** and **produce**).

## Grammar
```json
{ "id": "bidd", "title": "bidd- 'want'", "concept": "subjunctive",
  "body": ["Short explanation. **Bold** allowed. Keep it to two screens."],
  "examples": [{ "text": "…", "tr": "…", "en": "…" }],
  "drills": [{ "id": "bd1", "prompt": "Say: I want coffee.", "answer": "بِدّي قَهوة.", "tr": "biddi ʔahwe." }],
  "verified": false }
```
Each drill becomes a production card. `concept` links to a shared page in `public/packs/shared/concepts.json`
(for example `dative`, `root-pattern`, `construct`), which is how one explanation serves several languages.

## Texts (dialogues and readers)
```json
{ "id": "r01", "title": "Reader: …", "level": "U4", "v": "lev", "kind": "reading",
  "names": ["ليلى"], "lines": [{ "sp": "Layla", "text": "…", "tr": "…", "en": "…" }],
  "source": "optional, required for authentic texts", "verified": false }
```
`kind` is `dialogue`, `reading` or `authentic`. Texts listed in a unit are taught there. All others are extensive
reading, offered once your coverage reaches 90% or more. `names` are excluded from coverage.

## Script lessons
```json
{ "id": "s1", "title": "Letters 1", "note": "…", "letters": [
  { "id": "ba", "char": "ب", "name": "bāʔ", "tr": "b", "sound": "b as in bed", "connects": true,
    "ex": { "text": "بَيت", "tr": "bēt", "en": "house" } } ] }
```
For Arabic, joining forms are generated automatically when `connects` is true. Every plain single letter in `char`
(space-separated forms, e.g. `"כּ כ ך"` → כ and ך) can be practised by hand and is checked against the pack's
other letters, so list final forms and upper/lower case as separate forms.

## Sound contrasts (HVPT)
```json
{ "id": "sin-sad", "title": "س vs ص", "a": { "label": "س", "desc": "plain" }, "b": { "label": "ص", "desc": "emphatic" },
  "note": "optional", "items": [
    { "id": "sayf", "text": "سَيف", "tr": "sayf", "en": "sword", "side": "a" },
    { "id": "sayf2", "text": "صَيف", "tr": "ṣayf", "en": "summer", "side": "b" } ] }
```
Put minimal pairs next to each other (a, b, a, b…). "Hear the pair" plays an item and its neighbour.

## Speaking prompts and conversation scenarios
```json
{ "id": "p-intro", "level": "U1", "en": "Introduce yourself.", "hints": ["ʔana ismi …"], "fluency": true }
{ "id": "sc-cafe", "title": "At a café", "setup": "…", "you": "a customer", "partner": "the waiter", "grammar": ["bidd-"] }
```
`level` "U3" means the prompt is offered from unit 3 on. `fluency: true` makes it eligible for 4/3/2.

## Cross-language links
`public/packs/shared/links.json` holds roots, cognates and loanwords across languages:
```json
{ "id": "root-ktb", "type": "root", "note": "Writing", "items": [
  { "lang": "ar", "text": "كتب", "tr": "k-t-b", "en": "write" }, { "lang": "he", "text": "כתב", "tr": "k-t-v", "en": "write" } ] }
```
A word whose `root` matches an item's `tr` shows the link in its card.

## Adding content with Claude
Paste this into a chat together with the relevant pack file(s):

> Here is my language pack file (format: docs/PACK_FORMAT.md). Add N new words for unit X in frequency order. Each needs a
> natural example sentence in the pack's variety that uses only words already in the pack plus the new word. Fill in
> `tr`, `en`, `root` where clear, and `forms` for every inflected form your sentences use. Set `verified: false`.
> Return only valid JSON for the `words` array and the updated `items` list for the unit.

Then run `npm test`. It flags dangling references, duplicate ids, examples that don't contain their word, and texts
that are unreadable with the pack's vocabulary.
