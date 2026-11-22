import { describe, it, expect } from 'vitest'
import { bitmap, type Bitmap, type Shape } from '../src/engine/handwriting'
import { clusters, checkWordInk, answerLetters, lineOf } from '../src/engine/wordwriting'

// a 300×100 "page"; bars are drawn as filled rectangles (x0..x1, y0..y1 in pixels)
const page = (...rects: number[][]): Bitmap => {
  const b = bitmap(300, 100)
  for (const [x0, x1, y0, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) b.d[y * 300 + x] = 1
  return b
}
const tall = (x: number) => [x, x + 4, 20, 80], short = (x: number) => [x, x + 4, 20, 45], dot = (x: number) => [x, x + 3, 8, 11]

// fake templates: 'A' is a full-height bar, 'B' a half-height bar sitting on top; ref line is 0.25..0.75
const ref = { top: 0.25, bottom: 0.75 }
const height = (sh: Shape) => sh.box.bottom - sh.box.top
const want: Record<string, number> = { A: 0.5, B: 0.21 }
const cost = (sh: Shape, s: string) => (s.length === 1 ? Math.abs(height(sh) - want[s]) : 1)
const judge = (sh: Shape, ch: string) => {
  const best = Object.keys(want).sort((a, b) => cost(sh, a) - cost(sh, b))[0]
  return best === ch ? { ok: true as const } : { ok: false as const, reason: 'other' as const, looksLike: best }
}

describe('word segmentation', () => {
  it('splits separate letters and orders them right-to-left for RTL scripts', () => {
    const b = page(tall(20), short(120), tall(220))
    const ltr = clusters(b, false).map(c => c.left), rtl = clusters(b, true).map(c => c.left)
    expect(ltr).toEqual([20, 120, 220])
    expect(rtl).toEqual([220, 120, 20])
  })
  it('keeps a dot above with its letter', () => {
    expect(clusters(page(tall(20), dot(21), tall(120)), false)).toHaveLength(2)
  })
  it('finds the writing line from the typical letter', () => {
    expect(lineOf(clusters(page(tall(20), tall(80), short(140)), false))).toEqual({ top: 20, bottom: 81 })
    expect(lineOf(clusters(page(short(20), tall(140)), false))).toEqual({ top: 20, bottom: 81 })
  })
})

describe('checking a written word against the expected answer', () => {
  it('accepts the right letters in order', () => {
    const r = checkWordInk(page(tall(20), short(120), tall(220)), ['A', 'B', 'A'], false, ref, cost, judge)!
    expect(r.ok).toBe(true)
    expect(r.letters.map(l => l.status)).toEqual(['ok', 'ok', 'ok'])
  })
  it('names a wrong letter in the right position', () => {
    const r = checkWordInk(page(tall(20), tall(120), tall(220)), ['A', 'B', 'A'], false, ref, cost, judge)!
    expect(r.ok).toBe(false)
    expect(r.letters[1]).toMatchObject({ ch: 'B', status: 'other', looksLike: 'A' })
  })
  it('reports a missing letter and extra ink', () => {
    const missing = checkWordInk(page(tall(20), tall(220)), ['A', 'B', 'A'], false, ref, cost, judge)!
    expect(missing.letters.map(l => l.status)).toEqual(['ok', 'missing', 'ok'])
    const extra = checkWordInk(page(tall(20), short(90), tall(160), tall(240)), ['A', 'B', 'A'], false, ref, cost, judge)!
    expect(extra.extra).toBe(1)
    expect(extra.ok).toBe(false)
  })
  it('reads RTL words from the right', () => {
    const r = checkWordInk(page(short(20), tall(220)), ['A', 'B'], true, ref, cost, judge)!
    expect(r.ok).toBe(true)
  })
  it('answer letters ignore vowel points, spaces and punctuation', () => {
    expect(answerLetters('שָׁלוֹם, אֲנִי!')).toEqual(['ש', 'ל', 'ו', 'ם', 'א', 'נ', 'י'])
    expect(answerLetters('λόγος')).toEqual(['λ', 'ο', 'γ', 'ο', 'ς'])
  })
  it('an empty pad gives no result', () => {
    expect(checkWordInk(bitmap(300, 100), ['A'], false, ref, cost, judge)).toBeNull()
  })
})
