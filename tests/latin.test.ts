import { describe, it, expect } from 'vitest'
import { normalize, stripVowels, respell, buildLexicon, lookup, answerMatches } from '../src/engine/text'
import type { Pack } from '../src/packs/types'

const la = {
  id: 'la', vowelToggle: { label: 'Macrons', strip: '̄', nfd: true },
  normalize: { strip: '̄̆', nfd: true, map: { j: 'i', v: 'u' } },
  clitics: { enclitics: ['que', 'ne'], stems: true, suffixes: ['a', 'am', 'arum', 'ae', 'us', 'um', 'i', 'o', 'eo', 'is', 'em', 'es', 'et', 'it', 'unt', 'at', 'ant'] },
  ttsRespell: [['[̄̆]', ''], ['ae', 'ai'], ['c(?=[eiy])', 'ch'], ['g(?=[eiy])', 'gh'], ['v', 'u']],
  words: [
    { id: 'puella', text: 'puella', forms: [] }, { id: 'amicus', text: 'amīcus' }, { id: 'rex', text: 'rēx', forms: ['rēgis'] },
    { id: 'populus', text: 'populus' }, { id: 'video', text: 'videō', forms: ['vīdī'] },
  ],
} as unknown as Pack

describe('Latin text handling', () => {
  it('macron toggle hides long marks but keeps letters', () => {
    expect(stripVowels(la, 'Rōma in Italiā est')).toBe('Roma in Italia est')
  })
  it('matching ignores macrons, case, and u/v, i/j spelling', () => {
    expect(normalize(la, 'Vīta')).toBe(normalize(la, 'uita'))
    expect(normalize(la, 'Iūlius')).toBe(normalize(la, 'Julius'))
    expect(answerMatches(la, 'Puellam video.', 'Puellam videō.')).toBe(true)
  })
  it('recognises inflected forms through stems', () => {
    const lex = buildLexicon(la)
    for (const [tok, id] of [['puellam', 'puella'], ['puellārum', 'puella'], ['amīcī', 'amicus'], ['rēgem', 'rex'], ['vīdit', 'video'], ['videt', 'video']]) expect(lookup(la, lex, tok), tok).toBe(id)
  })
  it('peels the enclitic -que before endings', () => {
    expect(lookup(la, buildLexicon(la), 'populusque')).toBe('populus')
    expect(lookup(la, buildLexicon(la), 'puellamque')).toBe('puella')
  })
  it('does not over-match short unrelated words', () => {
    expect(lookup(la, buildLexicon(la), 'est')).toBeUndefined()
  })
  it('respells Latin for the Italian voice in classical style', () => {
    expect(respell(la, 'Caesar')).toBe('caisar')
    expect(respell(la, 'Cicerō')).toBe('chichero')
    expect(respell(la, 'vēnī, vīdī')).toBe('ueni, uidi')
    expect(respell(la, 'legiō')).toBe('leghio')
  })
  it('packs without respell rules are untouched', () => {
    expect(respell({} as Pack, 'مرحبا')).toBe('مرحبا')
  })
})
