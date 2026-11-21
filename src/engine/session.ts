// Pure session builder: minutes available + per-language state -> ordered list of activities.
export type ItemKind = 'script' | 'word' | 'grammar' | 'text'

export type Activity =
  | { type: 'review'; lang: string; cardIds: string[]; minutes: number }
  | { type: 'learn'; lang: string; refs: string[]; minutes: number }
  | { type: 'shadow'; lang: string; refs: string[]; minutes: number }
  | { type: 'read'; lang: string; textId: string; minutes: number }
  | { type: 'hvpt'; lang: string; contrastId: string; minutes: number }
  | { type: 'speak'; lang: string; promptId: string; minutes: number }
  | { type: 'fluency'; lang: string; promptId: string; minutes: number }

export interface LangInput {
  lang: string
  status: 'active' | 'maintenance'
  due: { id: string; kind: string }[]           // most overdue first
  newItems: { ref: string; kind: ItemKind }[]   // remaining curriculum, teaching order
  newWordsToday: number
  newWordCap: number
  texts: { id: string; coverage: number; minutes: number; reads: number }[]
  shadowRefs: string[]
  prompts: { id: string; fluency?: boolean }[]
  weakContrast?: string
  fluencyUnlocked: boolean
}

// Time estimates in minutes. shortcut: fixed guesses; upgrade by measuring real per-activity durations from logs.
export const COST = { review: 1 / 3, word: 1, script: 3, grammar: 3, text: 3, shadowEach: 0.75, speak: 2.5, fluency: 9, hvpt: 2.5 }
const MAINTENANCE_MAX = 2

/** Round-robin by kind so review is interleaved rather than blocked. */
export function interleave<T extends { kind: string }>(items: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const it of items) (groups.get(it.kind) ?? groups.set(it.kind, []).get(it.kind)!).push(it)
  const qs = [...groups.values()]
  const out: T[] = []
  while (out.length < items.length) for (const q of qs) { const x = q.shift(); if (x) out.push(x) }
  return out
}

function planReviews(lang: string, due: LangInput['due'], minutes: number): Activity | null {
  const n = Math.min(due.length, Math.floor(minutes / COST.review))
  if (n <= 0) return null
  return { type: 'review', lang, cardIds: interleave(due.slice(0, n)).map(d => d.id), minutes: n * COST.review }
}

function planActive(l: LangInput, budget: number): Activity[] {
  const short = budget <= 6
  const shadowN = short ? 1 : 2
  const shadow = Math.min(shadowN, Math.max(1, l.shadowRefs.length)) * COST.shadowEach
  const fluencyPrompt = l.fluencyUnlocked && budget >= 25 ? l.prompts.find(p => p.fluency) : undefined
  const speakPrompt = budget >= 12 ? l.prompts.find(p => !p.fluency) ?? l.prompts[0] : undefined
  const speak = fluencyPrompt ? COST.fluency : speakPrompt ? COST.speak : 0
  const hvpt = budget >= 12 && l.weakContrast ? COST.hvpt : 0
  const text = budget >= 12 ? [...l.texts].filter(t => t.coverage >= 0.9).sort((a, b) => a.reads - b.reads || b.coverage - a.coverage)[0] : undefined
  const read = text ? Math.min(text.minutes, budget * 0.25) : 0

  let rest = Math.max(0, budget - shadow - speak - hvpt - read)
  const dueTime = l.due.length * COST.review
  // reviews are capped so new material, input and speaking always get time (40% rule; short sessions are mostly review)
  let reviewMin = Math.min(dueTime, short ? rest : budget * 0.4, rest)
  let newBudget = rest - reviewMin

  const refs: string[] = []
  let used = 0, words = l.newWordsToday
  for (const it of l.newItems) {
    const c = COST[it.kind]
    if (used + c > newBudget + 1e-9) break
    if (it.kind === 'word' && words >= l.newWordCap) break
    refs.push(it.ref); used += c
    if (it.kind === 'word') words++
  }
  // leftover new-material time goes back to reviews if any are still due
  reviewMin = Math.min(dueTime, reviewMin + (newBudget - used))

  const out: Activity[] = []
  const rv = planReviews(l.lang, l.due, reviewMin)
  if (rv) out.push(rv)
  if (refs.length) out.push({ type: 'learn', lang: l.lang, refs, minutes: used })
  if (l.shadowRefs.length) out.push({ type: 'shadow', lang: l.lang, refs: l.shadowRefs.slice(0, shadowN), minutes: shadow })
  if (text) out.push({ type: 'read', lang: l.lang, textId: text.id, minutes: read })
  if (hvpt) out.push({ type: 'hvpt', lang: l.lang, contrastId: l.weakContrast!, minutes: hvpt })
  if (fluencyPrompt) out.push({ type: 'fluency', lang: l.lang, promptId: fluencyPrompt.id, minutes: speak })
  else if (speakPrompt) out.push({ type: 'speak', lang: l.lang, promptId: speakPrompt.id, minutes: speak })
  return out
}

export function buildSession(minutes: number, langs: LangInput[]): Activity[] {
  const maint = langs.filter(l => l.status === 'maintenance')
  const active = langs.filter(l => l.status === 'active')
  const out: Activity[] = []
  let left = minutes
  for (const m of maint) {
    const cap = Math.min(MAINTENANCE_MAX, minutes >= 15 ? MAINTENANCE_MAX : 1, left)
    const rv = planReviews(m.lang, m.due, cap)
    if (rv) { out.push(rv); left -= rv.minutes }
  }
  const per = active.length ? left / active.length : 0
  for (const a of active) out.push(...planActive(a, per))
  return out
}

export const totalMinutes = (acts: Activity[]) => acts.reduce((s, a) => s + a.minutes, 0)
