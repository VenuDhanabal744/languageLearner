// Checking a handwritten word or sentence against the answer we expect. We never need open recognition:
// split the ink into letter-sized clusters, align them to the expected letters (allowing a missing letter, extra ink,
// a letter written in two separate pieces, or two letters touching), then judge each aligned piece with the letter checker.
// shortcut: works for scripts printed letter by letter (Hebrew, Greek, Tamil); joined scripts (Arabic) use iPad Scribble instead.
import { bitmap, shape, T, type Bitmap, type Shape, type Verdict } from './handwriting'

export interface Cluster { left: number; right: number; top: number; bottom: number; px: number[] }

/** 8-connected pieces of ink. */
export function components(b: Bitmap): Cluster[] {
  const { w, h, d } = b, seen = new Uint8Array(w * h), out: Cluster[] = []
  for (let i = 0; i < w * h; i++) if (d[i] && !seen[i]) {
    const c: Cluster = { left: w, right: 0, top: h, bottom: 0, px: [] }, stack = [i]; seen[i] = 1
    while (stack.length) {
      const j = stack.pop()!, x = j % w, y = (j - x) / w
      c.px.push(j)
      if (x < c.left) c.left = x; if (x > c.right) c.right = x; if (y < c.top) c.top = y; if (y > c.bottom) c.bottom = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, k = ny * w + nx
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && d[k] && !seen[k]) { seen[k] = 1; stack.push(k) }
      }
    }
    out.push(c)
  }
  return out
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0 }
const merge = (a: Cluster, b: Cluster): Cluster => ({
  left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), px: [...a.px, ...b.px],
})

/** Letter-sized clusters in reading order: pieces that overlap horizontally (a letter's detached leg, dots) belong together. */
export function clusters(b: Bitmap, rtl: boolean): Cluster[] {
  let cs = components(b)
  if (!cs.length) return []
  const lineH = Math.max(1, median(cs.map(c => c.bottom - c.top + 1)))
  for (let changed = true; changed;) {
    changed = false
    cs.sort((a, b) => a.left - b.left)
    outer: for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], c = cs[j]
      const overlap = Math.min(a.right, c.right) - Math.max(a.left, c.left) + 1
      const narrow = Math.min(a.right - a.left, c.right - c.left) + 1
      const small = (x: Cluster) => x.right - x.left + 1 < lineH * 0.3 && x.bottom - x.top + 1 < lineH * 0.3
      if (overlap >= narrow * 0.5 || (overlap > 0 && (small(a) || small(c)))) {
        cs[i] = merge(a, c); cs.splice(j, 1); changed = true; break outer
      }
    }
  }
  return cs.sort((a, b) => (rtl ? b.left + b.right - a.left - a.right : a.left + a.right - b.left - b.right))
}

/** The writing line: typical top and bottom of the letters, in pixels. */
export function lineOf(cs: Cluster[]) {
  // most letters sit on the baseline at full height; upper medians keep one short letter (י) from shrinking the line
  const up = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.ceil((s.length - 1) / 2)] }
  const bottom = up(cs.map(c => c.bottom + 1)), height = up(cs.map(c => c.bottom + 1 - c.top))
  return { top: bottom - height, bottom }
}

/** Shape of one or more clusters, placed in letter-box coordinates so height cues (י vs ו) still count.
 *  `ref` is where a typical full-height letter sits in the letter templates (0..1). */
export function groupShape(b: Bitmap, cs: Cluster[], line: { top: number; bottom: number }, ref: { top: number; bottom: number }): Shape | null {
  const crop = bitmap(b.w, b.h)
  for (const c of cs) for (const i of c.px) crop.d[i] = 1
  const sh = shape(crop)
  if (!sh) return null
  const g = cs.reduce(merge)
  const k = (ref.bottom - ref.top) / (line.bottom - line.top)
  const map = (y: number) => ref.top + (y - line.top) * k
  const half = ((g.right - g.left + 1) * k) / 2
  sh.box = { top: map(g.top), bottom: map(g.bottom + 1), left: 0.5 - half, right: 0.5 + half }
  return sh
}

export type LetterStatus = 'ok' | 'close' | 'other' | 'unclear' | 'missing'
export interface LetterResult { ch: string; status: LetterStatus; looksLike?: string; sh?: Shape }  // sh: the ink judged for this letter
export interface WordResult { ok: boolean; letters: LetterResult[]; extra: number }

