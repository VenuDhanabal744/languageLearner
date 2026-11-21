// Thin wrapper over ts-fsrs (FSRS-7 via DefaultScheduler). Cards are stored as the plain objects ts-fsrs returns.
import { DefaultScheduler, Rating, State } from 'ts-fsrs'

export { Rating, State }
export type Grade = 1 | 2 | 3 | 4
export interface SrsState {
  stability: number
  stabilityFast: number
  difficulty: number
  state: number
  scheduleStatus: string
  dueAt: Date
  lastReviewAt: Date | null
  cardId: string
  reps: number
  lapses: number
  scheduledDays: number
  learningStep: number
  [k: string]: unknown
}

type Sched = Awaited<ReturnType<typeof DefaultScheduler>>
const cache = new Map<number, Promise<Sched>>()

export function getScheduler(desiredRetention = 0.9): Promise<Sched> {
  const key = Math.round(desiredRetention * 1000) / 1000
  let s = cache.get(key)
  if (!s) {
    s = DefaultScheduler({
      desiredRetention: key,
      enableFuzz: true,
      enableShortTerm: true,
      // keep short in-session steps for new language items instead of letting the model jump to days
      learningSteps: ['1m', '10m'],
      relearningSteps: ['10m'],
      allowModelOverride: false,
      maximumInterval: 3650,
    } as any)
    cache.set(key, s)
  }
  return s
}

export function newSrs(s: Sched, now: Date): SrsState {
  return s.newCard({ now }) as unknown as SrsState
}

export function reviewSrs(s: Sched, card: SrsState, grade: Grade, now: Date): SrsState {
  const r = (s as any).review({ card, grade, now })
  return r.card as SrsState
}

/** Preview the next due date for each grade (for button labels). */
export function previewSrs(s: Sched, card: SrsState, now: Date): Record<Grade, Date> {
  const out = {} as Record<Grade, Date>
  for (const item of (s as any).preview({ card, now })) out[item.grade as Grade] = item.card.dueAt
  return out
}

export function retrievability(s: Sched, card: SrsState, now: Date): number {
  if (card.state === State.New || !card.lastReviewAt) return 0
  const days = Math.max(0, s.chrono.difference(card.lastReviewAt, now) as number)
  const r = s.model.forgettingCurve(card as any, days) as number
  return Number.isFinite(r) ? r : 0
}

export const isDue = (c: SrsState, now: Date) => +c.dueAt <= +now
/** "Known" for honest metrics: graduated and survived at least ~3 weeks of stability. */
export const isMature = (c: SrsState) => c.state === State.Review && c.stability >= 21
/** "Learned" = passed the learning steps at least once (used for text coverage). */
export const isLearned = (c: SrsState) => c.reps > 0 && c.state !== State.New

export function formatInterval(from: Date, to: Date): string {
  const m = (+to - +from) / 60000
  if (m < 60) return `${Math.max(1, Math.round(m))}m`
  const h = m / 60
  if (h < 24) return `${Math.round(h)}h`
  const d = h / 24
  if (d < 30) return `${Math.round(d)}d`
  if (d < 365) return `${Math.round(d / 30)}mo`
  return `${(d / 365).toFixed(1)}y`
}

/** Dates become strings in JSON backups; restore them. */
export function reviveSrs(c: any): SrsState {
  return { ...c, dueAt: new Date(c.dueAt), lastReviewAt: c.lastReviewAt ? new Date(c.lastReviewAt) : null }
}
