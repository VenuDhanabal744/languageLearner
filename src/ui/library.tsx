import { useEffect, useState } from 'preact/hooks'
import { parseRef, wordById, grammarById, scriptById, textById, textMinutes } from '../logic'
import { startRecording, playBlob, type ActiveRecording } from '../audio/recorder'
import * as store from '../store/db'
import { useApp, Screen, T, Rich, Speak } from './common'
import { Intro, ReaderView, HvptRunner } from './session'

export function Library({ lang }: { lang?: string }) {
  const { w, nav } = useApp()
  const l = lang ?? Object.keys(w.packs)[0]
  const pack = w.packs[l]
  if (!pack) return <Screen title="Library"><p>No pack loaded.</p></Screen>
  const prog = w.progress[l]
  return (
    <Screen title="Library">
      <p class="muted small">{pack.name} · v{pack.version}</p>
      <div class="grid2">
        <button class="btn" onClick={() => nav({ name: 'browse', lang: l, what: 'grammar' })}>Grammar</button>
        <button class="btn" onClick={() => nav({ name: 'browse', lang: l, what: 'texts' })}>Readers</button>
        <button class="btn" onClick={() => nav({ name: 'browse', lang: l, what: 'words' })}>Words</button>
        <button class="btn" onClick={() => nav({ name: 'sounds', lang: l })}>Sounds (HVPT)</button>
        <button class="btn" onClick={() => nav({ name: 'roots', lang: l })}>Roots</button>
        <button class="btn" onClick={() => nav({ name: 'notes', lang: l })}>About this pack</button>
        <button class="btn" onClick={() => nav({ name: 'research' })}>Why it works</button>
      </div>
      <h2>Course</h2>
      {pack.units.map(u => {
        const done = u.items.filter(r => prog.introduced.includes(r)).length
        return <button key={u.id} class="row" onClick={() => nav({ name: 'unit', lang: l, id: u.id })}>
          <span>{u.title}<br /><small class="muted">{u.goal}</small></span><span class="muted small">{done}/{u.items.length}</span></button>
      })}
    </Screen>
  )
}

function itemLabel(w: ReturnType<typeof useApp>['w'], lang: string, ref: string) {
  const p = w.packs[lang], [k, id] = parseRef(ref)
  if (k === 'word') { const x = wordById(p, id); return x ? <><T pack={p} text={x.text} /> <span class="muted small">{x.en}</span></> : ref }
  if (k === 'grammar') return <>📐 {grammarById(p, id)?.title}</>
  if (k === 'script') return <>✍️ {scriptById(p, id)?.title}</>
  if (k === 'text') return <>📖 {textById(p, id)?.title}</>
  return ref
}

export function UnitView({ lang, id }: { lang: string; id: string }) {
  const { w, nav } = useApp()
  const u = w.packs[lang].units.find(x => x.id === id)!
  const prog = w.progress[lang]
  return (
    <Screen title={u.title} back>
      <p class="muted">{u.goal}</p>
      <p class="small muted">The session builder teaches these in order; you can also preview anything here.</p>
      {u.items.map(r => <button key={r} class="row" onClick={() => nav({ name: 'item', lang, ref: r })}><span>{itemLabel(w, lang, r)}</span><span>{prog.introduced.includes(r) ? '✓' : ''}</span></button>)}
    </Screen>
  )
}

export function ItemView({ lang, refStr }: { lang: string; refStr: string }) {
  const { w } = useApp()
  return <Screen title="" back><Intro w={w} pack={w.packs[lang]} refStr={refStr} /></Screen>
}

