import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalize, stripVowels, buildLexicon, lookup, answerMatches, respell } from '../src/engine/text'
import { loadPack, loadIndex } from '../src/packs/loader'

const root = join(__dirname, '..', 'public', 'packs')
const fsFetch = (p: string) => readFile(join(root, p.replace(/^\/?packs\//, '')), 'utf8')
const pack = await (async () => { const { concepts } = await loadIndex('', fsFetch); return loadPack('grc', { fetchText: fsFetch, concepts }) })()

describe('Greek text handling', () => {
  it('accent toggle hides accents and breathings but keeps iota subscript and letters', () => {
    expect(stripVowels(pack, 'ἐν τῷ κήπῳ')).toBe('εν τῳ κηπῳ')
    expect(stripVowels(pack, 'Ἡ Ἑλλὰς')).toBe('Η Ελλας')
  })
  it('typed answers match without accents, breathings, or final-sigma care', () => {
    expect(answerMatches(pack, 'Μαθητης ειμι', 'Μαθητής εἰμι.')).toBe(true)
    expect(normalize(pack, 'λόγος')).toBe(normalize(pack, 'λογοσ'))
    expect(answerMatches(pack, 'ὁ λόγος', 'ὁ λύκος')).toBe(false)
  })
  it('recognises inflected forms through stems and form lists', () => {
    const lex = buildLexicon(pack)
    for (const [tok, id] of [['ἀνθρώπων', 'anthropos'], ['τὴν', 'ho'], ['γράφουσιν', 'grapho'], ['πατρός', 'pater'], ['καλαί', 'kalos'], ['ἀλλ᾽', 'alla']]) expect(lookup(pack, lex, tok), tok).toBe(id)
  })
  it('respells toward Attic for the Modern Greek voice', () => {
    expect(respell(pack, 'χαῖρε')).toBe('καΐρε')
    expect(respell(pack, 'θάλαττα')).toBe('τάλαττα')
    expect(respell(pack, 'εὖ')).toBe('εού')
    expect(respell(pack, 'βιβλίον')).toBe('μπιμπλίον')
    expect(respell(pack, 'ἡμέρα')).toBe('εμέρα')
    expect(respell(pack, 'ψυχή')).toBe('ψουκέ')
    expect(respell(pack, 'ὁ λόγος')).toBe('ο λόγκος')
    expect(respell(pack, 'δῶρον')).toBe('ντόρον')
    expect(respell(pack, 'ἄγγελος')).toBe('άγκελος')
  })
})

describe('Greek ↔ Latin links', () => {
  it('at least 20 Greek words link to a Latin cousin or loan', async () => {
    const links = JSON.parse(await fsFetch('shared/links.json')) as { items: { lang: string; text: string }[] }[]
    const grc = new Set(pack.words.map(w => normalize(pack, w.text)))
    const linked = links.filter(l => l.items.some(i => i.lang === 'la') && l.items.some(i => i.lang === 'grc' && grc.has(normalize(pack, i.text))))
    expect(linked.length).toBeGreaterThanOrEqual(20)
  })
})
