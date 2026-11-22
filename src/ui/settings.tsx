import { useEffect, useState } from 'preact/hooks'
import * as store from '../store/db'
import { makeBackup, parseBackup, backupFileName, type FlagRow } from '../engine/backup'
import { buildDailyIcs } from '../engine/ics'
import { saveSettings, ensurePack, type LangStatus } from '../logic'
import { loadVoices, voicesFor, speak } from '../audio/tts'
import { startRecording, playBlob } from '../audio/recorder'
import { useApp, Screen } from './common'
import { isStandalone } from './today'
import { getSyncConfig, setSyncConfig, syncNow, type SyncConfig } from '../sync'
import { handwritingOn, setHandwriting } from './handwriting'

async function shareOrDownload(name: string, type: string, text: string) {
  const file = new File([text], name, { type })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true } catch (e) { if ((e as Error).name === 'AbortError') return false }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  return true
}

export function SettingsScreen() {
  const { w, refresh, nav } = useApp()
  const s = w.settings
  const set = async (patch: Partial<typeof s>) => { Object.assign(s, patch); await saveSettings(s); refresh() }
  const [msg, setMsg] = useState('')
  const [withRec, setWithRec] = useState(false)
  const [flags, setFlags] = useState<FlagRow[]>([])
  useEffect(() => { store.getFlags().then(setFlags) }, [])

  const exportNow = async () => {
    setMsg('Preparing…')
    const data = await store.collectBackup(withRec)
    const ok = await shareOrDownload(backupFileName(), 'application/json', makeBackup(data))
    if (ok) { await set({ lastBackup: new Date().toISOString() }); setMsg(`✓ Backup made: ${data.cards.length} cards, ${data.logs.length} reviews. Save it to Files / iCloud Drive.`) }
    else setMsg('Cancelled.')
  }
  const importFile = async (f: File) => {
    try {
      const b = parseBackup(await f.text())
      if (!confirm(`Replace ALL data on this device with this backup (${b.cards.length} cards, ${b.logs.length} reviews)? This can't be undone.`)) return
      await store.restoreBackup(b)
      setMsg('✓ Restored. Reloading…'); setTimeout(() => location.reload(), 800)
    } catch (e) { setMsg('✗ ' + (e as Error).message) }
  }

  return (
    <Screen title="Settings">
      <SyncSection />

      <h2>Backup</h2>
      <p class="small">Your progress lives on this device (and in your private sync repo if you set one up). A backup file is a second copy: keep it in Files / iCloud Drive.</p>
      <label class="check"><input type="checkbox" checked={withRec} onChange={e => setWithRec((e.target as HTMLInputElement).checked)} /> include my shadowing recordings (bigger file; friends' speaker recordings are always included)</label>
      <button class="btn primary" onClick={exportNow}>⬆︎ Export backup</button>
      <label class="btn">⬇︎ Import backup<input type="file" accept="application/json,.json" hidden onChange={e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importFile(f) }} /></label>
      {msg && <p class="small">{msg}</p>}
      {s.lastBackup && <p class="muted small">Last backup: {new Date(s.lastBackup).toLocaleString()}</p>}

      <h2>Languages</h2>
      <button class="btn" onClick={() => nav({ name: 'languages' })}>Choose active / maintenance / queued</button>

      <h2>Study</h2>
      <label class="check"><input type="checkbox" checked={s.vowels} onChange={e => set({ vowels: (e.target as HTMLInputElement).checked })} /> Show vowel marks (harakat, niqqud, Latin macrons, Greek accents)</label>
      <label>Transliteration <select value={s.translit} onChange={e => set({ translit: (e.target as HTMLSelectElement).value as any })}>
        <option value="auto">Fade out after the script course</option><option value="always">Always</option><option value="never">Never</option></select></label>
      <label>Target retention: {Math.round(s.retention * 100)}% <input type="range" min="0.8" max="0.95" step="0.01" value={s.retention} onChange={e => set({ retention: Number((e.target as HTMLInputElement).value) })} /></label>
      <p class="muted small">Higher = more reviews. 90% is the usual sweet spot. Maintenance languages use {Math.round(s.maintenanceRetention * 100)}%.</p>
      <label>New words per day (max): <input type="number" min="0" max="50" value={s.newWordCap} onChange={e => set({ newWordCap: Number((e.target as HTMLInputElement).value) || 0 })} /></label>
      <label class="check"><input type="checkbox" checked={handwritingOn()} onChange={e => { setHandwriting((e.target as HTMLInputElement).checked); refresh() }} /> Handwriting practice (Apple Pencil or finger). This device only; on by default on iPad.</label>
      <p class="muted small">Letters are checked automatically against the script course. Whole words are shown next to the answer so you can compare them yourself. On iPad, Arabic and Latin answer boxes also accept Pencil writing directly (Scribble); for Arabic, add the Arabic keyboard in iPad Settings → General → Keyboard.</p>

      <h2>Daily reminder</h2>
      <p class="small">Web push needs a server (not free), so the reminder is a repeating calendar event on your phone.</p>
      <label>Time <input type="time" value={`${String(s.reminder.hour).padStart(2, '0')}:${String(s.reminder.minute).padStart(2, '0')}`}
        onChange={e => { const [h, m] = (e.target as HTMLInputElement).value.split(':').map(Number); set({ reminder: { hour: h, minute: m } }) }} /></label>
      <button class="btn" onClick={() => shareOrDownload('language-reminder.ics', 'text/calendar', buildDailyIcs({ ...s.reminder, url: location.origin + location.pathname }))}>📅 Add daily reminder to Calendar</button>
      <details class="small"><summary>Or use the Shortcuts app</summary><ol><li>Shortcuts → Automation → + → Time of Day → pick a time → Daily.</li><li>Add the action <b>Show Notification</b> with the text "Language practice".</li><li>Turn off "Ask Before Running".</li></ol></details>

      <h2>Flagged content ({flags.length})</h2>
      {flags.length > 0 && <>
        <textarea class="mono" rows={5} readOnly value={flags.map(f => `[${f.lang}] ${f.ref}: ${f.note}${f.text ? ` | ${f.text}` : ''}`).join('\n')} />
        <p class="small muted">Copy these into a Claude chat with the pack file to get fixes.</p>
        <button class="btn small" onClick={async () => { for (const f of flags) await store.deleteFlag(f.id!); setFlags([]) }}>Clear flags</button>
      </>}

      <h2>About</h2>
      <button class="btn" onClick={() => nav({ name: 'diagnostics' })}>Diagnostics (mic, voices, storage, fonts)</button>
      <button class="btn" onClick={() => nav({ name: 'research' })}>Why the app works this way</button>
    </Screen>
  )
}

