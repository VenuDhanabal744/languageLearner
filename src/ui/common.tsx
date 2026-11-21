import { createContext } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { World } from '../logic'
import { logEvent } from '../logic'
import type { Pack } from '../packs/types'
import { stripVowels, respell } from '../engine/text'
import { speak, voicesFor } from '../audio/tts'
import { startRecording, playBlob, type ActiveRecording, type Recording } from '../audio/recorder'
import { addFlag } from '../store/db'

export type Route =
  | { name: 'today' } | { name: 'session'; minutes: number } | { name: 'library'; lang?: string }
  | { name: 'unit'; lang: string; id: string } | { name: 'item'; lang: string; ref: string }
  | { name: 'reader'; lang: string; id: string } | { name: 'sounds'; lang: string; id?: string }
  | { name: 'roots'; lang: string } | { name: 'concept'; id: string } | { name: 'research' } | { name: 'notes'; lang: string }
  | { name: 'progress' } | { name: 'settings' } | { name: 'languages' } | { name: 'diagnostics' } | { name: 'conversation'; lang: string }
  | { name: 'browse'; lang: string; what: 'grammar' | 'texts' | 'words' }

export interface Ctx { w: World; refresh: () => void; nav: (r: Route) => void; back: () => void }
export const AppCtx = createContext<Ctx>(null as any)
export const useApp = () => useContext(AppCtx)

/** Target-language text: right script direction, language tag, optional vowel stripping. */
export function T({ pack, text, big, className }: { pack: Pack; text: string; big?: boolean; className?: string }) {
  const { w } = useApp()
  const shown = w.settings.vowels ? text : stripVowels(pack, text)
  return <span lang={pack.id} dir={pack.dir} class={`tl tl-${pack.id} ${big ? 'tl-big' : ''} ${className ?? ''}`}>{shown}</span>
}

export function Speak({ pack, text, label = '▶︎', rate, onDone }: { pack: Pack; text: string; label?: string; rate?: number; onDone?: (s: number) => void }) {
  const [busy, setBusy] = useState(false)
  const has = voicesFor(pack.tts).length > 0
  return (
    <button class="btn speak" aria-label={`Play audio`} disabled={busy} title={has ? '' : 'No voice installed for this language'}
      onClick={async () => {
        setBusy(true)
        const secs = await speak(respell(pack, text), pack.tts, { rate })
        setBusy(false)
        if (secs > 0) logEvent({ lang: pack.id, type: 'listen', seconds: secs })
        onDone?.(secs)
      }}>{busy ? '…' : label}{!has && <small> (no voice)</small>}</button>
  )
}

export function Flag({ lang, refId, text }: { lang: string; refId: string; text?: string }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  if (saved) return <span class="muted small">Flagged, thanks.</span>
  if (!open) return <button class="link small" onClick={() => setOpen(true)}>⚑ Flag error</button>
  return (
    <div class="flag">
      <textarea rows={2} placeholder="What looks wrong? (spelling, meaning, not how people say it…)" value={note} onInput={e => setNote((e.target as HTMLTextAreaElement).value)} />
      <button class="btn small" onClick={async () => { await addFlag({ lang, ref: refId, note, text, at: new Date() }); setSaved(true) }}>Save flag</button>
    </div>
  )
}

/** Record yourself and compare with the model: play model → record → play model then you. */
export function RecordCompare({ pack, text, onRecorded }: { pack: Pack; text: string; onRecorded?: (r: Recording) => void }) {
  const [rec, setRec] = useState<ActiveRecording | null>(null)
  const [mine, setMine] = useState<Recording | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => () => rec?.cancel(), [rec])
  return (
    <div class="rc">
      <Speak pack={pack} text={text} label="▶︎ Model" />
      {!rec ? (
        <button class="btn rec" onClick={async () => {
          setErr('')
          try { setRec(await startRecording()) } catch (e) { setErr((e as Error).message || 'Microphone blocked. Allow it in Settings → Safari → Microphone.') }
        }}>● Record</button>
      ) : (
        <button class="btn rec on" onClick={async () => {
          const r = await rec.stop(); setRec(null); setMine(r)
          logEvent({ lang: pack.id, type: 'speak', seconds: r.seconds })
          onRecorded?.(r)
        }}>■ Stop</button>
      )}
      {mine && <button class="btn" onClick={async () => { await speak(respell(pack, text), pack.tts); await playBlob(mine.blob) }}>▶︎ Model + me</button>}
      {mine && <button class="btn" onClick={() => playBlob(mine.blob)}>▶︎ Me</button>}
      {err && <p class="warn small">{err}</p>}
    </div>
  )
}

export function Screen({ title, children, back }: { title: string; children: ComponentChildren; back?: boolean }) {
  const { back: goBack } = useApp()
  return (
    <main class="screen">
      <header class="top">{back && <button class="link" onClick={goBack}>‹ Back</button>}<h1>{title}</h1></header>
      {children}
    </main>
  )
}

export function Rich({ text }: { text: string }) {
  // **bold** only; everything else is plain text (no HTML injection from packs)
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return <>{parts.map((p, i) => p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p)}</>
}

export function Why({ id }: { id: string }) {
  const { w } = useApp()
  const r = w.research.find(x => x.id === id)
  const [open, setOpen] = useState(false)
  if (!r) return null
  return (
    <div class="why">
      <button class="link small" onClick={() => setOpen(!open)}>Why this works ({r.evidence})</button>
      {open && <div class="card soft small"><p>{r.why}</p><p class="muted">Caveat: {r.caveat}</p>{r.sources.length > 0 && <p class="muted">{r.sources.join(' · ')}</p>}</div>}
    </div>
  )
}

export function useTimer(running: boolean) {
  const [t, setT] = useState(0)
  const ref = useRef<number>(0)
  useEffect(() => {
    if (!running) return
    const start = performance.now() - t * 1000
    ref.current = window.setInterval(() => setT((performance.now() - start) / 1000), 250)
    return () => clearInterval(ref.current)
  }, [running])
  return [t, setT] as const
}
