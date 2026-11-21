import { describe, it, expect } from 'vitest'
import { buildSession, totalMinutes, interleave, type LangInput } from '../src/engine/session'

function lang(over: Partial<LangInput> = {}): LangInput {
  return {
    lang: 'ar', status: 'active', due: [], newWordsToday: 0, newWordCap: 15,
    newItems: Array.from({ length: 40 }, (_, i) => ({ ref: `word:w${i}`, kind: 'word' as const })),
    texts: [], shadowRefs: ['word:w0', 'word:w1', 'word:w2'], prompts: [{ id: 'p1' }, { id: 'f1', fluency: true }],
    fluencyUnlocked: false, ...over,
  }
}
const dues = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, kind: i % 2 ? 'listen' : 'produce' }))

describe('buildSession', () => {
  for (const m of [5, 15, 30, 60]) {
    it(`${m} min: always includes speaking and stays within budget`, () => {
      const s = buildSession(m, [lang({ due: dues(200) })])
      expect(s.some(a => a.type === 'shadow')).toBe(true)
      expect(totalMinutes(s)).toBeLessThanOrEqual(m + 0.01)
      expect(totalMinutes(s)).toBeGreaterThan(m * 0.6)
    })
  }

  it('day one (nothing due) teaches new items and shadowing in 5 minutes', () => {
    const s = buildSession(5, [lang()])
    expect(s.map(a => a.type)).toEqual(['learn', 'shadow'])
  })

  it('caps reviews at 40% in longer sessions even with a huge backlog', () => {
    const s = buildSession(30, [lang({ due: dues(500) })])
    const rv = s.find(a => a.type === 'review')!
    expect(rv.minutes).toBeLessThanOrEqual(30 * 0.4 + 0.01)
    expect(s.some(a => a.type === 'learn')).toBe(true)
  })

  it('gives unused new-material time back to reviews when the new-word cap is hit', () => {
    const s = buildSession(30, [lang({ due: dues(500), newWordsToday: 15 })])
    expect(s.some(a => a.type === 'learn')).toBe(false)
    expect(s.find(a => a.type === 'review')!.minutes).toBeGreaterThan(12)
  })

  it('respects the daily new-word cap', () => {
    const s = buildSession(60, [lang({ newWordsToday: 10 })])
    const learn = s.find(a => a.type === 'learn') as any
    expect(learn.refs.length).toBe(5)
  })

  it('maintenance languages only get overdue reviews, ≤2 minutes', () => {
    const s = buildSession(30, [lang(), lang({ lang: 'la', status: 'maintenance', due: dues(100) })])
    const la = s.filter(a => a.lang === 'la')
    expect(la.map(a => a.type)).toEqual(['review'])
    expect(la[0].minutes).toBeLessThanOrEqual(2)
  })

  it('4/3/2 fluency only when unlocked and the session is long enough', () => {
    expect(buildSession(30, [lang()]).some(a => a.type === 'fluency')).toBe(false)
    expect(buildSession(30, [lang({ fluencyUnlocked: true })]).some(a => a.type === 'fluency')).toBe(true)
    expect(buildSession(15, [lang({ fluencyUnlocked: true })]).some(a => a.type === 'fluency')).toBe(false)
  })

  it('picks an extensive-reading text only at ≥90% coverage, least-read first', () => {
    const texts = [{ id: 't1', coverage: 0.8, minutes: 3, reads: 0 }, { id: 't2', coverage: 0.97, minutes: 3, reads: 2 }, { id: 't3', coverage: 0.95, minutes: 3, reads: 0 }]
    const r = buildSession(30, [lang({ texts })]).find(a => a.type === 'read') as any
    expect(r.textId).toBe('t3')
  })

  it('adds HVPT for a weak contrast in sessions ≥15 min', () => {
    expect(buildSession(15, [lang({ weakContrast: 'sad-sin' })]).some(a => a.type === 'hvpt')).toBe(true)
    expect(buildSession(5, [lang({ weakContrast: 'sad-sin' })]).some(a => a.type === 'hvpt')).toBe(false)
  })

  it('splits time across two active languages', () => {
    const s = buildSession(30, [lang({ due: dues(100) }), lang({ lang: 'la', due: dues(100) })])
    const ar = totalMinutes(s.filter(a => a.lang === 'ar')), la = totalMinutes(s.filter(a => a.lang === 'la'))
    expect(Math.abs(ar - la)).toBeLessThan(2)
  })
})

describe('interleave', () => {
  it('alternates kinds', () => {
    const out = interleave([{ kind: 'a' }, { kind: 'a' }, { kind: 'b' }, { kind: 'b' }])
    expect(out.map(x => x.kind).join('')).toBe('abab')
  })
})
