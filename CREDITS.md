# Credits and licenses

Everything here is free to use. Each source was checked for its license; "checked" means the license was confirmed
online on 2026-11-20, and "to verify" means it must be confirmed before that source's data is added.

## Used in the app now

| What | Source | License | Status |
|---|---|---|---|
| Scheduling algorithm | [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 6.0.0 | MIT | checked (npm) |
| UI | [Preact](https://preactjs.com), [idb](https://github.com/jakearchibald/idb) | MIT / ISC | npm |
| Arabic frequency ranks (`public/packs/ar/frequency.txt`, top 20,000) | [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave, from OpenSubtitles 2018 | CC BY-SA 4.0 (content), MIT (code) | checked (repo README + LICENSE) |
| Arabic pack text (words, sentences, dialogues, readers, grammar notes) | Written for this app by Claude (Anthropic) for Venu | CC BY-SA 4.0 (this repo) | **all marked `verified: false`** |
| Audio | On-device iOS voices via the Web Speech API; your own recordings | n/a (nothing distributed) | — |
| Fonts | iOS system fonts | n/a (nothing distributed) | — |

## Planned sources (later packs)

| What | Source | License | Status |
|---|---|---|---|
| Example sentences | [Tatoeba](https://tatoeba.org/en/downloads) | Text CC BY 2.0 FR (some CC0) | checked |
| Sentence audio | Tatoeba | **Per contributor.** Use only CC BY / CC BY-SA; skip NC and unlicensed | checked (license model); check each file |
| Word pronunciations | [Lingua Libre](https://lingualibre.org) / Wikimedia Commons | CC BY-SA 4.0 | checked |
| Greek texts | [Perseus canonical-greekLit](https://github.com/PerseusDL/canonical-greekLit) | CC BY-SA 4.0 | checked |
| Latin texts | Perseus canonical-latinLit | CC BY-SA (assumed same as Greek) | to verify |
| Hanzi stroke order | [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) via [hanzi-writer-data](https://hanziwriter.org/license.html) | Arphic Public License (1999); keep ARPHICPL.TXT with the data | checked |
| Stroke-order player | [hanzi-writer](https://hanziwriter.org) 3.7.3 | MIT | checked (npm) |
| Chinese dictionary | CC-CEDICT | CC BY-SA 4.0 | to verify |
| Glosses / etymologies | Wiktionary via kaikki.org | CC BY-SA | to verify |
| Latin & Greek audio | LibriVox | Public domain | to verify per recording |
| Grammars / graded readers | D'Ooge *Latin for Beginners* (1909), Ritchie *Fabulae Faciles* (1903), White *First Greek Book* (1896), Rouse *A Greek Boy at Home* (1909), Perry *Sanskrit Primer* (1886), Arden *Tamil grammar* (1891), via Project Gutenberg / Internet Archive | Public domain in the US (published before 1930) | to verify each scan |
| Authentic texts | Ben Yehuda Project (Hebrew), Project Madurai (Tamil), Arabic Wikipedia/Wikisource, GRETIL (Sanskrit) | varies (PD / CC BY-SA / per text) | to verify each |
| Fallback fonts (polytonic Greek, Devanagari) if iOS rendering fails | Google Noto | SIL OFL 1.1 | to verify |

Not used: Ørberg's *Lingua Latina per se Illustrata* (copyrighted). Its method is followed using public-domain direct-method readers instead.