export function Browse({ lang, what }: { lang: string; what: 'grammar' | 'texts' | 'words' }) {
  const { w, nav } = useApp()
  const p = w.packs[lang]
  const [q, setQ] = useState('')
  if (what === 'grammar') return <Screen title="Grammar" back>{p.grammar.map(g => <button key={g.id} class="row" onClick={() => nav({ name: 'item', lang, ref: 'grammar:' + g.id })}>{g.title}</button>)}</Screen>
  if (what === 'texts') return <Screen title="Readers" back>{p.texts.map(t => <button key={t.id} class="row" onClick={() => nav({ name: 'reader', lang, id: t.id })}><span>{t.title}</span><span class="muted small">{t.level} · {t.v === 'msa' ? 'MSA' : 'Lev'} · {textMinutes(t)}m</span></button>)}</Screen>
  const words = p.words.filter(x => !q || x.en.toLowerCase().includes(q.toLowerCase()) || x.tr.includes(q) || x.text.includes(q))
  return (
    <Screen title={`Words (${p.words.length})`} back>
      <input class="type" placeholder="Search English, transliteration or script" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} />
      {words.map(x => <button key={x.id} class="row" onClick={() => nav({ name: 'item', lang, ref: 'word:' + x.id })}><span><T pack={p} text={x.text} /> <span class="tr small">{x.tr}</span></span><span class="small muted">{x.en}</span></button>)}
    </Screen>
  )
}

export function ReaderScreen({ lang, id }: { lang: string; id: string }) {
  const { w } = useApp()
  const p = w.packs[lang]
  return <Screen title="" back><ReaderView w={w} pack={p} text={textById(p, id)!} /></Screen>
}

export function Sounds({ lang, id }: { lang: string; id?: string }) {
  const { w, nav, back } = useApp()
  const p = w.packs[lang], prog = w.progress[lang]
  const [mode, setMode] = useState<'list' | 'speaker'>('list')
  if (id) return <Screen title="Sound training" back><HvptRunner w={w} pack={p} contrastId={id} onDone={back} /></Screen>
  if (mode === 'speaker') return <Screen title="Add a speaker" back><AddSpeaker lang={lang} onDone={() => setMode('list')} /></Screen>
  return (
    <Screen title="Sounds" back>
      <p class="small">High-variability training: hear many words from many voices, choose, get instant feedback.</p>
      {p.contrasts.map(c => {
        const r = prog.hvpt[c.id] ?? []
        return <button key={c.id} class="row" onClick={() => nav({ name: 'sounds', lang, id: c.id })}><span>{c.title}</span><span class="small muted">{r.length ? `${Math.round(100 * r.reduce((a, b) => a + b, 0) / r.length)}% recent` : 'not started'}</span></button>
      })}
      <h2>More voices = better training</h2>
      <p class="small">Your phone has one built-in voice for this language. Ask a native-speaker friend to record the word lists once; their voice is then mixed into every trial. The recordings stay on your phone and in your backups.</p>
      <button class="btn" onClick={() => setMode('speaker')}>🎙 Add a speaker</button>
    </Screen>
  )
}

