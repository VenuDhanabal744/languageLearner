import type { Pack, Text } from '../packs/types'
import { buildLexicon, lookup, normalize, tokenize } from './text'

export interface CoverageResult { total: number; known: number; ratio: number; unknown: string[] }

/** % of running tokens in a text that are words you have learned (Nation: aim 95–98% for extensive reading). */
export function textCoverage(pack: Pack, text: Pick<Text, 'lines' | 'names'>, learnedIds: Iterable<string>): CoverageResult {
  const lex = buildLexicon(pack, learnedIds)
  // names are skipped even with prefixes attached (Hebrew מִתֵּל = mi + Tel)
  const namesLex = new Map((text.names ?? []).map(n => [normalize(pack, n), '__name'] as [string, string]))
  let total = 0, known = 0
  const unknown: string[] = []
  for (const line of text.lines) for (const tok of tokenize(line.text)) {
    if (/^\p{N}+$/u.test(tok) || (namesLex.size && lookup(pack, namesLex, tok))) continue
    total++
    if (lookup(pack, lex, tok)) known++
    else unknown.push(tok)
  }
  return { total, known, ratio: total ? known / total : 0, unknown }
}

/** Parse "form<TAB or space>count" lines (FrequencyWords format). */
export function parseFrequency(txt: string, limit = Infinity): [string, number][] {
  const out: [string, number][] = []
  for (const line of txt.split('\n')) {
    const m = line.trim().match(/^(.+?)\s+(\d+)$/)
    if (m) out.push([m[1], Number(m[2])])
    if (out.length >= limit) break
  }
  return out
}

/**
 * Estimated coverage of real-world text: share of all corpus tokens (in the frequency list)
 * that match a learned word. An estimate: the list is truncated and matching is surface-form based.
 */
export function corpusCoverage(pack: Pack, freq: [string, number][], learnedIds: Iterable<string>): number {
  const lex = buildLexicon(pack, learnedIds)
  if (lex.size === 0) return 0
  let all = 0, hit = 0
  for (const [form, n] of freq) {
    if (!normalize(pack, form)) continue // punctuation entries like "،"
    all += n
    if (lookup(pack, lex, form)) hit += n
  }
  return all ? hit / all : 0
}

/** Frequency rank (1-based) of a word, by its main/MSA form. */
export function frequencyRanks(pack: Pack, freq: [string, number][]): Map<string, number> {
  const rankOf = new Map<string, number>()
  freq.forEach(([f], i) => { const n = normalize(pack, f); if (!rankOf.has(n)) rankOf.set(n, i + 1) })
  const out = new Map<string, number>()
  for (const w of pack.words) {
    const ranks = [w.text, ...(w.forms ?? []), ...(w.msa ? [w.msa.text] : [])].map(f => rankOf.get(normalize(pack, f))).filter((x): x is number => !!x)
    if (ranks.length) out.set(w.id, Math.min(...ranks))
  }
  return out
}
