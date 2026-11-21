import { useEffect, useState } from 'preact/hooks'
import { buildConversationPrompt, parseMistakes, type Mistake } from '../engine/conversation'
import { addMistakeCards, currentUnitIndex, grammarById, learnedWordIds, parseRef, showTranslit, wordById } from '../logic'
import { getAllCards } from '../store/db'
import { useApp, Screen, T } from './common'

export function Conversation({ lang }: { lang: string }) {
  const { w } = useApp()
  const pack = w.packs[lang], prog = w.progress[lang]
  const [scId, setScId] = useState(pack.scenarios[0]?.id)
  const [known, setKnown] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [paste, setPaste] = useState('')
  const [parsed, setParsed] = useState<Mistake[] | null>(null)
  const [added, setAdded] = useState(0)
  useEffect(() => { getAllCards(lang).then(cs => setKnown(learnedWordIds(cs, lang))) }, [])
  const sc = pack.scenarios.find(s => s.id === scId)!
  const unit = currentUnitIndex(pack, prog)
  const grammar = prog.introduced.filter(r => r.startsWith('grammar:')).slice(-5).map(r => grammarById(pack, parseRef(r)[1])?.title ?? '')
  const words = [...known].reverse().map(id => wordById(pack, id)).filter(Boolean).map(x => ({ text: x!.text, tr: x!.tr, en: x!.en }))
  const prompt = buildConversationPrompt({
    language: pack.id === 'ar' ? 'Levantine Arabic (Shami, Damascus/Beirut)' : pack.name,
    level: `beginner, unit ${unit + 1} of ${pack.units.length} (“${pack.units[unit]?.title}”), about ${known.length} words learned`,
    showTranslit: showTranslit(w.settings, pack, prog, 'prompt'), knownWords: words, grammar, scenario: sc,
  })
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true) } catch {
      const ta = document.getElementById('conv-prompt') as HTMLTextAreaElement; ta.select(); document.execCommand('copy'); setCopied(true)
    }
  }
  return (
    <Screen title="Conversation session" back>
      <p class="small">1 · Pick a scenario. 2 · Copy the prompt and paste it into your Claude chat. Use the Claude app's voice mode to actually speak. 3 · Type <b>END</b> when done, copy Claude's MISTAKES block, and paste it below.</p>
      <select value={scId} onChange={e => { setScId((e.target as HTMLSelectElement).value); setCopied(false) }}>
        {pack.scenarios.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
      </select>
      <textarea id="conv-prompt" class="mono" rows={8} readOnly value={prompt} />
      <button class="btn primary big" onClick={copy}>{copied ? '✓ Copied' : 'Copy prompt'}</button>
      <a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Open Claude ↗</a>
      <h2>Paste the mistakes back</h2>
      <textarea rows={6} placeholder={'MISTAKES\nsaid | correct | note'} value={paste} onInput={e => { setPaste((e.target as HTMLTextAreaElement).value); setParsed(null); setAdded(0) }} />
      <button class="btn" onClick={() => setParsed(parseMistakes(paste))}>Check</button>
      {parsed && (parsed.length === 0 ? <p class="warn">No lines in the form "said | correct | note" found.</p> : <>
        <ul class="small">{parsed.map((m, i) => <li key={i}><span class="strike"><T pack={pack} text={m.said} /></span> → <T pack={pack} text={m.correct} /> <span class="muted">{m.note}</span></li>)}</ul>
        {added ? <p class="ok">✓ {added} review cards added. They'll show up in your next session.</p>
          : <button class="btn primary" onClick={async () => setAdded(await addMistakeCards(w, lang, parsed))}>Make {parsed.length} review cards</button>}
      </>)}
    </Screen>
  )
}