function AddSpeaker({ lang, onDone }: { lang: string; onDone: () => void }) {
  const { w } = useApp()
  const p = w.packs[lang]
  const [name, setName] = useState('')
  const [cid, setCid] = useState(p.contrasts[0].id)
  const [i, setI] = useState(0)
  const [rec, setRec] = useState<ActiveRecording | null>(null)
  const [have, setHave] = useState<Record<string, Blob>>({})
  const c = p.contrasts.find(x => x.id === cid)!
  const item = c.items[i]
  useEffect(() => () => rec?.cancel(), [rec])
  if (!name) return <div class="card"><p>Speaker's name or initials (used to label their voice):</p>
    <input class="type" id="spk" /><button class="btn primary" onClick={() => setName((document.getElementById('spk') as HTMLInputElement).value.trim() || 'Speaker')}>Start</button></div>
  return (
    <div class="card">
      <select value={cid} onChange={e => { setCid((e.target as HTMLSelectElement).value); setI(0) }}>{p.contrasts.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
      {item ? <>
        <p class="muted small">{name}, please read aloud ({i + 1}/{c.items.length}):</p>
        <p><T pack={p} text={item.text} big /> <span class="tr">{item.tr}</span> · {item.en}</p>
        {!rec ? <button class="btn rec" onClick={async () => setRec(await startRecording())}>● Record</button>
          : <button class="btn rec on" onClick={async () => {
            const r = await rec.stop(); setRec(null)
            await store.putRecording({ id: `${lang}:hvpt:${cid}:${item.id}:${name}`, lang, ref: `hvpt:${cid}:${item.id}`, talker: name, mime: r.mime, at: new Date(), durationSec: r.seconds, blob: r.blob })
            setHave({ ...have, [item.id]: r.blob })
          }}>■ Stop</button>}
        {have[item.id] && <><button class="btn" onClick={() => playBlob(have[item.id])}>▶︎ Check</button><button class="btn primary" onClick={() => setI(i + 1)}>Next →</button></>}
      </> : <><p class="ok">✓ {c.title} recorded by {name}.</p><button class="btn primary" onClick={onDone}>Done</button></>}
    </div>
  )
}

export function Roots({ lang }: { lang: string }) {
  const { w } = useApp()
  const p = w.packs[lang]
  const groups = new Map<string, typeof p.words>()
  for (const x of p.words) if (x.root) (groups.get(x.root) ?? groups.set(x.root, []).get(x.root)!).push(x)
  const fam = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  const linkFor = (root: string) => w.links.find(l => l.items.some(i => i.lang === lang && i.tr === root))
  return (
    <Screen title="Root families" back>
      <p class="small">One root, many words. Learn to spot the three letters and new words get easier.</p>
      {fam.map(([root, ws]) => {
        const link = linkFor(root)
        return <div class="card" key={root}><h3>{root}</h3>
          {ws.map(x => <p key={x.id}><T pack={p} text={x.text} /> <span class="tr">{x.tr}</span> · {x.en}{x.pattern && <span class="muted small"> · {x.pattern}</span>}</p>)}
          {link && <p class="small">🔗 {link.items.filter(i => i.lang !== lang).map(i => <span key={i.lang}>{i.lang === 'he' ? 'Hebrew' : i.lang} <span lang={i.lang} dir="auto">{i.text}</span> ({i.tr}): {i.en}</span>)}</p>}
        </div>
      })}
      <h2>Arabic ↔ Hebrew links</h2>
      {w.links.filter(l => l.items.some(i => i.lang === lang)).map(l => <p key={l.id} class="small">{l.note}: {l.items.map(i => <span key={i.lang}><span lang={i.lang} dir="auto">{i.text}</span> ({i.tr}) </span>)}</p>)}
    </Screen>
  )
}

export function ConceptView({ id }: { id: string }) {
  const { w } = useApp()
  const c = w.concepts.find(x => x.id === id)!
  return <Screen title={c.title} back>{c.body.map((b, i) => <p key={i}><Rich text={b} /></p>)}
    <h2>In each language</h2>{Object.entries(c.langs).map(([l, t]) => <p key={l}><b>{w.index.find(e => e.id === l)?.name ?? l}:</b> {t}</p>)}</Screen>
}

export function ResearchView() {
  const { w } = useApp()
  return <Screen title="Why the app works this way" back>
    <p class="small muted">Evidence labels: strong = multiple meta-analyses or robust replication; moderate = consistent but limited; debated = mixed. Not included: learning styles, streaks, XP.</p>
    {w.research.map(r => <div class="card" key={r.id}><h3>{r.title} <span class="pill">{r.evidence}</span></h3><p>{r.why}</p><p class="muted small">Caveat: {r.caveat}</p>{r.sources.length > 0 && <p class="muted small">{r.sources.join(' · ')}</p>}</div>)}
    <h2>Shared grammar concepts</h2>
    {w.concepts.map(c => <ConceptLink key={c.id} id={c.id} title={c.title} />)}
  </Screen>
}
function ConceptLink({ id, title }: { id: string; title: string }) { const { nav } = useApp(); return <button class="row" onClick={() => nav({ name: 'concept', id })}>{title}</button> }

export function Notes({ lang }: { lang: string }) {
  const { w } = useApp()
  const p = w.packs[lang]
  return <Screen title="About this pack" back>
    {(p.notes ?? []).map(n => <div class="card" key={n.title}><h3>{n.title}</h3>{n.body.map((b, i) => <p key={i}><Rich text={b} /></p>)}</div>)}
    <div class="card"><h3>Audio</h3><p>{p.ttsNote}</p><Speak pack={p} text={p.words[0]?.ex.text ?? ''} label="▶︎ Test the voice" /></div>
    {p.frequency && <div class="card"><h3>Frequency data</h3><p class="small">{p.frequency.source}. {p.frequency.note}</p></div>}
  </Screen>
}
