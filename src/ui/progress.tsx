import { useEffect, useState } from 'preact/hooks'
import * as store from '../store/db'
import type { CardRow, EventRow, LogRow } from '../engine/backup'
import { computeMetrics, type Metrics } from '../engine/metrics'
import { corpusCoverage, parseFrequency, textCoverage } from '../engine/coverage'
import { frequencyUrl, learnedWordIds } from '../logic'
import { useApp, Screen, Why } from './common'

export function ProgressScreen() {
  const { w } = useApp()
  const [data, setData] = useState<{ cards: CardRow[]; logs: LogRow[]; events: EventRow[] } | null>(null)
  const [corpus, setCorpus] = useState<Record<string, number>>({})
  useEffect(() => {
    Promise.all([store.getAllCards(), store.getLogs(), store.getEvents()]).then(([cards, logs, events]) => {
      setData({ cards, logs, events })
      for (const [l, p] of Object.entries(w.packs)) if (p.frequency) {
        fetch(frequencyUrl(l, p.frequency.file)).then(r => r.text()).then(t =>
          setCorpus(c => ({ ...c, [l]: corpusCoverage(p, parseFrequency(t), learnedWordIds(cards, l)) })))
      }
    })
  }, [])
  if (!data) return <Screen title="Progress"><p>…</p></Screen>
  const all = computeMetrics(data.cards, data.logs, data.events)
  return (
    <Screen title="Progress">
      <p class="small muted">Measures of learning, not of opening the app. No streaks.</p>
      <Why id="metrics" />
      <MetricBlock m={all} />
      <Bars m={all} />
      {Object.entries(w.packs).map(([l, p]) => {
        const m = computeMetrics(data.cards, data.logs, data.events, new Date(), l)
        const learned = learnedWordIds(data.cards, l)
        const covs = p.texts.map(t => ({ t, c: textCoverage(p, t, learned).ratio }))
        const readable = covs.filter(x => x.c >= 0.95).length
        return (
          <div class="card" key={l}>
            <h2>{p.name}</h2>
            <MetricBlock m={m} />
            {corpus[l] !== undefined && <p class="small">Estimated coverage of real {p.id === 'ar' ? 'MSA-leaning (subtitle) Arabic' : 'text'}: <b>{Math.round(corpus[l] * 100)}%</b> of running words. <span class="muted">({p.frequency?.source}. Surface-form matching, so treat it as a rough estimate.)</span></p>}
            <p class="small">Pack texts you can read at ≥95% coverage: <b>{readable}/{p.texts.length}</b></p>
          </div>
        )
      })}
    </Screen>
  )
}

function MetricBlock({ m }: { m: Metrics }) {
  const f = (x: number) => x < 10 ? x.toFixed(1) : Math.round(x)
  return (
    <div class="metrics">
      <div><b>{m.wordsKnown}</b><small>words known (≥21-day memory)</small></div>
      <div><b>{m.wordsLearning}</b><small>words learning</small></div>
      <div><b>{m.retention30 === null ? '–' : Math.round(m.retention30 * 100) + '%'}</b><small>true retention, 30 d ({m.matureReviews30} reviews)</small></div>
      <div><b>{f(m.speakMin7)}</b><small>min speaking, 7 d ({f(m.speakMinAll)} total)</small></div>
      <div><b>{f(m.listenMin7)}</b><small>min listening, 7 d ({f(m.listenMinAll)} total)</small></div>
      <div><b>{f(m.readMin7)}</b><small>min reading, 7 d</small></div>
    </div>
  )
}

function Bars({ m }: { m: Metrics }) {
  const max = Math.max(5, ...m.daily.map(d => d.minutes))
  return (
    <div class="bars" aria-label="Minutes of logged practice per day, last 14 days">
      {m.daily.map(d => <div key={d.day} class="bar" title={`${d.day}: ${Math.round(d.minutes)} min`}><span style={{ height: `${(d.minutes / max) * 100}%` }} /><small>{d.day.slice(3)}</small></div>)}
      <p class="small muted">Logged speaking, listening, reading and sound training per day (minutes). Missing days are fine.</p>
    </div>
  )
}
