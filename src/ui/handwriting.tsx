import { useEffect, useRef, useState } from 'preact/hooks'
import type { Pack } from '../packs/types'
import { bitmap, shape, compare, judge, writableChars, type Bitmap, type Shape, type Verdict } from '../engine/handwriting'
import { T } from './common'

export type Stroke = [number, number][]   // points in 0..1 of the writing box

// ---- device preference (per device, not synced) ----
const isIPad = () => /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export function handwritingOn(): boolean {
  try { const v = localStorage.getItem('hw'); if (v) return v === 'on' } catch { /* private mode */ }
  return isIPad()
}
export function setHandwriting(on: boolean) { try { localStorage.setItem('hw', on ? 'on' : 'off') } catch { /* ignore */ } }
/** Languages where iPad's built-in Scribble turns Pencil writing into text inside answer boxes. */
export const SCRIBBLE = new Set(['ar', 'zh', 'la', 'es'])

// ---- rasterising (the writing box and the glyph template share one coordinate system) ----
const S = 128, BASE = 0.72, SIZE = 0.5
const fontCache = new Map<string, string>()
function fontFor(pack: Pack) {
  if (!fontCache.has(pack.id)) {
    const el = document.createElement('span'); el.className = `tl tl-${pack.id}`; el.lang = pack.id
    document.body.appendChild(el); fontCache.set(pack.id, getComputedStyle(el).fontFamily); el.remove()
  }
  return fontCache.get(pack.id)!
}
function toBitmap(c: HTMLCanvasElement): Bitmap {
  const px = c.getContext('2d')!.getImageData(0, 0, S, S).data, b = bitmap(S, S)
  for (let i = 0; i < S * S; i++) b.d[i] = px[i * 4 + 3] > 100 ? 1 : 0
  return b
}
const canvas = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c }
function drawGlyph(ctx: CanvasRenderingContext2D, ch: string, font: string, size: number) {
  ctx.font = `${SIZE * size}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  ctx.fillText(ch, size / 2, BASE * size)
}
export function rasterInk(strokes: Stroke[]): Bitmap {
  const c = canvas(), ctx = c.getContext('2d')!
  ctx.lineWidth = 0.035 * S; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#000'
  for (const s of strokes) {
    ctx.beginPath(); ctx.moveTo(s[0][0] * S, s[0][1] * S)
    for (const [x, y] of s.length > 1 ? s.slice(1) : [[s[0][0] + 0.001, s[0][1]]]) ctx.lineTo(x * S, y * S)
    ctx.stroke()
  }
  return toBitmap(c)
}
const templates = new Map<string, Promise<Map<string, Shape[]>>>()
/** Extra template fonts are fetched once (Google Fonts, free, OFL). If that fails (offline), the system font alone is used. */
async function loadFonts(pack: Pack): Promise<string[]> {
  const fams = pack.writingFonts ?? []
  if (!fams.length) return []
  if (!document.getElementById('hw-fonts')) {
    const l = Object.assign(document.createElement('link'), { id: 'hw-fonts', rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?' + fams.map(f => 'family=' + f.replace(/ /g, '+')).join('&') + '&display=block' })
    document.head.appendChild(l)
    await new Promise(r => { l.onload = l.onerror = r; setTimeout(r, 5000) })
  }
  const sample = packLetters(pack).join('')
  const ok = await Promise.all(fams.map(f => document.fonts.load(`64px "${f}"`, sample).then(() => document.fonts.check(`64px "${f}"`, sample), () => false)))
  return fams.filter((_, i) => ok[i]).map(f => `"${f}"`)
}
function templatesFor(pack: Pack): Promise<Map<string, Shape[]>> {
  if (!templates.has(pack.id)) templates.set(pack.id, (async () => {
    const fonts = [fontFor(pack), ...(await loadFonts(pack))], m = new Map<string, Shape[]>()
    for (const ch of packLetters(pack)) for (const font of fonts) {
      const c = canvas(); drawGlyph(c.getContext('2d')!, ch, font, S)
      const sh = shape(toBitmap(c)); if (sh) m.set(ch, [...(m.get(ch) ?? []), sh])
    }
    return m
  })())
  return templates.get(pack.id)!
}
/** Start loading templates early (when a writing card appears) so Check is instant. */
export const warmTemplates = (pack: Pack) => { void templatesFor(pack) }

const entriesOf = (pack: Pack) => (pack.scriptLessons ?? []).flatMap(s => s.letters.map(l => l.char))
const plainLetters = (pack: Pack) => new Set(entriesOf(pack).flatMap(e => writableChars(e, new Set())).filter(c => !/\p{M}/u.test(c)))
/** The letters of one script-lesson entry that can be practised by hand ("כּ כ ך" → כ ך; "שׁ שׂ" → ש; vowel-sign entries → none). */
export const lettersOf = (pack: Pack, entry: string) => writableChars(entry, plainLetters(pack))
/** Every letter of the pack's script course that can be practised by hand. */
export const packLetters = (pack: Pack) => [...new Set(entriesOf(pack).flatMap(e => lettersOf(pack, e)))]

export async function checkLetter(pack: Pack, target: string, strokes: Stroke[]): Promise<Verdict | null> {
  const ink = shape(rasterInk(strokes))
  if (!ink) return null
  const scores = [...await templatesFor(pack)].map(([char, gs]) => ({ char, score: Math.min(...gs.map(g => compare(ink, g))) }))
  return judge(scores, target)
}

// ---- the pad ----
let penSeen = false // once an Apple Pencil touches any pad, finger/palm touches are ignored for the rest of the visit
export function WritePad({ pack, strokes, onChange, trace, readOnly }: {
  pack: Pack; strokes: Stroke[]; onChange: (s: Stroke[]) => void; trace?: string; readOnly?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const cur = useRef<Stroke | null>(null)
  const paint = (extra?: Stroke) => {
    const c = ref.current; if (!c) return
    const w = c.clientWidth, dpr = devicePixelRatio || 1
    if (c.width !== Math.round(w * dpr)) { c.width = c.height = Math.round(w * dpr) }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, w)
    const css = getComputedStyle(c)
    ctx.strokeStyle = css.getPropertyValue('--muted') || '#888'; ctx.globalAlpha = 0.35; ctx.lineWidth = 1
    ctx.setLineDash([4, 4]); for (const y of [BASE, BASE - SIZE * 0.7]) { ctx.beginPath(); ctx.moveTo(0, y * w); ctx.lineTo(w, y * w); ctx.stroke() }
    ctx.setLineDash([])
    if (trace) { ctx.globalAlpha = 0.18; ctx.fillStyle = css.color; drawGlyph(ctx, trace, fontFor(pack), w) }
    ctx.globalAlpha = 1; ctx.strokeStyle = css.color; ctx.lineWidth = 0.035 * w; ctx.lineCap = ctx.lineJoin = 'round'
    for (const s of extra ? [...strokes, extra] : strokes) {
      ctx.beginPath(); ctx.moveTo(s[0][0] * w, s[0][1] * w)
      for (const [x, y] of s.length > 1 ? s.slice(1) : [[s[0][0] + 0.001, s[0][1]]]) ctx.lineTo(x * w, y * w)
      ctx.stroke()
    }
  }
  useEffect(() => paint(), [strokes, trace])
  const pt = (e: PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }
  const ignore = (e: PointerEvent) => readOnly || (penSeen && e.pointerType === 'touch') // palm rejection once a Pencil is used
  return (
    <div class="writepad">
      <canvas ref={ref} class="pad" aria-label="Writing area: draw the letter here"
        onPointerDown={e => {
          if (e.pointerType === 'pen') penSeen = true
          if (ignore(e)) return
          ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId); cur.current = [pt(e)]; paint(cur.current)
        }}
        onPointerMove={e => {
          if (!cur.current || ignore(e)) return
          for (const ev of (e.getCoalescedEvents?.() ?? [e])) cur.current.push(pt(ev))
          paint(cur.current)
        }}
        onPointerUp={() => { if (cur.current) { onChange([...strokes, cur.current]); cur.current = null } }}
        onPointerCancel={() => { cur.current = null; paint() }} />
      {!readOnly && <div class="hwrow">
        <button class="btn small" disabled={!strokes.length} onClick={() => onChange(strokes.slice(0, -1))}>↶ Undo</button>
        <button class="btn small" disabled={!strokes.length} onClick={() => onChange([])}>Clear</button>
      </div>}
    </div>
  )
}

export function VerdictLine({ pack, v }: { pack: Pack; v: Verdict | null }) {
  if (!v) return <p class="muted small">Write the letter in the box first.</p>
  if (v.ok) return <p class="ok">✓ That's it.</p>
  if (v.reason === 'close') return <p class="warn">Close, but it could be read as <T pack={pack} text={v.looksLike} big className="letter" />. Check what makes them different.</p>
  if (v.reason === 'other') return <p class="warn">That looks more like <T pack={pack} text={v.looksLike} big className="letter" />. Compare the shapes.</p>
  return <p class="warn">Not clear enough to recognise. Compare with the model and try again.</p>
}

/** Letter practice: trace first, then from memory, with feedback from the checker. */
export function WriteLetter({ pack, chars }: { pack: Pack; chars: string[] }) {
  const [k, setK] = useState(0)
  const [trace, setTrace] = useState(true)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [v, setV] = useState<Verdict | null | undefined>(undefined)
  const ch = chars[k % chars.length]
  useEffect(() => warmTemplates(pack), [pack.id])
  return (
    <div class="writeletter">
      <p class="small">{trace ? 'Trace' : 'Write from memory'}: <T pack={pack} text={ch} className="letter" /> {chars.length > 1 && <button class="link small" onClick={() => { setK(k + 1); setStrokes([]); setV(undefined) }}>next form →</button>}</p>
      <WritePad pack={pack} strokes={strokes} onChange={s => { setStrokes(s); setV(undefined) }} trace={trace ? ch : undefined} />
      <div class="hwrow">
        <button class="btn primary small" onClick={async () => setV(await checkLetter(pack, ch, strokes))}>Check</button>
        <button class="btn small" onClick={() => { setTrace(!trace); setStrokes([]); setV(undefined) }}>{trace ? 'Now without the guide' : 'Show the guide'}</button>
      </div>
      {v !== undefined && <VerdictLine pack={pack} v={v} />}
    </div>
  )
}
