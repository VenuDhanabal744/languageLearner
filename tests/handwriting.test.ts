import { describe, it, expect } from 'vitest'
import { bitmap, thin, shape, compare, judge, writableChars, chamfer, distanceMap, type Bitmap } from '../src/engine/handwriting'

// draw a thick line segment onto a 128×128 raster (coords in 0..1)
function line(b: Bitmap, x0: number, y0: number, x1: number, y1: number, r = 4) {
  for (let t = 0; t <= 1; t += 0.002) {
    const cx = (x0 + (x1 - x0) * t) * b.w, cy = (y0 + (y1 - y0) * t) * b.h
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const px = Math.round(cx + x), py = Math.round(cy + y)
      if (x * x + y * y <= r * r && px >= 0 && py >= 0 && px < b.w && py < b.h) b.d[py * b.w + px] = 1
    }
  }
  return b
}
const draw = (...segs: number[][]) => { const b = bitmap(128, 128); for (const s of segs) line(b, s[0], s[1], s[2], s[3]); return b }
const count = (b: Bitmap) => b.d.reduce((a, v) => a + v, 0)

describe('handwriting checker (pure parts)', () => {
  it('thinning turns a thick stroke into a one-pixel line', () => {
    const thick = draw([0.5, 0.2, 0.5, 0.8])
    const sk = thin(thick)
    expect(count(sk)).toBeLessThan(count(thick) / 5)
    expect(count(sk)).toBeGreaterThan(50)
  })
  it('identical shapes score 0; different shapes score higher', () => {
    const v = draw([0.5, 0.2, 0.5, 0.8]), h = draw([0.2, 0.5, 0.8, 0.5])
    const a = thin(v)
    expect(chamfer(a, a, distanceMap(a), distanceMap(a))).toBe(0)
    const L = draw([0.3, 0.2, 0.3, 0.8], [0.3, 0.8, 0.7, 0.8])
    expect(compare(shape(v)!, shape(v)!)).toBe(0)
    expect(compare(shape(v)!, shape(L)!)).toBeGreaterThan(compare(shape(v)!, shape(draw([0.52, 0.22, 0.49, 0.79]))!))
    expect(compare(shape(draw([0.3, 0.2, 0.3, 0.8], [0.3, 0.8, 0.72, 0.78]))!, shape(L)!)).toBeLessThan(compare(shape(h)!, shape(L)!))
  })
  it('size is forgiven, but sitting at the wrong height is penalised (י vs ו)', () => {
    const tall = draw([0.5, 0.2, 0.5, 0.8]), smallSame = draw([0.5, 0.35, 0.5, 0.65]), shortHigh = draw([0.5, 0.2, 0.5, 0.4])
    expect(compare(shape(tall)!, shape(shortHigh)!)).toBeGreaterThan(compare(shape(tall)!, shape(smallSame)!))
  })
  it('judge: passes only the best match, softens near-ties, flags scribbles', () => {
    expect(judge([{ char: 'ב', score: 0.05 }, { char: 'כ', score: 0.055 }], 'ב')).toEqual({ ok: true })
    expect(judge([{ char: 'ב', score: 0.052 }, { char: 'כ', score: 0.05 }], 'ב')).toEqual({ ok: false, reason: 'close', looksLike: 'כ' })
    expect(judge([{ char: 'ב', score: 0.09 }, { char: 'ש', score: 0.04 }], 'ב')).toEqual({ ok: false, reason: 'other', looksLike: 'ש' })
    expect(judge([{ char: 'ב', score: 0.3 }, { char: 'ש', score: 0.31 }], 'ב')).toEqual({ ok: false, reason: 'unclear' })
    expect(judge([{ char: 'ב', score: 0.3 }, { char: 'ש', score: 0.05 }], 'ב')).toEqual({ ok: false, reason: 'other', looksLike: 'ש' })
  })
  it('picks writable letters from script-lesson entries', () => {
    expect(writableChars('כּ כ ך', new Set())).toEqual(['כ', 'ך'])
    expect(writableChars('שׁ שׂ', new Set())).toEqual(['ש'])
    expect(writableChars('בַ בָ', new Set(['ב']))).toEqual([])
    expect(writableChars('Α α', new Set())).toEqual(['Α', 'α'])
    expect(writableChars('ae', new Set())).toEqual([])
  })
  it('an empty pad has no shape', () => { expect(shape(bitmap(128, 128))).toBeNull() })
})
