import { useEffect, useRef, useState } from 'preact/hooks'
import type { Pack } from '../packs/types'
import { bitmap, shape, compare, judge, writableChars, caseOf, packShape, unpackShape, addSample, type Bitmap, type Shape, type Verdict, type Sample } from '../engine/handwriting'
import { kvGet, kvSet } from '../store/db'
import { checkWordInk, answerLetters, type WordResult } from '../engine/wordwriting'
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
  const { width: w, height: h } = c, px = c.getContext('2d')!.getImageData(0, 0, w, h).data, b = bitmap(w, h)
  for (let i = 0; i < w * h; i++) b.d[i] = px[i * 4 + 3] > 100 ? 1 : 0
  return b
}
const canvas = (w = S, h = S) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
function drawGlyph(ctx: CanvasRenderingContext2D, ch: string, font: string, size: number) {
  ctx.font = `${SIZE * size}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  ctx.fillText(ch, size / 2, BASE * size)
}
/** Ink as a bitmap S pixels high; `aspect` = pad width / height (1 for the letter pad). */
export function rasterInk(strokes: Stroke[], aspect = 1): Bitmap {
  const W = Math.round(S * aspect), c = canvas(W, S), ctx = c.getContext('2d')!
  ctx.lineWidth = 0.035 * S; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#000'
  for (const s of strokes) {
    ctx.beginPath(); ctx.moveTo(s[0][0] * W, s[0][1] * S)
    for (const [x, y] of s.length > 1 ? s.slice(1) : [[s[0][0] + 0.001, s[0][1]]]) ctx.lineTo(x * W, y * S)
    ctx.stroke()
  }
  return toBitmap(c)
}
interface Templates { fonts: string[]; shapes: Map<string, Shape[]>; mine: Map<string, Shape[]>; ref: { top: number; bottom: number } }
const templates = new Map<string, Promise<Templates>>()
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
function templatesFor(pack: Pack): Promise<Templates> {
  if (!templates.has(pack.id)) templates.set(pack.id, (async () => {
    const t: Templates = { fonts: [fontFor(pack), ...(await loadFonts(pack))], shapes: new Map(), mine: new Map(), ref: { top: 0, bottom: 1 } }
    for (const [ch, xs] of Object.entries((await kvGet<Record<string, Sample[]>>('hw:' + pack.id)) ?? {})) t.mine.set(ch, xs.map(unpackShape))
    for (const ch of packLetters(pack)) glyphShapes(t, ch)
    // where a typical letter sits in the template box: maps a written line onto it
    const boxes = [...t.shapes.values()].map(g => g[0].box), mid = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    if (boxes.length) t.ref = { top: mid(boxes.map(b => b.top)), bottom: mid(boxes.map(b => b.bottom)) }
    return t
  })())
  return templates.get(pack.id)!
}
/** Template shapes for a letter (or a pair of touching letters), one per font, cached. */
function glyphShapes(t: Templates, str: string): Shape[] {
  if (!t.shapes.has(str)) t.shapes.set(str, t.fonts.flatMap(font => {
    const c = canvas(); drawGlyph(c.getContext('2d')!, str, font, S); const sh = shape(toBitmap(c)); return sh ? [sh] : []
  }))
  return t.shapes.get(str)!
}
/** Start loading templates early (when a writing card appears) so Check is instant. */
export const warmTemplates = (pack: Pack) => { void templatesFor(pack) }

const entriesOf = (pack: Pack) => (pack.scriptLessons ?? []).flatMap(s => s.letters.map(l => l.char))
// letters the course shows unpointed somewhere (so a pointed-only entry like 'בַ בָ' adds nothing new)
const plainLetters = (pack: Pack) => new Set(entriesOf(pack).flatMap(e => e.split(/\s+/)).filter(t => (t.match(/\p{L}/gu) ?? []).length === 1 && !/\p{M}/u.test(t.normalize('NFD'))))
/** The letters of one script-lesson entry that can be practised by hand ("כּ כ ך" → כ ך; "שׁ שׂ" → ש; vowel-sign entries → none). */
export const lettersOf = (pack: Pack, entry: string) => writableChars(entry, plainLetters(pack))
/** Every letter of the pack's script course that can be practised by hand. */
export const packLetters = (pack: Pack) => [...new Set(entriesOf(pack).flatMap(e => lettersOf(pack, e)))]

/** Remember how you write a letter, so the checker adapts to your hand. Synced with your other progress. */
export async function learnLetter(pack: Pack, ch: string, sh: Shape) {
  const x = packShape(sh), key = 'hw:' + pack.id
  await kvSet(key, addSample((await kvGet<Record<string, Sample[]>>(key)) ?? {}, ch, x))
  const t = await templatesFor(pack)
  t.mine.set(ch, [...(t.mine.get(ch) ?? []), unpackShape(x)].slice(-6))
}
export const inkShape = (strokes: Stroke[]) => shape(rasterInk(strokes))

export async function checkLetter(pack: Pack, target: string, strokes: Stroke[]): Promise<Verdict | null> {
  const ink = shape(rasterInk(strokes))
  if (!ink) return null
  return scoreLetter(await templatesFor(pack), pack, ink, target)
}
function scoreLetter(t: Templates, pack: Pack, ink: Shape, target: string): Verdict {
  const scores = packLetters(pack).filter(c => caseOf(c) === caseOf(target)).map(char => ({ char, score: Math.min(...[...glyphShapes(t, char), ...(t.mine.get(char) ?? [])].map(g => compare(ink, g))) }))
  return judge(scores, target)
}

/** Check a handwritten word or one-line sentence against the expected answer, letter by letter. */
export async function checkWord(pack: Pack, answer: string, strokes: Stroke[], aspect: number): Promise<WordResult | null> {
  const t = await templatesFor(pack), letters = new Set(packLetters(pack))
  const expected = answerLetters(answer).filter(c => letters.has(c))
  if (!expected.length || !strokes.length) return null
  return checkWordBitmap(pack, expected, rasterInk(strokes, aspect), t)
}
export async function checkWordBitmap(pack: Pack, expected: string[], raw: Bitmap, t?: Templates): Promise<WordResult | null> {
  t ??= await templatesFor(pack)
  return checkWordInk(raw, expected, pack.dir === 'rtl', t.ref,
    (sh, str) => Math.min(...[...glyphShapes(t, str), ...(t.mine.get(str) ?? [])].map(g => compare(sh, g))),
    (sh, ch) => scoreLetter(t, pack, sh, ch))
}

// ---- the pad ----
let penSeen = false // once an Apple Pencil touches any pad, finger/palm touches are ignored for the rest of the visit
export function WritePad({ pack, strokes, onChange, trace, readOnly, aspect = 1 }: {
  pack: Pack; strokes: Stroke[]; onChange: (s: Stroke[]) => void; trace?: string; readOnly?: boolean; aspect?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const cur = useRef<Stroke | null>(null)
  const paint = (extra?: Stroke) => {
    const c = ref.current; if (!c) return
    const w = c.clientWidth, h = w / aspect, dpr = devicePixelRatio || 1
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h)
    const css = getComputedStyle(c)
    ctx.strokeStyle = css.getPropertyValue('--muted') || '#888'; ctx.globalAlpha = 0.35; ctx.lineWidth = 1
    ctx.setLineDash([4, 4]); for (const y of [BASE, BASE - SIZE * 0.7]) { ctx.beginPath(); ctx.moveTo(0, y * h); ctx.lineTo(w, y * h); ctx.stroke() }
    ctx.setLineDash([])
    if (trace) { ctx.globalAlpha = 0.18; ctx.fillStyle = css.color; drawGlyph(ctx, trace, fontFor(pack), w) }
    ctx.globalAlpha = 1; ctx.strokeStyle = css.color; ctx.lineWidth = 0.035 * h; ctx.lineCap = ctx.lineJoin = 'round'
    for (const s of extra ? [...strokes, extra] : strokes) {
      ctx.beginPath(); ctx.moveTo(s[0][0] * w, s[0][1] * h)
      for (const [x, y] of s.length > 1 ? s.slice(1) : [[s[0][0] + 0.001, s[0][1]]]) ctx.lineTo(x * w, y * h)
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
      <canvas ref={ref} class={aspect > 1 ? 'pad wide' : 'pad'} style={aspect > 1 ? { aspectRatio: String(aspect) } : undefined} aria-label={aspect > 1 ? 'Writing area: write the answer here' : 'Writing area: draw the letter here'}
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
        <button class="btn primary small" onClick={async () => {
          const r = await checkLetter(pack, ch, strokes); setV(r)
          const sh = inkShape(strokes)
          if (r?.ok && !trace && sh) learnLetter(pack, ch, sh) // clean passes from memory teach the checker your hand
        }}>Check</button>
        <button class="btn small" onClick={() => { setTrace(!trace); setStrokes([]); setV(undefined) }}>{trace ? 'Now without the guide' : 'Show the guide'}</button>
      </div>
      {v !== undefined && <VerdictLine pack={pack} v={v} />}
      {v && !v.ok && <LearnButton onLearn={async () => { const sh = inkShape(strokes); if (sh) await learnLetter(pack, ch, sh) }} />}
    </div>
  )
}

/** Per-letter result for a written word: the expected letters coloured, then what to fix. */
export function WordVerdict({ pack, r }: { pack: Pack; r: WordResult | null }) {
  if (!r) return <p class="muted small">Nothing written to check.</p>
  const issues = r.letters.map((l, i) => ({ ...l, n: i + 1 })).filter(l => l.status !== 'ok')
  return (
    <div class="wordverdict">
      <p dir={pack.dir}>{r.letters.map((l, i) => <span key={i} lang={pack.id} class={`tl tl-${pack.id} hwl ${l.status}`}>{l.ch}</span>)}</p>
      {r.ok && issues.length === 0 && <p class="ok">✓ Every letter matches.</p>}
      {r.ok && issues.length > 0 && <p class="ok">✓ Readable. Letters that look a lot like another one:</p>}
      {issues.length > 0 && <ul class="small">
        {issues.map(l => <li key={l.n}>Letter {l.n} <T pack={pack} text={l.ch} />: {
          l.status === 'missing' ? 'missing' : l.status === 'unclear' ? 'not clear enough to read'
          : <>{l.status === 'close' ? 'could be read as' : 'looks like'} <T pack={pack} text={l.looksLike ?? ''} /></>}</li>)}
        {r.extra > 0 && <li>{r.extra === 1 ? '1 extra mark that doesn\'t' : `${r.extra} extra marks that don't`} belong to any letter</li>}
      </ul>}
      {issues.some(l => l.sh) && <LearnButton label="I wrote these letters right: learn my handwriting"
        onLearn={async () => { for (const l of issues) if (l.sh) await learnLetter(pack, l.ch, l.sh) }} />}
    </div>
  )
}