/** The letters to check in an answer: base letters only (vowel points, spaces and punctuation aren't checked). */
export const answerLetters = (text: string) => [...text.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC')].filter(c => /\p{L}/u.test(c))

export const P = { miss: 0.3, extra: 0.3, band: 5 }

/**
 * Align clusters to expected letters by dynamic programming. Moves: one piece = one letter; two pieces = one letter;
 * one piece = two touching letters; a letter with no ink (missing); ink with no letter (extra).
 * `cost(shape, s)` scores a shape against the template of string s (one or two letters); lower is better.
 */
export function checkWordInk(
  b: Bitmap, expected: string[], rtl: boolean, ref: { top: number; bottom: number },
  cost: (sh: Shape, s: string) => number, judgeLetter: (sh: Shape, ch: string) => Verdict,
): WordResult | null {
  const cs = clusters(b, rtl)
  if (!cs.length) return null
  const line = lineOf(cs), n = cs.length, m = expected.length, lineH = line.bottom - line.top
  const gap = (a: Cluster, b: Cluster) => Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right))
  const shapes = new Map<string, Shape | null>()
  const sh = (i: number, len: number) => {
    const key = i + ':' + len
    if (!shapes.has(key)) shapes.set(key, groupShape(b, cs.slice(i, i + len), line, ref))
    return shapes.get(key)!
  }
  const c = (i: number, len: number, k: number, letters: number) => {
    const s = sh(i, len)
    return s ? cost(s, expected.slice(k, k + letters).join('')) : 1
  }
  type Move = 'm11' | 'm21' | 'm12' | 'miss' | 'extra'
  const INF = 1e9, D: number[][] = [], from: Move[][] = []
  for (let i = 0; i <= n; i++) { D.push(new Array(m + 1).fill(INF)); from.push(new Array(m + 1)) }
  D[0][0] = 0
  const relax = (i: number, k: number, v: number, mv: Move) => { if (v < D[i][k]) { D[i][k] = v; from[i][k] = mv } }
  for (let i = 0; i <= n; i++) for (let k = 0; k <= m; k++) {
    const v = D[i][k]
    if (v >= INF || Math.abs(i - k) > P.band + Math.abs(n - m)) continue
    if (i < n && k < m) relax(i + 1, k + 1, v + c(i, 1, k, 1), 'm11')
    // one letter in two pieces only if the pieces are close together
    if (i + 1 < n && k < m && gap(cs[i], cs[i + 1]) < 0.25 * lineH) relax(i + 2, k + 1, v + c(i, 2, k, 1), 'm21')
    if (i < n && k + 1 < m) relax(i + 1, k + 2, v + c(i, 1, k, 2), 'm12')
    if (k < m) relax(i, k + 1, v + P.miss, 'miss')
    if (i < n) relax(i + 1, k, v + P.extra, 'extra')
  }
  const letters: LetterResult[] = []
  let extra = 0
  for (let i = n, k = m; i > 0 || k > 0;) {
    const mv = from[i][k]
    if (mv === 'm11' || mv === 'm21') {
      const len = mv === 'm11' ? 1 : 2, s = sh(i - len, len)!, v = judgeLetter(s, expected[k - 1])
      letters.unshift(v.ok ? { ch: expected[k - 1], status: 'ok', sh: s } : { ch: expected[k - 1], status: v.reason, looksLike: 'looksLike' in v ? v.looksLike : undefined, sh: s })
      i -= len; k -= 1
    } else if (mv === 'm12') {
      // two letters touching: no per-letter verdict, just whether the pair matches well
      const good = c(i - 1, 1, k - 2, 2) <= T.maxOk * 1.2
      letters.unshift({ ch: expected[k - 2], status: good ? 'ok' : 'unclear' }, { ch: expected[k - 1], status: good ? 'ok' : 'unclear' })
      i -= 1; k -= 2
    } else if (mv === 'miss') { letters.unshift({ ch: expected[k - 1], status: 'missing' }); k -= 1 }
    else { extra++; i -= 1 }
  }
  // 'close' letters are readable (near-twins like ו/ז); they pass but are pointed out
  return { ok: extra === 0 && letters.every(l => l.status === 'ok' || l.status === 'close'), letters, extra }
}
