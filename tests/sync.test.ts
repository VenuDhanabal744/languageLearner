import { describe, it, expect } from 'vitest'
import { mergeData, mergeKv, sameData, gzipB64, gunzipBytes, b64Bytes } from '../src/engine/sync'
import { makeBackup, parseBackup, type BackupData, type CardRow } from '../src/engine/backup'

const card = (id: string, last: string | null, reps = 1): CardRow => ({
  id, lang: 'ar', kind: 'produce', ref: 'word:' + id, created: new Date('2026-11-01'),
  srs: { dueAt: new Date('2026-11-25'), lastReviewAt: last ? new Date(last) : null, reps, state: 2 } as any,
})
const empty = (): BackupData => ({ cards: [], logs: [], events: [], flags: [], kv: [], recordings: [] })

describe('sync merge', () => {
  it('keeps the most recently reviewed version of each card and unions the rest', () => {
    const phone = { ...empty(), cards: [card('a', '2026-11-20'), card('b', '2026-11-10')] }
    const ipad = { ...empty(), cards: [card('a', '2026-11-18'), card('b', '2026-11-21'), card('c', null, 0)] }
    const m = mergeData(phone, ipad)
    expect(m.cards.map(c => [c.id, c.srs.lastReviewAt?.toISOString().slice(0, 10) ?? null])).toEqual([['a', '2026-11-20'], ['b', '2026-11-21'], ['c', null]])
  })
  it('unions review logs by content, ignoring device-local ids, without duplicates', () => {
    const at = new Date('2026-11-20T10:00:00Z')
    const log = (id: number, cardId: string) => ({ id, cardId, lang: 'ar', kind: 'produce', grade: 3, at, prevState: 0, prevStability: 0 })
    const m = mergeData({ ...empty(), logs: [log(1, 'a'), log(2, 'b')] }, { ...empty(), logs: [log(1, 'c'), log(7, 'a')] })
    expect(m.logs.map(l => l.cardId)).toEqual(['a', 'b', 'c'])
    expect(m.logs.every(l => l.id === undefined)).toBe(true)
  })
  it('settings: last write wins; progress: union of taught items, max counts', () => {
    expect(mergeKv('settings', { vowels: true, updatedAt: 5 }, { vowels: false, updatedAt: 9 }).vowels).toBe(false)
    expect(mergeKv('settings', { vowels: true, updatedAt: 9 }, { vowels: false }).vowels).toBe(true)
    const p = mergeKv('progress:ar', { introduced: ['word:a', 'word:b'], textReads: { d01: 2 }, shadowed: {}, hvpt: { x: [1] } },
      { introduced: ['word:a', 'word:c'], textReads: { d01: 1, d02: 1 }, shadowed: { s: 1 }, hvpt: { x: [1, 0, 1] } })
    expect(p).toEqual({ introduced: ['word:a', 'word:b', 'word:c'], textReads: { d01: 2, d02: 1 }, shadowed: { s: 1 }, hvpt: { x: [1, 0, 1] } })
  })
  it('never syncs device-only keys such as the token', () => {
    const m = mergeData({ ...empty(), kv: [['device:sync', { token: 'secret' }], ['settings', { updatedAt: 1 }]] }, empty())
    expect(m.kv.map(([k]) => k)).toEqual(['settings'])
  })
  it('merge is order-independent and idempotent', () => {
    const a = { ...empty(), cards: [card('a', '2026-11-20')], kv: [['progress:ar', { introduced: ['word:a'], textReads: {}, shadowed: {}, hvpt: {} }]] as [string, unknown][] }
    const b = { ...empty(), cards: [card('b', '2026-11-21')], kv: [['progress:ar', { introduced: ['word:b'], textReads: {}, shadowed: {}, hvpt: {} }]] as [string, unknown][] }
    const ab = mergeData(a, b)
    expect(sameData(ab, mergeData(ab, b))).toBe(true)
    expect(ab.cards).toEqual(mergeData(b, a).cards)
  })
  it('round-trips through gzip+base64 and the backup parser', async () => {
    const d = mergeData({ ...empty(), cards: [card('a', '2026-11-20')] }, empty())
    const text = makeBackup(d)
    const back = parseBackup(await gunzipBytes(b64Bytes(await gzipB64(text))))
    expect(sameData(back, d)).toBe(true)
  })
})
