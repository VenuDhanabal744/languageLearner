import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadPack, loadIndex, mergeInclude } from '../src/packs/loader'
import { validatePack } from '../src/packs/validate'
import { textCoverage } from '../src/engine/coverage'

const root = join(__dirname, '..', 'public', 'packs')
const fsFetch = (p: string) => readFile(join(root, p.replace(/^\/?packs\//, '')), 'utf8')

const minimal = () => ({
  id: 'xx', name: 'Test', version: '1', dir: 'ltr', tts: 'xx', translit: { name: 'none' },
  units: [{ id: 'u1', title: 'U1', goal: '', items: ['word:a'] }],
  words: [{ id: 'a', text: 'a', tr: 'a', en: 'a', ex: { text: 'a b', en: 'a b' }, verified: true }],
  grammar: [], texts: [], scriptLessons: [], contrasts: [], speaking: [], scenarios: [],
})

describe('validatePack', () => {
  it('accepts a minimal pack', () => expect(validatePack(minimal())).toEqual([]))
  it('reports dangling unit refs, duplicate ids, and missing examples', () => {
    const p: any = minimal()
    p.units[0].items.push('word:nope', 'bogus:1')
    p.words.push({ ...p.words[0] })
    p.words.push({ id: 'b', text: 'b', tr: 'b', en: 'b', verified: false })
    const errs = validatePack(p).join('\n')
    expect(errs).toMatch(/points to nothing/)
    expect(errs).toMatch(/bad ref/)
    expect(errs).toMatch(/duplicate word id "a"/)
    expect(errs).toMatch(/example needs text/)
  })
  it('requires both sides of an HVPT contrast', () => {
    const p: any = minimal()
    p.contrasts = [{ id: 'c', title: 'c', a: {}, b: {}, items: [{ id: 'i', text: 'x', tr: 'x', en: 'x', side: 'a' }] }]
    expect(validatePack(p).join()).toMatch(/both sides/)
  })
})

describe('loadPack', () => {
  it('merges includes and rejects unknown keys', async () => {
    const files: Record<string, string> = {
      'x/pack.json': JSON.stringify({ ...minimal(), words: [], units: [], includes: ['u.json'] }),
      'x/u.json': JSON.stringify({ words: minimal().words, units: minimal().units }),
    }
    const pack = await loadPack('x', { fetchText: async p => files[p] })
    expect(pack.words).toHaveLength(1)
    expect(() => mergeInclude({}, { id: 'hack' }, 'f.json')).toThrow(/not allowed/)
  })
  it('throws readable errors for bad JSON', async () => {
    await expect(loadPack('x', { fetchText: async () => '{oops' })).rejects.toThrow(/invalid JSON/)
  })
})

describe('shipped packs', () => {
  it('index + every available pack loads and validates', async () => {
    const { index, concepts } = await loadIndex('', fsFetch)
    const avail = index.filter(e => e.status === 'available')
    expect(avail.length).toBeGreaterThan(0)
    for (const e of avail) {
      const pack = await loadPack(e.path!, { fetchText: fsFetch, concepts })
      expect(pack.id).toBe(e.id)
      expect(pack.words.length).toBeGreaterThan(0)
    }
  })

  it('Arabic: every word example sentence contains its word (so context cards make sense)', async () => {
    const { concepts } = await loadIndex('', fsFetch)
    const pack = await loadPack('ar', { fetchText: fsFetch, concepts })
    const missing = pack.words.filter(w => textCoverage(pack, { lines: [w.ex] }, [w.id]).known === 0).map(w => w.id)
    expect(missing).toEqual([])
  })
})
