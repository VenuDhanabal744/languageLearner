import type { CardRow, EventRow, LogRow } from './backup'
import { isLearned, isMature, State } from './scheduler'

export interface Metrics {
  wordsKnown: number      // word production cards that are mature (stability ≥ 21 d)
  wordsLearning: number
  retention30: number | null // pass rate on reviews of graduated cards in the last 30 days
  matureReviews30: number
  reviews7: number
  speakMin7: number; speakMinAll: number
  listenMin7: number; listenMinAll: number
  readMin7: number; readMinAll: number
  daily: { day: string; minutes: number }[] // last 14 days of logged practice minutes
}

const DAY = 86400000

export function computeMetrics(cards: CardRow[], logs: LogRow[], events: EventRow[], now = new Date(), lang?: string): Metrics {
  const C = lang ? cards.filter(c => c.lang === lang) : cards
  const L = lang ? logs.filter(l => l.lang === lang) : logs
  const E = lang ? events.filter(e => e.lang === lang) : events
  const words = C.filter(c => c.kind === 'produce')
  const wordsKnown = words.filter(c => isMature(c.srs)).length
  const wordsLearning = words.filter(c => isLearned(c.srs) && !isMature(c.srs)).length
  const since = (days: number) => +now - days * DAY
  const mature = L.filter(l => +l.at >= since(30) && l.prevState === State.Review)
  const passed = mature.filter(l => l.grade > 1).length
  const mins = (type: EventRow['type'], days?: number) =>
    E.filter(e => e.type === type && (days === undefined || +e.at >= since(days))).reduce((s, e) => s + e.seconds, 0) / 60
  const daily: Metrics['daily'] = []
  for (let i = 13; i >= 0; i--) {
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setTime(+start - i * DAY)
    const end = +start + DAY
    const minutes = E.filter(e => +e.at >= +start && +e.at < end).reduce((s, e) => s + e.seconds, 0) / 60
    daily.push({ day: start.toISOString().slice(5, 10), minutes })
  }
  return {
    wordsKnown, wordsLearning,
    retention30: mature.length ? passed / mature.length : null,
    matureReviews30: mature.length,
    reviews7: L.filter(l => +l.at >= since(7)).length,
    speakMin7: mins('speak', 7), speakMinAll: mins('speak'),
    listenMin7: mins('listen', 7), listenMinAll: mins('listen'),
    readMin7: mins('read', 7), readMinAll: mins('read'),
    daily,
  }
}