function LearnButton({ onLearn, label = 'I wrote it right: learn my handwriting' }: { onLearn: () => Promise<void>; label?: string }) {
  const [done, setDone] = useState(false)
  return done ? <p class="muted small">Saved. The checker will compare against your own writing from now on.</p>
    : <button class="link small" onClick={async () => { await onLearn(); setDone(true) }}>{label}</button>
}

export const WORD_ASPECT = 3
/** Practise writing a word or sentence from memory; checked letter by letter (printed scripts only). */
export function WriteWord({ pack, text, en }: { pack: Pack; text: string; en: string }) {
  const [open, setOpen] = useState(false)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [r, setR] = useState<WordResult | null | undefined>(undefined)
  useEffect(() => { if (open) warmTemplates(pack) }, [open])
  if (!open) return <button class="btn small" onClick={() => setOpen(true)}>✍︎ Write this from memory</button>
  return (
    <div class="writeword">
      <p class="small">Write <b>{en}</b> on one line, without vowel points:</p>
      <WritePad pack={pack} strokes={strokes} onChange={x => { setStrokes(x); setR(undefined) }} aspect={WORD_ASPECT} />
      <div class="hwrow"><button class="btn primary small" disabled={!strokes.length} onClick={async () => setR(await checkWord(pack, text, strokes, WORD_ASPECT))}>Check</button></div>
      {r !== undefined && <><WordVerdict pack={pack} r={r} /><p><T pack={pack} text={text} big /></p></>}
    </div>
  )
}
