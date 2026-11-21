// Glue between the pure engine, the packs and IndexedDB. UI calls these.
import type { Pack, Word, Grammar, ScriptLesson, Text, Concept, CrossLink, PackIndexEntry } from './packs/types'
import { loadPack, loadIndex } from './packs/loader'
import type { CardRow, EventRow } from './engine/backup'
import { getScheduler, newSrs, reviewSrs, isDue, isLearned, State, type Grade } from './engine/scheduler'
import { buildSession, type LangInput, type Activity, type ItemKind } from './engine/session'
import { textCoverage } from './engine/coverage'
import { tokenize } from './engine/text'
import * as store from './store/db'

export type LangStatus = 'active' | 'maintenance' | 'queued'
export interface Settings {
  retention: number
  maintenanceRetention: number
  vowels: boolean
  translit: 'auto' | 'always' | 'never'
  newWordCap: number
  langs: Record<string, LangStatus>
  reminder: { hour: number; minute: number }
  lastBackup?: string
}
export interface Progress {
  introduced: string[]                      // unit item refs taught so far, in order
  textReads: Record<string, number>
  hvpt: Record<string, number[]>            // last trials per contrast: 1 correct / 0 wrong
  shadowed: Record<string, number>
}
export interface Research { id: string; title: string; evidence: string; why: string; caveat: string; sources: string[] }

export const DEFAULT_SETTINGS: Settings = {
  retention: 0.9, maintenanceRetention: 0.8, vowels: true, translit: 'auto', newWordCap: 15,
  langs: { ar: 'active' }, reminder: { hour: 20, minute: 0 },
}
const emptyProgress = (): Progress => ({ introduced: [], textReads: {}, hvpt: {}, shadowed: {} })

export interface World {
  index: PackIndexEntry[]
  concepts: Concept[]
  links: CrossLink[]
  research: Research[]
  packs: Record<string, Pack>
  settings: Settings
  progress: Record<string, Progress>
}

const BASE = import.meta.env.BASE_URL
const PACKS = BASE + 'packs/'

export async function loadWorld(): Promise<World> {
  const { index, concepts, links } = await loadIndex(PACKS)
  const research: Research[] = await fetch(PACKS + 'shared/research.json').then(r => r.json()).catch(() => [])
  const settings = { ...DEFAULT_SETTINGS, ...(await store.kvGet<Settings>('settings')) }
  const w: World = { index, concepts, links, research, packs: {}, settings, progress: {} }
  // queued languages are not loaded until you activate them
  const want = index.filter(e => e.status === 'available' && ['active', 'maintenance'].includes(settings.langs[e.id] ?? 'queued'))
  for (const e of want.length ? want : index.filter(e => e.status === 'available').slice(0, 1)) await ensurePack(w, e.id)
  return w
}

export async function ensurePack(w: World, lang: string) {
  if (w.packs[lang]) return w.packs[lang]
  const e = w.index.find(x => x.id === lang && x.status === 'available' && x.path)
  if (!e) throw new Error(`No pack for ${lang}`)
  w.packs[lang] = await loadPack(BASE + e.path, { concepts: w.concepts })
  w.progress[lang] = { ...emptyProgress(), ...(await store.kvGet<Progress>('progress:' + lang)) }
  return w.packs[lang]
}
export const frequencyUrl = (lang: string, file: string) => PACKS + lang + '/' + file

export const saveSettings = (s: Settings) => store.kvSet('settings', s)
export const saveProgress = (lang: string, p: Progress) => store.kvSet('progress:' + lang, p)

// ---------- lookups ----------
export function parseRef(ref: string): [ItemKind, string] { const i = ref.indexOf(':'); return [ref.slice(0, i) as ItemKind, ref.slice(i + 1)] }
export const wordById = (p: Pack, id: string) => p.words.find(w => w.id === id)
export const grammarById = (p: Pack, id: string) => p.grammar.find(g => g.id === id)
export const scriptById = (p: Pack, id: string) => p.scriptLessons.find(s => s.id === id)
export const textById = (p: Pack, id: string) => p.texts.find(t => t.id === id)
export function drillById(p: Pack, ref: string) {
  const [gid, did] = ref.split('/')
  const g = grammarById(p, gid)
  return g && { g, d: g.drills.find(d => d.id === did)! }
}
export function letterById(p: Pack, id: string) {
  for (const s of p.scriptLessons) { const l = s.letters.find(x => x.id === id); if (l) return { s, l } }
}
export function unitOf(p: Pack, ref: string) { return p.units.find(u => u.items.includes(ref)) }
export function currentUnitIndex(p: Pack, prog: Progress) {
  let idx = 0
  p.units.forEach((u, i) => { if (u.items.some(r => prog.introduced.includes(r))) idx = i })
  return idx
}
export const scriptDone = (p: Pack, prog: Progress) => p.scriptLessons.every(s => prog.introduced.includes('script:' + s.id))
export function showTranslit(s: Settings, p: Pack, prog: Progress, side: 'prompt' | 'answer') {
  if (s.translit === 'always') return true
  if (s.translit === 'never') return false
  return side === 'answer' || !scriptDone(p, prog) // auto: fade from prompts once the script course is done
}

// ---------- cards ----------
export function cardsForRef(lang: string, p: Pack, ref: string): { id: string; kind: string; ref: string }[] {
  const [k, id] = parseRef(ref)
  if (k === 'word') return [{ id: `${lang}:produce:${id}`, kind: 'produce', ref: id }, { id: `${lang}:listen:${id}`, kind: 'listen', ref: id }]
  if (k === 'grammar') return (grammarById(p, id)?.drills ?? []).map(d => ({ id: `${lang}:drill:${id}/${d.id}`, kind: 'drill', ref: `${id}/${d.id}` }))
  if (k === 'script') return (scriptById(p, id)?.letters ?? []).map(l => ({ id: `${lang}:script:${l.id}`, kind: 'script', ref: l.id }))
  return []
}

