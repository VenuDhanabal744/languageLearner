// Script-agnostic text helpers; per-language behaviour comes from pack config.
import type { Pack } from '../packs/types'

const reCache = new Map<string, RegExp>()
function re(cls: string) {
  let r = reCache.get(cls)
  if (!r) { r = new RegExp(`[${cls}]`, 'gu'); reCache.set(cls, r) }
  return r
}

/** Hide vowel marks (harakat/niqqud) for display. */
export function stripVowels(pack: Pack, s: string): string {
  return pack.vowelToggle ? s.replace(re(pack.vowelToggle.strip), '') : s
}

/** Normalise for matching: strip marks, unify letter variants, lowercase, trim punctuation. */
export function normalize(pack: Pick<Pack, 'normalize'>, s: string): string {
  let out = s.normalize('NFC')
  if (pack.normalize?.strip) out = out.replace(re(pack.normalize.strip), '')
  if (pack.normalize?.map) for (const [k, v] of Object.entries(pack.normalize.map)) out = out.split(k).join(v)
  return out.toLowerCase().replace(/[\p{P}\p{S}]/gu, '').trim()
}

/** Split into word tokens (letters + combining marks, keeping internal apostrophes/hyphens out). */
export function tokenize(s: string): string[] {
  return s.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
}

export type Lexicon = Map<string, string> // normalised form -> word id

export function buildLexicon(pack: Pack, wordIds?: Iterable<string>): Lexicon {
  const allow = wordIds ? new Set(wordIds) : null
  const lex: Lexicon = new Map()
  for (const w of pack.words) {
    if (allow && !allow.has(w.id)) continue
    for (const f of [w.text, ...(w.forms ?? []), ...(w.msa ? [w.msa.text] : [])]) {
      const n = normalize(pack, f)
      // multiword expressions (مع السلامة) also count each of their words as known
      for (const k of [n, ...(n.includes(' ') ? n.split(/\s+/) : [])]) if (k && !lex.has(k)) lex.set(k, w.id)
    }
  }
  return lex
}

const cliticCache = new WeakMap<object, { pre: string[]; suf: string[] }>()
function clitics(pack: Pack) {
  let c = cliticCache.get(pack)
  if (!c) {
    const prep = (xs: string[] = []) => xs.map(p => normalize(pack, p)).sort((a, b) => b.length - a.length)
    c = { pre: prep(pack.clitics?.prefixes), suf: prep(pack.clitics?.suffixes) }
    cliticCache.set(pack, c)
  }
  return c
}

/** Look a token up, peeling off configured clitics (e.g. Arabic و/ب/ال, possessive suffixes). */
export function lookup(pack: Pack, lex: Lexicon, token: string): string | undefined {
  const n = normalize(pack, token)
  if (!n) return undefined
  const hit = lex.get(n)
  if (hit) return hit
  const { pre, suf } = clitics(pack)
  const stems = new Set<string>([n])
  for (const p of pre) if (n.startsWith(p) && n.length - p.length >= 2) stems.add(n.slice(p.length))
  for (const s of [...stems]) for (const x of suf) if (s.endsWith(x) && s.length - x.length >= 2) stems.add(s.slice(0, -x.length))
  for (const s of stems) { const h = lex.get(s); if (h) return h }
  return undefined
}

/** Compare a typed answer with the expected one, ignoring vowel marks and punctuation. */
export function answerMatches(pack: Pack, typed: string, expected: string): boolean {
  const a = normalize(pack, typed).replace(/\s+/g, ' ')
  const b = normalize(pack, expected).replace(/\s+/g, ' ')
  return a.length > 0 && a === b
}
