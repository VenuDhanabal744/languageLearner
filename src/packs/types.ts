// Language pack schema. Documented for humans in docs/PACK_FORMAT.md; enforced by validate.ts.
export interface Example { text: string; tr?: string; en: string; v?: string }

export interface Word {
  id: string
  text: string            // fully vowelled form (vowel marks are stripped automatically when toggled off)
  tr: string              // transliteration
  en: string              // English gloss
  pos?: string
  root?: string           // e.g. "k-t-b"
  pattern?: string        // e.g. "maCCaC"
  forms?: string[]        // other surface forms counted as this word for coverage
  v?: string              // variety id, defaults to pack.defaultVariety
  msa?: { text: string; tr?: string; note?: string } // formal/literary counterpart when it differs
  cognates?: Record<string, string> // e.g. { "es": "noche", "en": "nocturnal" }
  ex: Example             // every word is taught inside a sentence
  note?: string
  verified: boolean
}

export interface Drill { id: string; prompt: string; cue?: string; answer: string; tr?: string; en?: string }

export interface Grammar {
  id: string
  title: string
  concept?: string        // id in shared/concepts.json
  body: string[]          // short paragraphs; **bold** allowed
  examples: Example[]
  drills: Drill[]
  verified: boolean
}

export interface TextLine { sp?: string; text: string; tr?: string; en: string }
export interface Text {
  id: string
  title: string
  level: string
  v?: string
  kind: 'dialogue' | 'reading' | 'authentic'
  lines: TextLine[]
  names?: string[]        // proper nouns excluded from coverage
  source?: string
  verified: boolean
}

export interface Letter { id: string; char: string; name: string; tr: string; sound: string; connects: boolean; ex: Example }
export interface ScriptLesson { id: string; title: string; note?: string; letters: Letter[] }

export interface ContrastItem { id: string; text: string; tr: string; en: string; side: 'a' | 'b' }
export interface Contrast {
  id: string
  title: string
  a: { label: string; desc: string }
  b: { label: string; desc: string }
  note?: string
  items: ContrastItem[]
}

export interface SpeakingPrompt { id: string; level: string; en: string; hints?: string[]; fluency?: boolean }
export interface Scenario { id: string; title: string; setup: string; you: string; partner: string; grammar?: string[] }

/** Unit items are typed refs: "script:<id>", "word:<id>", "grammar:<id>", "text:<id>". Order = teaching order. */
export interface Unit { id: string; title: string; goal: string; items: string[] }

export interface Pack {
  id: string
  name: string
  version: string
  dir: 'rtl' | 'ltr'
  tts: string                         // BCP-47 prefix used to pick an on-device voice
  ttsNote?: string                    // honest note about audio quality
  font?: string                       // CSS font-family stack override
  defaultVariety?: string
  varieties?: Record<string, string>
  vowelToggle?: { label: string; strip: string; nfd?: boolean } // strip = regex character class of marks to hide
  normalize?: { strip?: string; map?: Record<string, string>; nfd?: boolean } // for matching typed answers & coverage
  clitics?: { prefixes?: string[]; enclitics?: string[]; suffixes?: string[]; stems?: boolean }
  ttsRespell?: [string, string][]      // regex → replacement, applied before speaking (borrowed voices)
  /** OFL fonts from Google Fonts used as extra templates by the handwriting checker (loaded only when writing). */
  writingFonts?: string[]
  wordCards?: ('produce' | 'listen' | 'read')[] // cards made per word; default produce + listen
  chat?: { name: string; translit: boolean } // how the conversation prompt names the language
  translit: { name: string }
  frequency?: { file: string; source: string; note: string }
  includes?: string[]                 // extra JSON files merged into this pack (arrays concatenated)
  notes?: { title: string; body: string[] }[]
  units: Unit[]
  words: Word[]
  grammar: Grammar[]
  texts: Text[]
  scriptLessons: ScriptLesson[]
  contrasts: Contrast[]
  speaking: SpeakingPrompt[]
  scenarios: Scenario[]
}

export interface PackIndexEntry {
  id: string
  name: string
  native: string
  kind: 'living' | 'classical'
  status: 'available' | 'planned'
  path?: string
}

export interface Concept { id: string; title: string; body: string[]; langs: Record<string, string> }
export interface CrossLink { id: string; type: 'root' | 'cognate' | 'loan'; note: string; items: { lang: string; text: string; tr: string; en: string }[] }
