import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalize, stripVowels, buildLexicon, lookup, answerMatches } from '../src/engine/text'
import { loadPack, loadIndex } from '../src/packs/loader'

const root = join(__dirname, '..', 'public', 'packs')
const fsFetch = (p: string) => readFile(join(root, p.replace(/^\/?packs\//, '')), 'utf8')
const pack = await (async () => { const { concepts } = await loadIndex('', fsFetch); return loadPack('he', { fetchText: fsFetch, concepts }) })()

describe('Hebrew text handling', () => {
  it('niqqud toggle removes points and dagesh but keeps maqaf and letters', () => {
    expect(stripVowels(pack, 'וַיְהִי־אוֹר')).toBe('ויהי־אור')
    expect(stripVowels(pack, 'שָׁלוֹם')).toBe('שלום')
  })
  it('typed answers match regardless of niqqud and final-letter forms', () => {
    expect(answerMatches(pack, 'שלום', 'שָׁלוֹם')).toBe(true)
    expect(normalize(pack, 'ספרים')).toBe(normalize(pack, 'ספרימ'))
  })
  it('recognises words with attached prefixes and suffixes', () => {
    const lex = buildLexicon(pack)
    for (const [tok, id] of [['וּבַבַּיִת', 'bayit'], ['לַשּׁוּק', 'shuk'], ['הַסְּפָרִים', 'sefer'], ['וְהָאָרֶץ', 'eretz'], ['בְּסֵדֶר', 'beseder']]) expect(lookup(pack, lex, tok), tok).toBe(id)
  })
  it('Hebrew roots link to Arabic', async () => {
    const links = JSON.parse(await fsFetch('shared/links.json')) as { items: { lang: string; tr: string }[] }[]
    const heRoots = new Set(pack.words.map(w => w.root).filter(Boolean))
    const linked = links.filter(l => l.items.some(i => i.lang === 'ar') && l.items.some(i => i.lang === 'he' && heRoots.has(i.tr)))
    expect(linked.length).toBeGreaterThanOrEqual(10)
  })
})
