import { useEffect, useState } from 'preact/hooks'
import { getAllCards } from '../store/db'
import type { CardRow } from '../engine/backup'
import { dueCount, currentUnitIndex } from '../logic'
import { computeMetrics } from '../engine/metrics'
import { useApp, Screen } from './common'
import { getSyncConfig, type SyncConfig } from '../sync'

export const isStandalone = () => (navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches

export function Today() {
  const { w, nav } = useApp()
  const [cards, setCards] = useState<CardRow[]>([])
  const [sync, setSync] = useState<SyncConfig | undefined>()
  useEffect(() => { getAllCards().then(setCards); getSyncConfig().then(setSync) }, [w])
  const active = Object.keys(w.packs).filter(l => w.settings.langs[l] === 'active')
  const maint = Object.keys(w.packs).filter(l => w.settings.langs[l] === 'maintenance')
  const daysSinceBackup = w.settings.lastBackup ? (Date.now() - +new Date(w.settings.lastBackup)) / 864e5 : Infinity
  return (
    <Screen title="Today">
      {!isStandalone() && (
        <div class="card warnbox small">
          <b>Install this app:</b> tap Share → <b>Add to Home Screen</b>, then open it from the icon. Safari can erase data in an
          ordinary tab after 7 days without use, and the home-screen app keeps separate storage, so start using it from the icon.
        </div>
      )}
      {sync?.lastError && <div class="card warnbox small">Sync: {sync.lastError} <button class="link" onClick={() => nav({ name: 'settings' })}>Settings</button></div>}
      {sync?.lastSync && !sync.lastError && <p class="muted small">↻ Synced {new Date(sync.lastSync).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</p>}
      {!sync && cards.length > 20 && daysSinceBackup > 7 && (
        <div class="card soft small">It's been {daysSinceBackup === Infinity ? 'a while' : `${Math.floor(daysSinceBackup)} days`} since your last backup.{' '}
          <button class="link" onClick={() => nav({ name: 'settings' })}>Back up now</button></div>
      )}
      <p class="muted">How much time do you have?</p>
      <div class="minutes">
        {[5, 15, 30, 60].map(m => <button key={m} class="btn big" onClick={() => nav({ name: 'session', minutes: m })}>{m}<small>min</small></button>)}
      </div>
      {active.map(l => {
        const p = w.packs[l], u = p.units[currentUnitIndex(p, w.progress[l])]
        const m = computeMetrics(cards, [], [], new Date(), l)
        return (
          <div class="card" key={l}>
            <h2>{p.name}</h2>
            <p class="small">{dueCount(cards, l)} reviews due · {m.wordsLearning + m.wordsKnown} words started, {m.wordsKnown} known · now in <b>{u?.title}</b></p>
            <button class="btn" onClick={() => nav({ name: 'conversation', lang: l })}>💬 Conversation session</button>
            <button class="btn" onClick={() => nav({ name: 'library', lang: l })}>Library</button>
          </div>
        )
      })}
      {maint.length > 0 && <p class="small muted">Maintenance (reviews only, ≤2 min/day): {maint.map(l => w.packs[l].name).join(', ')}</p>}
      {active.length === 0 && <p>No active language. <button class="link" onClick={() => nav({ name: 'languages' })}>Choose one</button></p>}
    </Screen>
  )
}
