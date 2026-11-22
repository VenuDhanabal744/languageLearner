import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { respell } from '../src/engine/text'
import { loadPack, loadIndex } from '../src/packs/loader'

const root = join(__dirname, '..', 'public', 'packs')
const fsFetch = (p: string) => readFile(join(root, p.replace(/^\/?packs\//, '')), 'utf8')
const pack = await (async () => { const { concepts } = await loadIndex('', fsFetch); return loadPack('ar', { fetchText: fsFetch, concepts }) })()

describe('Arabic speech', () => {
  // the Arabic voices drop a word-final short vowel (MSA pause rule), so إنتِ came out "int"
  it('spells word-final short vowels as letters so the voice says them', () => {
    expect(respell(pack, 'إنتِ')).toBe('إنتي')
    expect(respell(pack, 'وإنتِ، كيفِك؟')).toBe('وإنتي، كيفِك؟')
    expect(respell(pack, 'نَحنُ')).toBe('نَحنو')
    expect(respell(pack, 'أَنتَ')).toBe('أَنتة')
    expect(respell(pack, 'يَقرَأُ')).toBe('يَقرَأو')  // the vowel sits before the hamza mark once decomposed
    expect(respell(pack, 'أَنَّ')).toBe('أَنّا')  // the voice ignores ة after a doubled letter
  })
  it('leaves vowels inside words, long vowels and tanween alone', () => {
    for (const s of ['كيفِك', 'شُكرًا', 'بَلَدٌ', 'جِدًّا', 'عَلى']) expect(respell(pack, s)).toBe(s)
  })
})
