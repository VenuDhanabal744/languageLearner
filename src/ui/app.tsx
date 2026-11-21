import { useEffect, useState } from 'preact/hooks'
import { loadWorld, type World } from '../logic'
import { loadVoices } from '../audio/tts'
import { AppCtx, type Route } from './common'
import { Today } from './today'
import { SessionScreen } from './session'
import { Library, UnitView, ItemView, Browse, ReaderScreen, Sounds, Roots, ConceptView, ResearchView, Notes } from './library'
import { ProgressScreen } from './progress'
import { SettingsScreen, Languages, Diagnostics } from './settings'
import { Conversation } from './conversation'

export function App() {
  const [w, setW] = useState<World | null>(null)
  const [err, setErr] = useState('')
  const [stack, setStack] = useState<Route[]>([{ name: 'today' }])
  const [, setTick] = useState(0)
  useEffect(() => {
    loadWorld().then(setW).catch(e => setErr(String(e?.message ?? e)))
    loadVoices()
    navigator.storage?.persist?.() // iOS 17+ grants this automatically for home-screen apps
  }, [])
  if (err) return <main class="screen"><h1>Couldn't start</h1><pre class="small">{err}</pre></main>
  if (!w) return <main class="screen"><p>Loading…</p></main>
  const route = stack[stack.length - 1]
  const nav = (r: Route) => { setStack(['today', 'library', 'progress', 'settings'].includes(r.name) ? [r] : [...stack, r]); scrollTo(0, 0) }
  const back = () => setStack(stack.length > 1 ? stack.slice(0, -1) : stack)
  const ctx = { w, refresh: () => setTick(t => t + 1), nav, back }
  const tab = (name: Route['name'], label: string, icon: string) =>
    <button class={`tab ${stack[0].name === name ? 'on' : ''}`} onClick={() => nav({ name } as Route)}><span>{icon}</span>{label}</button>
  return (
    <AppCtx.Provider value={ctx}>
      {render(route)}
      {route.name !== 'session' && <nav class="tabs">{tab('today', 'Today', '☀︎')}{tab('library', 'Library', '▤')}{tab('progress', 'Progress', '↗︎')}{tab('settings', 'Settings', '⚙︎')}</nav>}
    </AppCtx.Provider>
  )
}

function render(r: Route) {
  switch (r.name) {
    case 'today': return <Today />
    case 'session': return <SessionScreen minutes={r.minutes} />
    case 'library': return <Library lang={r.lang} />
    case 'unit': return <UnitView lang={r.lang} id={r.id} />
    case 'item': return <ItemView lang={r.lang} refStr={r.ref} />
    case 'browse': return <Browse lang={r.lang} what={r.what} />
    case 'reader': return <ReaderScreen lang={r.lang} id={r.id} />
    case 'sounds': return <Sounds lang={r.lang} id={r.id} />
    case 'roots': return <Roots lang={r.lang} />
    case 'concept': return <ConceptView id={r.id} />
    case 'research': return <ResearchView />
    case 'notes': return <Notes lang={r.lang} />
    case 'progress': return <ProgressScreen />
    case 'settings': return <SettingsScreen />
    case 'languages': return <Languages />
    case 'diagnostics': return <Diagnostics />
    case 'conversation': return <Conversation lang={r.lang} />
  }
}
