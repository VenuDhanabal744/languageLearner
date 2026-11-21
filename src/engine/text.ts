// Script-agnostic text helpers; per-language behaviour comes from pack config.
import type { Pack } from '../packs/types'

const reCache = new Map<string, RegExp>()
function re(cls: string) {
  let r = reCache.get(cls)
  if (!r) { r = new RegExp(`[${cls}]`, 'gu'); reCache.set(cls, r) }
  return r
}

/** Hide vowel marks (harakat, niqqud, Latin macrons) for display. */
export function stripVowels(pack: Pick<Pack, 'vowelToggle'>, s: string): string {
  const v = pack.vowelToggle
  if (!v) return s
  // nfd: marks precomposed into letters (ā = a + U+0304) must be decomposed first; not for Arabic, where NFD splits أ
  return v.nfd ? s.normalize('NFD').replace(re(v.strip), '').normalize('NFC') : s.replace(re(v.strip), '')
}

/** Normalise for matching: strip marks, lowercase, unify letter variants, drop punctuation. */
export function normalize(pack: Pick<Pack, 'normalize'>, s: string): string {
  const n = pack.normalize
  let out = s.normalize(n?.nfd ? 'NFD' : 'NFC')
  if (n?.strip) out = out.replace(re(n.strip), '')
  out = out.normalize('NFC').toLowerCase()
  if (n?.map) for (const [k, v] of Object.entries(n.map)) out = out.split(k).join(v)
  return out.replace(/[\p{P}\p{S}]/gu, '').trim()
}

/** Split into word tokens (letters + combining marks). */
export function tokenize(s: string): string[] {
  return s.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
}

export type Lexicon = Map<string, string> // normalised form (or stem) -> word id

const STEM_MIN = 3

export function buildLexicon(pack: Pack, wordIds?: Iterable<string>): Lexicon {
  const allow = wordIds ? new Set(wordIds) : null
  const lex: Lexicon = new Map()
  const stems: [string, string][] = []
  const { suf } = clitics(pack)
  for (const w of pack.words) {
    if (allow && !allow.has(w.id)) continue
    for (const f of [w.text, ...(w.forms ?? []), ...(w.msa ? [w.msa.text] : [])]) {
      const n = normalize(pack, f)
      // multiword expressions (مع السلامة) also count each of their words as known
      for (const k of [n, ...(n.includes(' ') ? n.split(/\s+/) : [])]) {
        if (k && !lex.has(k)) lex.set(k, w.id)
        // inflecting languages (Latin): index the stem so puella / puellam / puellārum all match
        if (pack.clitics?.stems) for (const x of suf) if (k.endsWith(x) && k.length - x.length >= STEM_MIN) stems.push([k.slice(0, -x.length), w.id])
      }
    }
  }
  for (const [k, id] of stems) if (!lex.has(k)) lex.set(k, id) // exact forms always win over stems
  return lex
}

const cliticCache = new WeakMap<object, { pre: string[]; enc: string[]; suf: string[] }>()
function clitics(pack: Pack) {
  let c = cliticCache.get(pack)
  if (!c) {
    const prep = (xs: string[] = []) => [...new Set(xs.map(p => normalize(pack, p)))].filter(Boolean).sort((a, b) => b.length - a.length)
    c = { pre: prep(pack.clitics?.prefixes), enc: prep(pack.clitics?.enclitics), suf: prep(pack.clitics?.suffixes) }
    cliticCache.set(pack, c)
  }
  return c
}

/** Look a token up, peeling off configured clitics (Arabic و/ب/ال, Latin -que) and endings. */
export function lookup(pack: Pack, lex: Lexicon, token: string): string | undefined {
  const n = normalize(pack, token)
  if (!n) return undefined
  const hit = lex.get(n)
  if (hit) return hit
  const { pre, enc, suf } = clitics(pack)
  const min = pack.clitics?.stems ? STEM_MIN : 2
  const stems = new Set<string>([n])
  for (const p of pre) if (n.startsWith(p) && n.length - p.length >= 2) stems.add(n.slice(p.length))
  for (const s of [...stems]) for (const e of enc) if (s.endsWith(e) && s.length - e.length >= 2) stems.add(s.slice(0, -e.length))
  for (const s of [...stems]) for (const x of suf) if (s.endsWith(x) && s.length - x.length >= min) stems.add(s.slice(0, -x.length))
  for (const s of stems) { const h = lex.get(s); if (h) return h }
  return undefined
}

/** Compare a typed answer with the expected one, ignoring vowel marks and punctuation. */
export function answerMatches(pack: Pack, typed: string, expected: string): boolean {
  const a = normalize(pack, typed).replace(/\s+/g, ' ')
  const b = normalize(pack, expected).replace(/\s+/g, ' ')
  return a.length > 0 && a === b
}

/** Text actually sent to the speech engine: some packs borrow another language's voice with respelling rules. */
export function respell(pack: Pick<Pack, 'ttsRespell'>, s: string): string {
  if (!pack.ttsRespell?.length) return s
  let out = s.normalize('NFD').toLowerCase()
  for (const [pat, rep] of pack.ttsRespell) out = out.replace(new RegExp(pat, 'gu'), rep)
  return out.normalize('NFC')
}