const SEQUENCE = [
  ['ar', 'la'], ['he', 'grc'], ['zh'], ['ta', 'sa'],
]
export function Languages() {
  const { w, refresh } = useApp()
  const s = w.settings
  const active = Object.entries(s.langs).filter(([, v]) => v === 'active').length
  const setStatus = async (id: string, st: LangStatus) => {
    s.langs = { ...s.langs, [id]: st }
    if (st !== 'queued') await ensurePack(w, id)
    await saveSettings(s); refresh()
  }
  return (
    <Screen title="Languages" back>
      <p class="small"><b>Recommendation:</b> 1 living language + at most 1 classical reading language active at a time. Others in maintenance (reviews only, ≤2 min/day) or queued.</p>
      <p class="small muted">Suggested order: {SEQUENCE.map(g => g.map(id => w.index.find(e => e.id === id)?.name.split(' (')[0]).join(' + ')).join(' → ')}. Arabic first (your priority) with Latin (cheap thanks to Spanish, reading-based). Hebrew when Arabic reaches ~A2/B1, since roots transfer. Greek after Latin's basics, since cases transfer. Mandarin gets its own slot (biggest time cost). Sanskrit after Latin/Greek, with links to Tamil.</p>
      {active > 2 && <p class="warn small">You have {active} active languages. That's allowed, but each gets less time per session.</p>}
      {w.index.map(e => (
        <div class="row" key={e.id}>
          <span>{e.name}<br /><small class="muted" lang={e.id}>{e.native}</small></span>
          {e.status === 'available'
            ? <select value={s.langs[e.id] ?? 'queued'} onChange={ev => setStatus(e.id, (ev.target as HTMLSelectElement).value as LangStatus)}>
                <option value="active">active</option><option value="maintenance">maintenance</option><option value="queued">queued</option></select>
            : <span class="muted small">pack coming</span>}
        </div>
      ))}
    </Screen>
  )
}

const SAMPLES: [string, string, string, 'rtl' | 'ltr'][] = [
  ['ar', 'Arabic', 'مَرحَبا، كِيفَك؟ العَرَبِيَّةُ جَمِيلَةٌ', 'rtl'],
  ['he', 'Hebrew (niqqud)', 'שָׁלוֹם, מָה שְׁלוֹמְךָ?', 'rtl'],
  ['ta', 'Tamil', 'வணக்கம், எப்படி இருக்கீங்க? ழ ள ல', 'ltr'],
  ['sa', 'Devanagari (Sanskrit)', 'संस्कृतम् । क्ष त्र ज्ञ द्ध श्र', 'ltr'],
  ['zh', 'Hanzi (Simplified)', '你好，我学中文。', 'ltr'],
  ['grc', 'Greek polytonic', 'ἐν ἀρχῇ ἦν ὁ λόγος· ᾠδή, ῥήτωρ', 'ltr'],
]
export function Diagnostics() {
  const { w } = useApp()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [persist, setPersist] = useState<string>('…')
  const [est, setEst] = useState('')
  const [mic, setMic] = useState('')
  useEffect(() => {
    loadVoices().then(setVoices)
    navigator.storage?.persisted?.().then(p => setPersist(p ? 'granted ✓' : 'not granted')).catch(() => setPersist('unsupported'))
    navigator.storage?.estimate?.().then(e => setEst(`${((e.usage ?? 0) / 1e6).toFixed(1)} MB used of ~${((e.quota ?? 0) / 1e9).toFixed(1)} GB`))
  }, [])
  const mrTypes = typeof MediaRecorder !== 'undefined' ? ['audio/mp4', 'audio/webm', 'audio/aac'].filter(t => MediaRecorder.isTypeSupported?.(t)).join(', ') || 'none' : 'MediaRecorder missing (WAV fallback)'
  const testMic = async () => {
    try { setMic('Recording 2 s…'); const r = await startRecording(); await new Promise(x => setTimeout(x, 2000)); const out = await r.stop(); setMic(`✓ ${out.mime}, ${out.seconds.toFixed(1)} s. Playing back…`); await playBlob(out.blob); setMic(`✓ Mic works (${out.mime})`) }
    catch (e) { setMic('✗ ' + (e as Error).message) }
  }
  const langs = ['ar', 'he', 'zh', 'ta', 'hi', 'el', 'la', 'it']
  return (
    <Screen title="Diagnostics" back>
      <table class="diag small"><tbody>
        <tr><td>Home-screen app</td><td>{isStandalone() ? 'yes ✓' : 'no: open from the home-screen icon'}</td></tr>
        <tr><td>Persistent storage</td><td>{persist} <button class="link small" onClick={async () => setPersist((await navigator.storage?.persist?.()) ? 'granted ✓' : 'not granted')}>request</button></td></tr>
        <tr><td>Storage</td><td>{est}</td></tr>
        <tr><td>Recording formats</td><td>{mrTypes}</td></tr>
        <tr><td>Speech recognition API</td><td>{'webkitSpeechRecognition' in window || 'SpeechRecognition' in window ? 'present (not used: unreliable in iOS home-screen apps)' : 'absent'}</td></tr>
        <tr><td>Browser</td><td>{navigator.userAgent}</td></tr>
      </tbody></table>
      <button class="btn" onClick={testMic}>🎙 Test microphone</button> <span class="small">{mic}</span>
      <h2>Voices on this device</h2>
      <table class="diag small"><tbody>{langs.map(l => { const v = voicesFor(l); return <tr key={l}><td>{l}</td><td>{v.length ? v.map(x => x.name).join(', ') : <span class="warn">none</span>} {v.length > 0 && <button class="link small" onClick={() => speak(SAMPLES.find(s => s[0] === l)?.[2] ?? 'Salve', l)}>test</button>}</td></tr> })}</tbody></table>
      <p class="muted small">{voices.length} voices total. iOS lists only some voices to web apps; Settings → Accessibility → Spoken Content → Voices can add more, though web apps may not see the enhanced ones.</p>
      <h2>Script rendering</h2>
      {SAMPLES.map(([l, name, txt, dir]) => <p key={l}><span class="muted small">{name}:</span><br /><span lang={l} dir={dir} class={`tl tl-${l} tl-big`}>{txt}</span></p>)}
      <p class="muted small">Check: Arabic letters joined, harakat above/below; Hebrew dots placed; Tamil and Devanagari conjuncts formed; Greek accents and breathings on the right letters.</p>
      <p class="muted small">Loaded packs: {Object.keys(w.packs).join(', ')}</p>
    </Screen>
  )
}

function SyncSection() {
  const [cfg, setCfg] = useState<SyncConfig | undefined>()
  const [repo, setRepo] = useState('VenuDhanabal744/polyglot-data')
  const [token, setToken] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { getSyncConfig().then(setCfg) }, [])
  const go = async (first: boolean) => {
    setBusy(true); setMsg('Syncing…')
    try {
      const r = await syncNow()
      setCfg(await getSyncConfig())
      setMsg(r ? `✓ Synced: ${r.pulled} change${r.pulled === 1 ? '' : 's'} from other devices${r.pushed ? ', this device\'s progress saved' : ''}.` : '')
      if (r?.pulled) setTimeout(() => location.reload(), 900)
    } catch (e) {
      if (first) { await setSyncConfig(undefined); setCfg(undefined) } else setCfg(await getSyncConfig())
      setMsg('✗ ' + (e as Error).message)
    }
    setBusy(false)
  }
  const connect = async () => {
    const r = repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '')
    if (!/^[\w.-]+\/[\w.-]+$/.test(r)) { setMsg('✗ Repo should look like owner/name.'); return }
    if (!token.trim()) { setMsg('✗ Paste the token first.'); return }
    await setSyncConfig({ repo: r, token: token.trim() }); setToken('')
    await go(true)
  }
  return (<>
    <h2>Sync across devices</h2>
    {cfg ? (<>
      <p class="small">This device syncs with your private repo <b>{cfg.repo}</b> when the app opens, when you leave it, and after each session.
        Reviews from every device are merged; nothing is overwritten. Voice recordings stay on the device that made them.</p>
      {cfg.lastSync && <p class="muted small">Last sync: {new Date(cfg.lastSync).toLocaleString()}</p>}
      {cfg.lastError && <p class="warn small">Last attempt failed: {cfg.lastError}</p>}
      <button class="btn primary" disabled={busy} onClick={() => go(false)}>↻ Sync now</button>
      <button class="btn" disabled={busy} onClick={async () => {
        if (!confirm('Stop syncing on this device? Its progress stays here and in the repo; the token is deleted from this device.')) return
        await setSyncConfig(undefined); setCfg(undefined); setMsg('Disconnected.')
      }}>Disconnect this device</button>
    </>) : (<>
      <p class="small">Free, through a private GitHub repo you own. Set it up once, then paste the token on each device (iPhone, iPad, Mac):</p>
      <ol class="small">
        <li>Create a <b>private</b> repo named <b>polyglot-data</b>: <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a>.</li>
        <li>Create a fine-grained token: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Settings → Developer settings → Fine-grained tokens</a>.
          Repository access: <b>Only select repositories → polyglot-data</b>. Permissions: <b>Contents → Read and write</b>. Pick a long expiry.</li>
        <li>Paste it here. It's stored only on this device and is never included in backup files or the synced data.</li>
      </ol>
      <label class="small">Repo <input value={repo} autocapitalize="off" autocorrect="off" spellcheck={false} onInput={e => setRepo((e.target as HTMLInputElement).value)} /></label>
      <label class="small">Token <input type="password" value={token} autocomplete="off" placeholder="github_pat_…" onInput={e => setToken((e.target as HTMLInputElement).value)} /></label>
      <button class="btn primary" disabled={busy} onClick={connect}>Connect and sync</button>
    </>)}
    {msg && <p class="small">{msg}</p>}
  </>)
}
