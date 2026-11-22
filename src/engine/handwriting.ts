// Offline single-letter handwriting check. Both the learner's ink and the font's glyph are reduced to one-pixel
// skeletons on a small grid, then compared by symmetric chamfer distance (how far each line is from the other's).
// The learner's letter is ranked against every letter of the script, so we can say "looks more like X".
// shortcut: template matching against one system font, good for single letters; whole words would need a real recognizer.

export interface Bitmap { w: number; h: number; d: Uint8Array }   // d[i] = 1 for ink
export interface Box { top: number; bottom: number; left: number; right: number }  // in 0..1 of the writing box
export const GRID = 48

export const bitmap = (w: number, h: number): Bitmap => ({ w, h, d: new Uint8Array(w * h) })

export function bbox(b: Bitmap): Box | null {
  let top = b.h, bottom = -1, left = b.w, right = -1
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.d[y * b.w + x]) {
    if (y < top) top = y; if (y > bottom) bottom = y; if (x < left) left = x; if (x > right) right = x
  }
  return bottom < 0 ? null : { top: top / b.h, bottom: (bottom + 1) / b.h, left: left / b.w, right: (right + 1) / b.w }
}

/** Crop to the ink, scale uniformly so the longer side fills 80% of a GRID×GRID square, and centre it. */
export function normalize(b: Bitmap): Bitmap {
  const out = bitmap(GRID, GRID), bb = bbox(b)
  if (!bb) return out
  const x0 = bb.left * b.w, y0 = bb.top * b.h, bw = (bb.right - bb.left) * b.w, bh = (bb.bottom - bb.top) * b.h
  const s = (GRID * 0.8) / Math.max(bw, bh)
  const ox = (GRID - bw * s) / 2, oy = (GRID - bh * s) / 2
  // forward-map every source pixel (no holes at these scales because the source is larger than the grid)
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.d[y * b.w + x]) {
    const gx = Math.floor(ox + (x - x0) * s), gy = Math.floor(oy + (y - y0) * s)
    if (gx >= 0 && gy >= 0 && gx < GRID && gy < GRID) out.d[gy * GRID + gx] = 1
  }
  return out
}

/** Zhang–Suen thinning: reduces strokes of any width to a one-pixel skeleton. */
export function thin(src: Bitmap): Bitmap {
  const { w, h } = src, d = src.d.slice()
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x])
  for (let changed = true; changed;) {
    changed = false
    for (const step of [0, 1]) {
      const kill: number[] = []
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!d[y * w + x]) continue
        const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)]
        const B = p.reduce((a, v) => a + v, 0)
        if (B < 2 || B > 6) continue
        let A = 0
        for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) A++
        if (A !== 1) continue
        if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue
        kill.push(y * w + x)
      }
      for (const i of kill) d[i] = 0
      if (kill.length) changed = true
    }
  }
  return { w, h, d }
}

/** Distance (in pixels, 3-4 chamfer / 3) from every cell to the nearest ink cell. */
export function distanceMap(b: Bitmap): Float32Array {
  const { w, h } = b, INF = 1e6, D = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) D[i] = b.d[i] ? 0 : INF
  const relax = (i: number, j: number, c: number) => { if (D[j] + c < D[i]) D[i] = D[j] + c }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (x > 0) relax(i, i - 1, 3)
    if (y > 0) { relax(i, i - w, 3); if (x > 0) relax(i, i - w - 1, 4); if (x < w - 1) relax(i, i - w + 1, 4) }
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x
    if (x < w - 1) relax(i, i + 1, 3)
    if (y < h - 1) { relax(i, i + w, 3); if (x < w - 1) relax(i, i + w + 1, 4); if (x > 0) relax(i, i + w - 1, 4) }
  }
  for (let i = 0; i < w * h; i++) D[i] /= 3
  return D
}

/** Symmetric mean chamfer distance between two skeletons, as a fraction of the grid size. */
export function chamfer(a: Bitmap, b: Bitmap, da = distanceMap(a), db = distanceMap(b)): number {
  let sa = 0, na = 0, sb = 0, nb = 0
  for (let i = 0; i < a.d.length; i++) { if (a.d[i]) { sa += db[i]; na++ } if (b.d[i]) { sb += da[i]; nb++ } }
  if (!na || !nb) return 1
  return (sa / na + sb / nb) / 2 / a.w
}