export async function introduce(w: World, lang: string, ref: string): Promise<string[]> {
  const p = w.packs[lang], prog = w.progress[lang]
  const s = await getScheduler(w.settings.retention)
  const now = new Date()
  const rows: CardRow[] = []
  for (const c of cardsForRef(lang, p, ref)) {
    if (await store.getCard(c.id)) continue
    rows.push({ ...c, lang, srs: newSrs(s, now), created: now })
  }
  await store.putCards(rows)
  if (!prog.introduced.includes(ref)) prog.introduced.push(ref)
  await saveProgress(lang, prog)
  return rows.map(r => r.id)
}

export async function grade(w: World, card: CardRow, g: Grade): Promise<CardRow> {
  const status = w.settings.langs[card.lang]
  const s = await getScheduler(status === 'maintenance' ? w.settings.maintenanceRetention : w.settings.retention)
  const now = new Date()
  const next: CardRow = { ...card, srs: reviewSrs(s, card.srs, g, now) }
  await store.putCard(next)
  await store.addLog({ cardId: card.id, lang: card.lang, kind: card.kind, grade: g, at: now, prevState: card.srs.state, prevStability: card.srs.stability })
  return next
}

export async function addMistakeCards(w: World, lang: string, ms: { said: string; correct: string; note: string }[]) {
  const s = await getScheduler(w.settings.retention)
  const now = new Date()
  const rows: CardRow[] = ms.map((m, i) => ({
    id: `${lang}:mistake:${+now}-${i}`, lang, kind: 'mistake', ref: `${+now}-${i}`, srs: newSrs(s, now), created: now,
    extra: { said: m.said, correct: m.correct, note: m.note },
  }))
  await store.putCards(rows)
  return rows.length
}

export const logEvent = (e: Omit<EventRow, 'at'>) => store.addEvent({ ...e, at: new Date() })

// ---------- session ----------
export function learnedWordIds(cards: CardRow[], lang: string) {
  return cards.filter(c => c.lang === lang && c.kind === 'produce' && isLearned(c.srs)).map(c => c.ref)
}
export const textMinutes = (t: Text) => Math.max(1, Math.round(t.lines.reduce((n, l) => n + tokenize(l.text).length, 0) / 40))

export function langInput(w: World, lang: string, cards: CardRow[], now = new Date()): LangInput {
  const p = w.packs[lang], prog = w.progress[lang]
  const mine = cards.filter(c => c.lang === lang)
  const due = mine.filter(c => isDue(c.srs, now)).sort((a, b) => +a.srs.dueAt - +b.srs.dueAt).map(c => ({ id: c.id, kind: c.kind }))
  const curriculum = p.units.flatMap(u => u.items)
  const newItems = curriculum.filter(r => !prog.introduced.includes(r)).map(r => ({ ref: r, kind: parseRef(r)[0] }))
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const newWordsToday = mine.filter(c => c.kind === 'produce' && +c.created >= +today).length
  const learned = learnedWordIds(cards, lang)
  const curriculumTexts = new Set(curriculum.filter(r => r.startsWith('text:')).map(r => r.slice(5)))
  const texts = p.texts
    .filter(t => !curriculumTexts.has(t.id) || prog.introduced.includes('text:' + t.id))
    .map(t => ({ id: t.id, coverage: textCoverage(p, t, learned).ratio, minutes: textMinutes(t), reads: prog.textReads[t.id] ?? 0 }))
  const introducedWords = prog.introduced.filter(r => r.startsWith('word:'))
  const recent = introducedWords.slice(-12).sort((a, b) => (prog.shadowed[a] ?? 0) - (prog.shadowed[b] ?? 0))
  const shadowRefs = recent.length ? recent : curriculum.filter(r => r.startsWith('word:')).slice(0, 3)
  const unitIdx = currentUnitIndex(p, prog)
  const prompts = p.speaking.filter(s => Number(s.level.replace(/\D/g, '')) <= unitIdx + 1).reverse()
  const contrastAcc = (id: string) => { const r = prog.hvpt[id] ?? []; return r.length ? r.reduce((a, b) => a + b, 0) / r.length : -1 }
  const untrained = p.contrasts.find(c => !(prog.hvpt[c.id]?.length))
  const weakest = [...p.contrasts].sort((a, b) => contrastAcc(a.id) - contrastAcc(b.id))[0]
  const weakContrast = introducedWords.length >= 8 ? (untrained?.id ?? (weakest && contrastAcc(weakest.id) < 0.9 ? weakest.id : undefined)) : undefined
  return {
    lang, status: w.settings.langs[lang] === 'maintenance' ? 'maintenance' : 'active',
    due, newItems, newWordsToday, newWordCap: w.settings.newWordCap, texts, shadowRefs,
    prompts: prompts.map(s => ({ id: s.id, fluency: s.fluency })), weakContrast,
    fluencyUnlocked: introducedWords.length >= 80,
  }
}

export async function buildToday(w: World, minutes: number): Promise<Activity[]> {
  const cards = await store.getAllCards()
  const langs = Object.keys(w.packs).filter(l => ['active', 'maintenance'].includes(w.settings.langs[l] ?? ''))
  return buildSession(minutes, langs.map(l => langInput(w, l, cards)))
}

export function dueCount(cards: CardRow[], lang: string, now = new Date()) {
  return cards.filter(c => c.lang === lang && isDue(c.srs, now) && c.srs.state !== State.New).length
}
export type { Word, Grammar, ScriptLesson, Text }