/** Separate marks (dots, short dashes) above and below the letter's body: they alone tell ب ت ث ن ي apart. */
export function marks(b: Bitmap): { above: number; below: number } {
  const { w, h, d } = b, seen = new Uint8Array(w * h), comps: { top: number; bottom: number; n: number }[] = []
  for (let i = 0; i < w * h; i++) if (d[i] && !seen[i]) {
    let top = h, bottom = 0, n = 0
    const stack = [i]; seen[i] = 1
    while (stack.length) {
      const j = stack.pop()!, x = j % w, y = (j - x) / w
      n++; if (y < top) top = y; if (y > bottom) bottom = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, k = ny * w + nx
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && d[k] && !seen[k]) { seen[k] = 1; stack.push(k) }
      }
    }
    comps.push({ top: top / h, bottom: (bottom + 1) / h, n })
  }
  if (!comps.length) return { above: 0, below: 0 }
  const main = comps.reduce((a, c) => (c.n > a.n ? c : a))
  const tol = 0.02
  return {
    above: comps.filter(c => c !== main && c.bottom <= main.top + tol).length,
    below: comps.filter(c => c !== main && c.top >= main.bottom - tol).length,
  }
}

export interface Shape { skel: Bitmap; dist: Float32Array; box: Box; marks: { above: number; below: number } }
/** Pre-process a full-size raster (ink or glyph, drawn in the same writing box) for comparison. */
export function shape(raw: Bitmap): Shape | null {
  const box = bbox(raw)
  if (!box) return null
  const skel = thin(normalize(raw))
  return { skel, dist: distanceMap(skel), box, marks: marks(raw) }
}

/** Lower is better. Shape distance plus a small penalty for sitting at the wrong height in the box
 *  (that's what separates Hebrew י from ו, or Arabic ء from ع, whose outlines are similar). */
export const W = { pos: 0.15, side: 0.06, count: 0 }   // count: 0 calibrated best (fonts and hands draw dots differently)
export function compare(ink: Shape, glyph: Shape): number {
  const pos = Math.abs(ink.box.top - glyph.box.top) + Math.abs(ink.box.bottom - glyph.box.bottom)
  const m = ink.marks, g = glyph.marks
  // dots written as one dash are common, so whether marks sit above/below matters more than their exact count
  const side = Number((m.above > 0) !== (g.above > 0)) + Number((m.below > 0) !== (g.below > 0))
  const count = Math.abs(m.above - g.above) + Math.abs(m.below - g.below)
  return chamfer(ink.skel, glyph.skel, ink.dist, glyph.dist) + W.pos * pos + W.side * side + W.count * count
}

export type Verdict = { ok: true } | { ok: false; reason: 'other' | 'close'; looksLike: string } | { ok: false; reason: 'unclear' }

/** Calibrated in a browser by "writing" each letter in other fonts and matching against the templates:
 *  target scores sit below ~0.06 (Hebrew) / ~0.10 (Arabic) at the 97th percentile. Real handwriting is messier. */
export const T = { maxOk: 0.12, close: 1.05 }

/** Pass only when the target is the best match: letting near-ties pass would accept ד for ר about 1 time in 3. */
export function judge(scores: { char: string; score: number }[], target: string): Verdict {
  const sorted = [...scores].sort((a, b) => a.score - b.score)
  const t = scores.find(s => s.char === target)
  if (!t || !sorted.length) return { ok: false, reason: 'unclear' }
  const best = sorted[0]
  if (best.char === target || best.score === t.score) return t.score <= T.maxOk ? { ok: true } : { ok: false, reason: 'unclear' }
  if (t.score <= T.maxOk && t.score <= best.score * T.close) return { ok: false, reason: 'close', looksLike: best.char }
  if (best.score <= T.maxOk) return { ok: false, reason: 'other', looksLike: best.char }
  return { ok: false, reason: 'unclear' }
}

/** Which characters of a script-lesson entry are worth writing: plain single letters ("כּ כ ך" → כ, ך).
 *  Entries made only of pointed forms ("שׁ שׂ") fall back to their base letter if it isn't taught elsewhere. */
export function writableChars(entry: string, plainElsewhere: Set<string>): string[] {
  const toks = entry.split(/\s+/).filter(Boolean)
  const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length
  const plain = toks.filter(t => letters(t) === 1 && !/\p{M}/u.test(t))
  if (plain.length) return plain
  const bases = [...new Set(toks.map(t => t.normalize('NFD').replace(/\p{M}/gu, '')).filter(t => letters(t) === 1))]
  return bases.filter(b => !plainElsewhere.has(b))
}
